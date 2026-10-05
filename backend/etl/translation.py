"""
Translation: which answers a survey translates, into which language, and
what text each one is.

A survey translates the answers to the questions its owner picks, into one
language: typed answers to text questions, and the transcripts of audio
questions. Pure functions over the stored form and submission data: no
network, no database. See docs/specs/translation.md.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Any

from etl.audio import AUDIO_TYPE, answer_key, form_questions
from services.transcription_languages import normalize_language

TEXT_TYPE = "text"
SOURCE_TEXT = "text"
SOURCE_TRANSCRIPT = "transcript"
ORIGIN_AI = "ai"
ORIGIN_KOBO = "kobo"

SETTINGS_KEY = "translation"

# An answer with no letters (a number, a code, "-99") has nothing to translate.
_LETTER = re.compile(r"[^\W\d_]", re.UNICODE)


@dataclass(frozen=True)
class TranslatableQuestion:
    path: str  # group-qualified, as in submission_data
    name: str
    label: str
    kind: str  # "text" | "audio"
    in_repeat: bool


@dataclass(frozen=True)
class TranslationSettings:
    enabled: bool = False
    language: str | None = None  # ISO 639-3, the target
    questions: tuple[str, ...] = ()
    # Translations of transcripts go to Kobo next to the transcript; Kobo
    # keeps none for typed answers.
    send_to_kobo: bool = False

    @property
    def active(self) -> bool:
        return self.enabled and self.language is not None and bool(self.questions)

    @property
    def sending_to_kobo(self) -> bool:
        return self.active and self.send_to_kobo


def translation_settings(config_data: dict[str, Any] | None) -> TranslationSettings:
    """The survey's translation settings, with defaults for anything missing."""
    raw = (config_data or {}).get(SETTINGS_KEY) or {}
    if not isinstance(raw, dict):
        return TranslationSettings()
    questions = tuple(
        str(path) for path in (raw.get("questions") or []) if isinstance(path, str) and path
    )
    return TranslationSettings(
        enabled=bool(raw.get("enabled")),
        language=normalize_language(raw.get("language")),
        questions=questions,
        send_to_kobo=bool(raw.get("send_to_kobo")),
    )


def translatable_questions(config_data: dict[str, Any] | None) -> list[TranslatableQuestion]:
    """The form's text and audio questions, in form order."""
    return [
        TranslatableQuestion(
            path=q.path,
            name=q.name,
            label=q.label,
            kind=AUDIO_TYPE if q.type == AUDIO_TYPE else TEXT_TYPE,
            in_repeat=q.in_repeat,
        )
        for q in form_questions(config_data, (TEXT_TYPE, AUDIO_TYPE))
    ]


def selected_questions(
    config_data: dict[str, Any] | None, settings: TranslationSettings | None = None
) -> list[TranslatableQuestion]:
    """The questions this survey translates (none inside repeats)."""
    settings = settings or translation_settings(config_data)
    if not settings.active:
        return []
    chosen = set(settings.questions)
    return [q for q in translatable_questions(config_data) if q.path in chosen and not q.in_repeat]


def text_answer(submission_data: dict[str, Any], question: TranslatableQuestion) -> str | None:
    """A typed answer, as given; None when unanswered."""
    key = answer_key(submission_data or {}, question)
    value = (submission_data or {}).get(key) if key else None
    if value is None:
        return None
    text = str(value).strip()
    return text or None


@dataclass(frozen=True)
class KoboTranslation:
    text: str
    language_code: str  # as Kobo files it, e.g. "en"


def kobo_translation(
    submission_data: dict[str, Any], question_path: str, question_name: str, language: str
) -> KoboTranslation | None:
    """
    The translation into ``language`` (ISO 639-3) Kobo shows for an answer,
    from the submission's ``_supplementalDetails``: typed there, made by
    Kobo's automatic translation, or sent by Field Compass. Kobo lists them
    by language code (``{"translation": {"en": {"value": ...}}}``).

    None when there is none in that language, or it is still waiting for
    someone to accept it (Kobo then sends ``pendingReview`` and no value).
    """
    details = (submission_data or {}).get("_supplementalDetails")
    if not isinstance(details, dict):
        return None
    entry = details.get(question_path)
    if not isinstance(entry, dict):
        entry = details.get(question_name)
    translations = entry.get("translation") if isinstance(entry, dict) else None
    if not isinstance(translations, dict):
        return None
    for code, found in translations.items():
        if not isinstance(found, dict) or found.get("pendingReview"):
            continue
        filed = found.get("languageCode") or code
        if normalize_language(str(filed)) != language and normalize_language(str(code)) != language:
            continue
        value = found.get("value")
        if isinstance(value, str) and value.strip():
            return KoboTranslation(text=value.strip(), language_code=str(filed))
    return None


def has_words(text: str | None) -> bool:
    return bool(text and _LETTER.search(text))


def translation_input_hash(text: str | None, language: str) -> str:
    """
    What a translation is of: one text (a typed answer or a transcript), into
    one language. A new text -- an edited answer, a transcript made again or
    corrected in Kobo -- or another language translates it again.
    """
    payload = f"translation_v1:{language}:{(text or '').strip()}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
