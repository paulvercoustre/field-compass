"""
The two events the usage funnel needs that the tables can't give: a survey's
first check turned on, and review decisions (once a day per reviewer and
survey). Then the funnel, activation within a week of signing up, and the
North Star (surveys with a pull and a review decision) they feed in
routers/admin.py.
"""

from datetime import datetime, timedelta
from uuid import UUID

import pytest

import routers.submissions as submissions_router
from database.models import AppEvent, Run, User
from services import app_events
from services.runs import PULL
from tests.test_api_endpoints import (  # noqa: F401 -- fixture
    TEST_USER_ID,
    TestingSessionLocal,
    client,
)
from tests.test_review_queue_api import _add


class FakeKobo:
    """Accepts every validation status it is sent."""

    def update_validation_status(self, asset_uid, submission_id, validation_status):
        return {}

    def update_validation_statuses(self, asset_uid, submission_ids, status):
        return list(submission_ids)


@pytest.fixture
def fake_kobo(monkeypatch):
    monkeypatch.setattr(submissions_router, "_kobo_fetcher_for", lambda survey, user: FakeKobo())


def _events(kind, survey_id=None):
    with TestingSessionLocal() as db:
        query = db.query(AppEvent).filter(AppEvent.kind == kind)
        if survey_id:
            query = query.filter(AppEvent.survey_id == UUID(survey_id))
        return query.all()


def _survey(client, name="Baseline", config_data=None):  # noqa: F811
    response = client.post(
        "/api/surveys",
        json={
            "survey_name": name,
            "kobo_asset_id": f"asset_{name}",
            "config_data": config_data or {},
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["survey_id"]


def _decide(client, survey_id, submission_id, status="Approved"):  # noqa: F811
    response = client.patch(
        f"/api/submissions/{submission_id}/validation-status",
        params={"survey_id": survey_id},
        json={"validation_status": status},
    )
    assert response.status_code == 200, response.text


def _back_date(kind, days):
    with TestingSessionLocal() as db:
        for event in db.query(AppEvent).filter(AppEvent.kind == kind):
            event.created_at = event.created_at - timedelta(days=days)
        db.commit()


class TestChecksOn:
    def test_a_rule_counts_once_it_is_on(self, client):  # noqa: F811
        survey_id = _survey(client)
        assert _events(app_events.CHECKS_ON, survey_id) == []

        rule = client.post(
            f"/api/surveys/{survey_id}/rules",
            json={"rule_name": "Age", "rule_data": {"field": "age"}, "is_active": False},
        )
        assert rule.status_code == 201, rule.text
        assert _events(app_events.CHECKS_ON, survey_id) == []

        rule_id = rule.json()["rule_id"]
        response = client.put(f"/api/surveys/{survey_id}/rules/{rule_id}", json={"is_active": True})
        assert response.status_code == 200, response.text
        [event] = _events(app_events.CHECKS_ON, survey_id)
        assert event.user_id == TEST_USER_ID

    def test_only_the_first_check_is_recorded(self, client):  # noqa: F811
        survey_id = _survey(client)
        for name in ("Age", "Income"):
            client.post(
                f"/api/surveys/{survey_id}/rules",
                json={"rule_name": name, "rule_data": {"field": name}},
            )
        assert len(_events(app_events.CHECKS_ON, survey_id)) == 1

    def test_a_built_in_check_counts_from_creation(self, client):  # noqa: F811
        survey_id = _survey(client, config_data={"quality_checks": {"flag_weekend": True}})
        assert len(_events(app_events.CHECKS_ON, survey_id)) == 1

    def test_a_built_in_check_counts_from_settings(self, client):  # noqa: F811
        survey_id = _survey(client)
        response = client.put(
            f"/api/surveys/{survey_id}",
            json={"config_data": {"global_parameters": {"min_survey_duration_minutes": 10}}},
        )
        assert response.status_code == 200, response.text
        assert len(_events(app_events.CHECKS_ON, survey_id)) == 1


class TestReviewDecisions:
    def test_once_a_day_per_reviewer_and_survey(self, client, fake_kobo):  # noqa: F811
        survey_id = _survey(client)
        first, second = _add(survey_id, {}), _add(survey_id, {})
        _decide(client, survey_id, first)
        _decide(client, survey_id, second, "Not Approved")
        assert len(_events(app_events.REVIEW_DECISION, survey_id)) == 1

        _back_date(app_events.REVIEW_DECISION, days=1)
        _decide(client, survey_id, first, "On Hold")
        assert len(_events(app_events.REVIEW_DECISION, survey_id)) == 2

    def test_clearing_a_status_is_not_a_decision(self, client, fake_kobo):  # noqa: F811
        survey_id = _survey(client)
        submission = _add(survey_id, {}, validation="Approved")
        _decide(client, survey_id, submission, None)
        assert _events(app_events.REVIEW_DECISION, survey_id) == []

    def test_approving_the_clean_ones_is_a_decision(self, client, fake_kobo):  # noqa: F811
        survey_id = _survey(client)
        _add(survey_id, {})
        response = client.post("/api/submissions/approve-clean", params={"survey_id": survey_id})
        assert response.json() == {"approved": 1, "failed": 0}
        assert len(_events(app_events.REVIEW_DECISION, survey_id)) == 1


@pytest.fixture
def usage_viewer(monkeypatch):
    monkeypatch.setenv("USAGE_ADMIN_EMAILS", "test-user@example.invalid")


def _pull(survey_id, days_ago=0):
    with TestingSessionLocal() as db:
        db.add(
            Run(
                survey_id=UUID(survey_id),
                kind=PULL,
                started_by_user_id=TEST_USER_ID,
                status="finished",
                created_at=datetime.utcnow() - timedelta(days=days_ago),
            )
        )
        db.commit()


def _signed_up(days_ago):
    signed_up = datetime.utcnow() - timedelta(days=days_ago)
    with TestingSessionLocal() as db:
        db.query(User).filter(User.user_id == TEST_USER_ID).update({"created_at": signed_up})
        db.commit()
    monday = signed_up - timedelta(days=signed_up.weekday())
    return monday.date().isoformat()


def _usage(client):  # noqa: F811
    response = client.get("/api/admin/usage")
    assert response.status_code == 200, response.text
    return response.json()


def _a_set_up_survey(client):  # noqa: F811
    """Checks on, pulled and a decision taken, all today."""
    survey_id = _survey(client, config_data={"quality_checks": {"flag_weekend": True}})
    _pull(survey_id)
    _decide(client, survey_id, _add(survey_id, {}))
    return survey_id


class TestUsage:
    def test_each_step_activation_and_the_north_star(self, client, fake_kobo, usage_viewer):  # noqa: F811
        _a_set_up_survey(client)
        usage = _usage(client)

        steps = {step["step"]: step["users"] for step in usage["funnel"]}
        assert steps["Added a survey"] == 1
        assert steps["Pulled data"] == 1
        assert steps["Turned on a check"] == 1
        assert steps["Made a review decision"] == 1
        assert steps["Added a second survey"] == 0

        assert usage["last_7_days"]["active_surveys"] == 1
        assert usage["weekly"][-1]["active_surveys"] == 1
        assert usage["review_tracking_since"] is not None

        this_week = usage["activation"][-1]
        assert this_week["measured"] is True
        assert this_week["complete"] is False
        assert {
            key: this_week[key]
            for key in ("signups", "added_survey", "pulled", "checks_on", "decided", "activated")
        } == {
            "signups": 1,
            "added_survey": 1,
            "pulled": 1,
            "checks_on": 1,
            "decided": 1,
            "activated": 1,
        }
        [me] = usage["recent_signups"]
        assert (me["checks_on"], me["decided"], me["activated"]) == (True, True, True)

    def test_a_pull_alone_is_not_an_active_survey(self, client, usage_viewer):  # noqa: F811
        _pull(_survey(client))
        assert _usage(client)["last_7_days"]["active_surveys"] == 0

    def test_activation_needs_all_three_within_a_week(self, client, fake_kobo, usage_viewer):  # noqa: F811
        _a_set_up_survey(client)
        # Decisions were already being recorded before this account signed up
        _back_date(app_events.REVIEW_DECISION, days=20)
        week = _signed_up(days_ago=10)

        usage = _usage(client)
        [cohort] = [row for row in usage["activation"] if row["week"] == week]
        assert cohort["measured"] is True
        assert (cohort["signups"], cohort["activated"]) == (1, 0)
        assert usage["recent_signups"][0]["activated"] is False

    def test_signups_before_decisions_were_recorded_are_not_measured(
        self,
        client,  # noqa: F811
        fake_kobo,
        usage_viewer,
    ):
        _a_set_up_survey(client)
        week = _signed_up(days_ago=30)

        usage = _usage(client)
        [cohort] = [row for row in usage["activation"] if row["week"] == week]
        assert cohort["measured"] is False
        assert cohort["signups"] == 1
        assert cohort["activated"] is None
        assert usage["recent_signups"][0]["activated"] is None


def test_deleted_surveys_leave_the_funnel(client, usage_viewer):  # noqa: F811
    survey_id = _survey(client, config_data={"quality_checks": {"flag_weekend": True}})
    assert client.delete(f"/api/surveys/{survey_id}").status_code == 200
    steps = {step["step"]: step["users"] for step in _usage(client)["funnel"]}
    assert steps["Turned on a check"] == 0
    # The event stays: the history is kept, only the count follows the survey
    assert len(_events(app_events.CHECKS_ON, survey_id)) == 1
