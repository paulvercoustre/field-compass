"""
The server's configuration: every environment variable it reads, in one place.

``get_settings()`` reads the environment each time it is called -- a few
microseconds -- so a value changed in a test, or a key added to ``.env`` and
the container recreated, is picked up without a restart of anything else. The
API and the worker each call it once when they start, so a malformed value
stops them with a message naming the variable instead of failing on the first
request that happens to read it.

Variable names are unchanged. A variable that is unset, or set to an empty
string (docker compose passes ``${VAR:-}`` through as ""), takes its default --
except the reasoning-effort settings, where an empty value means "send none and
leave the model's default".
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from typing import Any

from dotenv import load_dotenv
from pydantic import BaseModel, ConfigDict, Field, ValidationError

load_dotenv()

DEFAULT_CORS_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:3001",  # Fallback when 3000 is in use
    "http://localhost:5173",  # Vite default port
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "http://127.0.0.1:5173",
]

# Fields that read a variable other than their own upper-cased name, newest
# first: the allowances used to be per survey, and their old names still work.
_ENV_NAMES: dict[str, tuple[str, ...]] = {
    "ai_allowance_checks_per_user_month": (
        "AI_ALLOWANCE_CHECKS_PER_USER_MONTH",
        "AI_ALLOWANCE_CHECKS_PER_SURVEY_MONTH",
    ),
    "ai_allowance_translations_per_user_month": (
        "AI_ALLOWANCE_TRANSLATIONS_PER_USER_MONTH",
        "AI_ALLOWANCE_TRANSLATIONS_PER_SURVEY_MONTH",
    ),
    "transcription_allowance_minutes_per_user_month": (
        "TRANSCRIPTION_ALLOWANCE_MINUTES_PER_USER_MONTH",
        "TRANSCRIPTION_ALLOWANCE_MINUTES_PER_SURVEY_MONTH",
    ),
}

# An empty value is a choice here, not "unset": send no reasoning effort.
_EMPTY_MEANS_NONE = {
    "openai_rule_gen_reasoning_effort",
    "openai_qual_check_reasoning_effort",
    "openai_translation_reasoning_effort",
}


class SettingsError(RuntimeError):
    """A variable is set to something the server cannot use."""


class Settings(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    # --- Server ---------------------------------------------------------------
    environment: str = "development"
    database_url: str = "postgresql://postgres:postgres@localhost:5432/field_compass"
    cors_origins: str = ""
    trust_proxy_headers: bool = False
    ratelimit_storage_uri: str = "memory://"
    usage_admin_emails: str = ""

    # --- Accounts -------------------------------------------------------------
    jwt_secret_key: str = "change-this-secret-in-production-please"
    jwt_expire_minutes: int = Field(default=1440, gt=0)
    encryption_key: str | None = None

    # --- Background jobs ------------------------------------------------------
    celery_broker_url: str = "redis://redis:6379/0"
    celery_result_backend: str | None = None  # the broker when unset
    celery_task_always_eager: bool = False

    # --- Kobo -----------------------------------------------------------------
    kobo_api_token: str | None = None
    kobo_api_url: str = "https://kf.kobotoolbox.org/api/v2"
    kobo_supplement_version: str | None = None
    audit_dir: str | None = None

    # --- AI on the operator's key ---------------------------------------------
    openai_api_key: str | None = None
    openai_base_url: str | None = None
    openai_model: str = "gpt-5-mini"
    openai_rule_gen_model: str | None = None  # openai_model when unset
    openai_qual_check_model: str | None = None  # openai_model when unset
    openai_translation_model: str | None = None  # the review model when unset
    # A reasoning model's thinking counts against these limits, and gpt-5 can
    # spend all of 2,500 before writing a rule. Only what is used is billed.
    openai_rule_gen_max_tokens: int = Field(default=8000, gt=0)
    openai_qual_check_max_tokens: int = Field(default=8000, gt=0)
    openai_rule_suggest_max_tokens: int = Field(default=16000, gt=0)
    openai_rule_gen_reasoning_effort: str | None = "low"
    openai_qual_check_reasoning_effort: str | None = "low"
    openai_translation_reasoning_effort: str | None = "low"
    openai_temperature: float = Field(default=0.2, ge=0, le=2)
    ai_allow_private_endpoints: bool = False
    ai_prices_file: str | None = None

    # --- Included usage, per account per month --------------------------------
    ai_allowance_enabled: bool = True
    ai_allowance_checks_per_user_month: int = Field(default=200, ge=0)
    ai_allowance_translations_per_user_month: int = Field(default=500, ge=0)
    ai_allowance_rule_requests_per_user_month: int = Field(default=30, ge=0)

    # --- Transcription (ElevenLabs) -------------------------------------------
    elevenlabs_api_key: str | None = None
    elevenlabs_base_url: str | None = None
    elevenlabs_zero_retention: bool = False
    transcription_model: str | None = None
    transcription_allowance_minutes_per_user_month: int = Field(default=120, ge=0)
    transcription_max_seconds: int = Field(default=1800, gt=0)

    # --- Derived --------------------------------------------------------------

    @property
    def allowed_origins(self) -> list[str]:
        origins = [o.strip() for o in self.cors_origins.split(",") if o.strip()]
        return origins or DEFAULT_CORS_ORIGINS

    @property
    def usage_admins(self) -> set[str]:
        return {e.strip().lower() for e in self.usage_admin_emails.split(",") if e.strip()}

    @property
    def is_development(self) -> bool:
        return self.environment.lower() == "development"

    @property
    def result_backend(self) -> str:
        return self.celery_result_backend or self.celery_broker_url

    @property
    def rule_gen_model(self) -> str:
        return self.openai_rule_gen_model or self.openai_model

    @property
    def qual_check_model(self) -> str:
        return self.openai_qual_check_model or self.openai_model

    @property
    def translation_model(self) -> str:
        return self.openai_translation_model or self.qual_check_model

    @property
    def operator_ai_key(self) -> str | None:
        return (self.openai_api_key or "").strip() or None

    @property
    def operator_transcription_key(self) -> str | None:
        return (self.elevenlabs_api_key or "").strip() or None

    @property
    def allowance_enabled(self) -> bool:
        """Off, or no operator key: AI features need the survey owner's own provider."""
        return self.ai_allowance_enabled and self.operator_ai_key is not None


def _raw_values(environ: Mapping[str, str]) -> dict[str, Any]:
    values: dict[str, Any] = {}
    for field in Settings.model_fields:
        for name in _ENV_NAMES.get(field, (field.upper(),)):
            if name not in environ:
                continue
            value = environ[name]
            if value.strip():
                values[field] = value.strip()
            elif field in _EMPTY_MEANS_NONE:
                values[field] = None
            # Otherwise empty is unset: keep looking, then the default.
            if field in values:
                break
    return values


def _env_name(field: str, environ: Mapping[str, str]) -> str:
    names = _ENV_NAMES.get(field, (field.upper(),))
    return next((name for name in names if name in environ), names[0])


def get_settings(environ: Mapping[str, str] | None = None) -> Settings:
    """The configuration from ``environ`` (the process environment by default)."""
    environ = os.environ if environ is None else environ
    try:
        return Settings.model_validate(_raw_values(environ))
    except ValidationError as exc:
        problems = []
        for error in exc.errors():
            field = str(error["loc"][0]) if error["loc"] else "?"
            name = _env_name(field, environ)
            problems.append(f"{name}={environ.get(name, '')!r}: {error['msg']}")
        raise SettingsError("Invalid configuration: " + "; ".join(problems)) from None
