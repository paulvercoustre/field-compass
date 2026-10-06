"""The server's configuration, read from environment variables in one place."""

import pytest

from settings import DEFAULT_CORS_ORIGINS, SettingsError, get_settings


class TestDefaults:
    def test_nothing_set(self):
        settings = get_settings({})
        assert settings.openai_model == "gpt-5-mini"
        assert settings.rule_gen_model == "gpt-5-mini"
        assert settings.qual_check_model == "gpt-5-mini"
        assert settings.translation_model == "gpt-5-mini"
        assert settings.result_backend == settings.celery_broker_url
        assert settings.allowed_origins == DEFAULT_CORS_ORIGINS
        assert settings.operator_ai_key is None
        assert settings.allowance_enabled is False  # no operator key, nothing included

    def test_rule_writing_and_review_have_room_for_a_reasoning_model(self):
        settings = get_settings({})
        assert settings.openai_rule_gen_max_tokens == 8000
        assert settings.openai_qual_check_max_tokens == 8000
        assert settings.openai_rule_suggest_max_tokens == 16000
        assert settings.openai_qual_check_reasoning_effort == "low"

    def test_models_follow_the_base_model(self):
        settings = get_settings({"OPENAI_MODEL": "gpt-x", "OPENAI_QUAL_CHECK_MODEL": "gpt-y"})
        assert settings.rule_gen_model == "gpt-x"
        assert settings.qual_check_model == "gpt-y"
        assert settings.translation_model == "gpt-y"  # the review model when unset


class TestEmptyValues:
    """docker compose passes ${VAR:-} through as an empty string."""

    def test_empty_is_unset(self):
        settings = get_settings(
            {
                "OPENAI_BASE_URL": "",
                "OPENAI_TRANSLATION_MODEL": "",
                "OPENAI_RULE_GEN_MAX_TOKENS": "",
                "TRUST_PROXY_HEADERS": "",
                "CORS_ORIGINS": " ",
            }
        )
        assert settings.openai_base_url is None
        assert settings.translation_model == settings.qual_check_model
        assert settings.openai_rule_gen_max_tokens == 8000
        assert settings.trust_proxy_headers is False
        assert settings.allowed_origins == DEFAULT_CORS_ORIGINS

    def test_empty_reasoning_effort_sends_none(self):
        settings = get_settings(
            {
                "OPENAI_RULE_GEN_REASONING_EFFORT": "",
                "OPENAI_QUAL_CHECK_REASONING_EFFORT": "",
                "OPENAI_TRANSLATION_REASONING_EFFORT": "",
            }
        )
        assert settings.openai_rule_gen_reasoning_effort is None
        assert settings.openai_qual_check_reasoning_effort is None
        assert settings.openai_translation_reasoning_effort is None

    def test_values_are_trimmed(self):
        settings = get_settings(
            {"OPENAI_API_KEY": "  sk-test \n", "CORS_ORIGINS": "https://a, https://b ,"}
        )
        assert settings.operator_ai_key == "sk-test"
        assert settings.allowed_origins == ["https://a", "https://b"]


class TestAllowanceNames:
    def test_per_user_names(self):
        settings = get_settings(
            {
                "AI_ALLOWANCE_CHECKS_PER_USER_MONTH": "50",
                "AI_ALLOWANCE_TRANSLATIONS_PER_USER_MONTH": "60",
                "TRANSCRIPTION_ALLOWANCE_MINUTES_PER_USER_MONTH": "70",
            }
        )
        assert settings.ai_allowance_checks_per_user_month == 50
        assert settings.ai_allowance_translations_per_user_month == 60
        assert settings.transcription_allowance_minutes_per_user_month == 70

    def test_the_old_per_survey_names_still_work(self):
        settings = get_settings(
            {
                "AI_ALLOWANCE_CHECKS_PER_SURVEY_MONTH": "5",
                "AI_ALLOWANCE_TRANSLATIONS_PER_SURVEY_MONTH": "6",
                "TRANSCRIPTION_ALLOWANCE_MINUTES_PER_SURVEY_MONTH": "7",
            }
        )
        assert settings.ai_allowance_checks_per_user_month == 5
        assert settings.ai_allowance_translations_per_user_month == 6
        assert settings.transcription_allowance_minutes_per_user_month == 7

    def test_the_new_name_wins(self):
        settings = get_settings(
            {
                "AI_ALLOWANCE_CHECKS_PER_USER_MONTH": "50",
                "AI_ALLOWANCE_CHECKS_PER_SURVEY_MONTH": "5",
            }
        )
        assert settings.ai_allowance_checks_per_user_month == 50

    def test_allowance_needs_a_key_and_can_be_switched_off(self):
        assert get_settings({"OPENAI_API_KEY": "sk"}).allowance_enabled is True
        assert (
            get_settings(
                {"OPENAI_API_KEY": "sk", "AI_ALLOWANCE_ENABLED": "false"}
            ).allowance_enabled
            is False
        )


class TestFlags:
    @pytest.mark.parametrize("value", ["1", "true", "TRUE", "yes", "on"])
    def test_true(self, value):
        assert get_settings({"TRUST_PROXY_HEADERS": value}).trust_proxy_headers is True

    @pytest.mark.parametrize("value", ["0", "false", "no", "off"])
    def test_false(self, value):
        assert get_settings({"TRUST_PROXY_HEADERS": value}).trust_proxy_headers is False


class TestInvalidValues:
    """A value the server cannot use stops it on startup, naming the variable."""

    def test_not_a_number(self):
        with pytest.raises(SettingsError, match=r"OPENAI_RULE_GEN_MAX_TOKENS='lots'"):
            get_settings({"OPENAI_RULE_GEN_MAX_TOKENS": "lots"})

    def test_negative_allowance(self):
        with pytest.raises(SettingsError, match=r"AI_ALLOWANCE_CHECKS_PER_SURVEY_MONTH='-1'"):
            get_settings({"AI_ALLOWANCE_CHECKS_PER_SURVEY_MONTH": "-1"})

    def test_unreadable_flag(self):
        with pytest.raises(SettingsError, match=r"TRUST_PROXY_HEADERS='maybe'"):
            get_settings({"TRUST_PROXY_HEADERS": "maybe"})

    def test_every_problem_is_listed(self):
        with pytest.raises(SettingsError) as raised:
            get_settings({"JWT_EXPIRE_MINUTES": "0", "OPENAI_TEMPERATURE": "hot"})
        assert "JWT_EXPIRE_MINUTES" in str(raised.value)
        assert "OPENAI_TEMPERATURE" in str(raised.value)

    def test_the_process_environment_is_read_by_default(self, monkeypatch):
        monkeypatch.setenv("OPENAI_MODEL", "gpt-from-env")
        assert get_settings().openai_model == "gpt-from-env"
