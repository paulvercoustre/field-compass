"""
AIClient: one request shape for any OpenAI-compatible endpoint.

Driven by a fake SDK client that records each request and plays back
replies or errors, standing in for endpoints that differ in what they accept.
"""

import json
from types import SimpleNamespace
from uuid import uuid4

import httpx
import openai
import pytest

from database.models import AIUsage, User
from services import ai_client
from services.ai_client import (
    JSON_OBJECT,
    JSON_SCHEMA,
    MAX_TOKENS,
    PROMPT_ONLY,
    AIClient,
    CallUsage,
    Capabilities,
    ResolvedProvider,
    operator_provider,
    safety_identifier,
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


def _reply(
    content,
    prompt_tokens=120,
    completion_tokens=30,
    finish_reason="stop",
    cached_tokens=None,
    reasoning_tokens=None,
):
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(content=content, refusal=None), finish_reason=finish_reason
            )
        ],
        usage=SimpleNamespace(
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            prompt_tokens_details=SimpleNamespace(cached_tokens=cached_tokens),
            completion_tokens_details=SimpleNamespace(reasoning_tokens=reasoning_tokens),
        ),
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

        kwargs = endpoint.client_kwargs[0]
        assert (kwargs["api_key"], kwargs["base_url"]) == (
            "sk-azure",
            "https://r.openai.azure.com/openai/v1/",
        )

    def test_reasoning_effort_only_when_asked(self):
        endpoint = FakeEndpoint(_reply('{"answer": "yes"}'), _reply('{"answer": "yes"}'))
        _call(endpoint)
        _call(endpoint, reasoning_effort="low")
        assert "reasoning_effort" not in endpoint.requests[0]
        assert endpoint.requests[1]["reasoning_effort"] == "low"

    def test_redirects_are_not_followed(self):
        endpoint = FakeEndpoint(_reply('{"answer": "yes"}'))
        _call(endpoint)
        assert endpoint.client_kwargs[0]["http_client"].follow_redirects is False

    def test_default_endpoint_is_explicit(self):
        endpoint = FakeEndpoint(_reply('{"answer": "yes"}'))
        _call(endpoint)
        assert endpoint.client_kwargs[0]["base_url"] == "https://api.openai.com/v1"

    def test_empty_base_url_in_the_environment_is_not_used(self, monkeypatch):
        """Compose sets OPENAI_BASE_URL="" when unset; the real SDK must not pick it up."""
        monkeypatch.setenv("OPENAI_BASE_URL", "")
        captured = []

        def real_sdk(**kwargs):
            client = openai.OpenAI(**kwargs)
            captured.append(str(client.base_url))
            return FakeEndpoint(_reply('{"answer": "yes"}'))

        AIClient(client_factory=real_sdk).complete_json(
            ResolvedProvider(api_key="sk-test", model="m"),
            name="answer",
            system="s",
            user="u",
            schema=SCHEMA,
            max_output=10,
        )
        assert captured == ["https://api.openai.com/v1/"]


class TestRealSdk:
    """Requests built by the installed openai SDK, not the fake endpoint.

    The fake accepts any keyword, so it never noticed that openai 1.54 had no
    reasoning_effort: every rule written on the operator key failed with a
    TypeError inside the SDK, reported as "AI generated an invalid response".
    """

    @staticmethod
    def _sdk_with_transport(sent):
        def handler(request: httpx.Request) -> httpx.Response:
            sent.append(json.loads(request.content))
            return httpx.Response(
                200,
                json={
                    "id": "chatcmpl-1",
                    "object": "chat.completion",
                    "created": 0,
                    "model": "gpt-5",
                    "choices": [
                        {
                            "index": 0,
                            "finish_reason": "stop",
                            "message": {"role": "assistant", "content": '{"answer": "yes"}'},
                        }
                    ],
                    "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
                },
            )

        def factory(**kwargs):
            kwargs["http_client"] = httpx.Client(transport=httpx.MockTransport(handler))
            return openai.OpenAI(**kwargs)

        return factory

    def test_every_option_the_client_sends_is_accepted(self):
        sent = []
        data = AIClient(client_factory=self._sdk_with_transport(sent)).complete_json(
            ResolvedProvider(api_key="sk-test", model="gpt-5"),
            name="answer",
            system="s",
            user="u",
            schema=SCHEMA,
            max_output=400,
            end_user="user-1",
            reasoning_effort="low",
        )

        assert data == {"answer": "yes"}
        body = sent[0]
        assert body["reasoning_effort"] == "low"
        assert body["max_completion_tokens"] == 400
        assert body["response_format"]["type"] == "json_schema"
        assert "safety_identifier" in body


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

    def test_reasoning_effort_rejected_by_a_non_reasoning_model(self):
        endpoint = FakeEndpoint(
            _rejected("Unrecognized request argument supplied: reasoning_effort"),
            _reply('{"answer": "yes"}'),
            _reply('{"answer": "again"}'),
        )
        _, provider = _call(endpoint, reasoning_effort="low")
        assert endpoint.requests[0]["reasoning_effort"] == "low"
        assert "reasoning_effort" not in endpoint.requests[1]

        _call(endpoint, provider, reasoning_effort="low")
        assert "reasoning_effort" not in endpoint.requests[2]

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
        """Wrong twice -- once as asked, once with the shape in the prompt -- fails."""
        endpoint = FakeEndpoint(_reply('{"answer": 42}'), _reply('{"answer": 43}'))
        with pytest.raises(AIError) as raised:
            _call(endpoint)
        assert raised.value.category == BAD_RESPONSE
        assert "answer" in raised.value.message
        assert len(endpoint.requests) == 2

    def test_ignored_response_format_is_learned(self):
        """Anthropic's compatibility layer accepts response_format and ignores it."""
        endpoint = FakeEndpoint(
            _reply("Sure, the connection works!", 100, 20),
            _reply('{"answer": "yes"}', 300, 25),
            _reply('{"answer": "again"}'),
        )
        calls = []
        data, provider = _call(endpoint, record=calls.append)

        assert data == {"answer": "yes"}
        assert provider.capabilities.structured_output == PROMPT_ONLY
        retry = endpoint.requests[1]
        assert "response_format" not in retry
        assert json.dumps(SCHEMA) in retry["messages"][0]["content"]
        # Both calls were billed.
        assert (calls[0].input_tokens, calls[0].output_tokens) == (400, 45)

        _call(endpoint, provider)  # remembered: no wasted first attempt
        assert "response_format" not in endpoint.requests[2]

    def test_a_reply_cut_off_by_the_limit_is_not_retried(self):
        endpoint = FakeEndpoint(_reply('{"answ', finish_reason="length"))
        with pytest.raises(AIError) as raised:
            _call(endpoint)
        assert len(endpoint.requests) == 1
        assert "ran out of output tokens" in raised.value.message

    def test_reasoning_that_used_the_whole_limit(self):
        """A reasoning model can spend every output token thinking."""
        endpoint = FakeEndpoint(
            _reply("", completion_tokens=5000, reasoning_tokens=5000, finish_reason="length")
        )
        with pytest.raises(AIError) as raised:
            _call(endpoint)
        assert raised.value.category == BAD_RESPONSE
        assert "ran out of output tokens" in raised.value.message

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
        reply = _reply('{"answer": "yes"}', 120, 30, cached_tokens=100, reasoning_tokens=20)
        _call(FakeEndpoint(reply), record=calls.append)
        assert calls == [CallUsage("some-model", "ok", 120, 30, 100, 20)]

    def test_failure_records_the_category(self):
        calls = []
        endpoint = FakeEndpoint(
            _rejected("Incorrect API key", status=401, cls=openai.AuthenticationError)
        )
        with pytest.raises(AIError):
            _call(endpoint, record=calls.append)
        assert calls == [CallUsage("some-model", AUTH)]

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
        assert row.cost_usd_micros is None  # "some-model" has no price

    def test_recorder_bills_the_owner_and_prices_the_call(self, test_db, test_survey_config):
        owner = User(user_id=uuid4(), email="o@example.invalid", username="o", password_hash="x")
        test_db.add(owner)
        test_db.commit()
        record = usage_recorder(
            test_db, test_survey_config.survey_id, QUALITATIVE_CHECK, billed_user_id=owner.user_id
        )
        provider = ResolvedProvider(api_key="sk-test", model="gpt-5-mini")
        reply = _reply('{"answer": "yes"}', 1300, 600, cached_tokens=300, reasoning_tokens=450)
        _call(FakeEndpoint(reply), provider, record=record)

        row = test_db.query(AIUsage).one()
        assert row.billed_user_id == owner.user_id
        assert (row.cached_input_tokens, row.reasoning_tokens) == (300, 450)
        # 1000 x 0.25 + 300 x 0.025 + 600 x 2.00 micro-dollars
        assert row.cost_usd_micros == 1458


class TestEndUser:
    def test_sent_hashed_to_openai(self):
        endpoint = FakeEndpoint(_reply('{"answer": "yes"}'))
        _call(endpoint, end_user="2f6d1c0e-user")

        sent = endpoint.requests[0]["extra_body"]["safety_identifier"]
        assert sent == safety_identifier("2f6d1c0e-user")
        assert "2f6d1c0e-user" not in sent and len(sent) == 32

    def test_not_sent_to_other_endpoints(self):
        """Another endpoint may reject a field it does not know."""
        provider = ResolvedProvider(
            api_key="k", model="m", base_url="https://ours.openai.azure.com/v1"
        )
        endpoint = FakeEndpoint(_reply('{"answer": "yes"}'))
        _call(endpoint, provider, end_user="2f6d1c0e-user")
        assert "extra_body" not in endpoint.requests[0]


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
