"""
The one place that talks to an AI provider.

Every AI feature -- writing a rule, suggesting rules, checking answers -- asks
for a JSON object matching a schema. :class:`AIClient` sends that request to
any OpenAI-compatible endpoint, checks the reply against the schema, records
the call in ``ai_usage``, and either returns the object or raises an
:class:`~services.ai_errors.AIError`. It never returns a default on failure.

Endpoints differ in three request details, so each provider carries a
:class:`Capabilities` profile rather than the code branching on model names:

- structured output: ``json_schema`` (strict), ``json_object``, or neither;
- the output limit is ``max_completion_tokens`` or the older ``max_tokens``;
- whether a ``temperature`` is accepted (reasoning models reject one).

A profile starts at the most capable setting. When an endpoint rejects a
request because of one of these details, the client steps that detail down
and tries again, and the provider keeps what it learned -- for the operator
key, for the life of the process.

See docs/specs/ai-provider-overhaul.md, section 6.1.
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

import jsonschema
import openai

from services.ai_errors import BAD_REQUEST, BAD_RESPONSE, NOT_CONFIGURED, AIError, classify

logger = logging.getLogger(__name__)

JSON_SCHEMA = "json_schema"
JSON_OBJECT = "json_object"
PROMPT_ONLY = "prompt_only"

# Passed explicitly, never left to the SDK: given no base URL, the SDK reads
# OPENAI_BASE_URL from the environment itself -- and docker compose sets it
# to "" when unset, which sent every request to an empty address.
DEFAULT_BASE_URL = "https://api.openai.com/v1"

MAX_COMPLETION_TOKENS = "max_completion_tokens"
MAX_TOKENS = "max_tokens"

# Called once per call: (model, outcome, input_tokens, output_tokens).
UsageRecorder = Callable[[str, str, int | None, int | None], None]


@dataclass
class Capabilities:
    structured_output: str = JSON_SCHEMA
    token_param: str = MAX_COMPLETION_TOKENS
    temperature: bool = True

    def step_down(self, rejection: str) -> bool:
        """
        Adjust to an endpoint that rejected a request, from its error text.

        Returns False when the rejection names nothing this can change.
        """
        text = rejection.lower()
        if self.temperature and "temperature" in text:
            self.temperature = False
            return True
        if self.token_param in text:
            self.token_param = (
                MAX_TOKENS if self.token_param == MAX_COMPLETION_TOKENS else MAX_COMPLETION_TOKENS
            )
            return True
        if self.structured_output != PROMPT_ONLY and (
            "response_format" in text or "json_schema" in text or "json_object" in text
        ):
            self.structured_output = (
                JSON_OBJECT if self.structured_output == JSON_SCHEMA else PROMPT_ONLY
            )
            return True
        return False


@dataclass
class ResolvedProvider:
    """Where a call goes: an endpoint, a key, a model, and what it supports."""

    api_key: str
    model: str
    base_url: str | None = None
    capabilities: Capabilities = field(default_factory=Capabilities)
    connection_id: UUID | None = None  # None: the operator's key


# The operator key's profiles, per (base_url, model), shared by every call in
# this process so a rejected parameter is learned once.
_OPERATOR_CAPABILITIES: dict[tuple[str | None, str], Capabilities] = {}


def operator_provider(model: str) -> ResolvedProvider:
    """The operator's own key, from the environment."""
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise AIError(NOT_CONFIGURED, "No AI provider is configured (OPENAI_API_KEY).")
    base_url = os.getenv("OPENAI_BASE_URL") or None
    capabilities = _OPERATOR_CAPABILITIES.setdefault((base_url, model), Capabilities())
    return ResolvedProvider(
        api_key=api_key, model=model, base_url=base_url, capabilities=capabilities
    )


def _schema_instructions(schema: dict[str, Any]) -> str:
    return (
        "\n\nReply with a single JSON object and nothing else. It must match this "
        f"JSON Schema exactly:\n{json.dumps(schema)}"
    )


def _first_json_object(text: str) -> Any:
    """The reply's JSON: all of it, or the outermost {...} when wrapped in prose or fences."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass
    raise AIError(BAD_RESPONSE, "The AI reply was not valid JSON.")


class AIClient:
    """Sends schema-shaped requests to OpenAI-compatible endpoints."""

    # Rejections of a request detail the profile can step down from. Three
    # details, so at most three retries before the rejection stands.
    _MAX_STEP_DOWNS = 3

    def __init__(
        self,
        *,
        timeout: float = 120,
        temperature: float = 0.2,
        client_factory: Callable[..., Any] = openai.OpenAI,
    ):
        self.timeout = timeout
        self.temperature = temperature
        self._client_factory = client_factory

    def complete_json(
        self,
        provider: ResolvedProvider,
        *,
        name: str,
        system: str,
        user: str,
        schema: dict[str, Any],
        max_output: int,
        check_schema: dict[str, Any] | None = None,
        record: UsageRecorder | None = None,
    ) -> dict[str, Any]:
        """
        Ask for a JSON object matching ``schema``; return it or raise AIError.

        ``check_schema`` validates the reply instead of ``schema`` -- for
        callers that would rather drop a bad item than the whole reply.
        ``record`` is told about every call, successful or not.
        """
        client = self._client_factory(
            api_key=provider.api_key,
            base_url=provider.base_url or DEFAULT_BASE_URL,
            # The SDK follows redirects by default. A user-supplied endpoint
            # must not bounce requests to an address it could not name itself.
            http_client=openai.DefaultHttpxClient(follow_redirects=False),
        )
        capabilities = provider.capabilities
        input_tokens = output_tokens = None
        outcome = "ok"
        started = time.time()
        try:
            for attempt in range(self._MAX_STEP_DOWNS + 1):
                request = self._request(
                    provider, capabilities, name, system, user, schema, max_output
                )
                try:
                    response = client.chat.completions.create(**request)
                    break
                # Endpoints reject an unknown parameter with 400 or 422.
                except (openai.BadRequestError, openai.UnprocessableEntityError) as exc:
                    if attempt < self._MAX_STEP_DOWNS and capabilities.step_down(str(exc)):
                        logger.info(
                            "AI endpoint %s rejected a request detail for %s; now %s",
                            provider.base_url or "openai",
                            provider.model,
                            capabilities,
                        )
                        continue
                    raise

            usage = getattr(response, "usage", None)
            input_tokens = getattr(usage, "prompt_tokens", None)
            output_tokens = getattr(usage, "completion_tokens", None)
            data = self._parse(response)
            self._validate(data, check_schema or schema)
            return data
        except Exception as exc:
            error = classify(exc)
            outcome = error.category
            raise error from exc
        finally:
            close = getattr(client, "close", None)
            if callable(close):
                close()
            logger.info(
                "AI call %s model=%s outcome=%s in=%s out=%s %.1fs",
                name,
                provider.model,
                outcome,
                input_tokens,
                output_tokens,
                time.time() - started,
            )
            if record is not None:
                try:
                    record(provider.model, outcome, input_tokens, output_tokens)
                except Exception:
                    logger.exception("Could not record AI usage")

    def _request(
        self,
        provider: ResolvedProvider,
        capabilities: Capabilities,
        name: str,
        system: str,
        user: str,
        schema: dict[str, Any],
        max_output: int,
    ) -> dict[str, Any]:
        if capabilities.structured_output != JSON_SCHEMA:
            system = system + _schema_instructions(schema)
        request: dict[str, Any] = {
            "model": provider.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            capabilities.token_param: max_output,
            "timeout": self.timeout,
        }
        if capabilities.structured_output == JSON_SCHEMA:
            request["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": name, "strict": True, "schema": schema},
            }
        elif capabilities.structured_output == JSON_OBJECT:
            request["response_format"] = {"type": "json_object"}
        if capabilities.temperature:
            request["temperature"] = self.temperature
        return request

    @staticmethod
    def _parse(response: Any) -> Any:
        choice = response.choices[0]
        refusal = getattr(choice.message, "refusal", None)
        if refusal:
            raise AIError(BAD_REQUEST, f"The AI declined: {refusal}")
        content = choice.message.content
        if not content:
            reason = getattr(choice, "finish_reason", None)
            detail = "it ran out of output tokens" if reason == "length" else "it was empty"
            raise AIError(BAD_RESPONSE, f"The AI reply could not be used: {detail}.")
        # Leniently, whatever was asked for: some endpoints accept
        # response_format and still wrap the JSON in prose or code fences.
        return _first_json_object(content)

    @staticmethod
    def _validate(data: Any, schema: dict[str, Any]) -> None:
        try:
            jsonschema.validate(data, schema)
        except jsonschema.ValidationError as exc:
            where = "/".join(str(part) for part in exc.absolute_path) or "the reply"
            raise AIError(
                BAD_RESPONSE, f"The AI reply did not have the expected shape (at {where})."
            ) from exc
