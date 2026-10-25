"""
A submission is its survey's: Kobo's _id is only unique within one survey.

_id used to be the whole key of submissions_current. A pull that brought an
_id already stored moved that row into the survey pulling it, so any account
could point its Kobo connection at a server it ran, answer with guessed _ids,
and take other accounts' submissions, reviewer notes and findings, or change
their answers. These tests are that attack, and what must happen instead.
"""

from datetime import datetime
from uuid import UUID, uuid4

import pytest

from database.models import SubmissionCurrent, SubmissionHistory, SurveyConfig, User
from etl.data_merger import merge_submission, parse_kobo_submission
from tests.test_auth_endpoints import (  # noqa: F401 -- fixture
    client,
    create_survey,
    register,
    sign_in,
)

TIMES = {"_submission_time": "2026-10-20T10:00:00Z", "end": "2026-10-20T10:15:00Z"}


def _survey(db, name):
    owner = User(email=f"{name}@example.org", username=name, password_hash="x")
    db.add(owner)
    db.flush()
    survey = SurveyConfig(
        survey_name=name, kobo_asset_id=f"a{name}", config_data={}, user_id=owner.user_id
    )
    db.add(survey)
    db.commit()
    return survey


def _pull(db, survey, record):
    merge_submission(
        db, parse_kobo_submission(record), str(survey.survey_id), survey.kobo_asset_id, record
    )
    db.commit()


def _row(db, survey, kobo_id):
    return db.get(SubmissionCurrent, (survey.survey_id, kobo_id))


class TestPullsReachTheirOwnSurveyOnly:
    @pytest.fixture
    def surveys(self, test_db):
        return _survey(test_db, "alice"), _survey(test_db, "mallory")

    def test_the_same_id_in_another_survey_is_another_submission(self, test_db, surveys):
        alice, mallory = surveys
        _pull(test_db, alice, {"_id": 555001, "_uuid": "real", "phone": "+221 77 000", **TIMES})
        _row(test_db, alice, 555001).reviewer_notes = "Called back, confirmed GPS"
        test_db.commit()

        # A server Mallory runs answers her pull with Alice's _id.
        _pull(test_db, mallory, {"_id": 555001, "_uuid": "fake", **TIMES})

        kept = _row(test_db, alice, 555001)
        assert kept.submission_data["phone"] == "+221 77 000"
        assert kept.reviewer_notes == "Called back, confirmed GPS"
        assert "phone" not in _row(test_db, mallory, 555001).submission_data
        assert _row(test_db, mallory, 555001).reviewer_notes is None

    def test_a_fake_edit_from_another_survey_changes_nothing(self, test_db, surveys):
        alice, mallory = surveys
        real = {"_id": 1001, "_uuid": "u1", "household_size": "4", **TIMES}
        _pull(test_db, alice, real)

        fake_edit = {
            "_id": 1001,
            "_uuid": "u1b",
            "meta/deprecatedID": "uuid:u1",
            "household_size": "40",
        }
        _pull(test_db, mallory, {**fake_edit, **TIMES})
        _pull(test_db, alice, real)

        assert _row(test_db, alice, 1001).submission_data["household_size"] == "4"
        assert not _row(test_db, alice, 1001).has_edit_history
        history = test_db.query(SubmissionHistory).filter_by(survey_id=alice.survey_id).count()
        assert history == 0

    def test_a_row_planted_ahead_of_time_is_not_the_real_submission(self, test_db, surveys):
        alice, mallory = surveys
        _pull(test_db, mallory, {"_id": 2002, "_uuid": "planted", "household_size": "99", **TIMES})

        # The enumerator's real submission is given that _id later.
        _pull(test_db, alice, {"_id": 2002, "_uuid": "u2", "household_size": "5", **TIMES})

        assert _row(test_db, alice, 2002).submission_data["household_size"] == "5"
        assert _row(test_db, mallory, 2002).submission_data["household_size"] == "99"

    def test_two_surveys_of_one_kobo_project_keep_their_own_rows(self, test_db, surveys):
        alice, mallory = surveys
        record = {"_id": 3003, "_uuid": "same-uuid", "consent": "yes", **TIMES}
        _pull(test_db, alice, record)
        _pull(test_db, mallory, record)
        _pull(test_db, alice, record)

        assert test_db.query(SubmissionCurrent).filter_by(_id=3003).count() == 2
        assert _row(test_db, alice, 3003).survey_id == alice.survey_id


class TestAnswersAreKobos:
    def test_answers_changed_in_kobo_are_taken_on_the_next_pull(self, test_db, test_survey_config):
        record = {"_id": 4004, "_uuid": "u4", "village": "Kabul", **TIMES}
        _pull(test_db, test_survey_config, record)

        _pull(test_db, test_survey_config, {**record, "village": "Herat"})

        row = _row(test_db, test_survey_config, 4004)
        assert row.submission_data["village"] == "Herat"
        # Not an edit in Kobo: nothing in the edit history.
        assert test_db.query(SubmissionHistory).count() == 0

    def test_an_edit_in_kobo_is_recorded_under_its_survey(self, test_db, test_survey_config):
        record = {"_id": 5005, "_uuid": "u5", "age": "30", **TIMES}
        _pull(test_db, test_survey_config, record)

        edited = {**record, "_uuid": "u5b", "meta/deprecatedID": "uuid:u5", "age": "31"}
        _pull(test_db, test_survey_config, edited)

        (history,) = test_db.query(SubmissionHistory).all()
        assert (history.survey_id, history.kobo_id) == (test_survey_config.survey_id, 5005)
        assert _row(test_db, test_survey_config, 5005).submission_data["age"] == "31"

    def test_audit_times_stay_when_the_log_could_not_be_read(self, test_db, test_survey_config):
        record = {"_id": 6006, "_uuid": "u6", "village": "Kabul", **TIMES}
        parsed = parse_kobo_submission(record)
        parsed["submission_data"]["active_interview_time"] = 42.5
        merge_submission(test_db, parsed, str(test_survey_config.survey_id), kobo_data=record)
        test_db.commit()

        _pull(test_db, test_survey_config, record)  # no audit log this time

        assert (
            _row(test_db, test_survey_config, 6006).submission_data["active_interview_time"] == 42.5
        )


@pytest.fixture
def two_accounts(client):  # noqa: F811
    register(client)
    register(client, email="bob@example.com", username="bob")
    alice = sign_in(client, "alice@example.com")
    bob = sign_in(client, "bob@example.com")
    surveys = create_survey(client, alice, "Baseline"), create_survey(client, bob, "Baseline")
    db = client.db_factory()
    try:
        for survey_id, village in zip(surveys, ("Kabul", "Herat"), strict=True):
            db.add(
                SubmissionCurrent(
                    _id=1,
                    survey_id=survey_id,
                    _uuid=str(uuid4()),
                    _submission_time=datetime.utcnow(),
                    end=datetime.utcnow(),
                    submission_data={"village": village},
                )
            )
        db.commit()
    finally:
        db.close()
    return {"alice": (alice, surveys[0]), "bob": (bob, surveys[1])}


class TestSubmissionRoutes:
    def test_each_survey_shows_its_own_submission(self, client, two_accounts):  # noqa: F811
        for headers, survey_id in two_accounts.values():
            response = client.get(
                "/api/submissions/1", params={"survey_id": str(survey_id)}, headers=headers
            )
            assert response.status_code == 200
        bob, bob_survey = two_accounts["bob"]
        response = client.get(
            "/api/submissions/1", params={"survey_id": str(bob_survey)}, headers=bob
        )
        assert response.json()["submission_data"]["village"] == "Herat"

    def test_another_accounts_survey_is_refused(self, client, two_accounts):  # noqa: F811
        bob, _ = two_accounts["bob"]
        _, alice_survey = two_accounts["alice"]
        params = {"survey_id": str(alice_survey)}
        assert client.get("/api/submissions/1", params=params, headers=bob).status_code == 403
        notes = client.patch(
            "/api/submissions/1/reviewer-notes",
            params=params,
            json={"reviewer_notes": "mine now"},
            headers=bob,
        )
        assert notes.status_code == 403

    @pytest.mark.parametrize(
        "path", ["", "/history", "/transcripts", "/translations", "/kobo-edit-url"]
    )
    def test_a_submission_is_always_named_with_its_survey(self, client, two_accounts, path):  # noqa: F811
        bob, _ = two_accounts["bob"]
        assert client.get(f"/api/submissions/1{path}", headers=bob).status_code == 422


class TestSurveys:
    def test_names_are_unique_per_owner_only(self, client, two_accounts):  # noqa: F811
        # Both own a "Baseline": another account's names say nothing to this one.
        alice, _ = two_accounts["alice"]
        response = client.post("/api/surveys", json={"survey_name": "Baseline"}, headers=alice)
        assert response.status_code == 400
        assert "You already have" in response.json()["detail"]

    def test_a_survey_keeps_its_owners_kobo_server(self, client, two_accounts):  # noqa: F811
        _, survey_id = two_accounts["alice"]
        db = client.db_factory()
        try:
            survey = db.get(SurveyConfig, UUID(str(survey_id)))
            owner = db.get(User, survey.user_id)
            assert survey.kobo_api_url == (
                owner.kobo_api_url or "https://kf.kobotoolbox.org/api/v2"
            )
        finally:
            db.close()
