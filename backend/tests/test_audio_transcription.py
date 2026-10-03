"""
Audio transcription, the pure parts: finding audio questions and their
recordings, languages, the ElevenLabs client's request and error handling,
and the built-in checks on transcripts. See docs/specs/audio-transcription.md.
"""

import json

import pytest
import requests

from etl.audio import (
    TranscriptView,
    ai_audio_fields,
    answer_filename,
    audio_questions,
    find_attachment,
    review_data,
    root_uuid,
    selected_questions,
    transcript_input_hash,
    transcript_issues,
    transcription_settings,
)
from services.ai_errors import AUTH, BAD_REQUEST, PROVIDER_QUOTA, RATE_LIMITED, UNAVAILABLE, AIError
from services.audio_files import AudioFile, prepare_for_upload
from services.transcription_client import (
    TranscriptionClient,
    classify_response,
    parse_result,
    read_timeout,
)
from services.transcription_languages import (
    form_languages,
    kobo_language_code,
    language_name,
    match_form_language,
    normalize_language,
    scribe_languages,
)

# The stored form as Field Compass keeps it after reading a Kobo project:
# sheet rows, no group rows, each question carrying its group path.
KOBO_TOOL = {
    "survey": [
        {"type": "start", "name": "start"},
        {"type": "text", "name": "village", "label::English (en)": "Village"},
        {
            "type": "audio",
            "name": "story",
            "label::English (en)": "Tell us what happened",
            "label::Français (fr)": "Racontez",
            "group_path": "interview",
        },
        {"type": "audio", "name": "feedback", "label::English (en)": "Any feedback?"},
        {
            "type": "audio",
            "name": "member_voice",
            "label::English (en)": "Member's voice",
            "roster_name": "members",
            "group_path": "members",
        },
        {"type": "background-audio", "name": "ambient"},
    ],
    "choices": [],
    "label_column_survey": "label::English (en)",
}
CONFIG = {
    "kobo_tool": KOBO_TOOL,
    "audio_transcription": {
        "enabled": True,
        "questions": ["interview/story", "members/member_voice"],
        "language": "fr",
    },
}

SUBMISSION = {
    "_uuid": "abc",
    "meta/rootUuid": "uuid:root-1",
    "interview/story": "story-12_3.m4a",
    "feedback": "fb.amr",
    "_attachments": [
        {
            "uid": "attStory",
            "download_url": "https://kf.kobotoolbox.org/api/v2/assets/a1/data/1/attachments/1/",
            "filename": "user/attachments/x/story-12_3.m4a",
            "mimetype": "audio/mp4",
            "question_xpath": "interview/story",
        },
        {
            "uid": "attFeedback",
            "download_url": "https://kf.kobotoolbox.org/api/v2/assets/a1/data/1/attachments/2/",
            "media_file_basename": "fb_renamed.amr",
            "question_xpath": "feedback",
        },
    ],
}


class TestAudioQuestions:
    def test_only_audio_questions_with_their_group_paths(self):
        questions = audio_questions(CONFIG)
        assert [q.path for q in questions] == [
            "interview/story",
            "feedback",
            "members/member_voice",
        ]
        assert questions[0].label == "Tell us what happened"
        assert [q.in_repeat for q in questions] == [False, False, True]

    def test_a_form_without_audio_has_none(self):
        assert audio_questions({"kobo_tool": {"survey": [{"type": "text", "name": "x"}]}}) == []
        assert audio_questions({}) == []

    def test_uploaded_xlsform_groups_are_walked(self):
        tool = {
            "survey": [
                {"type": "begin_group", "name": "g"},
                {"type": "audio", "name": "q", "label": "Q"},
                {"type": "end_group"},
            ]
        }
        assert [q.path for q in audio_questions({"kobo_tool": tool})] == ["g/q"]

    def test_questions_in_repeats_are_never_selected(self):
        assert [q.path for q in selected_questions(CONFIG)] == ["interview/story"]

    def test_nothing_is_selected_when_off(self):
        config = {
            **CONFIG,
            "audio_transcription": {**CONFIG["audio_transcription"], "enabled": False},
        }
        assert selected_questions(config) == []

    def test_settings_normalise_the_language(self):
        assert transcription_settings(CONFIG).language == "fra"
        assert transcription_settings({}).active is False


class TestAttachments:
    def test_matched_on_file_name(self):
        question = audio_questions(CONFIG)[0]
        filename = answer_filename(SUBMISSION, question)
        attachment = find_attachment(SUBMISSION, question, filename)
        assert filename == "story-12_3.m4a"
        assert attachment.uid == "attStory"
        assert attachment.url.endswith("/attachments/1/")

    def test_matched_on_question_when_kobo_renamed_the_file(self):
        question = audio_questions(CONFIG)[1]
        attachment = find_attachment(SUBMISSION, question, "fb.amr")
        assert attachment.uid == "attFeedback"

    def test_unanswered_question_has_no_file(self):
        question = audio_questions(CONFIG)[2]
        assert answer_filename(SUBMISSION, question) is None

    def test_deleted_attachment_is_marked(self):
        data = {
            "q": "a.m4a",
            "_attachments": [
                {"uid": "u", "download_url": "x", "filename": "a.m4a", "is_deleted": True}
            ],
        }
        question = audio_questions({"kobo_tool": {"survey": [{"type": "audio", "name": "q"}]}})[0]
        assert find_attachment(data, question, "a.m4a").deleted is True

    def test_a_new_recording_is_a_new_input(self):
        assert transcript_input_hash("q", "att1") != transcript_input_hash("q", "att2")
        assert transcript_input_hash("q", "att1") == transcript_input_hash("q", "att1")

    def test_root_uuid_drops_the_prefix(self):
        assert root_uuid(SUBMISSION) == "root-1"
        assert root_uuid({"_uuid": "plain"}) == "plain"


class TestLanguages:
    def test_scribe_lists_100_languages_sorted(self):
        languages = scribe_languages()
        assert len(languages) == 100
        assert [lang["name"] for lang in languages] == sorted(lang["name"] for lang in languages)

    @pytest.mark.parametrize(
        "code,expected",
        [
            ("fr", "fra"),
            ("fra", "fra"),
            ("FR-ca", "fra"),
            ("prs", "fas"),
            ("tl", "fil"),
            ("xx", None),
            (None, None),
        ],
    )
    def test_normalize(self, code, expected):
        assert normalize_language(code) == expected

    def test_kobo_code_is_two_letters_where_one_exists(self):
        assert kobo_language_code("fra") == "fr"
        assert kobo_language_code("ceb") == "ceb"
        assert language_name("sw") == "Swahili"

    @pytest.mark.parametrize(
        "label,code",
        [
            ("English (en)", "eng"),
            ("Français (fr)", "fra"),
            ("Kiswahili", "swa"),
            ("Dari (prs)", "fas"),
            ("Tigrinya (ti)", None),
        ],
    )
    def test_form_languages_match_scribe(self, label, code):
        assert match_form_language(label).code == code

    def test_default_and_duplicates_are_dropped(self):
        found = form_languages(["default", "English (en)", "English (en-GB)", "Somali (so)"])
        assert [lang.code for lang in found] == ["eng", "som"]


def _response(status, body=None, headers=None):
    response = requests.Response()
    response.status_code = status
    response._content = json.dumps(body).encode() if body is not None else b""
    response.headers.update(headers or {})
    return response


class TestElevenLabsErrors:
    def test_rejected_key(self):
        error = classify_response(
            _response(401, {"detail": {"status": "invalid_api_key", "message": "Invalid API key"}})
        )
        assert error.category == AUTH

    def test_quota_reported_as_401_is_still_quota(self):
        error = classify_response(
            _response(401, {"detail": {"status": "quota_exceeded", "message": "No credits"}})
        )
        assert error.category == PROVIDER_QUOTA

    def test_payment_required(self):
        assert classify_response(_response(402, {"detail": "pay"})).category == PROVIDER_QUOTA

    def test_rate_limit_honours_retry_after(self):
        error = classify_response(
            _response(
                429, {"detail": {"status": "too_many_concurrent_requests"}}, {"retry-after": "12"}
            )
        )
        assert error.category == RATE_LIMITED and error.retryable and error.retry_after == 12

    def test_server_error_is_retryable(self):
        assert classify_response(_response(503, {"detail": "busy"})).category == UNAVAILABLE

    def test_bad_file_is_not_retried(self):
        error = classify_response(_response(422, {"detail": [{"msg": "Unsupported file"}]}))
        assert error.category == BAD_REQUEST and not error.retryable
        assert "Unsupported file" in error.message


class _FakeSession:
    def __init__(self, response):
        self.response = response
        self.calls = []

    def post(self, url, **kwargs):
        kwargs["files"]["file"][1].read()
        self.calls.append((url, kwargs))
        if isinstance(self.response, Exception):
            raise self.response
        return self.response


class TestElevenLabsClient:
    def _audio(self, tmp_path):
        path = tmp_path / "a.m4a"
        path.write_bytes(b"fake")
        return AudioFile(path=str(path), filename="a.m4a", mimetype="audio/mp4")

    def test_request_fields(self, tmp_path):
        session = _FakeSession(
            _response(
                200,
                {
                    "text": "Bonjour",
                    "language_code": "fra",
                    "language_probability": 0.97,
                    "audio_duration_secs": 12.5,
                },
            )
        )
        client = TranscriptionClient("key-123", session=session, zero_retention=True)
        result = client.transcribe(
            self._audio(tmp_path), language="fra", diarize=False, duration_seconds=12
        )
        url, kwargs = session.calls[0]
        assert url == "https://api.elevenlabs.io/v1/speech-to-text"
        assert kwargs["headers"] == {"xi-api-key": "key-123"}
        assert kwargs["params"] == {"enable_logging": "false"}
        assert kwargs["data"]["model_id"] == "scribe_v2"
        assert kwargs["data"]["language_code"] == "fra"
        assert kwargs["data"]["tag_audio_events"] == "false"
        assert kwargs["data"]["timestamps_granularity"] == "none"
        assert (
            result.text == "Bonjour"
            and result.language_code == "fra"
            and result.audio_seconds == 12.5
        )

    def test_no_language_means_detect(self, tmp_path):
        session = _FakeSession(_response(200, {"text": "hi"}))
        TranscriptionClient("k", session=session).transcribe(self._audio(tmp_path))
        assert "language_code" not in session.calls[0][1]["data"]

    def test_no_key_is_not_configured(self, tmp_path):
        with pytest.raises(AIError) as raised:
            TranscriptionClient(None).transcribe(self._audio(tmp_path))
        assert raised.value.category == "not_configured"

    def test_timeout_and_network(self, tmp_path):
        with pytest.raises(AIError) as raised:
            TranscriptionClient("k", session=_FakeSession(requests.Timeout())).transcribe(
                self._audio(tmp_path)
            )
        assert raised.value.category == "timeout"
        with pytest.raises(AIError) as raised:
            TranscriptionClient("k", session=_FakeSession(requests.ConnectionError())).transcribe(
                self._audio(tmp_path)
            )
        assert raised.value.category == "unavailable"

    def test_timeout_grows_with_length_up_to_a_cap(self):
        assert read_timeout(60) == 90
        assert read_timeout(10_000) == 900

    def test_speaker_turns(self):
        words = [
            {"text": "Hello", "type": "word", "speaker_id": "speaker_0", "start": 0, "end": 0.5},
            {"text": " ", "type": "spacing", "speaker_id": "speaker_0"},
            {"text": "there", "type": "word", "speaker_id": "speaker_0", "start": 0.5, "end": 1},
            {"text": " ", "type": "spacing", "speaker_id": "speaker_1"},
            {"text": "Hi", "type": "word", "speaker_id": "speaker_1", "start": 1.2, "end": 1.5},
        ]
        result = parse_result({"text": "Hello there Hi", "words": words}, diarize=True)
        assert [(s["speaker"], s["text"]) for s in result.segments] == [
            ("speaker_0", "Hello there"),
            ("speaker_1", "Hi"),
        ]
        assert result.audio_seconds == 1.5

    def test_one_speaker_has_no_turns(self):
        words = [{"text": "Hi", "type": "word", "speaker_id": "speaker_0", "end": 1}]
        assert parse_result({"text": "Hi", "words": words}, diarize=True).segments is None


class TestFormats:
    def test_supported_formats_are_sent_as_recorded(self, tmp_path):
        audio = AudioFile(path=str(tmp_path / "a.m4a"), filename="a.m4a", mimetype=None)
        assert prepare_for_upload(audio, str(tmp_path)) is audio

    def test_amr_is_converted_when_ffmpeg_is_there(self, tmp_path, monkeypatch):
        import services.audio_files as audio_files

        calls = []
        monkeypatch.setattr(audio_files.shutil, "which", lambda name: f"/usr/bin/{name}")
        monkeypatch.setattr(audio_files.subprocess, "run", lambda args, **kw: calls.append(args))
        audio = AudioFile(path=str(tmp_path / "a.amr"), filename="a.amr", mimetype=None)
        converted = prepare_for_upload(audio, str(tmp_path))
        assert converted.filename == "a.m4a" and converted.mimetype == "audio/mp4"
        assert calls and calls[0][0] == "ffmpeg"


class TestReviewInput:
    def _fields(self):
        config = {**CONFIG, "quality_checks": {"llm_qualitative_fields": ["story", "village"]}}
        return ai_audio_fields(config, ["story", "village"])

    def test_file_name_is_replaced_by_the_transcript(self):
        transcripts = {
            "interview/story": TranscriptView("interview/story", "success", "It flooded")
        }
        data, waiting = review_data(SUBMISSION, self._fields(), transcripts)
        assert data["interview/story"] == "It flooded" and waiting is False

    def test_waits_while_the_transcript_is_being_made(self):
        transcripts = {"interview/story": TranscriptView("interview/story", "running", None)}
        data, waiting = review_data(SUBMISSION, self._fields(), transcripts)
        assert waiting is True and data["interview/story"] == ""

    def test_a_failed_transcript_is_never_read_as_its_file_name(self):
        transcripts = {"interview/story": TranscriptView("interview/story", "failed", None)}
        data, waiting = review_data(SUBMISSION, self._fields(), transcripts)
        assert data["interview/story"] == "" and waiting is False


class TestBuiltInChecks:
    labels = {"q": "Story"}

    def test_no_speech(self):
        issues = transcript_issues(
            [TranscriptView("q", "success", "", audio_seconds=10)], self.labels, None
        )
        assert [i["check"] for i in issues] == ["audio_no_speech"]
        issues = transcript_issues(
            [TranscriptView("q", "success", "uh", audio_seconds=1.2)], self.labels, None
        )
        assert [i["check"] for i in issues] == ["audio_no_speech"]

    def test_unexpected_language_only_when_confident(self):
        sure = TranscriptView(
            "q", "success", "Hello", language_code="eng", language_probability=0.95, audio_seconds=8
        )
        unsure = TranscriptView(
            "q", "success", "Hello", language_code="eng", language_probability=0.5, audio_seconds=8
        )
        assert [i["check"] for i in transcript_issues([sure], self.labels, "fra")] == [
            "audio_language_mismatch"
        ]
        assert transcript_issues([unsure], self.labels, "fra") == []
        assert transcript_issues([sure], self.labels, None) == []
        assert "English, not French" in transcript_issues([sure], self.labels, "fra")[0]["message"]

    def test_unfinished_transcripts_are_not_checked(self):
        assert transcript_issues([TranscriptView("q", "pending", None)], self.labels, "fra") == []
