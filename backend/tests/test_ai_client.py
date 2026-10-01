"""
AIClient: one request shape for any OpenAI-compatible endpoint.

Driven by a fake SDK client that records each request and plays back
replies or errors, standing in for endpoints that differ in what they accept.
"""

import json
from types import SimpleNamespace

import httpx
import openai
import pytest

from database.models import AIUsage
from services import ai_client
from services.ai_client import (
    JSON_OBJECT,
    JSON_SCHEMA,
    MAX_TOKENS,
    PROMPT_ONLY,
    AIClient,
    Capabilities,
    ResolvedProvider,
    operator_provider,
)
from services.ai_errors import AUTH, BAD_REQUEST, BAD_RESPONSE, NOT_CONFIGURED, AIError
from services.ai_usage import QUALITATIVE_CHECK, usage_recorder

SCHEMA = {
    "type": "object",
    "properties": {"answer": {"type": "string"}},
    "required": ["answer"],
    "additionalProperties": False,
}
_REQUEST = httpx.Request("POST", "https://llm.example/v1/chat/completions")


def _reply(content, prompt_tokens=120, completion_tokens=30, finish_reason="stop"):
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(content=content, refusal=None), finish_reason=finish_reason
            )
        ],
        usage=SimpleNamespace(prompt_tokens=prompt_tokens, completion_tokens=completion_tokens),
    )


def _rejected(message, status=400, cls=openai.BadRequestError):
    response = httpx.Response(status, request=_REQUEST)
    return cls(message, response=response, body={"message": message})


class FakeEndpoint:
    """Plays back `outcomes` in order: a reply, or an exception to raise."""

    def __init__(self, *outcomes):
        self.outcomes = list(outcomes)
        self.requests = []
        self.client_kwargs = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **request):
        self.requests.append(request)
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    def factory(self, **kwargs):
        self.client_kwargs.append(kwargs)
        return self


def _call(endpoint, provider=None, record=None, **overrides):
    provider = provider or ResolvedProvider(api_key="sk-test", model="some-model")
    arguments = {
        "name": "answer",
        "system": "You answer.",
        "user": "Question?",
        "schema": SCHEMA,
        "max_output": 400,
        "record": record,
    }
    arguments.update(overrides)
    client = AIClient(client_factory=endpoint.factory, temperature=0.2)
    return client.complete_json(provider, **arguments), provider


class TestRequestShape:
    def test_most_capable_by_default(self):
        endpoint = FakeEndpoint(_reply('{"answer": "yes"}'))
        data, _ = _call(endpoint)

        request = endpoint.requests[0]
        assert data == {"answer": "yes"}
        assert request["response_format"]["type"] == "json_schema"
        assert request["response_format"]["json_schema"]["strict"] is True
        assert request["max_completion_tokens"] == 400
        assert request["temperature"] == 0.2

    def test_json_object_mode_puts_the_schema_in_the_prompt(self):
        provider = ResolvedProvider(
            api_key="k", model="m", capabilities=Capabilities(structured_output=JSON_OBJECT)
        )
        endpoint = FakeEndpoint(_reply('{"answer": "yes"}'))
        _call(endpoint, provider)

        request = endpoint.requests[0]
        assert request["response_format"] == {"type": "json_object"}
        assert json.dumps(SCHEMA) in request["messages"][0]["content"]

    def test_prompt_only_mode_sends_no_response_format(self):
        provider = ResolvedProvider(
            api_key="k", model="m", capabilities=Capabilities(structured_output=PROMPT_ONLY)
        )
        endpoint = FakeEndpoint(_reply('{"answer": "yes"}'))
        _call(endpoint, provider)

        assert "response_format" not in endpoint.requests[0]

    def test_base_url_and_key_reach_the_sdk(self):
        provider = ResolvedProvider(
            api_key="sk-azure", model="gpt-4o", base_url="https://r.openai.azure.com/openai/v1/"
        )
        endpoint = FakeEndpoint(_reply('{"answer": "yes"}'))
        _call(endpoint, provider)

        assert endpoint.client_kwargs == [
            {"api_key": "sk-azure", "base_url": "https://r.openai.azure.com/openai/v1/"}
        ]


class TestSteppingDown:
    def test_temperature_rejected_by_a_reasoning_model(self):
        endpoint = FakeEndpoint(
            _rejected("Unsupported value: 'temperature' does not support 0.2 with this model."),
            _reply('{"answer": "yes"}'),
            _reply('{"answer": "again"}'),
        )
        _, provider = _call(endpoint)
        assert "temperature" not in endpoint.requests[1]

        # Learned: the next call does not send it at all.
        _call(endpoint, provider)
        assert "temperature" not in endpoint.requests[2]
        assert len(endpoint.requests) == 3

    def test_old_server_without_max_completion_tokens(self):
        endpoint = FakeEndpoint(
            _rejected("Unrecognized request argument supplied: max_completion_tokens"),
            _reply('{"answer": "yes"}'),
        )
        _, provider = _call(endpoint)

        assert endpoint.requests[1]["max_tokens"] == 400
        assert "max_completion_tokens" not in endpoint.requests[1]
        assert provider.capabilities.token_param == MAX_TOKENS

    def test_structured_output_unsupported_all_the_way_down(self):
        endpoint = FakeEndpoint(
            _rejected(
                "response_format json_schema is not supported",
                status=422,
                cls=openai.UnprocessableEntityError,
            ),
            _rejected("response_format json_object is not supported"),
            _reply('Sure! ```json\n{"answer": "yes"}\n```'),
        )
        data, provider = _call(endpoint)

        assert data == {"answer": "yes"}
        assert provider.capabilities.structured_output == PROMPT_ONLY
        assert "response_format" not in endpoint.requests[2]

    def test_an_unrelated_rejection_is_not_retried(self):
        endpoint = FakeEndpoint(
            _rejected("The model `gpt-9` does not exist", status=404, cls=openai.NotFoundError)
        )
        with pytest.raises(AIError) as raised:
            _call(endpoint)
        assert raised.value.category == BAD_REQUEST
        assert len(endpoint.requests) == 1

    def test_a_bad_request_naming_nothing_adjustable_stands(self):
        endpoint = FakeEndpoint(_rejected("This model's maximum context length is 8192 tokens"))
        with pytest.raises(AIError) as raised:
            _call(endpoint)
        assert raised.value.category == BAD_REQUEST
        assert len(endpoint.requests) == 1


class TestReplies:
    def test_reply_not_matching_the_schema(self):
        endpoint = FakeEndpoint(_reply('{"answer": 42}'))
        with pytest.raises(AIError) as raised:
            _call(endpoint)
        assert raised.value.category == BAD_RESPONSE
        assert "answer" in raised.value.message

    def test_check_schema_replaces_the_request_schema_for_validation(self):
        endpoint = FakeEndpoint(_reply('{"answer": 42}'))
        data, _ = _call(endpoint, check_schema={"type": "object"})
        assert data == {"answer": 42}

    def test_refusal(self):
        reply = _reply(None)
        reply.choices[0].message.refusal = "I can't help with that."
        with pytest.raises(AIError) as raised:
            _call(FakeEndpoint(reply))
        assert raised.value.category == BAD_REQUEST
        assert "declined" in raised.value.message

    def test_provider_error_is_classified(self):
        endpoint = FakeEndpoint(
            _rejected("Incorrect API key", status=401, cls=openai.AuthenticationError)
        )
        with pytest.raises(AIError) as raised:
            _call(endpoint)
        assert raised.value.category == AUTH


class TestUsage:
    def test_success_records_tokens(self):
        calls = []
        _call(FakeEndpoint(_reply('{"answer": "yes"}', 120, 30)), record=lambda *a: calls.append(a))
        assert calls == [("some-model", "ok", 120, 30)]

    def test_failure_records_the_category(self):
        calls = []
        endpoint = FakeEndpoint(
            _rejected("Incorrect API key", status=401, cls=openai.AuthenticationError)
        )
        with pytest.raises(AIError):
            _call(endpoint, record=lambda *a: calls.append(a))
        assert calls == [("some-model", AUTH, None, None)]

    def test_a_broken_recorder_does_not_lose_the_answer(self):
        def broken(*_):
            raise RuntimeError("database down")

        data, _ = _call(FakeEndpoint(_reply('{"answer": "yes"}')), record=broken)
        assert data == {"answer": "yes"}

    def test_recorder_writes_a_row(self, test_db, test_survey_config):
        record = usage_recorder(test_db, test_survey_config.survey_id, QUALITATIVE_CHECK, 7)
        _call(FakeEndpoint(_reply('{"answer": "yes"}', 120, 30)), record=record)

        row = test_db.query(AIUsage).one()
        assert (row.feature, row.submission_id, row.model, row.outcome) == (
            QUALITATIVE_CHECK,
            7,
            "some-model",
            "ok",
        )
        assert (row.input_tokens, row.output_tokens) == (120, 30)


class TestOperatorProvider:
    @pytest.fixture(autouse=True)
    def _clean(self, monkeypatch):
        monkeypatch.delenv("OPENAI_BASE_URL", raising=False)
        ai_client._OPERATOR_CAPABILITIES.clear()

    def test_no_key(self, monkeypatch):
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        with pytest.raises(AIError) as raised:
            operator_provider("gpt-5-mini")
        assert raised.value.category == NOT_CONFIGURED

    def test_base_url_from_the_environment(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-op")
        monkeypatch.setenv("OPENAI_BASE_URL", "https://openrouter.ai/api/v1")
        provider = operator_provider("mistral-small")
        assert (provider.base_url, provider.model, provider.connection_id) == (
            "https://openrouter.ai/api/v1",
            "mistral-small",
            None,
        )

    def test_what_a_model_rejects_is_learned_once_per_process(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-op")
        operator_provider("gpt-5-mini").capabilities.temperature = False

        assert operator_provider("gpt-5-mini").capabilities.temperature is False
        assert operator_provider("gpt-4o-mini").capabilities.temperature is True
        assert operator_provider("gpt-4o-mini").capabilities.structured_output == JSON_SCHEMA
