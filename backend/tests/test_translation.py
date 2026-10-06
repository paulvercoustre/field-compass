"""
Translating answers -- typed ones and transcripts -- with the survey's AI key
for translation, reading Kobo's own translations on pull, and sending ours to
Kobo, end to end against the test database with the AI and Kobo replaced by
fakes. See docs/specs/translation.md.
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
from database.models import AIUsage, AnswerTranslation, AudioTranscript, Run, SubmissionCurrent
from etl.translation import (
    kobo_translation,
    translatable_questions,
    translation_input_hash,
    translation_settings,
)
from services.ai_allowance import Account, checks_used, translations_used
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

    def translate_answer(self, text, **kwargs):
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


def _translating(test_db, survey, language="eng", questions=("village", "interview/story"), **more):
    survey.config_data = {
        **survey.config_data,
        "translation": {
            "enabled": language is not None,
            "language": language,
            "questions": list(questions),
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
    tasks = _Recorder()
    from services.translation_worker import translate_answer_task

    monkeypatch.setattr(translate_answer_task, "apply_async", tasks.apply_async)
    kobo_tasks = _Recorder()
    monkeypatch.setattr(
        kobo_sync_worker.send_translation_to_kobo_task, "apply_async", kobo_tasks.apply_async
    )
    _translating(test_db, survey)
    env["translation_tasks"] = tasks
    env["translation_kobo_tasks"] = kobo_tasks
    return env


def _answered(test_db, survey, _id=1, village="Kabul", **extra):
    submission = _submission(test_db, survey, _id=_id)
    submission.submission_data = {**submission.submission_data, "village": village, **extra}
    test_db.commit()
    return submission


def _transcript(test_db, survey, _id=1, text="Il a plu", language="fra", **fields):
    submission = _answered(test_db, survey, _id=_id, village="1")
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
    return submission, row


def _consider(test_db, survey, submission, run_id=None, force=False):
    queuer = TranslationQueuer(test_db, survey, run_id=run_id, user_id=survey.user_id)
    rows = queuer.consider_submission(submission, force=force)
    test_db.flush()
    queuer.queue(rows)
    test_db.commit()
    queuer.dispatch()
    return queuer, rows


def _row(test_db, path="interview/story"):
    return test_db.query(AnswerTranslation).filter_by(question_path=path).one()


def _translate(test_db, row, final_attempt=True):
    try:
        return translation_runtime.run_translation_job(
            {"translation_id": row.translation_id, "input_hash": row.input_hash},
            job_id="job-t",
            final_attempt=final_attempt,
        )
    finally:
        test_db.expire_all()


def _in_kobo(test_db, submission, translation=None, transcript="Il a plu", language="en"):
    """What Kobo's data API sends for the story: its transcript, and translations by language."""
    entry = {"transcript": {"value": transcript, "languageCode": "fr"}}
    if translation is not None:
        entry["translation"] = {language: translation}
    submission.submission_data = {
        **submission.submission_data,
        "_supplementalDetails": {"interview/story": entry},
    }
    test_db.commit()


class TestSettings:
    def test_the_language_is_normalised(self):
        settings = translation_settings(
            {"translation": {"enabled": True, "language": "en", "questions": ["q"]}}
        )
        assert settings.language == "eng" and settings.active

    def test_off_without_a_language_or_questions(self):
        assert not translation_settings(
            {"translation": {"enabled": True, "questions": ["q"]}}
        ).active
        assert not translation_settings({"translation": {"enabled": True, "language": "en"}}).active

    def test_text_and_audio_questions_of_the_form(self):
        questions = translatable_questions({"kobo_tool": jobs.KOBO_TOOL})
        assert [(q.path, q.kind) for q in questions] == [
            ("village", "text"),
            ("interview/story", "audio"),
        ]

    def test_a_new_text_or_language_is_a_new_input(self):
        assert translation_input_hash("a", "eng") == translation_input_hash(" a ", "eng")
        assert translation_input_hash("a", "eng") != translation_input_hash("b", "eng")
        assert translation_input_hash("a", "eng") != translation_input_hash("a", "fra")


class TestKobosTranslations:
    def _data(self, translations):
        return {"_supplementalDetails": {"interview/story": {"translation": translations}}}

    def test_the_one_in_the_language(self):
        data = self._data({"en": {"languageCode": "en", "value": "It rained"}})
        found = kobo_translation(data, "interview/story", "story", "eng")
        assert (found.text, found.language_code) == ("It rained", "en")

    def test_another_language_is_not_ours(self):
        data = self._data({"es": {"languageCode": "es", "value": "Llovió"}})
        assert kobo_translation(data, "interview/story", "story", "eng") is None

    def test_one_waiting_for_review_is_none(self):
        data = self._data({"en": {"languageCode": "en", "value": "", "pendingReview": True}})
        assert kobo_translation(data, "interview/story", "story", "eng") is None


class TestTextAnswers:
    def test_a_typed_answer_is_translated(self, test_db, survey, ai):
        _consider(test_db, survey, _answered(test_db, survey))
        row = _row(test_db, "village")
        assert (row.source, row.status, row.language) == ("text", "pending", "eng")
        assert len(ai["translation_tasks"].sent) == 1
        assert _translate(test_db, row)["status"] == "success"
        assert _row(test_db, "village").text == "It rained"
        text, kwargs = _FakeAI.calls[0]
        assert text == "Kabul" and kwargs["transcript"] is False
        assert kwargs["question"] == "Village"

    def test_an_answer_without_words_is_skipped(self, test_db, survey, ai):
        _consider(test_db, survey, _answered(test_db, survey, village="-99"))
        row = _row(test_db, "village")
        assert (row.status, row.skip_reason) == ("skipped", "no_text")
        assert ai["translation_tasks"].sent == []

    def test_once_and_again_when_edited(self, test_db, survey, ai):
        submission = _answered(test_db, survey)
        _consider(test_db, survey, submission)
        _row(test_db, "village").status = "success"
        test_db.commit()
        assert _consider(test_db, survey, submission)[1] == []
        submission.submission_data = {**submission.submission_data, "village": "Herat"}
        test_db.commit()
        assert [r.status for r in _consider(test_db, survey, submission)[1]] == ["pending"]

    def test_a_removed_answer_loses_its_translation(self, test_db, survey, ai):
        submission = _answered(test_db, survey)
        _consider(test_db, survey, submission)
        _row(test_db, "village").status = "success"
        data = dict(submission.submission_data)
        data.pop("village")
        submission.submission_data = data
        test_db.commit()
        _consider(test_db, survey, submission)
        assert test_db.query(AnswerTranslation).count() == 0

    def test_only_the_chosen_questions(self, test_db, survey, ai):
        _translating(test_db, survey, questions=("interview/story",))
        _consider(test_db, survey, _answered(test_db, survey))
        assert test_db.query(AnswerTranslation).count() == 0

    def test_already_in_the_language(self, test_db, survey, ai):
        _FakeAI.outcome = None
        _consider(test_db, survey, _answered(test_db, survey))
        assert _translate(test_db, _row(test_db, "village"))["status"] == "skipped"
        row = _row(test_db, "village")
        assert (row.skip_reason, row.text) == ("same_language", None)


class TestTranscripts:
    def test_a_new_transcript_is_translated_in_its_run(self, test_db, survey, ai):
        run = Run(survey_id=survey.survey_id, kind="pull", status="background", stats={})
        test_db.add(run)
        test_db.commit()
        submission = _submission(test_db, survey)
        _, rows = _queue(test_db, survey, submission, run_id=run.run_id)
        _run(test_db, rows[0])
        row = _row(test_db)
        assert (row.source, row.status, row.run_id) == ("transcript", "pending", run.run_id)
        assert test_db.get(Run, run.run_id).status == "background"  # waits for it
        assert run_counts(test_db, test_db.get(Run, run.run_id))["translations"]["open"] == 1

    def test_an_answer_already_in_the_language_is_skipped(self, test_db, survey, ai):
        submission, _ = _transcript(test_db, survey, language="eng")
        _consider(test_db, survey, submission)
        assert (_row(test_db).status, _row(test_db).skip_reason) == ("skipped", "same_language")

    def test_a_corrected_transcript_is_translated_again(self, test_db, survey, ai):
        submission, transcript = _transcript(test_db, survey)
        _consider(test_db, survey, submission)
        _row(test_db).status = "success"
        test_db.commit()
        transcript.text = "Il a beaucoup plu"
        test_db.commit()
        assert [r.status for r in _consider(test_db, survey, submission)[1]] == ["pending"]

    def test_the_job_reads_the_transcript(self, test_db, survey, ai):
        submission, _ = _transcript(test_db, survey)
        _consider(test_db, survey, submission)
        assert _translate(test_db, _row(test_db))["status"] == "success"
        text, kwargs = _FakeAI.calls[0]
        assert text == "Il a plu" and kwargs["transcript"] is True
        assert (kwargs["target_language"], kwargs["source_language"]) == ("English", "French")


class TestTranslationsFromKobo:
    def test_kobos_translation_is_kept_and_nothing_is_sent_to_the_ai(self, test_db, survey, ai):
        submission, _ = _transcript(test_db, survey)
        _in_kobo(test_db, submission, {"languageCode": "en", "value": "It rained hard"})
        queuer, rows = _consider(test_db, survey, submission)
        assert queuer.stats["translations_from_kobo"] == 1
        row = _row(test_db)
        assert (row.origin, row.status, row.text) == ("kobo", "success", "It rained hard")
        assert (row.kobo_status, row.kobo_language) == ("sent", "en")
        assert [r.question_path for r in rows] == ["village"] or rows == []
        assert all(r.question_path != "interview/story" for r in rows)
        # The next pull changes nothing.
        assert _consider(test_db, survey, submission)[0].stats["translations_from_kobo"] == 0

    def test_ours_sent_to_kobo_stays_ours(self, test_db, survey, ai):
        submission, _ = _transcript(test_db, survey)
        _consider(test_db, survey, submission)
        row = _row(test_db)
        row.status, row.text, row.kobo_status, row.kobo_version_uuid = (
            "success",
            "It rained",
            "sent",
            "t-ours",
        )
        test_db.commit()
        _in_kobo(test_db, submission, {"languageCode": "en", "value": "It rained"})
        _consider(test_db, survey, submission)
        assert (_row(test_db).origin, _row(test_db).kobo_status) == ("ai", "sent")

    def test_ours_corrected_in_kobo_shows_the_correction(self, test_db, survey, ai):
        submission, _ = _transcript(test_db, survey)
        _consider(test_db, survey, submission)
        row = _row(test_db)
        row.status, row.text, row.kobo_status, row.kobo_version_uuid = (
            "success",
            "It rained",
            "sent",
            "t-ours",
        )
        test_db.commit()
        _in_kobo(test_db, submission, {"languageCode": "en", "value": "It poured"})
        _consider(test_db, survey, submission)
        row = _row(test_db)
        assert (row.origin, row.text, row.kobo_status) == ("kobo", "It poured", "edited_in_kobo")

    def test_kobos_in_a_newly_chosen_language_is_simply_kobos(self, test_db, survey, ai):
        submission, _ = _transcript(test_db, survey)
        _consider(test_db, survey, submission)
        row = _row(test_db)
        row.status, row.text, row.kobo_status, row.kobo_version_uuid = (
            "success",
            "It rained",
            "sent",
            "t-ours",
        )
        test_db.commit()
        _translating(test_db, survey, language="spa")
        _in_kobo(test_db, submission, {"languageCode": "es", "value": "Llovió"}, language="es")
        _consider(test_db, survey, submission)
        row = _row(test_db)
        assert (row.origin, row.language, row.kobo_status) == ("kobo", "spa", "sent")

    def test_removed_in_kobo_is_translated_here_again(self, test_db, survey, ai):
        submission, _ = _transcript(test_db, survey)
        _in_kobo(test_db, submission, {"languageCode": "en", "value": "It rained hard"})
        _consider(test_db, survey, submission)
        _in_kobo(test_db, submission)
        _consider(test_db, survey, submission)
        row = _row(test_db)
        assert (row.origin, row.status) == ("ai", "pending")

    def test_one_in_another_language_does_not_count(self, test_db, survey, ai):
        submission, _ = _transcript(test_db, survey)
        _in_kobo(test_db, submission, {"languageCode": "es", "value": "Llovió"}, language="es")
        _consider(test_db, survey, submission)
        assert (_row(test_db).origin, _row(test_db).status) == ("ai", "pending")

    def test_translate_all_again_leaves_kobos_alone(self, test_db, survey, ai):
        submission, _ = _transcript(test_db, survey)
        _in_kobo(test_db, submission, {"languageCode": "en", "value": "It rained hard"})
        _consider(test_db, survey, submission)
        _consider(test_db, survey, submission, force=True)
        assert _row(test_db).origin == "kobo" and _FakeAI.calls == []

    def test_a_pull_takes_kobos_transcript_and_translation(
        self, test_db, survey, ai, owner, monkeypatch
    ):
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
            "village": "Kabul",
            "interview/story": "s.m4a",
            "_attachments": [_attachment()],
            "_supplementalDetails": {
                "interview/story": {
                    "transcript": {"value": "Il a plu fort", "languageCode": "fr"},
                    "translation": {"en": {"languageCode": "en", "value": "It rained hard"}},
                }
            },
        }
        stats = ETLPipeline(
            test_db,
            kobo_fetcher=_FakeFetcher([kobo_sub]),
            run=run,
            started_by_user_id=owner.user_id,
        ).run_pipeline(str(survey.survey_id))

        assert stats["transcripts_from_kobo"] == 1 and stats["translations_from_kobo"] == 1
        assert stats["translations_queued"] == 1  # the typed answer only
        assert _row(test_db).origin == "kobo"
        typed = _row(test_db, "village")
        assert (typed.status, typed.run_id, typed.requested_by_user_id) == (
            "pending",
            run.run_id,
            owner.user_id,
        )


class TestAllowance:
    def test_held_back_when_the_included_translations_are_used(
        self, test_db, survey, ai, monkeypatch
    ):
        monkeypatch.setenv("AI_ALLOWANCE_TRANSLATIONS_PER_USER_MONTH", "1")
        _consider(test_db, survey, _answered(test_db, survey, _id=1))
        _consider(test_db, survey, _answered(test_db, survey, _id=2))
        statuses = sorted(r.status for r in test_db.query(AnswerTranslation))
        assert statuses == ["not_run_allowance", "pending"]
        held = test_db.query(AnswerTranslation).filter_by(status="not_run_allowance").one()
        assert "included translations" in held.last_error

    def test_apart_from_ai_review(self, test_db, survey, ai, monkeypatch):
        monkeypatch.setenv("AI_ALLOWANCE_CHECKS_PER_USER_MONTH", "0")
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
        assert checks_used(test_db, Account.of(survey)) == 1
        assert translations_used(test_db, Account.of(survey)) == 2
        # Reviews used up: translation goes on.
        _consider(test_db, survey, _answered(test_db, survey, _id=2))
        assert _row(test_db, "village").status == "pending"

    def test_the_owners_key_for_translation_has_no_limit(self, test_db, survey, ai, monkeypatch):
        monkeypatch.setenv("AI_ALLOWANCE_TRANSLATIONS_PER_USER_MONTH", "0")
        monkeypatch.setattr(
            translation_queue,
            "translation_connection",
            lambda db, s: SimpleNamespace(check_model="own-model"),
        )
        _consider(test_db, survey, _answered(test_db, survey))
        row = _row(test_db, "village")
        assert (row.status, row.model) == ("pending", "own-model")

    def test_a_paused_key_is_not_called(self, test_db, survey, ai, monkeypatch):
        monkeypatch.setattr(
            translation_queue,
            "translation_paused_error",
            lambda db, s: "auth: The key was rejected. Translation is paused until it is fixed.",
        )
        _consider(test_db, survey, _answered(test_db, survey))
        assert _row(test_db, "village").last_error.startswith("auth")
        assert ai["translation_tasks"].sent == []

    def test_without_any_ai(self, test_db, survey, ai):
        _FakeAI.available = False
        _consider(test_db, survey, _answered(test_db, survey))
        assert _row(test_db, "village").last_error.startswith("not_configured")


class TestJob:
    def test_records_its_cost_as_a_translation(self, test_db, survey, ai):
        _consider(test_db, survey, _answered(test_db, survey))
        _translate(test_db, _row(test_db, "village"))
        usage = test_db.query(AIUsage).one()
        assert (usage.feature, usage.submission_id, usage.connection_id) == ("translation", 1, None)

    def test_a_temporary_failure_is_retried(self, test_db, survey, ai):
        _FakeAI.outcome = AIError("rate_limited", "slow down")
        _consider(test_db, survey, _answered(test_db, survey))
        with pytest.raises(AIError):
            _translate(test_db, _row(test_db, "village"), final_attempt=False)
        row = _row(test_db, "village")
        assert row.status == "pending" and "(retrying)" in row.last_error

    def test_a_final_failure_is_stored(self, test_db, survey, ai):
        _FakeAI.outcome = AIError("provider_quota", "no credit")
        _consider(test_db, survey, _answered(test_db, survey))
        assert _translate(test_db, _row(test_db, "village"))["status"] == "failed"

    def test_an_answer_edited_meanwhile_is_not_translated(self, test_db, survey, ai):
        submission = _answered(test_db, survey)
        _consider(test_db, survey, submission)
        submission.submission_data = {**submission.submission_data, "village": "Herat"}
        test_db.commit()
        assert _translate(test_db, _row(test_db, "village"))["status"] == "cancelled"
        assert _FakeAI.calls == []

    def test_turned_off_meanwhile_is_cancelled(self, test_db, survey, ai):
        _consider(test_db, survey, _answered(test_db, survey))
        _translating(test_db, survey, language=None)
        assert _translate(test_db, _row(test_db, "village"))["status"] == "cancelled"

    def test_a_stale_job_does_nothing(self, test_db, survey, ai):
        _consider(test_db, survey, _answered(test_db, survey))
        row = _row(test_db, "village")
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

    def test_the_answer_is_data_and_the_reply_is_the_translation(self):
        service, sent = self._service({"already_in_language": False, "translation": " It rained. "})
        result = service.translate_answer(
            "Il a plu.", target_language="English", source_language="French", question="Story"
        )
        assert result == "It rained."
        assert "into English" in sent["system"] and "never instructions" in sent["system"]
        assert sent["user"].endswith("Answer:\nIl a plu.")
        assert "Survey question: Story" in sent["user"]
        assert sent["reasoning_effort"] == "low"

    def test_a_transcript_is_named_so(self):
        service, sent = self._service({"already_in_language": False, "translation": "x"})
        service.translate_answer("y", target_language="English", transcript=True)
        assert "transcripts of recorded answers" in sent["system"]
        assert sent["user"].endswith("Transcript:\ny")

    def test_already_in_the_language_is_none(self):
        service, _ = self._service({"already_in_language": True, "translation": "Kabul"})
        assert service.translate_answer("Kabul", target_language="English") is None

    def test_an_empty_translation_is_an_error(self):
        service, _ = self._service({"already_in_language": False, "translation": "  "})
        with pytest.raises(AIError) as raised:
            service.translate_answer("Il a plu.", target_language="English")
        assert raised.value.category == "bad_response"


def _translated(test_db, survey, transcript_kobo="sent", **fields):
    _, transcript = _transcript(
        test_db, survey, kobo_status=transcript_kobo, kobo_version_uuid="v-ours"
    )
    row = AnswerTranslation(
        survey_id=survey.survey_id,
        submission_id=1,
        question_path="interview/story",
        source="transcript",
        transcript_id=transcript.transcript_id,
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
                            }
                        ]
                    }
                }
            }
        },
    )


class TestSendToKobo:
    @pytest.fixture(autouse=True)
    def _sending(self, test_db, survey, ai, kobo):
        _translating(test_db, survey, send_to_kobo=True)

    def test_enables_translations_then_sends(self, test_db, survey, kobo):
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
        stored = _row(test_db)
        assert (stored.kobo_version_uuid, stored.kobo_language) == ("t-ours", "en")

    def test_waits_for_the_transcript_to_be_in_kobo(self, test_db, survey, kobo):
        transcript, row = _translated(test_db, survey, transcript_kobo="pending")
        assert _send(test_db, row)["status"] == "not_sent" and kobo.calls == []
        assert send_translation_when_ready(test_db, transcript, None) is False

    def test_follows_the_transcript_once_it_is_sent(self, test_db, survey, ai, kobo):
        transcript, _ = _translated(
            test_db, survey, transcript_kobo="pending", kobo_status="not_sent"
        )
        transcript.kobo_version_uuid = None
        test_db.commit()
        result = kobo_sync_worker.run_kobo_send_job({"transcript_id": transcript.transcript_id})
        test_db.expire_all()
        assert result["status"] == "sent"
        assert _row(test_db).kobo_status == "pending"
        assert len(ai["translation_kobo_tasks"].sent) == 1

    def test_a_translation_corrected_in_kobo_is_never_overwritten(self, test_db, survey, kobo):
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

    def test_kobos_own_translation_stands(self, test_db, survey, kobo):
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

    def test_not_sent_when_sending_is_off(self, test_db, survey, kobo):
        _translating(test_db, survey, send_to_kobo=False)
        _, row = _translated(test_db, survey)
        assert _send(test_db, row)["status"] == "not_sent" and kobo.calls == []

    def test_typed_answers_never_go_to_kobo(self, test_db, survey, ai, kobo):
        _consider(test_db, survey, _answered(test_db, survey))
        _translate(test_db, _row(test_db, "village"))
        assert _row(test_db, "village").kobo_status == "not_sent"
        assert ai["translation_kobo_tasks"].sent == []

    def test_a_translated_transcript_goes_to_kobo(self, test_db, survey, ai, kobo):
        submission, _ = _transcript(test_db, survey, kobo_status="sent")
        _translating(test_db, survey, questions=("interview/story",), send_to_kobo=True)
        _consider(test_db, survey, submission)
        _translate(test_db, _row(test_db))
        assert _row(test_db).kobo_status == "pending"
        assert len(ai["translation_kobo_tasks"].sent) == 1


class TestRuns:
    def test_stopping_a_run_cancels_queued_translations(self, test_db, survey, ai, owner):
        run = Run(survey_id=survey.survey_id, kind="pull", status="background", stats={})
        test_db.add(run)
        test_db.commit()
        _consider(test_db, survey, _answered(test_db, survey), run_id=run.run_id)
        assert has_open_items(test_db, run.run_id)
        stop_run(test_db, run, owner)
        test_db.expire_all()
        assert _row(test_db, "village").status == "cancelled"
        assert not has_open_items(test_db, run.run_id)

    def test_finished_translations_are_counted(self, test_db, survey, ai):
        run = Run(survey_id=survey.survey_id, kind="translation_rerun", status="background")
        run.stats = {"translations_queued": 1}
        run.started_at = datetime.utcnow()
        test_db.add(run)
        test_db.commit()
        _consider(test_db, survey, _answered(test_db, survey), run_id=run.run_id)
        _translate(test_db, _row(test_db, "village"))
        stored = test_db.get(Run, run.run_id)
        assert stored.status == "finished"
        assert run_counts(test_db, stored)["translations"]["done"] == 1


def test_stalled_translations_are_swept(test_db, survey, ai):
    _consider(test_db, survey, _answered(test_db, survey))
    row = _row(test_db, "village")
    row.queued_at = datetime(2020, 1, 1)
    test_db.commit()
    assert translation_runtime.sweep_stalled_translations(test_db) == 1
    assert _row(test_db, "village").last_error.startswith("timeout")


def test_removing_a_transcript_removes_its_translation(test_db, survey, ai):
    submission, transcript = _transcript(test_db, survey)
    _translating(test_db, survey, questions=("interview/story",))
    _consider(test_db, survey, submission)
    test_db.delete(transcript)
    test_db.commit()
    assert test_db.query(AnswerTranslation).count() == 0
    assert test_db.query(SubmissionCurrent).count() == 1
