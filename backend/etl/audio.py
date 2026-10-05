"""
Audio answers: which questions record audio, where each recording is, and how
a survey wants them transcribed.

Pure functions over the stored form and submission data: no network, no
database. See docs/specs/audio-transcription.md, section 4.
"""

from __future__ import annotations

import hashlib
import posixpath
from dataclasses import dataclass, field
from typing import Any

from forms.schema import load_form_schema
from services.transcription_languages import normalize_language

AUDIO_TYPE = "audio"

# Where a stored transcript came from: Field Compass's own transcription, or
# Kobo's (typed or corrected there, or Kobo's automatic one). Kobo's is never
# transcribed again, nor sent back.
SOURCE_ELEVENLABS = "elevenlabs"
SOURCE_KOBO = "kobo"

# Issues the transcription worker adds. Kept apart from the deterministic
# checks and from AI findings, so each source replaces only its own.
TRANSCRIPTION_ISSUE_SOURCE = "transcription_v1"
CHECK_NO_SPEECH = "audio_no_speech"
CHECK_LANGUAGE_MISMATCH = "audio_language_mismatch"

# A recording this short holds no answer, whatever the model heard.
NO_SPEECH_SECONDS = 2.0
# How sure the model must be before an answer is called "another language".
LANGUAGE_MISMATCH_PROBABILITY = 0.8


@dataclass(frozen=True)
class AudioQuestion:
    path: str  # group-qualified, as in submission_data: "interview/q_story"
    name: str
    label: str
    in_repeat: bool
    type: str = AUDIO_TYPE


@dataclass(frozen=True)
class Attachment:
    uid: str
    url: str | None
    filename: str
    mimetype: str | None
    deleted: bool


@dataclass(frozen=True)
class TranscriptionSettings:
    enabled: bool = False
    questions: tuple[str, ...] = ()
    language: str | None = None  # ISO 639-3, None = detect
    multiple_speakers: bool = False
    send_to_kobo: bool = False
    kobo_pause: dict[str, Any] | None = None
    acknowledged_at: str | None = None
    acknowledged_by: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, compare=False)

    @property
    def active(self) -> bool:
        return self.enabled and bool(self.questions)

    @property
    def sending_to_kobo(self) -> bool:
        return self.active and self.send_to_kobo and not self.kobo_pause


def transcription_settings(config_data: dict[str, Any] | None) -> TranscriptionSettings:
    """The survey's transcription settings, with defaults for anything missing."""
    raw = (config_data or {}).get("audio_transcription") or {}
    if not isinstance(raw, dict):
        return TranscriptionSettings()
    questions = tuple(
        str(path) for path in (raw.get("questions") or []) if isinstance(path, str) and path
    )
    pause = raw.get("kobo_pause")
    return TranscriptionSettings(
        enabled=bool(raw.get("enabled")),
        questions=questions,
        language=normalize_language(raw.get("language")),
        multiple_speakers=bool(raw.get("multiple_speakers")),
        send_to_kobo=bool(raw.get("send_to_kobo")),
        kobo_pause=pause if isinstance(pause, dict) else None,
        acknowledged_at=raw.get("acknowledged_at"),
        acknowledged_by=raw.get("acknowledged_by"),
        raw=dict(raw),
    )


def _label(question, row: dict[str, Any], label_column: str | None) -> str:
    if label_column and isinstance(row.get(label_column), str) and row[label_column].strip():
        return row[label_column].strip()
    return question.label_for() or question.name


def audio_questions(config_data: dict[str, Any] | None) -> list[AudioQuestion]:
    """The form's audio questions, in form order."""
    return form_questions(config_data, (AUDIO_TYPE,))


def form_questions(
    config_data: dict[str, Any] | None, types: tuple[str, ...]
) -> list[AudioQuestion]:
    """
    The form's questions of the given types, in form order.

    The stored form keeps no group rows when it came from Kobo, so the path is
    rebuilt from each row's ``group_path`` column; an uploaded XLSForm keeps its
    group markers and the schema walks them.
    """
    kobo_tool = (config_data or {}).get("kobo_tool") or {}
    if not isinstance(kobo_tool, dict):
        return []
    schema = load_form_schema(kobo_tool)
    label_column = kobo_tool.get("label_column_survey")
    found: list[AudioQuestion] = []
    seen: set[str] = set()
    for question in schema.questions:
        if question.type not in types or not question.name:
            continue
        row = question.raw or {}
        group_path = row.get("group_path")
        path = question.path
        if isinstance(group_path, str) and group_path and "/" not in path:
            path = f"{group_path.strip('/')}/{question.name}"
        if path in seen:
            continue
        seen.add(path)
        found.append(
            AudioQuestion(
                path=path,
                name=question.name,
                label=_label(question, row, label_column),
                in_repeat=bool(question.repeat_name or row.get("roster_name")),
                type=question.type,
            )
        )
    return found


def selected_questions(
    config_data: dict[str, Any] | None, settings: TranscriptionSettings | None = None
) -> list[AudioQuestion]:
    """The audio questions this survey transcribes (none inside repeats)."""
    settings = settings or transcription_settings(config_data)
    if not settings.active:
        return []
    chosen = set(settings.questions)
    return [q for q in audio_questions(config_data) if q.path in chosen and not q.in_repeat]


def answer_key(submission_data: dict[str, Any], question: AudioQuestion) -> str | None:
    """The submission_data key holding this question's answer, if answered."""
    if question.path in submission_data:
        return question.path
    suffix = f"/{question.name}"
    for key in submission_data:
        if key == question.name or (key.endswith(suffix) and not key.startswith("_")):
            return key
    return None


def answer_filename(submission_data: dict[str, Any], question: AudioQuestion) -> str | None:
    key = answer_key(submission_data, question)
    if key is None:
        return None
    value = submission_data.get(key)
    if not isinstance(value, str) or not value.strip():
        return None
    return value.strip()


def find_attachment(
    submission_data: dict[str, Any], question: AudioQuestion, filename: str
) -> Attachment | None:
    """
    The recording for an answer, from the submission's ``_attachments``.

    Matched on the file's base name (the answer value), which is unique within
    a submission, or on Kobo's ``question_xpath`` when the name differs (Kobo
    sometimes rewrites characters in stored file names).
    """
    by_xpath: dict[str, Any] | None = None
    for item in submission_data.get("_attachments") or []:
        if not isinstance(item, dict):
            continue
        base = item.get("media_file_basename") or posixpath.basename(
            str(item.get("filename") or "")
        )
        if base == filename:
            return _attachment(item, base)
        xpath = str(item.get("question_xpath") or "").strip("/")
        if xpath and xpath == question.path and by_xpath is None:
            by_xpath = item
    if by_xpath is not None:
        base = by_xpath.get("media_file_basename") or posixpath.basename(
            str(by_xpath.get("filename") or "")
        )
        return _attachment(by_xpath, base)
    return None


def _attachment(item: dict[str, Any], base: str) -> Attachment:
    uid = item.get("uid") or item.get("id") or base
    return Attachment(
        uid=str(uid),
        url=item.get("download_url") or item.get("download_large_url"),
        filename=base,
        mimetype=item.get("mimetype"),
        deleted=bool(item.get("is_deleted")),
    )


@dataclass(frozen=True)
class KoboTranscript:
    text: str
    language_code: str | None  # as Kobo files it, e.g. "fr"


def kobo_transcript(
    submission_data: dict[str, Any], question: AudioQuestion
) -> KoboTranscript | None:
    """
    The transcript Kobo shows for an answer, from the submission's
    ``_supplementalDetails``: the one accepted last there, typed by someone,
    made by Kobo's own (Google) transcription, or sent by Field Compass.

    None when there is none, or it is still waiting for someone to accept it
    (Kobo then sends ``pendingReview`` and no value).
    """
    details = submission_data.get("_supplementalDetails")
    if not isinstance(details, dict):
        return None
    entry = details.get(question.path)
    if not isinstance(entry, dict):
        entry = details.get(question.name)
    transcript = entry.get("transcript") if isinstance(entry, dict) else None
    if not isinstance(transcript, dict):
        return None
    value = transcript.get("value")
    if not isinstance(value, str) or not value.strip():
        return None
    language = transcript.get("languageCode")
    return KoboTranscript(
        text=value.strip(),
        language_code=language.strip() if isinstance(language, str) and language.strip() else None,
    )


def transcript_input_hash(question_path: str, attachment_uid: str | None) -> str:
    """
    What a transcript is of: one recording for one question. A new recording
    (an edit in Kobo that replaces it) changes the hash and is transcribed
    again. Settings changes apply to new recordings; "Transcribe all again"
    re-runs older ones on purpose.
    """
    payload = f"transcript_v1:{question_path}:{attachment_uid or ''}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def root_uuid(submission_data: dict[str, Any]) -> str | None:
    """The id Kobo files a submission's supplement under, without ``uuid:``."""
    meta = submission_data.get("meta") if isinstance(submission_data.get("meta"), dict) else {}
    for value in (
        submission_data.get("meta/rootUuid"),
        meta.get("rootUuid"),
        submission_data.get("_uuid"),
        submission_data.get("meta/instanceID"),
    ):
        if isinstance(value, str) and value.strip():
            return value.strip().removeprefix("uuid:")
    return None


# --- Transcripts as AI review input -----------------------------------------


@dataclass(frozen=True)
class TranscriptView:
    """What the AI review and the built-in checks need from a stored transcript."""

    question_path: str
    status: str
    text: str | None
    language_code: str | None = None
    language_probability: float | None = None
    audio_seconds: float | None = None


OPEN_TRANSCRIPT_STATUSES = frozenset({"pending", "running"})


def ai_audio_fields(
    config_data: dict[str, Any] | None, llm_fields: list[str]
) -> dict[str, AudioQuestion]:
    """
    The AI review fields that are audio questions, by field name.

    An audio answer's value is a file name; the review must read its
    transcript instead, or nothing at all.
    """
    if not llm_fields:
        return {}
    questions = audio_questions(config_data)
    by_name = {q.name: q for q in questions}
    by_path = {q.path: q for q in questions}
    found: dict[str, AudioQuestion] = {}
    for name in llm_fields:
        question = by_path.get(name) or by_name.get(name)
        if question is not None:
            found[name] = question
    return found


def review_data(
    submission_data: dict[str, Any],
    audio_fields: dict[str, AudioQuestion],
    transcripts: dict[str, TranscriptView],
) -> tuple[dict[str, Any], bool]:
    """
    The submission data the AI review reads, and whether it must wait.

    Each audio field's file name is replaced by its finished transcript, or by
    nothing when there is none. ``waiting`` is True while a transcript the
    review needs is still being made.
    """
    if not audio_fields:
        return submission_data, False
    data = dict(submission_data)
    waiting = False
    for question in audio_fields.values():
        key = answer_key(submission_data, question)
        if key is None:
            continue
        transcript = transcripts.get(question.path)
        if transcript is not None and transcript.status in OPEN_TRANSCRIPT_STATUSES:
            waiting = True
        text = transcript.text if transcript is not None and transcript.status == "success" else ""
        data[key] = (text or "").strip()
    return data, waiting


def transcript_issues(
    transcripts: list[TranscriptView],
    labels: dict[str, str],
    expected_language: str | None,
) -> list[dict[str, Any]]:
    """
    Built-in, free checks on finished transcripts.

    - No speech: an empty transcript, or a recording under two seconds.
    - Another language: only when the survey names the language, and the
      model is confident about a different one.
    """
    from services.transcription_languages import language_name

    issues: list[dict[str, Any]] = []
    for transcript in transcripts:
        if transcript.status != "success":
            continue
        label = labels.get(transcript.question_path, transcript.question_path)
        seconds = transcript.audio_seconds
        if not (transcript.text or "").strip() or (
            seconds is not None and seconds < NO_SPEECH_SECONDS
        ):
            issues.append(
                {
                    "check": CHECK_NO_SPEECH,
                    "field": transcript.question_path,
                    "value": None,
                    "message": f"The recording for “{label}” has no speech.",
                    "metadata": {"source": TRANSCRIPTION_ISSUE_SOURCE},
                }
            )
            continue
        detected = normalize_language(transcript.language_code)
        if (
            expected_language
            and detected
            and detected != expected_language
            and (transcript.language_probability or 0) >= LANGUAGE_MISMATCH_PROBABILITY
        ):
            issues.append(
                {
                    "check": CHECK_LANGUAGE_MISMATCH,
                    "field": transcript.question_path,
                    "value": detected,
                    "message": (
                        f"The answer to “{label}” is in {language_name(detected) or detected}, "
                        f"not {language_name(expected_language) or expected_language}."
                    ),
                    "metadata": {"source": TRANSCRIPTION_ISSUE_SOURCE},
                }
            )
    return issues


def is_transcription_issue(issue: dict[str, Any]) -> bool:
    metadata = issue.get("metadata") or {}
    return metadata.get("source") == TRANSCRIPTION_ISSUE_SOURCE
