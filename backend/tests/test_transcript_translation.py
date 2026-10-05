"""
Translating transcripts with the survey's AI provider, and sending the
translations to Kobo, end to end against the test database with the AI and
Kobo replaced by fakes. See docs/specs/transcript-translation.md.
"""

from datetime import datetime
from types import SimpleNamespace

import pytest
from sqlalchemy.orm import sessionmaker

import services.ai_service as ai_service_module
import services.kobo_sync_worker as kobo_sync_worker
import services.translation_queue as translation_queue
import services.translation_runtime as translation_runtime
import tests.test_transcription_jobs as jobs
from database.models import AIUsage, AudioTranscript, Run, TranscriptTranslation
from etl.audio import transcription_settings, translation_input_hash
from services.ai_allowance import checks_used
from services.ai_client import CallUsage
from services.ai_errors import AIError
from services.ai_service import AIService
from services.runs import has_open_items, run_counts, stop_run
from services.translation_queue import TranslationQueuer, send_translation_when_ready
from tests.test_transcription_jobs import (
    _attachment,
    _FakeFetcher,
    _kobo_response,
    _queue,
    _Recorder,
    _run,
    _submission,
)

# The transcription tests' fixtures: an owner, a survey transcribing its
# "interview/story" question, fakes for ElevenLabs, and Kobo's supplement API.
owner = jobs.owner
survey = jobs.survey
env = jobs.env
kobo = jobs.kobo


class _FakeAI:
    """AIService as the translation code uses it."""

    available = True
    outcome: object = "It rained"
    calls: list = []
    translation_model = "gpt-test"
    qual_check_model = "gpt-test"

    def is_available(self):
        return _FakeAI.available

    def translate_transcript(self, text, **kwargs):
        _FakeAI.calls.append((text, kwargs))
        outcome = _FakeAI.outcome
        record = kwargs.get("record")
        if record is not None:
            record(
                CallUsage(
                    model="gpt-test",
                    outcome=outcome.category if isinstance(outcome, AIError) else "ok",
                    input_tokens=40,
                    output_tokens=10,
                )
            )
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def _translating(test_db, survey, language="eng", **more):
    survey.config_data = {
        **survey.config_data,
        "audio_transcription": {
            **survey.config_data["audio_transcription"],
            "translate_to": language,
            **more,
        },
    }
    test_db.commit()


@pytest.fixture
def ai(test_db, survey, env, monkeypatch):
    """Translation into English on, with the operator's key and a fake AI."""
    monkeypatch.setenv("OPENAI_API_KEY", "sk-operator")
    monkeypatch.setattr(ai_service_module, "AIService", _FakeAI)
    monkeypatch.setattr(translation_runtime, "AIService", _FakeAI)
    monkeypatch.setattr(translation_runtime, "SessionLocal", sessionmaker(bind=test_db.get_bind()))
    _FakeAI.available = True
    _FakeAI.outcome = "It rained"
    _FakeAI.calls = []
    jobs = _Recorder()
    from services.translation_worker import translate_transcript_task

    monkeypatch.setattr(translate_transcript_task, "apply_async", jobs.apply_async)
    kobo_jobs = _Recorder()
    monkeypatch.setattr(
        kobo_sync_worker.send_translation_to_kobo_task, "apply_async", kobo_jobs.apply_async
    )
    _translating(test_db, survey)
    env["translation_tasks"] = jobs
    env["translation_kobo_tasks"] = kobo_jobs
    return env


def _transcript(test_db, survey, _id=1, text="Il a plu", language="fra", **fields):
    _submission(test_db, survey, _id=_id)
    row = AudioTranscript(
        survey_id=survey.survey_id,
        submission_id=_id,
        question_path="interview/story",
        status="success",
        text=text,
        language_code=language,
        requested_by_user_id=survey.user_id,
        **fields,
    )
    test_db.add(row)
    test_db.commit()
    return row


def _consider(test_db, survey, transcript, run_id=None, force=False):
    queuer = TranslationQueuer(test_db, survey, run_id=run_id, user_id=survey.user_id)
    row = queuer.consider(transcript, force=force)
    test_db.flush()
    if row is not None:
        queuer.queue([row])
    test_db.commit()
    queuer.dispatch()
    return queuer, row


def _translate(test_db, row, final_attempt=True):
    try:
        return translation_runtime.run_translation_job(
            {"translation_id": row.translation_id, "input_hash": row.input_hash},
            job_id="job-t",
            final_attempt=final_attempt,
        )
    finally:
        test_db.expire_all()


class TestSettings:
    def test_the_language_is_normalised(self):
        settings = transcription_settings(
            {"audio_transcription": {"enabled": True, "questions": ["q"], "translate_to": "en"}}
        )
        assert settings.translate_to == "eng" and settings.translating

    def test_only_while_transcription_is_on(self):
        settings = transcription_settings(
            {"audio_transcription": {"enabled": False, "questions": ["q"], "translate_to": "eng"}}
        )
        assert not settings.translating

    def test_a_new_text_or_language_is_a_new_input(self):
        assert translation_input_hash("a", "eng") == translation_input_hash(" a ", "eng")
        assert translation_input_hash("a", "eng") != translation_input_hash("b", "eng")
        assert translation_input_hash("a", "eng") != translation_input_hash("a", "fra")


class TestQueueing:
    def test_a_new_transcript_is_translated_in_its_run(self, test_db, survey, ai):
        run = Run(survey_id=survey.survey_id, kind="pull", status="background", stats={})
        test_db.add(run)
        test_db.commit()
        submission = _submission(test_db, survey)
        _, rows = _queue(test_db, survey, submission, run_id=run.run_id)
        _run(test_db, rows[0])
        translation = test_db.query(TranscriptTranslation).one()
        assert (translation.status, translation.language) == ("pending", "eng")
        assert translation.run_id == run.run_id
        assert len(ai["translation_tasks"].sent) == 1
        # The run waits for it.
        assert test_db.get(Run, run.run_id).status == "background"
        assert run_counts(test_db, test_db.get(Run, run.run_id))["translations"]["open"] == 1

    def test_nothing_when_off(self, test_db, survey, ai):
        _translating(test_db, survey, language=None)
        submission = _submission(test_db, survey)
        _, rows = _queue(test_db, survey, submission)
        _run(test_db, rows[0])
        assert test_db.query(TranscriptTranslation).count() == 0

    def test_an_answer_already_in_the_language_is_skipped(self, test_db, survey, ai):
        _, row = _consider(test_db, survey, _transcript(test_db, survey, language="eng"))
        assert (row.status, row.skip_reason) == ("skipped", "same_language")
        assert ai["translation_tasks"].sent == []

    def test_no_speech_is_skipped(self, test_db, survey, ai):
        _, row = _consider(test_db, survey, _transcript(test_db, survey, text=""))
        assert (row.status, row.skip_reason) == ("skipped", "no_speech")

    def test_translated_once_and_again_when_the_text_changes(self, test_db, survey, ai):
        transcript = _transcript(test_db, survey)
        _, row = _consider(test_db, survey, transcript)
        row.status = "success"
        test_db.commit()
        assert _consider(test_db, survey, transcript)[1] is None
        transcript.text = "Il a beaucoup plu"  # corrected in Kobo
        test_db.commit()
        _, again = _consider(test_db, survey, transcript)
        assert again.status == "pending" and again.translation_id == row.translation_id

    def test_another_language_translates_again_as_a_new_kobo_entry(self, test_db, survey, ai):
        transcript = _transcript(test_db, survey)
        _, row = _consider(test_db, survey, transcript)
        row.status, row.kobo_status, row.kobo_version_uuid = "success", "edited_in_kobo", "v-en"
        test_db.commit()
        _translating(test_db, survey, language="spa")
        _, again = _consider(test_db, survey, transcript)
        assert (again.language, again.kobo_status, again.kobo_version_uuid) == (
            "spa",
            "not_sent",
            None,
        )

    def test_a_retryable_failure_is_tried_again_a_refusal_is_not(self, test_db, survey, ai):
        transcript = _transcript(test_db, survey)
        _, row = _consider(test_db, survey, transcript)
        row.status, row.last_error = "failed", "bad_request: The AI declined"
        test_db.commit()
        assert _consider(test_db, survey, transcript)[1] is None
        row.last_error = "timeout: slow"
        test_db.commit()
        assert _consider(test_db, survey, transcript)[1].status == "pending"

    def test_only_the_questions_chosen_for_transcription(self, test_db, survey, ai):
        transcript = _transcript(test_db, survey)
        transcript.question_path = "interview/other"
        test_db.commit()
        assert _consider(test_db, survey, transcript)[1] is None

    def test_without_an_ai_provider(self, test_db, survey, ai):
        _FakeAI.available = False
        _, row = _consider(test_db, survey, _transcript(test_db, survey))
        assert row.status == "failed" and row.last_error.startswith("not_configured")

    def test_a_paused_provider_is_not_called(self, test_db, survey, ai, monkeypatch):
        monkeypatch.setattr(
            translation_queue, "paused_error", lambda db, s: "auth: The key was rejected."
        )
        _, row = _consider(test_db, survey, _transcript(test_db, survey))
        assert row.status == "failed" and row.last_error.startswith("auth")
        assert ai["translation_tasks"].sent == []


class TestAllowance:
    def test_held_back_when_the_included_reviews_are_used(self, test_db, survey, ai, monkeypatch):
        monkeypatch.setenv("AI_ALLOWANCE_CHECKS_PER_SURVEY_MONTH", "1")
        first = _transcript(test_db, survey, _id=1)
        second = _transcript(test_db, survey, _id=2)
        queuer = TranslationQueuer(test_db, survey, run_id=None, user_id=None)
        assert queuer.consider(first).status == "pending"
        held = queuer.consider(second)
        assert held.status == "not_run_allowance" and held.last_error.startswith("allowance")

    def test_a_submission_already_reviewed_is_free(self, test_db, survey, ai, monkeypatch):
        monkeypatch.setenv("AI_ALLOWANCE_CHECKS_PER_SURVEY_MONTH", "1")
        transcript = _transcript(test_db, survey)
        test_db.add(
            AIUsage(
                survey_id=survey.survey_id,
                feature="qualitative_check",
                submission_id=1,
                model="gpt-test",
                outcome="ok",
            )
        )
        test_db.commit()
        _, row = _consider(test_db, survey, transcript)
        assert row.status == "pending"

    def test_reviewed_and_translated_counts_once(self, test_db, survey, ai):
        for feature in ("qualitative_check", "translation", "translation"):
            test_db.add(
                AIUsage(
                    survey_id=survey.survey_id,
                    feature=feature,
                    submission_id=1,
                    model="gpt-test",
                    outcome="ok",
                )
            )
        test_db.commit()
        assert checks_used(test_db, survey.survey_id) == 1

    def test_the_owners_own_provider_has_no_limit(self, test_db, survey, ai, monkeypatch):
        monkeypatch.setenv("AI_ALLOWANCE_CHECKS_PER_SURVEY_MONTH", "0")
        monkeypatch.setattr(
            translation_queue,
            "survey_connection",
            lambda db, s: SimpleNamespace(check_model="own-model"),
        )
        _, row = _consider(test_db, survey, _transcript(test_db, survey))
        assert row.status == "pending" and row.model == "own-model"


class TestJob:
    def test_stores_the_translation_and_its_cost(self, test_db, survey, ai):
        _, row = _consider(test_db, survey, _transcript(test_db, survey))
        assert _translate(test_db, row)["status"] == "success"
        stored = test_db.query(TranscriptTranslation).one()
        assert (stored.status, stored.text, stored.model) == ("success", "It rained", "gpt-test")
        text, kwargs = _FakeAI.calls[0]
        assert text == "Il a plu"
        assert kwargs["target_language"] == "English"
        assert kwargs["source_language"] == "French"
        assert kwargs["question"] == "Story"
        usage = test_db.query(AIUsage).one()
        assert (usage.feature, usage.submission_id, usage.connection_id) == ("translation", 1, None)

    def test_a_temporary_failure_is_retried(self, test_db, survey, ai):
        _FakeAI.outcome = AIError("rate_limited", "slow down")
        _, row = _consider(test_db, survey, _transcript(test_db, survey))
        with pytest.raises(AIError):
            _translate(test_db, row, final_attempt=False)
        stored = test_db.query(TranscriptTranslation).one()
        assert stored.status == "pending" and "(retrying)" in stored.last_error

    def test_a_final_failure_is_stored(self, test_db, survey, ai):
        _FakeAI.outcome = AIError("provider_quota", "no credit")
        _, row = _consider(test_db, survey, _transcript(test_db, survey))
        assert _translate(test_db, row)["status"] == "failed"
        assert test_db.query(TranscriptTranslation).one().last_error.startswith("provider_quota")

    def test_a_transcript_changed_meanwhile_is_not_translated(self, test_db, survey, ai):
        transcript = _transcript(test_db, survey)
        _, row = _consider(test_db, survey, transcript)
        transcript.text = "Il a beaucoup plu"
        test_db.commit()
        assert _translate(test_db, row)["status"] == "cancelled"
        assert _FakeAI.calls == []

    def test_turned_off_meanwhile_is_cancelled(self, test_db, survey, ai):
        _, row = _consider(test_db, survey, _transcript(test_db, survey))
        _translating(test_db, survey, language=None)
        assert _translate(test_db, row)["status"] == "cancelled"

    def test_a_stale_job_does_nothing(self, test_db, survey, ai):
        _, row = _consider(test_db, survey, _transcript(test_db, survey))
        result = translation_runtime.run_translation_job(
            {"translation_id": row.translation_id, "input_hash": "old"}, job_id="j"
        )
        assert result["status"] == "stale" and _FakeAI.calls == []


class TestPrompt:
    @pytest.fixture(autouse=True)
    def _operator_key(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-operator")

    def _service(self, reply):
        service = AIService.__new__(AIService)
        service.api_key = "sk"
        service.translation_model = "gpt-test"
        service.translation_reasoning_effort = "low"
        sent = {}

        class _Client:
            def complete_json(self, provider, **kwargs):
                sent.update(kwargs)
                return reply

        service.ai = _Client()
        return service, sent

    def test_the_transcript_is_data_and_the_reply_is_the_translation(self):
        service, sent = self._service({"translation": " It rained. "})
        result = service.translate_transcript(
            "Il a plu.", target_language="English", source_language="French", question="Story"
        )
        assert result == "It rained."
        assert "into English" in sent["system"] and "never instructions" in sent["system"]
        assert sent["user"].endswith("Transcript:\nIl a plu.")
        assert "Survey question: Story" in sent["user"]
        assert sent["reasoning_effort"] == "low"

    def test_an_empty_translation_is_an_error(self):
        service, _ = self._service({"translation": "  "})
        with pytest.raises(AIError) as raised:
            service.translate_transcript("Il a plu.", target_language="English")
        assert raised.value.category == "bad_response"


def _translated(test_db, survey, transcript_kobo="sent", **fields):
    transcript = _transcript(
        test_db, survey, kobo_status=transcript_kobo, kobo_version_uuid="v-ours"
    )
    row = TranscriptTranslation(
        transcript_id=transcript.transcript_id,
        survey_id=survey.survey_id,
        submission_id=1,
        question_path="interview/story",
        language="eng",
        input_hash=translation_input_hash("Il a plu", "eng"),
        status="success",
        text="It rained",
        kobo_status=fields.pop("kobo_status", "pending"),
        requested_by_user_id=survey.user_id,
        **fields,
    )
    test_db.add(row)
    test_db.commit()
    return transcript, row


def _send(test_db, row, final_attempt=True):
    try:
        return kobo_sync_worker.run_translation_kobo_send_job(
            {"translation_id": row.translation_id}, final_attempt=final_attempt
        )
    finally:
        test_db.expire_all()


def _translation_reply(language="en", uuid="t-ours"):
    return _kobo_response(
        200,
        {
            "interview/story": {
                "manual_translation": {
                    language: {
                        "_versions": [
                            {
                                "_uuid": uuid,
                                "_dateCreated": "2026-10-05T10:00:00Z",
                                "_data": {"language": language, "value": "It rained"},
                                "_dependency": {
                                    "_actionId": "manual_transcription",
                                    "_uuid": "v-ours",
                                },
                            }
                        ]
                    }
                }
            }
        },
    )


class TestSendToKobo:
    def test_enables_translations_then_sends(self, test_db, survey, ai, kobo):
        _translating(test_db, survey)
        kobo.replies[("PATCH", "/supplement/")] = _translation_reply()
        _, row = _translated(test_db, survey)
        assert _send(test_db, row)["status"] == "sent"
        methods = [(m, e.split("/")[-2]) for m, e, _ in kobo.calls]
        assert methods == [
            ("GET", "supplement"),
            ("GET", "advanced-features"),
            ("POST", "advanced-features"),
            ("PATCH", "supplement"),
        ]
        assert kobo.calls[2][2] == {
            "question_xpath": "interview/story",
            "action": "manual_translation",
            "params": [{"language": "en"}],
        }
        assert kobo.calls[3][2] == {
            "_version": "20250820",
            "interview/story": {"manual_translation": {"language": "en", "value": "It rained"}},
        }
        stored = test_db.query(TranscriptTranslation).one()
        assert (stored.kobo_version_uuid, stored.kobo_language) == ("t-ours", "en")

    def test_waits_for_the_transcript_to_be_in_kobo(self, test_db, survey, ai, kobo):
        _translating(test_db, survey)
        transcript, row = _translated(test_db, survey, transcript_kobo="pending")
        row.kobo_status = "not_sent"
        test_db.commit()
        assert send_translation_when_ready(test_db, transcript, None) is False
        assert _send(test_db, row)["status"] == "stale"  # nothing queued it
        row.kobo_status = "pending"
        test_db.commit()
        assert _send(test_db, row)["status"] == "not_sent"
        assert kobo.calls == []

    def test_follows_the_transcript_once_it_is_sent(self, test_db, survey, ai, kobo):
        _translating(test_db, survey)
        transcript, row = _translated(
            test_db, survey, transcript_kobo="pending", kobo_status="not_sent"
        )
        transcript.kobo_version_uuid = None
        test_db.commit()
        result = kobo_sync_worker.run_kobo_send_job({"transcript_id": transcript.transcript_id})
        test_db.expire_all()
        assert result["status"] == "sent"
        assert test_db.query(TranscriptTranslation).one().kobo_status == "pending"
        assert len(ai["translation_kobo_tasks"].sent) == 1

    def test_a_translation_corrected_in_kobo_is_never_overwritten(self, test_db, survey, ai, kobo):
        _translating(test_db, survey)
        theirs = {
            "_uuid": "t-theirs",
            "_dateCreated": "2026-10-05T12:00:00Z",
            "_data": {"language": "en", "value": "It poured"},
        }
        ours = {"_uuid": "t-ours", "_dateCreated": "2026-10-05T10:00:00Z"}
        kobo.replies[("GET", "/supplement/")] = _kobo_response(
            200, {"interview/story": {"manual_translation": {"en": {"_versions": [theirs, ours]}}}}
        )
        _, row = _translated(test_db, survey, kobo_version_uuid="t-ours")
        assert _send(test_db, row)["status"] == "edited_in_kobo"
        assert not any(m == "PATCH" for m, _, _ in kobo.calls)

    def test_kobos_own_translation_stands(self, test_db, survey, ai, kobo):
        _translating(test_db, survey)
        googles = {
            "_uuid": "t-google",
            "_dateCreated": "2026-10-05T09:00:00Z",
            "_dateAccepted": "2026-10-05T09:01:00Z",
            "_data": {"language": "en", "value": "It rained a lot"},
        }
        kobo.replies[("GET", "/supplement/")] = _kobo_response(
            200,
            {"interview/story": {"automatic_google_translation": {"en": {"_versions": [googles]}}}},
        )
        _, row = _translated(test_db, survey)
        assert _send(test_db, row)["status"] == "edited_in_kobo"
        assert not any(m in ("POST", "PATCH") for m, _, _ in kobo.calls)

    def test_not_sent_when_sending_is_off(self, test_db, survey, ai, kobo):
        _translating(test_db, survey, send_to_kobo=False)
        _, row = _translated(test_db, survey)
        assert _send(test_db, row)["status"] == "not_sent" and kobo.calls == []

    def test_a_successful_translation_goes_to_kobo(self, test_db, survey, ai, kobo):
        _translating(test_db, survey)
        transcript = _transcript(test_db, survey, kobo_status="sent")
        _, row = _consider(test_db, survey, transcript)
        _translate(test_db, row)
        assert test_db.query(TranscriptTranslation).one().kobo_status == "pending"
        assert len(ai["translation_kobo_tasks"].sent) == 1


class TestRuns:
    def test_stopping_a_run_cancels_queued_translations(self, test_db, survey, ai, owner):
        run = Run(survey_id=survey.survey_id, kind="pull", status="background", stats={})
        test_db.add(run)
        test_db.commit()
        _, row = _consider(test_db, survey, _transcript(test_db, survey), run_id=run.run_id)
        assert has_open_items(test_db, run.run_id)
        stop_run(test_db, run, owner)
        test_db.expire_all()
        assert test_db.query(TranscriptTranslation).one().status == "cancelled"
        assert not has_open_items(test_db, run.run_id)

    def test_finished_translations_are_counted(self, test_db, survey, ai):
        run = Run(survey_id=survey.survey_id, kind="translation_rerun", status="background")
        run.stats = {"translations_queued": 1}
        run.started_at = datetime.utcnow()
        test_db.add(run)
        test_db.commit()
        _, row = _consider(test_db, survey, _transcript(test_db, survey), run_id=run.run_id)
        _translate(test_db, row)
        stored = test_db.get(Run, run.run_id)
        assert stored.status == "finished"
        assert run_counts(test_db, stored)["translations"]["done"] == 1


def test_stalled_translations_are_swept(test_db, survey, ai):
    _, row = _consider(test_db, survey, _transcript(test_db, survey))
    row.queued_at = datetime(2020, 1, 1)
    test_db.commit()
    assert translation_runtime.sweep_stalled_translations(test_db) == 1
    assert test_db.query(TranscriptTranslation).one().last_error.startswith("timeout")


def test_removing_a_transcript_removes_its_translation(test_db, survey, ai):
    transcript = _transcript(test_db, survey)
    _consider(test_db, survey, transcript)
    test_db.delete(transcript)
    test_db.commit()
    assert test_db.query(TranscriptTranslation).count() == 0


def test_a_pull_translates_the_transcript_kobo_has(test_db, survey, ai, owner, monkeypatch):
    """Kobo's own transcript is never transcribed here, but it is translated."""
    import etl.pipeline as pipeline_module
    from etl.pipeline import ETLPipeline

    monkeypatch.setattr(pipeline_module, "run_qualitative_check_task", _Recorder())
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
        "_supplementalDetails": {
            "interview/story": {"transcript": {"value": "Il a plu fort", "languageCode": "fr"}}
        },
    }
    stats = ETLPipeline(
        test_db, kobo_fetcher=_FakeFetcher([kobo_sub]), run=run, started_by_user_id=owner.user_id
    ).run_pipeline(str(survey.survey_id))

    assert stats["transcripts_from_kobo"] == 1 and stats["translations_queued"] == 1
    translation = test_db.query(TranscriptTranslation).one()
    assert (translation.status, translation.run_id) == ("pending", run.run_id)
    assert translation.requested_by_user_id == owner.user_id
    assert len(ai["translation_tasks"].sent) == 1
