"""
Runs, activity, notifications and transcription settings through the API.
See docs/specs/audio-transcription.md, sections 4.9, 5 and 6.
"""

from datetime import datetime, timedelta
from uuid import uuid4

import pytest

import routers.etl as etl_router
import routers.transcription as transcription_router
from database.models import (
    AnswerTranslation,
    AudioTranscript,
    Base,
    Notification,
    Run,
    SubmissionCurrent,
    SurveyConfig,
)
from services import pull_worker
from services.runs import run_counts, sweep_runs
from tests.test_api_endpoints import (
    TEST_USER_ID,
    TestingSessionLocal,
    _ensure_test_user,
    engine,
    override_current_user,
    override_get_db,
)

KOBO_TOOL = {
    "survey": [
        {
            "type": "text",
            "name": "village",
            "label::English (en)": "Village",
            "label::Français (fr)": "Village",
        },
        {
            "type": "audio",
            "name": "story",
            "label::English (en)": "Story",
            "group_path": "interview",
        },
        {
            "type": "audio",
            "name": "voice",
            "label::English (en)": "Voice",
            "roster_name": "members",
        },
    ],
    "choices": [],
    "label_column_survey": "label::English (en)",
}


@pytest.fixture
def client():
    from fastapi.testclient import TestClient

    Base.metadata.create_all(bind=engine)
    from main import app
    from services.auth import get_current_active_user
    from services.database import get_db

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_active_user] = override_current_user
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db(client):
    session = TestingSessionLocal()
    yield session
    session.close()


@pytest.fixture
def survey(db):
    _ensure_test_user(db)
    survey = SurveyConfig(
        survey_id=uuid4(),
        survey_name="Household survey",
        kobo_asset_id="aAsset123456",
        user_id=TEST_USER_ID,
        config_data={
            "kobo_tool": KOBO_TOOL,
            "special_values": {"dk_value": -99, "dk_string_value": "dk"},
        },
    )
    db.add(survey)
    db.commit()
    return survey


class _Task:
    def __init__(self):
        self.sent = []

    def apply_async(self, kwargs=None, task_id=None):
        self.sent.append((kwargs, task_id))

        class Result:
            id = task_id

        return Result()


@pytest.fixture
def pull_task(monkeypatch):
    task = _Task()
    monkeypatch.setattr(etl_router, "run_pull_task", task)
    monkeypatch.setattr(etl_router, "get_user_kobo_token", lambda user: "kobo-token")
    return task


class TestStartingAPull:
    def test_starts_in_the_background(self, client, survey, pull_task):
        response = client.post(f"/api/etl/run/{survey.survey_id}")
        assert response.status_code == 202
        run = response.json()["data"]["run"]
        assert run["status"] == "queued" and run["kind"] == "pull"
        assert run["started_by"]["name"] == "Test User"
        assert pull_task.sent[0][0]["run_id"] == run["run_id"]

    def test_one_pull_at_a_time(self, client, survey, pull_task):
        client.post(f"/api/etl/run/{survey.survey_id}")
        second = client.post(f"/api/etl/run/{survey.survey_id}")
        assert second.status_code == 409
        assert second.json()["detail"].startswith("A pull is already running, started by Test User")
        assert len(pull_task.sent) == 1

    def test_needs_a_kobo_key(self, client, survey, monkeypatch):
        monkeypatch.setattr(etl_router, "get_user_kobo_token", lambda user: None)
        assert client.post(f"/api/etl/run/{survey.survey_id}").status_code == 400

    def test_wait_keeps_the_old_synchronous_answer(self, client, survey, pull_task, monkeypatch):
        stats = {
            "fetched": 3,
            "created": 3,
            "updated": 0,
            "edited": 0,
            "hfc_flagged": 1,
            "errors": 0,
        }
        monkeypatch.setattr(etl_router, "execute_pull", lambda run_id, options: stats)
        response = client.post(f"/api/etl/run/{survey.survey_id}?wait=true")
        assert response.status_code == 200
        assert response.json()["data"]["fetched"] == 3 and pull_task.sent == []

    def test_worker_down_is_said_plainly(self, client, survey, monkeypatch):
        monkeypatch.setattr(etl_router, "get_user_kobo_token", lambda user: "kobo-token")

        class Down:
            def apply_async(self, **kwargs):
                raise ConnectionError("redis")

        monkeypatch.setattr(etl_router, "run_pull_task", Down())
        response = client.post(f"/api/etl/run/{survey.survey_id}")
        assert response.status_code == 503
        # Not left looking active: a new pull can start once the worker is back.
        assert client.post(f"/api/etl/run/{survey.survey_id}").status_code == 503


class _FakePipeline:
    outcome: object = None

    def __init__(self, db, **kwargs):
        self.db = db

    def run_pipeline(self, **kwargs):
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return {
            "fetched": 2,
            "created": 2,
            "updated": 0,
            "edited": 0,
            "hfc_flagged": 0,
            "errors": 0,
            "start_time": datetime.utcnow(),
        }


class TestThePullTask:
    @pytest.fixture
    def queued(self, db, survey, monkeypatch):
        import etl.pipeline
        import services.database

        monkeypatch.setattr(services.database, "SessionLocal", TestingSessionLocal)
        monkeypatch.setattr(etl.pipeline, "ETLPipeline", _FakePipeline)
        import services.auth

        monkeypatch.setattr(services.auth, "get_user_kobo_token", lambda user: "kobo-token")
        run = Run(
            survey_id=survey.survey_id,
            kind="pull",
            started_by_user_id=TEST_USER_ID,
            status="queued",
            stage="queued",
            stats={},
        )
        db.add(run)
        db.commit()
        return run

    def test_a_pull_with_no_background_work_finishes_and_notifies(self, db, queued):
        _FakePipeline.outcome = None
        assert pull_worker.execute_pull(queued.run_id)["fetched"] == 2
        db.expire_all()
        run = db.query(Run).one()
        assert run.status == "finished" and run.stats["created"] == 2
        note = db.query(Notification).one()
        assert note.title == "Household survey: pull finished"
        assert note.body.startswith("2 new submissions, 0 need review.")

    def test_kobo_refusing_says_why(self, db, queued):
        from etl.kobo_fetcher import KoboFetchError

        _FakePipeline.outcome = KoboFetchError("401", status=401)
        assert pull_worker.execute_pull(queued.run_id) is None
        db.expire_all()
        run = db.query(Run).one()
        assert run.status == "failed" and "Kobo rejected the API key" in run.error
        assert db.query(Notification).one().kind == "run_failed"

    def test_kobo_unreachable_says_so_in_words(self):
        import requests

        from etl.kobo_fetcher import KoboFetchError, describe_kobo_error

        try:
            try:
                raise requests.ConnectionError(
                    "HTTPConnectionPool(host='kobo', port=80): Max retries exceeded"
                )
            except requests.ConnectionError as error:
                raise KoboFetchError(str(error)) from error
        except KoboFetchError as exc:
            message = describe_kobo_error(exc)
        assert message.startswith("Could not reach Kobo.")
        assert "HTTPConnectionPool" not in message


def _run(db, survey, **fields):
    run = Run(survey_id=survey.survey_id, kind="pull", started_by_user_id=TEST_USER_ID, **fields)
    db.add(run)
    db.commit()
    return run


def _submission(db, survey, _id, **fields):
    row = SubmissionCurrent(
        _id=_id,
        survey_id=survey.survey_id,
        _uuid=f"u{_id}",
        _submission_time=datetime(2026, 6, 1),
        end=datetime(2026, 6, 1),
        submission_data={"interview/story": f"{_id}.m4a"},
        data_quality_issues=[],
        qa_status="PENDING_APPROVAL",
        **fields,
    )
    db.add(row)
    db.commit()
    return row


class TestActivity:
    def test_progress_is_counted_from_the_items(self, client, db, survey):
        run = _run(
            db,
            survey,
            status="background",
            stage="background",
            stats={"llm_queued": 3, "fetched": 3, "created": 3},
        )
        _submission(db, survey, 1, llm_check_status="success", llm_run_id=run.run_id)
        _submission(db, survey, 2, llm_check_status="pending", llm_run_id=run.run_id)
        _submission(
            db,
            survey,
            3,
            llm_check_status="failed",
            llm_run_id=run.run_id,
            llm_last_error="auth: bad key",
        )
        activity = client.get("/api/activity").json()
        assert activity["active"] is True
        summary = activity["runs"][0]
        assert summary["ai_checks"] == {
            "queued": 3,
            "done": 1,
            "failed": 1,
            "not_run": 0,
            "open": 1,
            "handed_off": 0,
            "eta_seconds": None,
        }
        assert (
            summary["problems"][0]["text"] == "AI review stopped: the AI provider rejected the key."
        )

    def test_an_item_requeued_by_a_later_pull_is_handed_off(self, db, survey):
        run = _run(db, survey, status="background", stage="background", stats={"llm_queued": 2})
        _submission(db, survey, 1, llm_check_status="success", llm_run_id=run.run_id)
        assert run_counts(db, run)["ai_checks"]["handed_off"] == 1

    def test_stop_cancels_what_has_not_started(self, client, db, survey):
        run = _run(db, survey, status="background", stage="background", stats={})
        _submission(
            db, survey, 1, llm_check_status="pending", llm_run_id=run.run_id, llm_job_id="j1"
        )
        _submission(db, survey, 2, llm_check_status="running", llm_run_id=run.run_id)
        db.add(
            AudioTranscript(
                survey_id=survey.survey_id,
                submission_id=1,
                question_path="interview/story",
                status="pending",
                run_id=run.run_id,
            )
        )
        db.commit()
        summary = client.post(f"/api/runs/{run.run_id}/stop").json()
        assert summary["stop_requested"] is True
        db.expire_all()
        statuses = {s._id: s.llm_check_status for s in db.query(SubmissionCurrent)}
        assert statuses == {1: "cancelled", 2: "running"}
        assert db.query(AudioTranscript).one().status == "cancelled"
        assert summary["status"] == "background"  # the running review still finishes

    def test_survey_history_and_single_run(self, client, db, survey):
        run = _run(db, survey, status="finished", stage="done", finished_at=datetime.utcnow())
        assert client.get(f"/api/runs/{run.run_id}").json()["status"] == "finished"
        assert len(client.get(f"/api/surveys/{survey.survey_id}/runs").json()["runs"]) == 1

    def test_stalled_pulls_are_failed_and_finished_runs_closed(self, db, survey):
        stalled = _run(
            db,
            survey,
            status="running",
            stage="checking",
            started_at=datetime.utcnow() - timedelta(hours=3),
        )
        idle = Run(
            survey_id=survey.survey_id,
            kind="kobo_resend",
            status="background",
            stage="background",
            stats={},
        )
        db.add(idle)
        db.commit()
        swept = sweep_runs(db)
        assert swept["failed"] == 1 and swept["finished"] == 1
        db.refresh(stalled)
        assert stalled.status == "failed"


class TestNotifications:
    def test_list_and_mark_read(self, client, db, survey):
        _ensure_test_user(db)
        for title in ("one", "two"):
            db.add(Notification(user_id=TEST_USER_ID, kind="run_finished", title=title))
        db.commit()
        listing = client.get("/api/notifications").json()
        assert listing["unread"] == 2 and len(listing["notifications"]) == 2
        first = listing["notifications"][0]["notification_id"]
        assert client.post("/api/notifications/read", json={"ids": [first]}).json()["marked"] == 1
        assert client.get("/api/activity").json()["unread_notifications"] == 1
        client.post("/api/notifications/read", json={})
        assert client.get("/api/notifications").json()["unread"] == 0


class TestTranscriptionSettings:
    def test_payload(self, client, survey):
        body = client.get(f"/api/surveys/{survey.survey_id}/audio-transcription").json()
        assert [q["path"] for q in body["audio_questions"]] == ["interview/story", "voice"]
        assert body["audio_questions"][1]["in_repeat"] is True
        assert [(lang["label"], lang["code"]) for lang in body["form_languages"]] == [
            ("English (en)", "eng"),
            ("Français (fr)", "fra"),
        ]
        assert len(body["languages"]) == 100
        assert body["allowance"]["limit_minutes"] == 120
        assert body["settings"]["enabled"] is False and body["can_edit"] is True

    def test_turning_on_needs_the_acknowledgement(self, client, survey):
        url = f"/api/surveys/{survey.survey_id}/audio-transcription"
        body = {"enabled": True, "questions": ["interview/story"], "language": "fr"}
        refused = client.put(url, json=body)
        assert refused.status_code == 400 and "ElevenLabs" in refused.json()["detail"]
        saved = client.put(url, json={**body, "acknowledge": True}).json()
        assert saved["settings"]["language"] == "fra" and saved["settings"]["acknowledged_at"]
        # Once acknowledged, later saves need not repeat it.
        assert client.put(url, json={**body, "multiple_speakers": True}).status_code == 200

    @pytest.mark.parametrize(
        "body,message",
        [
            ({"enabled": True, "questions": ["village"]}, "not an audio question"),
            ({"enabled": True, "questions": ["voice"]}, "repeat group"),
            ({"enabled": True, "questions": []}, "at least one"),
            (
                {"enabled": True, "questions": ["interview/story"], "language": "tlh"},
                "can't transcribe",
            ),
        ],
    )
    def test_validation(self, client, survey, body, message):
        response = client.put(
            f"/api/surveys/{survey.survey_id}/audio-transcription",
            json={**body, "acknowledge": True},
        )
        assert response.status_code == 400 and message in response.json()["detail"]

    def test_saving_clears_a_kobo_pause(self, client, db, survey):
        survey.config_data = {
            **survey.config_data,
            "audio_transcription": {
                "enabled": True,
                "questions": ["interview/story"],
                "acknowledged_at": "x",
                "kobo_pause": {"reason": "permission"},
            },
        }
        db.commit()
        saved = client.put(
            f"/api/surveys/{survey.survey_id}/audio-transcription",
            json={"enabled": True, "questions": ["interview/story"], "send_to_kobo": True},
        ).json()
        assert saved["settings"]["kobo_pause"] is None

    def test_other_settings_saves_keep_it(self, client, db, survey):
        survey.config_data = {
            **survey.config_data,
            "audio_transcription": {"enabled": True, "questions": ["interview/story"]},
        }
        db.commit()
        response = client.put(
            f"/api/surveys/{survey.survey_id}", json={"config_data": {"kobo_tool": KOBO_TOOL}}
        )
        assert response.json()["config_data"]["audio_transcription"]["enabled"] is True


class TestSubmissionTranscripts:
    def test_list_filter_and_summary(self, client, db, survey):
        _submission(db, survey, 1, llm_check_status="skipped")
        _submission(db, survey, 2, llm_check_status="skipped")
        db.add(
            AudioTranscript(
                survey_id=survey.survey_id,
                submission_id=1,
                question_path="interview/story",
                status="failed",
                last_error="bad_request: x",
            )
        )
        db.add(
            AudioTranscript(
                survey_id=survey.survey_id,
                submission_id=2,
                question_path="interview/story",
                status="success",
                text="",
            )
        )
        db.commit()
        failed = client.get(
            f"/api/submissions?survey_id={survey.survey_id}&transcript=failed"
        ).json()
        assert [s["_id"] for s in failed["submissions"]] == [1]
        assert failed["submissions"][0]["transcript_summary"]["failed"] == 1
        silent = client.get(
            f"/api/submissions?survey_id={survey.survey_id}&transcript=no_speech"
        ).json()
        assert [s["_id"] for s in silent["submissions"]] == [2]

    def test_answers_with_and_without_transcripts(self, client, db, survey):
        _submission(db, survey, 1, llm_check_status="skipped")
        db.add(
            AudioTranscript(
                survey_id=survey.survey_id,
                submission_id=1,
                question_path="interview/story",
                status="success",
                text="Il a plu",
                language_code="fra",
            )
        )
        db.commit()
        body = client.get("/api/submissions/1/transcripts").json()
        assert body["answers"][0]["label"] == "Story"
        assert body["answers"][0]["transcript"]["language_name"] == "French"
        assert body["answers"][0]["has_recording"] is False  # no attachment stored

    def test_transcribe_now_needs_it_turned_on(self, client, survey, monkeypatch):
        monkeypatch.setattr(transcription_router, "get_user_kobo_token", lambda user: "kobo-token")
        response = client.post(f"/api/surveys/{survey.survey_id}/transcripts/run")
        assert response.status_code == 400


class TestTranslationApi:
    """Translation: its own settings, "Translate now", a submission's translations, usage."""

    URL = "/api/surveys/{}/translation"
    ON = {"enabled": True, "language": "en", "questions": ["village", "interview/story"]}

    def test_payload_lists_text_and_audio_questions(self, client, survey):
        body = client.get(self.URL.format(survey.survey_id)).json()
        assert [(q["path"], q["kind"], q["in_repeat"]) for q in body["questions"]] == [
            ("village", "text", False),
            ("interview/story", "audio", False),
            ("voice", "audio", True),
        ]
        # Audio questions are translated through their transcript.
        assert [q["transcribed"] for q in body["questions"]] == [True, False, False]
        assert body["settings"]["enabled"] is False and body["can_edit"] is True

    def test_saved_normalised(self, client, survey):
        saved = client.put(self.URL.format(survey.survey_id), json=self.ON).json()
        assert saved["settings"]["language"] == "eng"
        assert saved["settings"]["questions"] == ["village", "interview/story"]

    @pytest.mark.parametrize(
        "body,message",
        [
            ({"enabled": True, "language": "en", "questions": ["nope"]}, "not a text or audio"),
            ({"enabled": True, "language": "en", "questions": ["voice"]}, "repeat group"),
            ({"enabled": True, "language": "tlh", "questions": ["village"]}, "can't be translated"),
            ({"enabled": True, "questions": ["village"]}, "Choose a language"),
            ({"enabled": True, "language": "en", "questions": []}, "at least one"),
        ],
    )
    def test_validation(self, client, survey, body, message):
        response = client.put(self.URL.format(survey.survey_id), json=body)
        assert response.status_code == 400 and message in response.json()["detail"]

    def test_other_settings_saves_keep_it(self, client, db, survey):
        client.put(self.URL.format(survey.survey_id), json=self.ON)
        response = client.put(
            f"/api/surveys/{survey.survey_id}", json={"config_data": {"kobo_tool": KOBO_TOOL}}
        )
        assert response.json()["config_data"]["translation"]["enabled"] is True

    def test_included_translations_apart_from_reviews(self, client, survey, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-operator")
        monkeypatch.setenv("AI_ALLOWANCE_TRANSLATIONS_PER_USER_MONTH", "300")
        body = client.get(self.URL.format(survey.survey_id)).json()
        assert body["key"]["source"] == "operator"
        assert (body["allowance"]["limit"], body["allowance"]["remaining"]) == (300, 300)
        client.put(self.URL.format(survey.survey_id), json=self.ON)
        usage = client.get("/api/ai/usage").json()
        assert usage["included"]["translations_per_month"] == 300
        assert usage["included_usage"]["translations"]["limit"] == 300
        mine = next(s for s in usage["surveys"] if s["survey_id"] == str(survey.survey_id))
        assert mine["translation"] == {"provider": None, "translations": 0}
        assert client.get("/api/ai/usage/history?metric=translations").status_code == 200

    def test_translate_now_needs_it_on(self, client, survey):
        assert client.post(f"/api/surveys/{survey.survey_id}/translations/run").status_code == 400

    def test_translate_now_queues_the_missing_ones(self, client, db, survey, monkeypatch):
        from services.translation_worker import translate_answer_task

        monkeypatch.setenv("OPENAI_API_KEY", "sk-operator")
        task = _Task()
        monkeypatch.setattr(translate_answer_task, "apply_async", task.apply_async)
        client.put(self.URL.format(survey.survey_id), json=self.ON)
        submission = _submission(db, survey, 1, llm_check_status="skipped")
        submission.submission_data = {**submission.submission_data, "village": "Kabul"}
        db.commit()
        before = client.get(self.URL.format(survey.survey_id)).json()
        assert before["counts"]["missing"] == 1
        run = client.post(f"/api/surveys/{survey.survey_id}/translations/run").json()
        assert run["kind"] == "translation_rerun" and run["translations"]["queued"] == 1
        assert len(task.sent) == 1

    def test_a_submission_shows_its_translations(self, client, db, survey):
        client.put(self.URL.format(survey.survey_id), json=self.ON)
        _submission(db, survey, 1, llm_check_status="skipped")
        db.add(
            AnswerTranslation(
                survey_id=survey.survey_id,
                submission_id=1,
                question_path="village",
                source="text",
                language="eng",
                status="success",
                text="Kabul",
            )
        )
        db.commit()
        body = client.get("/api/submissions/1/translations").json()
        assert (body["language"], body["language_name"]) == ("eng", "English")
        assert body["answers"]["village"]["text"] == "Kabul"
        assert body["answers"]["village"]["origin"] == "ai"


class TestTranscriptionKeys:
    """ElevenLabs keys are AI connections of kind "transcription", chosen per survey."""

    @pytest.fixture
    def accepted(self, monkeypatch):
        import services.transcription_keys as keys

        monkeypatch.setattr(
            keys,
            "check_key",
            lambda key, session=None: keys.KeyCheck(True, "ElevenLabs accepted the key."),
        )

    def _add(self, client, key="sk_" + "a" * 30 + "WXYZ"):
        return client.post(
            "/api/ai/connections",
            json={"kind": "transcription", "label": "My ElevenLabs", "api_key": key},
        )

    def test_add_and_choose_for_a_survey(self, client, db, survey, accepted):
        added = self._add(client)
        assert added.status_code == 201
        body = added.json()
        assert body["kind"] == "transcription" and body["preset"] == "elevenlabs"
        assert body["api_key_hint"] == "WXYZ" and body["status"] == "ok" and body["surveys"] == []
        assert "sk_" not in str(body)
        chosen = client.put(
            f"/api/surveys/{survey.survey_id}/ai-connection",
            json={"connection_id": body["connection_id"], "kind": "transcription"},
        )
        assert chosen.status_code == 200
        overview = client.get(f"/api/surveys/{survey.survey_id}/audio-transcription").json()
        assert overview["available"] is True
        assert overview["key"]["source"] == "own" and overview["key"]["label"] == "My ElevenLabs"
        listed = client.get("/api/ai/connections").json()
        assert listed[0]["surveys"][0]["survey_id"] == str(survey.survey_id)
        # It is not an AI review provider.
        db.expire_all()
        assert (
            db.query(SurveyConfig)
            .filter(SurveyConfig.survey_id == survey.survey_id)
            .one()
            .ai_connection_id
            is None
        )

    def test_a_key_of_the_wrong_kind_is_refused(self, client, survey, accepted):
        connection_id = self._add(client).json()["connection_id"]
        response = client.put(
            f"/api/surveys/{survey.survey_id}/ai-connection",
            json={"connection_id": connection_id, "kind": "review"},
        )
        assert response.status_code == 400 and "audio transcription" in response.json()["detail"]

    def test_a_refused_key_is_not_saved(self, client, monkeypatch):
        import services.transcription_keys as keys

        monkeypatch.setattr(
            keys,
            "check_key",
            lambda key, session=None: keys.KeyCheck(
                False, "ElevenLabs doesn't recognise this key.", "auth"
            ),
        )
        response = self._add(client, "sk_" + "b" * 30)
        assert response.status_code == 400 and "recognise" in response.json()["detail"]
        assert client.get("/api/ai/connections").json() == []

    def test_deleting_it_puts_surveys_back_on_included_usage(self, client, db, survey, accepted):
        connection_id = self._add(client).json()["connection_id"]
        client.put(
            f"/api/surveys/{survey.survey_id}/ai-connection",
            json={"connection_id": connection_id, "kind": "transcription"},
        )
        assert client.delete(f"/api/ai/connections/{connection_id}").status_code == 204
        db.expire_all()
        assert (
            db.query(SurveyConfig)
            .filter(SurveyConfig.survey_id == survey.survey_id)
            .one()
            .transcription_connection_id
            is None
        )

    def test_without_any_key_the_card_says_so(self, client, survey, monkeypatch):
        monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
        overview = client.get(f"/api/surveys/{survey.survey_id}/audio-transcription").json()
        assert overview["available"] is False and overview["key"]["source"] is None
        assert overview["key"]["viewer_is_owner"] is True


class TestUsageHistory:
    def test_daily_buckets_split_included_and_own(self, client, db, survey):
        from database.models import AIConnection, AIUsage

        connection = AIConnection(
            owner_user_id=TEST_USER_ID,
            kind="transcription",
            label="k",
            preset="elevenlabs",
            base_url="https://api.elevenlabs.io",
            check_model="scribe_v2",
        )
        db.add(connection)
        db.flush()
        now = datetime.utcnow()
        for seconds, connection_id, when in (
            (120, None, now),
            (60, connection.connection_id, now),
            (600, None, now - timedelta(days=40)),  # outside the 30 days
        ):
            db.add(
                AIUsage(
                    survey_id=survey.survey_id,
                    feature="transcription",
                    model="scribe_v2",
                    outcome="ok",
                    audio_seconds=seconds,
                    connection_id=connection_id,
                    created_at=when,
                )
            )
        db.add(
            AIUsage(
                survey_id=survey.survey_id,
                feature="qualitative_check",
                model="m",
                outcome="ok",
                created_at=now,
            )
        )
        db.commit()

        minutes = client.get("/api/ai/usage/history?metric=minutes&period=30d").json()
        assert len(minutes["buckets"]) == 30 and minutes["unit"] == "day"
        assert minutes["buckets"][-1] == {
            "start": now.date().isoformat(),
            "included": 2.0,
            "own": 1.0,
        }
        assert minutes["total_included"] == 2.0
        reviews = client.get(
            f"/api/ai/usage/history?metric=reviews&period=6m&survey_id={survey.survey_id}"
        ).json()
        assert len(reviews["buckets"]) == 6 and reviews["buckets"][-1]["included"] == 1

    def test_only_your_own_surveys(self, client, survey):
        from uuid import uuid4

        assert client.get(f"/api/ai/usage/history?survey_id={uuid4()}").status_code == 404


class TestRunProblems:
    """Every kind of problem a run can report, in the order it reports them."""

    def test_every_kind_in_order(self, db, survey):
        from services.runs import run_problems

        run = _run(db, survey, status="finished", stats={"llm_paused": True, "errors": 3})
        _submission(
            db,
            survey,
            1,
            llm_check_status="failed",
            llm_run_id=run.run_id,
            llm_last_error="auth: The provider rejected the key.",
        )
        _submission(
            db,
            survey,
            2,
            llm_check_status="failed",
            llm_run_id=run.run_id,
            llm_last_error="provider_quota: No credit.",
        )
        _submission(db, survey, 3, llm_check_status="not_run_allowance", llm_run_id=run.run_id)

        def transcript(n, **fields):
            db.add(
                AudioTranscript(
                    survey_id=survey.survey_id,
                    submission_id=n,
                    question_path="interview/story",
                    run_id=run.run_id,
                    **fields,
                )
            )

        transcript(1, status="failed", last_error="auth: ElevenLabs refused your key.")
        transcript(2, status="failed", last_error="bad_request: Unsupported file.")
        transcript(3, status="failed", last_error="bad_request: Damaged file.")
        transcript(4, status="not_run_allowance")
        transcript(5, status="skipped", skip_reason="too_long")
        db.add(
            AnswerTranslation(
                survey_id=survey.survey_id,
                submission_id=1,
                question_path="v",
                language="eng",
                run_id=run.run_id,
                status="not_run_allowance",
            )
        )
        db.commit()

        problems = run_problems(
            db, run, survey, {"ai_checks": 1, "transcripts": 1, "translations": 1}
        )

        assert [p["kind"] for p in problems] == [
            "ai_paused",
            "ai_auth",
            "ai_quota",
            "ai_allowance",
            "transcription_auth",
            "transcription_bad_file",
            "transcription_allowance",
            "transcription_too_long",
            "translation_allowance",
            "pull_errors",
        ]
        by_kind = {p["kind"]: p for p in problems}
        assert by_kind["transcription_auth"] == {
            "kind": "transcription_auth",
            "text": "Transcription stopped: ElevenLabs refused your key.",
            "action": "open_ai_providers",
        }
        assert by_kind["transcription_bad_file"]["text"].startswith(
            "2 recordings couldn't be transcribed"
        )
        assert by_kind["ai_allowance"]["text"].startswith("1 answer not reviewed")
        assert by_kind["pull_errors"] == {
            "kind": "pull_errors",
            "text": "3 submissions couldn't be processed; the rest of the pull went through.",
            "action": None,
        }

    def test_nothing_to_report(self, db, survey):
        from services.runs import run_problems

        run = _run(db, survey, status="finished", stats={})
        assert run_problems(db, run, survey, {"ai_checks": 1, "transcripts": 1}) == []
