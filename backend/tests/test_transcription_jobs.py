"""
Transcription and Kobo-send jobs, end to end against the test database, with
Kobo and ElevenLabs replaced by fakes. See docs/specs/audio-transcription.md.
"""

import json
from datetime import datetime, timedelta
from uuid import uuid4

import pytest
import requests
from sqlalchemy.orm import sessionmaker

import services.kobo_sync_worker as kobo_sync_worker
import services.transcription_queue as transcription_queue
import services.transcription_runtime as runtime
from database.models import AIUsage, AudioTranscript, Notification, Run, SubmissionCurrent, User
from services.ai_errors import AIError
from services.runs import finish_if_done
from services.transcription_client import TranscriptResult
from services.transcription_queue import TranscriptionQueuer

KOBO_TOOL = {
    "survey": [
        {"type": "text", "name": "village", "label::English (en)": "Village"},
        {
            "type": "audio",
            "name": "story",
            "label::English (en)": "Story",
            "group_path": "interview",
        },
    ],
    "choices": [],
    "label_column_survey": "label::English (en)",
}


def _attachment(uid="att1", filename="s.m4a"):
    return {
        "uid": uid,
        "download_url": f"https://kf.kobotoolbox.org/api/v2/assets/a1/data/1/attachments/{uid}/",
        "filename": f"x/{filename}",
        "question_xpath": "interview/story",
    }


@pytest.fixture
def owner(test_db):
    user = User(
        user_id=uuid4(),
        email="owner@example.invalid",
        username="owner",
        password_hash="x",
        full_name="Amina",
        is_active=True,
    )
    test_db.add(user)
    test_db.commit()
    return user


@pytest.fixture
def survey(test_db, test_survey_config, owner):
    config = dict(test_survey_config.config_data)
    config["kobo_tool"] = KOBO_TOOL
    config["audio_transcription"] = {
        "enabled": True,
        "questions": ["interview/story"],
        "language": "fra",
        "send_to_kobo": False,
    }
    test_survey_config.config_data = config
    test_survey_config.user_id = owner.user_id
    test_db.commit()
    return test_survey_config


def _submission(db, survey, _id=1, attachments=None, filename="s.m4a", **fields):
    submission = SubmissionCurrent(
        _id=_id,
        survey_id=survey.survey_id,
        _uuid=f"uuid-{_id}",
        _submission_time=datetime(2026, 6, 1),
        end=datetime(2026, 6, 1, 1),
        submission_data={
            "_uuid": f"uuid-{_id}",
            "meta/rootUuid": f"uuid:root-{_id}",
            "interview/story": filename,
            "_attachments": attachments if attachments is not None else [_attachment()],
        },
        data_quality_issues=[],
        qa_status="PENDING_APPROVAL",
        llm_check_status=fields.pop("llm_check_status", "skipped"),
        **fields,
    )
    db.add(submission)
    db.commit()
    return submission


class _FakeClient:
    available = True
    model = "scribe_v2"
    outcome: object = TranscriptResult("Il a plu", "fra", 0.98, 30.0, None)
    calls: list = []

    @classmethod
    def from_env(cls):
        return cls()

    def transcribe(self, audio, **kwargs):
        _FakeClient.calls.append(kwargs)
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


class _FakeKobo:
    status: int | None = None

    def __init__(self, api_token, api_url):
        self.api_url = api_url

    def download_attachment(self, url, path, max_bytes=0):
        from etl.kobo_fetcher import KoboFetchError

        if self.status:
            raise KoboFetchError("nope", status=self.status)
        with open(path, "wb") as handle:
            handle.write(b"audio")
        return 5


class _Recorder:
    def __init__(self):
        self.sent = []

    def apply_async(self, kwargs=None, task_id=None):
        self.sent.append((kwargs, task_id))


@pytest.fixture
def env(test_db, monkeypatch):
    sessions = sessionmaker(bind=test_db.get_bind())
    monkeypatch.setattr(runtime, "SessionLocal", sessions)
    monkeypatch.setattr(kobo_sync_worker, "SessionLocal", sessions)
    monkeypatch.setenv("ELEVENLABS_API_KEY", "operator-elevenlabs-key")
    monkeypatch.setattr(runtime, "client_for", lambda key: _FakeClient())
    monkeypatch.setattr(transcription_queue, "client_for", lambda key: _FakeClient())
    monkeypatch.setattr(runtime, "KoboFetcher", _FakeKobo)
    monkeypatch.setattr(runtime, "get_user_kobo_token", lambda user: "kobo-token")
    monkeypatch.setattr(runtime, "probe_duration", lambda path: 30.0)
    _FakeClient.outcome = TranscriptResult("Il a plu", "fra", 0.98, 30.0, None)
    _FakeClient.calls = []
    _FakeKobo.status = None
    kobo_tasks = _Recorder()
    ai_tasks = _Recorder()
    monkeypatch.setattr(
        kobo_sync_worker.send_transcript_to_kobo_task, "apply_async", kobo_tasks.apply_async
    )
    import services.qualitative_worker as qualitative_worker

    monkeypatch.setattr(
        qualitative_worker.run_qualitative_check_task, "apply_async", ai_tasks.apply_async
    )
    return {"kobo_tasks": kobo_tasks, "ai_tasks": ai_tasks}


def _queue(db, survey, submission, run_id=None, user_id=None):
    queuer = TranscriptionQueuer(db, survey, run_id=run_id, user_id=user_id or survey.user_id)
    rows = queuer.consider(submission)
    db.flush()
    queuer.queue(rows)
    db.commit()
    return queuer, rows


def _run(db, row, final_attempt=True):
    try:
        return runtime.run_transcription_job(
            {"transcript_id": row.transcript_id, "input_hash": row.input_hash},
            job_id="job-1",
            final_attempt=final_attempt,
        )
    finally:
        db.expire_all()


class TestQueueing:
    def test_a_recording_is_queued_once(self, test_db, survey, env):
        submission = _submission(test_db, survey)
        queuer, rows = _queue(test_db, survey, submission)
        assert [r.status for r in rows] == ["pending"] and queuer.stats["transcripts_queued"] == 1
        rows[0].status = "success"
        test_db.commit()
        _, again = _queue(test_db, survey, submission)
        assert again == []

    def test_a_replaced_recording_is_queued_again(self, test_db, survey, env):
        submission = _submission(test_db, survey)
        _, rows = _queue(test_db, survey, submission)
        rows[0].status = "success"
        submission.submission_data = {
            **submission.submission_data,
            "_attachments": [_attachment("att2")],
        }
        test_db.commit()
        _, again = _queue(test_db, survey, submission)
        assert [r.attachment_uid for r in again] == ["att2"]

    def test_missing_file_is_skipped_not_sent(self, test_db, survey, env):
        submission = _submission(test_db, survey, attachments=[])
        queuer, rows = _queue(test_db, survey, submission)
        assert rows[0].status == "skipped" and rows[0].skip_reason == "missing_file"
        assert queuer._to_send == []

    def test_a_bad_file_is_not_retried_but_a_timeout_is(self, test_db, survey, env):
        submission = _submission(test_db, survey)
        _, rows = _queue(test_db, survey, submission)
        rows[0].status = "failed"
        rows[0].last_error = "bad_request: Unsupported file"
        test_db.commit()
        assert _queue(test_db, survey, submission)[1] == []
        rows[0].last_error = "timeout: slow"
        test_db.commit()
        assert len(_queue(test_db, survey, submission)[1]) == 1

    def test_nothing_without_a_key(self, test_db, survey, env, monkeypatch):
        monkeypatch.setattr(_FakeClient, "available", False)
        submission = _submission(test_db, survey)
        _, rows = _queue(test_db, survey, submission)
        assert rows[0].status == "failed" and rows[0].last_error.startswith("not_configured")


def _in_kobo(submission, db, value="Il a plu fort", language="fr"):
    """Kobo now shows a transcript for the story, as its data API sends it."""
    data = dict(submission.submission_data)
    if value is None:
        data.pop("_supplementalDetails", None)
    else:
        data["_supplementalDetails"] = {
            "interview/story": {"transcript": {"value": value, "languageCode": language}}
        }
    submission.submission_data = data
    db.commit()


class TestTranscriptsFromKobo:
    def test_a_transcript_in_kobo_is_kept_and_not_transcribed(self, test_db, survey, env):
        submission = _submission(test_db, survey)
        _in_kobo(submission, test_db)
        queuer, rows = _queue(test_db, survey, submission)
        assert rows == [] and queuer._to_send == []
        assert queuer.stats["transcripts_from_kobo"] == 1
        row = test_db.query(AudioTranscript).one()
        assert (row.source, row.status, row.text) == ("kobo", "success", "Il a plu fort")
        assert row.language_code == "fra" and row.kobo_language == "fr"
        assert row.kobo_status == "sent" and row.run_id is None
        # The next pull changes nothing.
        queuer, rows = _queue(test_db, survey, submission)
        assert rows == [] and queuer.stats["transcripts_from_kobo"] == 0

    def test_read_for_questions_this_survey_does_not_transcribe(self, test_db, survey, env):
        survey.config_data = {
            **survey.config_data,
            "audio_transcription": {**survey.config_data["audio_transcription"], "enabled": False},
        }
        test_db.commit()
        submission = _submission(test_db, survey)
        _in_kobo(submission, test_db)
        _queue(test_db, survey, submission)
        assert test_db.query(AudioTranscript).one().source == "kobo"

    def test_one_waiting_for_review_in_kobo_is_transcribed_here(self, test_db, survey, env):
        submission = _submission(test_db, survey)
        submission.submission_data = {
            **submission.submission_data,
            "_supplementalDetails": {
                "interview/story": {"transcript": {"languageCode": "fr", "pendingReview": True}}
            },
        }
        test_db.commit()
        _, rows = _queue(test_db, survey, submission)
        assert [(r.source, r.status) for r in rows] == [("elevenlabs", "pending")]

    def test_ours_sent_to_kobo_stays_ours(self, test_db, survey, env):
        submission = _submission(test_db, survey)
        _, rows = _queue(test_db, survey, submission)
        rows[0].status, rows[0].text = "success", "Il a plu"
        rows[0].kobo_status, rows[0].kobo_version_uuid = "sent", "v-ours"
        test_db.commit()
        _in_kobo(submission, test_db, value="Il a plu")
        _queue(test_db, survey, submission)
        row = test_db.query(AudioTranscript).one()
        assert (row.source, row.kobo_status) == ("elevenlabs", "sent")

    def test_ours_corrected_in_kobo_shows_the_correction(self, test_db, survey, env):
        submission = _submission(test_db, survey)
        _, rows = _queue(test_db, survey, submission)
        rows[0].status, rows[0].text = "success", "Il a plu"
        rows[0].kobo_status, rows[0].kobo_version_uuid = "sent", "v-ours"
        test_db.commit()
        _in_kobo(submission, test_db, value="Il a beaucoup plu")
        _queue(test_db, survey, submission)
        row = test_db.query(AudioTranscript).one()
        assert (row.source, row.text, row.kobo_status) == (
            "kobo",
            "Il a beaucoup plu",
            "edited_in_kobo",
        )

    def test_a_newer_one_of_ours_on_its_way_to_kobo_is_left_alone(self, test_db, survey, env):
        submission = _submission(test_db, survey)
        _, rows = _queue(test_db, survey, submission)
        # Transcribed again; Kobo still shows our first version.
        rows[0].status, rows[0].text = "success", "Il a plu, encore"
        rows[0].kobo_status, rows[0].kobo_version_uuid = "pending", "v-ours"
        test_db.commit()
        _in_kobo(submission, test_db, value="Il a plu")
        _queue(test_db, survey, submission)
        assert test_db.query(AudioTranscript).one().source == "elevenlabs"

    def test_a_queued_transcription_is_dropped_when_kobo_has_one(self, test_db, survey, env):
        submission = _submission(test_db, survey)
        _, rows = _queue(test_db, survey, submission)
        queued = test_db.query(AudioTranscript).one()
        job = {"transcript_id": queued.transcript_id, "input_hash": queued.input_hash}
        _in_kobo(submission, test_db)
        _queue(test_db, survey, submission)
        result = runtime.run_transcription_job(job, job_id="job-1")
        assert result["status"] == "stale" and _FakeClient.calls == []
        test_db.expire_all()
        assert test_db.query(AudioTranscript).one().source == "kobo"

    def test_transcribe_all_again_leaves_kobos_alone(self, test_db, survey, env):
        submission = _submission(test_db, survey)
        _in_kobo(submission, test_db)
        _queue(test_db, survey, submission)
        row = test_db.query(AudioTranscript).one()
        row.input_hash = None  # what "Transcribe all again" does to the others
        test_db.commit()
        _, rows = _queue(test_db, survey, submission)
        assert rows == []

    def test_removed_in_kobo_is_transcribed_here_again(self, test_db, survey, env):
        submission = _submission(test_db, survey)
        _in_kobo(submission, test_db)
        _queue(test_db, survey, submission)
        _in_kobo(submission, test_db, value=None)
        _, rows = _queue(test_db, survey, submission)
        assert [(r.source, r.status) for r in rows] == [("elevenlabs", "pending")]
        assert test_db.query(AudioTranscript).count() == 1

    def test_counted_apart_from_ours(self, test_db, survey, env):
        from routers.transcription import _counts

        theirs = _submission(test_db, survey, _id=1)
        _in_kobo(theirs, test_db)
        _queue(test_db, survey, theirs)
        corrected = _submission(test_db, survey, _id=2)
        _, rows = _queue(test_db, survey, corrected)
        rows[0].status, rows[0].text = "success", "Il a plu"
        rows[0].kobo_status, rows[0].kobo_version_uuid = "sent", "v-ours"
        test_db.commit()
        _in_kobo(corrected, test_db, value="Il a beaucoup plu")
        _queue(test_db, survey, corrected)
        counts = _counts(test_db, survey.survey_id)
        assert counts["from_kobo"] == 1
        assert counts["kobo"]["sent"] == 0 and counts["kobo"]["edited_in_kobo"] == 1

    def test_kobos_transcript_is_what_the_built_in_checks_read(self, test_db, survey, env):
        submission = _submission(test_db, survey)
        _, rows = _queue(test_db, survey, submission)
        rows[0].status, rows[0].text, rows[0].audio_seconds = "success", "", 30
        test_db.commit()
        runtime.refresh_transcript_issues(test_db, survey, submission)
        test_db.commit()
        assert [i["check"] for i in submission.data_quality_issues] == ["audio_no_speech"]
        _in_kobo(submission, test_db, value="Nous avons tout perdu")
        _queue(test_db, survey, submission)
        test_db.refresh(submission)
        assert submission.data_quality_issues == []


class TestTranscriptionJob:
    def test_success_stores_the_transcript_and_counts_the_minutes(self, test_db, survey, env):
        submission = _submission(test_db, survey)
        _, rows = _queue(test_db, survey, submission)
        assert _run(test_db, rows[0])["status"] == "success"
        row = test_db.query(AudioTranscript).one()
        assert (row.status, row.text, row.language_code, float(row.audio_seconds)) == (
            "success",
            "Il a plu",
            "fra",
            30.0,
        )
        usage = test_db.query(AIUsage).one()
        assert (
            usage.feature == "transcription"
            and usage.outcome == "ok"
            and float(usage.audio_seconds) == 30.0
        )
        assert usage.cost_usd_micros == round(30 * 0.22 * 1_000_000 / 3600)
        assert _FakeClient.calls[0] == {
            "language": "fra",
            "diarize": False,
            "duration_seconds": 30.0,
        }

    def test_answer_in_another_language_is_flagged(self, test_db, survey, env):
        _FakeClient.outcome = TranscriptResult("It rained", "eng", 0.97, 30.0, None)
        submission = _submission(test_db, survey)
        _, rows = _queue(test_db, survey, submission)
        _run(test_db, rows[0])
        stored = test_db.query(SubmissionCurrent).one()
        assert [i["check"] for i in stored.data_quality_issues] == ["audio_language_mismatch"]
        assert stored.qa_status == "FLAGGED"

    def test_allowance_used_up_sends_nothing(self, test_db, survey, env, monkeypatch):
        monkeypatch.setenv("TRANSCRIPTION_ALLOWANCE_MINUTES_PER_SURVEY_MONTH", "0")
        submission = _submission(test_db, survey)
        _, rows = _queue(test_db, survey, submission)
        assert _run(test_db, rows[0])["status"] == "not_run_allowance"
        assert _FakeClient.calls == []
        assert test_db.query(AudioTranscript).one().last_error.startswith("allowance:")

    def test_too_long_is_skipped(self, test_db, survey, env, monkeypatch):
        monkeypatch.setattr(runtime, "probe_duration", lambda path: 4000.0)
        submission = _submission(test_db, survey)
        _, rows = _queue(test_db, survey, submission)
        assert _run(test_db, rows[0])["status"] == "skipped"
        assert test_db.query(AudioTranscript).one().skip_reason == "too_long"
        assert _FakeClient.calls == []

    def test_temporary_failure_is_retried_and_costs_nothing(self, test_db, survey, env):
        _FakeClient.outcome = AIError("rate_limited", "busy", retry_after=5)
        submission = _submission(test_db, survey)
        _, rows = _queue(test_db, survey, submission)
        with pytest.raises(AIError):
            _run(test_db, rows[0], final_attempt=False)
        row = test_db.query(AudioTranscript).one()
        assert row.status == "pending" and row.last_error.endswith("(retrying)")
        assert test_db.query(AIUsage).one().outcome == "rate_limited"

    def test_rejected_key_fails_and_tells_the_owner(self, test_db, survey, env, owner):
        _FakeClient.outcome = AIError("auth", "Invalid API key")
        submission = _submission(test_db, survey)
        _, rows = _queue(test_db, survey, submission)
        assert _run(test_db, rows[0])["status"] == "failed"
        note = test_db.query(Notification).one()
        assert note.user_id == owner.user_id and note.kind == "paused"
        assert "ElevenLabs rejected the API key" in note.title
        # The next pull does not send recordings while the key is known bad.
        assert TranscriptionQueuer(
            test_db, survey, run_id=None, user_id=None
        ).paused_error.startswith("auth")

    def test_kobo_refusing_the_download_is_a_kobo_problem(self, test_db, survey, env):
        _FakeKobo.status = 403
        submission = _submission(test_db, survey)
        _, rows = _queue(test_db, survey, submission)
        _run(test_db, rows[0])
        assert test_db.query(AudioTranscript).one().last_error.startswith("kobo_auth")

    def test_turned_off_meanwhile_is_cancelled(self, test_db, survey, env):
        submission = _submission(test_db, survey)
        _, rows = _queue(test_db, survey, submission)
        survey.config_data = {**survey.config_data, "audio_transcription": {"enabled": False}}
        test_db.commit()
        assert _run(test_db, rows[0])["status"] == "cancelled"
        assert _FakeClient.calls == []

    def test_success_queues_the_kobo_send_when_on(self, test_db, survey, env):
        survey.config_data = {
            **survey.config_data,
            "audio_transcription": {
                **survey.config_data["audio_transcription"],
                "send_to_kobo": True,
            },
        }
        test_db.commit()
        submission = _submission(test_db, survey)
        _, rows = _queue(test_db, survey, submission)
        _run(test_db, rows[0])
        assert test_db.query(AudioTranscript).one().kobo_status == "pending"
        assert len(env["kobo_tasks"].sent) == 1

    def test_waiting_ai_review_starts_once_the_transcript_is_in(
        self, test_db, survey, env, monkeypatch
    ):
        # The review runs on the included usage, which needs the operator's key.
        monkeypatch.setenv("OPENAI_API_KEY", "sk-operator")
        survey.config_data = {
            **survey.config_data,
            "quality_checks": {
                "flag_llm_qualitative": True,
                "llm_qualitative_fields": ["story"],
                "llm_check_types": ["relevance"],
            },
        }
        test_db.commit()
        submission = _submission(test_db, survey, llm_check_status="waiting")
        _, rows = _queue(test_db, survey, submission)
        _run(test_db, rows[0])
        stored = test_db.query(SubmissionCurrent).one()
        assert stored.llm_check_status == "pending"
        assert len(env["ai_tasks"].sent) == 1


class TestRunFinishes:
    def test_last_item_finishes_the_run_once_and_notifies(self, test_db, survey, env, owner):
        run = Run(
            survey_id=survey.survey_id,
            kind="pull",
            started_by_user_id=owner.user_id,
            status="background",
            stage="background",
            stats={"transcripts_queued": 1},
        )
        test_db.add(run)
        test_db.commit()
        submission = _submission(test_db, survey)
        _, rows = _queue(test_db, survey, submission, run_id=run.run_id)
        _run(test_db, rows[0])
        stored = test_db.query(Run).one()
        assert stored.status == "finished" and stored.finished_at is not None
        assert finish_if_done(test_db, run.run_id) is False  # already done
        notes = test_db.query(Notification).filter(Notification.kind == "run_finished").all()
        assert len(notes) == 1 and "1 recording transcribed" in notes[0].body


def _kobo_response(status, body=None):
    response = requests.Response()
    response.status_code = status
    response._content = json.dumps(body).encode() if body is not None else b""
    return response


class _FakeSupplementKobo:
    """Kobo's advanced-features and supplement endpoints, as a script."""

    replies: dict = {}
    calls: list = []

    def __init__(self, api_token, api_url):
        self.api_url = api_url

    def request_json(self, method, endpoint, payload=None, timeout=30):
        _FakeSupplementKobo.calls.append((method, endpoint, payload))
        for (m, fragment), reply in self.replies.items():
            if m == method and fragment in endpoint:
                return reply() if callable(reply) else reply
        return _kobo_response(404, {"detail": "Not found"})


@pytest.fixture
def kobo(test_db, survey, env, monkeypatch):
    from services import kobo_supplement

    kobo_supplement._feature_cache.clear()
    monkeypatch.setattr(kobo_sync_worker, "KoboFetcher", _FakeSupplementKobo)
    monkeypatch.setattr(kobo_sync_worker, "get_user_kobo_token", lambda user: "kobo-token")
    survey.config_data = {
        **survey.config_data,
        "audio_transcription": {**survey.config_data["audio_transcription"], "send_to_kobo": True},
    }
    test_db.commit()
    _FakeSupplementKobo.calls = []
    version = {
        "_uuid": "v-ours",
        "_dateCreated": "2026-10-03T10:00:00Z",
        "_data": {"language": "fr", "value": "Il a plu"},
    }
    _FakeSupplementKobo.replies = {
        ("GET", "advanced-features"): _kobo_response(200, []),
        ("POST", "advanced-features"): _kobo_response(201, {"uid": "f1"}),
        ("PATCH", "/supplement/"): _kobo_response(
            200, {"interview/story": {"manual_transcription": {"_versions": [version]}}}
        ),
    }
    return _FakeSupplementKobo


def _transcribed(test_db, survey, **fields):
    submission = _submission(test_db, survey)
    row = AudioTranscript(
        survey_id=survey.survey_id,
        submission_id=submission._id,
        question_path="interview/story",
        status="success",
        text="Il a plu",
        language_code="fra",
        kobo_status="pending",
        requested_by_user_id=survey.user_id,
        **fields,
    )
    test_db.add(row)
    test_db.commit()
    return row


def _send(test_db, row, final_attempt=True):
    try:
        return kobo_sync_worker.run_kobo_send_job(
            {"transcript_id": row.transcript_id}, final_attempt=final_attempt
        )
    finally:
        test_db.expire_all()


class TestSendToKobo:
    def test_enables_the_feature_then_sends(self, test_db, survey, kobo):
        row = _transcribed(test_db, survey)
        assert _send(test_db, row)["status"] == "sent"
        methods = [(m, e.split("/")[-2]) for m, e, _ in kobo.calls]
        assert methods == [
            ("GET", "supplement"),
            ("GET", "advanced-features"),
            ("POST", "advanced-features"),
            ("PATCH", "supplement"),
        ]
        post = kobo.calls[2][2]
        assert post == {
            "question_xpath": "interview/story",
            "action": "manual_transcription",
            "params": [{"language": "fr"}],
        }
        patch = kobo.calls[3]
        assert "/data/root-1/supplement/" in patch[1]
        assert patch[2] == {
            "_version": "20250820",
            "interview/story": {"manual_transcription": {"language": "fr", "value": "Il a plu"}},
        }
        stored = test_db.query(AudioTranscript).one()
        assert stored.kobo_version_uuid == "v-ours" and stored.kobo_language == "fr"

    def test_an_answer_in_another_language_is_filed_under_it(self, test_db, survey, kobo):
        row = _transcribed(test_db, survey)
        row.language_code, row.language_probability, row.text = "eng", 0.96, "It rained"
        test_db.commit()
        _send(test_db, row)
        post = next(c for c in kobo.calls if c[0] == "POST")
        assert post[2]["params"] == [{"language": "en"}]

    def test_an_unsure_detection_uses_the_survey_language(self, test_db, survey, kobo):
        row = _transcribed(test_db, survey)
        row.language_code, row.language_probability = "eng", 0.4
        test_db.commit()
        _send(test_db, row)
        assert next(c for c in kobo.calls if c[0] == "POST")[2]["params"] == [{"language": "fr"}]

    def test_adds_a_language_to_an_existing_feature(self, test_db, survey, kobo):
        kobo.replies[("GET", "advanced-features")] = _kobo_response(
            200,
            [
                {
                    "uid": "f1",
                    "action": "manual_transcription",
                    "question_xpath": "interview/story",
                    "params": [{"language": "en"}],
                }
            ],
        )
        kobo.replies[("PATCH", "advanced-features")] = _kobo_response(200, {})
        _send(test_db, _transcribed(test_db, survey))
        patch = next(c for c in kobo.calls if c[0] == "PATCH" and "advanced-features" in c[1])
        assert patch[2] == {"params": [{"language": "en"}, {"language": "fr"}]}

    def test_a_correction_made_in_kobo_is_never_overwritten(self, test_db, survey, kobo):
        theirs = {
            "_uuid": "v-theirs",
            "_dateCreated": "2026-10-04T09:00:00Z",
            "_data": {"value": "Il a beaucoup plu"},
        }
        ours = {"_uuid": "v-ours", "_dateCreated": "2026-10-03T10:00:00Z"}
        kobo.replies[("GET", "/supplement/")] = _kobo_response(
            200, {"interview/story": {"manual_transcription": {"_versions": [theirs, ours]}}}
        )
        row = _transcribed(test_db, survey, kobo_version_uuid="v-ours")
        assert _send(test_db, row)["status"] == "edited_in_kobo"
        assert not any(m == "PATCH" for m, _, _ in kobo.calls)

    def test_a_transcript_kobo_already_has_is_never_overwritten(self, test_db, survey, kobo):
        googles = {
            "_uuid": "v-google",
            "_dateCreated": "2026-10-04T09:00:00Z",
            "_dateAccepted": "2026-10-04T09:05:00Z",
            "_data": {"language": "fr", "value": "Il a plu fort", "status": "complete"},
        }
        kobo.replies[("GET", "/supplement/")] = _kobo_response(
            200,
            {"interview/story": {"automatic_google_transcription": {"_versions": [googles]}}},
        )
        row = _transcribed(test_db, survey)
        assert _send(test_db, row)["status"] == "edited_in_kobo"
        assert not any(m in ("POST", "PATCH") for m, _, _ in kobo.calls)

    def test_three_permission_failures_pause_sending(self, test_db, survey, kobo, owner):
        kobo.replies[("GET", "advanced-features")] = _kobo_response(403, {"detail": "no"})
        for minute in range(3):
            row = _transcribed(test_db, survey) if minute == 0 else None
            if row is None:
                submission_id = minute + 1
                _submission(test_db, survey, _id=submission_id)
                row = AudioTranscript(
                    survey_id=survey.survey_id,
                    submission_id=submission_id,
                    question_path="interview/story",
                    status="success",
                    text="x",
                    language_code="fra",
                    kobo_status="pending",
                )
                test_db.add(row)
                test_db.commit()
            _send(test_db, row)
        test_db.refresh(survey)
        pause = survey.config_data["audio_transcription"]["kobo_pause"]
        assert pause["reason"] == "permission"
        assert test_db.query(Notification).filter(Notification.kind == "paused").count() == 1

    def test_old_kobo_server_is_unsupported(self, test_db, survey, kobo):
        kobo.replies[("GET", "advanced-features")] = _kobo_response(404, {"detail": "Not found"})
        assert _send(test_db, _transcribed(test_db, survey))["status"] == "unsupported"
        test_db.refresh(survey)
        assert survey.config_data["audio_transcription"]["kobo_pause"]["reason"] == "unsupported"

    def test_kobo_busy_is_retried(self, test_db, survey, kobo):
        from services.kobo_supplement import KoboSupplementError

        kobo.replies[("GET", "advanced-features")] = _kobo_response(503, {"detail": "busy"})
        row = _transcribed(test_db, survey)
        with pytest.raises(KoboSupplementError):
            _send(test_db, row, final_attempt=False)
        assert test_db.query(AudioTranscript).one().kobo_status == "pending"


def test_stalled_transcriptions_are_swept(test_db, survey, env):
    submission = _submission(test_db, survey)
    _, rows = _queue(test_db, survey, submission)
    rows[0].status = "running"
    rows[0].started_at = datetime.utcnow() - timedelta(hours=1)
    test_db.commit()
    assert runtime.sweep_stalled_transcripts(test_db) == 1
    assert test_db.query(AudioTranscript).one().last_error.startswith("timeout")


class _FakeFetcher:
    def __init__(self, submissions):
        self.submissions = submissions

    def get_asset_submissions(self, **_):
        return self.submissions

    def get_asset_info(self, asset_uid):
        return {}


def test_a_pull_queues_transcriptions_and_the_ai_review_waits(
    test_db, survey, env, monkeypatch, owner
):
    import etl.pipeline as pipeline_module
    from etl.pipeline import ETLPipeline

    survey.config_data = {
        **survey.config_data,
        "quality_checks": {
            "flag_llm_qualitative": True,
            "llm_qualitative_fields": ["story"],
            "llm_check_types": ["relevance"],
        },
    }
    test_db.commit()
    transcribe = _Recorder()
    import services.transcription_worker as transcription_worker

    monkeypatch.setattr(
        transcription_worker.transcribe_recording_task, "apply_async", transcribe.apply_async
    )
    ai = _Recorder()
    monkeypatch.setattr(pipeline_module, "run_qualitative_check_task", ai)
    run = Run(
        survey_id=survey.survey_id,
        kind="pull",
        started_by_user_id=owner.user_id,
        status="running",
        stage="fetching",
        stats={},
    )
    test_db.add(run)
    test_db.commit()

    kobo_sub = {
        "_id": 77,
        "_uuid": "pull-77",
        "_submission_time": "2026-10-10T10:00:00Z",
        "end": "2026-10-10T10:00:00Z",
        "interview/story": "s.m4a",
        "_attachments": [_attachment()],
    }
    stats = ETLPipeline(
        test_db, kobo_fetcher=_FakeFetcher([kobo_sub]), run=run, started_by_user_id=owner.user_id
    ).run_pipeline(str(survey.survey_id))

    assert (
        stats["transcripts_queued"] == 1 and stats["llm_waiting"] == 1 and stats["llm_queued"] == 0
    )
    assert len(transcribe.sent) == 1 and ai.sent == []
    row = test_db.query(AudioTranscript).one()
    assert (row.status, row.run_id, row.requested_by_user_id) == (
        "pending",
        run.run_id,
        owner.user_id,
    )
    submission = test_db.query(SubmissionCurrent).one()
    assert submission.llm_check_status == "waiting" and submission.llm_run_id == run.run_id


class TestOwnKey:
    """A survey's own ElevenLabs key: used instead of Field Compass's, never limited."""

    @pytest.fixture
    def own_key(self, test_db, owner, survey):
        from database.models import AIConnection
        from services.auth import encrypt_api_key

        connection = AIConnection(
            owner_user_id=owner.user_id,
            kind="transcription",
            label="My ElevenLabs",
            preset="elevenlabs",
            base_url="https://api.elevenlabs.io",
            check_model="scribe_v2",
            api_key_encrypted=encrypt_api_key("sk_owner_key_0123456789"),
            api_key_hint="6789",
            status="ok",
            consecutive_failures=0,
        )
        test_db.add(connection)
        test_db.flush()
        survey.transcription_connection_id = connection.connection_id
        test_db.commit()
        return connection

    def test_the_surveys_key_is_used_and_not_counted(
        self, test_db, survey, env, own_key, monkeypatch
    ):
        from services.transcription_allowance import seconds_used

        used_keys = []
        monkeypatch.setattr(
            runtime, "client_for", lambda key: used_keys.append(key) or _FakeClient()
        )
        monkeypatch.setenv("TRANSCRIPTION_ALLOWANCE_MINUTES_PER_SURVEY_MONTH", "0")
        submission = _submission(test_db, survey)
        _, rows = _queue(test_db, survey, submission)
        assert _run(test_db, rows[0])["status"] == "success"
        assert used_keys[0].source == "own" and used_keys[0].api_key == "sk_owner_key_0123456789"
        usage = test_db.query(AIUsage).one()
        assert (usage.connection_id, usage.outcome, float(usage.audio_seconds)) == (
            own_key.connection_id,
            "ok",
            30.0,
        )
        assert seconds_used(test_db, survey.survey_id) == 0

    def test_a_key_refused_again_and_again_is_paused(self, test_db, survey, env, own_key):
        own_key.consecutive_failures = 2  # the third rejection pauses it
        test_db.commit()
        _FakeClient.outcome = AIError("auth", "invalid_api_key")
        submission = _submission(test_db, survey)
        _, rows = _queue(test_db, survey, submission)
        _run(test_db, rows[0])
        test_db.refresh(own_key)
        assert own_key.status == "failing"
        assert "your key" in test_db.query(AudioTranscript).one().last_error
        note = test_db.query(Notification).filter(Notification.kind == "paused").one()
        assert note.link == {"view": "userSettings", "tab": "ai"}
        # The next pull does not send this survey's recordings until the key is fixed.
        paused = TranscriptionQueuer(test_db, survey, run_id=None, user_id=None).paused_error
        assert "My ElevenLabs" in paused

    def test_another_users_key_is_never_used(self, test_db, survey, env, own_key, monkeypatch):
        from services.transcription_keys import resolve_transcription_key

        survey.user_id = None  # ownership changed: the key's owner no longer owns it
        test_db.commit()
        assert resolve_transcription_key(test_db, survey).source == "operator"


def _key_response(status, body):
    response = requests.Response()
    response.status_code = status
    response._content = json.dumps(body).encode()
    return response


class _KeySession:
    def __init__(self, response):
        self.response = response

    def get(self, url, **kwargs):
        assert url.endswith("/v1/user") and kwargs["headers"]["xi-api-key"] == "sk_test"
        return self.response


class TestCheckingAKey:
    def test_accepted(self):
        from services.transcription_keys import check_key

        result = check_key(
            "sk_test", _KeySession(_key_response(200, {"subscription": {"tier": "creator"}}))
        )
        assert result.ok

    def test_a_speech_to_text_only_key_is_accepted(self):
        from services.transcription_keys import check_key

        body = {"detail": {"status": "missing_permissions", "message": "missing user_read"}}
        result = check_key("sk_test", _KeySession(_key_response(401, body)))
        assert result.ok

    def test_an_unknown_key_is_refused(self):
        from services.transcription_keys import check_key

        body = {
            "detail": {
                "type": "authentication_error",
                "code": "invalid_api_key",
                "message": "Invalid API key",
            }
        }
        assert not check_key("sk_test", _KeySession(_key_response(401, body))).ok


def test_new_error_codes_are_understood():
    from services.transcription_client import classify_response

    quota = _key_response(
        401, {"detail": {"type": "payment_required", "code": "insufficient_credits"}}
    )
    busy = _key_response(
        429, {"detail": {"type": "rate_limit_error", "code": "concurrent_limit_exceeded"}}
    )
    restricted = _key_response(
        403, {"detail": {"type": "authorization_error", "code": "insufficient_permissions"}}
    )
    assert classify_response(quota).category == "provider_quota"
    assert classify_response(busy).category == "rate_limited"
    error = classify_response(restricted)
    assert error.category == "auth" and "Speech to Text" in error.message
