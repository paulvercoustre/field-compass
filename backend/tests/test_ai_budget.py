"""
The monthly AI budget: what the whole service spends on Field Compass's keys,
the pause once it is spent, and the emails to the usage admins.
"""

from datetime import datetime
from uuid import uuid4

import pytest

import tests.test_ai_allowance as allowance
from database.models import AIConnection, AIUsage, AppEvent, SubmissionCurrent, User
from services import ai_budget, app_events, mailer
from services.account_emails import ai_budget_email
from services.ai_allowance import NOT_RUN_ALLOWANCE
from services.ai_usage import QUALITATIVE_CHECK, RULE_GENERATION, TRANSCRIPTION, TRANSLATION

# The allowance tests' operator key, pull and HTTP client
_operator_key = allowance._operator_key
ai_survey = allowance.ai_survey
client = allowance.client

NOW = datetime(2026, 10, 15, 12, 0)


@pytest.fixture(autouse=True)
def _budget(monkeypatch):
    monkeypatch.setenv("AI_MONTHLY_BUDGET_USD", "10")


def _spend(db, survey_id, micros, *, when=None, **fields):
    fields.setdefault("feature", QUALITATIVE_CHECK)
    fields.setdefault("model", "gpt-5-mini")
    fields.setdefault("outcome", "ok")
    db.add(
        AIUsage(
            survey_id=survey_id,
            cost_usd_micros=micros,
            created_at=when or datetime.utcnow(),
            **fields,
        )
    )
    db.commit()


def _own_connection(db):
    owner = User(user_id=uuid4(), email=f"{uuid4()}@example.invalid", username=str(uuid4()))
    db.add(owner)
    db.commit()
    connection = AIConnection(
        owner_user_id=owner.user_id,
        label="Own",
        base_url="https://own.example/v1",
        check_model="m",
        status="ok",
        consecutive_failures=0,
    )
    db.add(connection)
    db.commit()
    return connection


class TestSpend:
    def test_counts_what_field_compass_keys_spent_this_month(self, test_db, test_survey_config):
        survey_id = test_survey_config.survey_id
        _spend(test_db, survey_id, 2_000_000, when=NOW)
        _spend(test_db, survey_id, 500_000, when=NOW, feature=TRANSLATION, outcome="bad_response")
        _spend(test_db, survey_id, 250_000, when=NOW, feature=TRANSCRIPTION, outcome="reserved")
        # Not counted: last month, a call that never reached the provider,
        # an organisation's own key.
        _spend(test_db, survey_id, 9_000_000, when=datetime(2026, 9, 30, 23, 0))
        _spend(test_db, survey_id, 9_000_000, when=NOW, outcome="timeout")
        connection = _own_connection(test_db)
        _spend(test_db, survey_id, 9_000_000, when=NOW, connection_id=connection.connection_id)

        budget = ai_budget.current(test_db, NOW)
        assert budget.spent_micros == 2_750_000
        assert budget.limit_micros == 10_000_000
        assert (budget.share, budget.paused) == (0.275, False)
        assert budget.resumes_at == datetime(2026, 11, 1)

    def test_a_model_missing_from_the_price_table_counts_at_the_highest_price(
        self, test_db, test_survey_config
    ):
        survey_id = test_survey_config.survey_id
        _spend(
            test_db, survey_id, None, when=NOW, model="gpt-9", input_tokens=1000, output_tokens=100
        )
        _spend(
            test_db, survey_id, None, when=NOW, model="gpt-9", input_tokens=1000, output_tokens=100
        )
        _spend(
            test_db,
            survey_id,
            None,
            when=NOW,
            feature=TRANSCRIPTION,
            model="scribe_v9",
            audio_seconds=3600,
        )

        budget = ai_budget.current(test_db, NOW)
        # gpt-4o's input ($2.50 per 1M) and gpt-5's output ($10), and $0.22 an hour of audio
        assert budget.spent_micros == 2 * (1000 * 2.5 + 100 * 10) + 220_000
        assert [(item.model, item.calls) for item in budget.unpriced] == [
            ("gpt-9", 2),
            ("scribe_v9", 1),
        ]

    def test_paused_once_spent(self, test_db, test_survey_config):
        _spend(test_db, test_survey_config.survey_id, 9_999_999)
        assert not ai_budget.paused(test_db)
        _spend(test_db, test_survey_config.survey_id, 1)
        assert ai_budget.paused(test_db)

    def test_no_budget_no_pause(self, test_db, test_survey_config, monkeypatch):
        monkeypatch.setenv("AI_MONTHLY_BUDGET_USD", "")
        _spend(test_db, test_survey_config.survey_id, 50_000_000)
        assert ai_budget.current(test_db).limit_micros is None
        assert not ai_budget.paused(test_db)

    def test_messages_name_the_day_it_resumes(self):
        assert "paused until 1 November" in ai_budget.paused_detail(NOW)
        assert ai_budget.paused_message(NOW).startswith(
            "allowance: Field Compass's included AI is paused until 1 November."
        )


class TestPaused:
    def test_a_pull_holds_every_review_even_already_counted_ones(self, test_db, ai_survey):
        allowance._pull(test_db, ai_survey, 2)
        test_db.query(SubmissionCurrent).update({SubmissionCurrent.llm_check_status: "failed"})
        test_db.commit()
        # Both were billed (so "counted"), and that spent the budget.
        for submission_id in (5000, 5001):
            _spend(test_db, ai_survey.survey_id, 5_000_000, submission_id=submission_id)

        stats = allowance._pull(test_db, ai_survey, 3)

        assert (stats["llm_queued"], stats["llm_not_run_allowance"]) == (0, 3)
        held = test_db.query(SubmissionCurrent).all()
        assert {s.llm_check_status for s in held} == {NOT_RUN_ALLOWANCE}
        assert all("included AI is paused until" in s.llm_last_error for s in held)

    def test_and_they_run_on_the_first_pull_after(self, test_db, ai_survey, monkeypatch):
        _spend(test_db, ai_survey.survey_id, 10_000_000)
        allowance._pull(test_db, ai_survey, 2)
        monkeypatch.setenv("AI_MONTHLY_BUDGET_USD", "20")

        stats = allowance._pull(test_db, ai_survey, 2)
        assert (stats["llm_queued"], stats["llm_not_run_allowance"]) == (2, 0)

    def test_surveys_on_their_own_key_carry_on(self, test_db, ai_survey):
        _spend(test_db, ai_survey.survey_id, 10_000_000)
        connection = _own_connection(test_db)
        ai_survey.user_id = connection.owner_user_id
        ai_survey.ai_connection_id = connection.connection_id
        test_db.commit()

        stats = allowance._pull(test_db, ai_survey, 2)
        assert (stats["llm_queued"], stats["llm_not_run_allowance"]) == (2, 0)

    def test_rule_requests_are_refused(self, client):
        from uuid import UUID

        from services.ai_service import ai_service
        from tests.test_api_endpoints import TEST_USER_ID, TestingSessionLocal

        survey_id = allowance._api_survey(client)
        db = TestingSessionLocal()
        _spend(db, UUID(survey_id), 10_000_000, feature=RULE_GENERATION, user_id=TEST_USER_ID)
        db.close()
        original = ai_service.api_key
        ai_service.api_key = "sk-operator"
        try:
            response = client.post(
                "/api/ai/generate-rule", json={"survey_id": survey_id, "prompt": "age over 100"}
            )
        finally:
            ai_service.api_key = original

        assert response.status_code == 429
        assert "included AI is paused until" in response.json()["detail"]

    def test_the_usage_page_says_so(self, client):
        from uuid import UUID

        from tests.test_api_endpoints import TestingSessionLocal

        assert client.get("/api/ai/usage").json()["included_paused"] is False
        survey_id = allowance._api_survey(client)
        db = TestingSessionLocal()
        _spend(db, UUID(survey_id), 10_000_000)
        db.close()
        assert client.get("/api/ai/usage").json()["included_paused"] is True


# --- Emails to the usage admins ---------------------------------------------------


@pytest.fixture
def outbox(monkeypatch):
    sent = []
    monkeypatch.setattr(mailer, "send", lambda email: sent.append(email) or True)
    monkeypatch.setenv("SMTP_HOST", "smtp.example.org")
    monkeypatch.setenv("USAGE_ADMIN_EMAILS", "Paul@fieldcompass.org, ops@fieldcompass.org")
    return sent


class TestAlerts:
    def test_at_80_and_100_percent_once_each(self, test_db, test_survey_config, outbox):
        survey_id = test_survey_config.survey_id
        _spend(test_db, survey_id, 7_000_000)
        assert ai_budget.send_alerts(test_db) is None and outbox == []

        _spend(test_db, survey_id, 1_500_000)
        assert ai_budget.send_alerts(test_db) == 0.8
        assert sorted(email.to for email in outbox) == [
            "ops@fieldcompass.org",
            "paul@fieldcompass.org",
        ]
        assert outbox[0].subject == "Field Compass has used 85% of this month's AI budget"
        assert ai_budget.send_alerts(test_db) is None and len(outbox) == 2

        _spend(test_db, survey_id, 1_500_000)
        assert ai_budget.send_alerts(test_db) == 1.0
        assert outbox[-1].subject.startswith("Field Compass's included AI is paused until ")
        assert ai_budget.send_alerts(test_db) is None and len(outbox) == 4

    def test_straight_past_100_sends_one_email(self, test_db, test_survey_config, outbox):
        _spend(test_db, test_survey_config.survey_id, 12_000_000)
        assert ai_budget.send_alerts(test_db) == 1.0
        assert len(outbox) == 2
        shares = sorted(
            event.details["share"]
            for event in test_db.query(AppEvent).filter(AppEvent.kind == app_events.AI_BUDGET_ALERT)
        )
        assert shares == [0.8, 1.0]
        assert ai_budget.send_alerts(test_db) is None

    def test_nothing_without_a_budget_or_anyone_to_tell(
        self, test_db, test_survey_config, outbox, monkeypatch
    ):
        _spend(test_db, test_survey_config.survey_id, 12_000_000)
        monkeypatch.setenv("USAGE_ADMIN_EMAILS", "")
        assert ai_budget.send_alerts(test_db) is None
        monkeypatch.setenv("USAGE_ADMIN_EMAILS", "paul@fieldcompass.org")
        monkeypatch.setenv("AI_MONTHLY_BUDGET_USD", "")
        assert ai_budget.send_alerts(test_db) is None
        assert outbox == []

    def test_the_email_names_unpriced_models_and_never_a_person(self):
        budget = ai_budget.Budget(
            month=datetime(2026, 10, 1),
            resumes_at=datetime(2026, 11, 1),
            spent_micros=150_400_000,
            limit_micros=150_000_000,
            unpriced=(ai_budget.Unpriced("gpt-9", 12),),
        )
        email = ai_budget_email("paul@fieldcompass.org", budget, 1.0)

        assert email.subject == "Field Compass's included AI is paused until 1 November"
        assert email.about == "the AI budget"
        assert "$150.40 of the $150 budget" in email.text
        assert "paused for everyone until 1 November" in email.text
        assert "gpt-9 (12 calls) has no price in the price table" in email.text
        assert "AI_MONTHLY_BUDGET_USD" in email.text
