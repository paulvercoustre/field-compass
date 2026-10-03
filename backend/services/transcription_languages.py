"""
The languages ElevenLabs Scribe v2 can transcribe, and the codes around them.

Scribe identifies languages with ISO 639-3 codes (``fra``); Kobo's processing
screen and most XLSForm label columns use ISO 639-1 where one exists
(``label::French (fr)``). Everything stored by Field Compass is 639-3; this
module converts at the edges.

Source: https://elevenlabs.io/docs/capabilities/speech-to-text (Scribe v2,
checked 2026-10-03).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# (ISO 639-3, English name, ISO 639-1 or None)
_SCRIBE_V2: tuple[tuple[str, str, str | None], ...] = (
    ("afr", "Afrikaans", "af"),
    ("amh", "Amharic", "am"),
    ("ara", "Arabic", "ar"),
    ("hye", "Armenian", "hy"),
    ("asm", "Assamese", "as"),
    ("ast", "Asturian", None),
    ("aze", "Azerbaijani", "az"),
    ("bel", "Belarusian", "be"),
    ("ben", "Bengali", "bn"),
    ("bos", "Bosnian", "bs"),
    ("bul", "Bulgarian", "bg"),
    ("mya", "Burmese", "my"),
    ("yue", "Cantonese", None),
    ("cat", "Catalan", "ca"),
    ("ceb", "Cebuano", None),
    ("nya", "Chichewa", "ny"),
    ("hrv", "Croatian", "hr"),
    ("ces", "Czech", "cs"),
    ("dan", "Danish", "da"),
    ("nld", "Dutch", "nl"),
    ("eng", "English", "en"),
    ("est", "Estonian", "et"),
    ("fil", "Filipino", None),
    ("fin", "Finnish", "fi"),
    ("fra", "French", "fr"),
    ("ful", "Fulah", "ff"),
    ("glg", "Galician", "gl"),
    ("lug", "Ganda", "lg"),
    ("kat", "Georgian", "ka"),
    ("deu", "German", "de"),
    ("ell", "Greek", "el"),
    ("guj", "Gujarati", "gu"),
    ("hau", "Hausa", "ha"),
    ("heb", "Hebrew", "he"),
    ("hin", "Hindi", "hi"),
    ("hun", "Hungarian", "hu"),
    ("isl", "Icelandic", "is"),
    ("ibo", "Igbo", "ig"),
    ("ind", "Indonesian", "id"),
    ("gle", "Irish", "ga"),
    ("ita", "Italian", "it"),
    ("jpn", "Japanese", "ja"),
    ("jav", "Javanese", "jv"),
    ("kea", "Kabuverdianu", None),
    ("kan", "Kannada", "kn"),
    ("kaz", "Kazakh", "kk"),
    ("khm", "Khmer", "km"),
    ("kor", "Korean", "ko"),
    ("kur", "Kurdish", "ku"),
    ("kir", "Kyrgyz", "ky"),
    ("lao", "Lao", "lo"),
    ("lav", "Latvian", "lv"),
    ("lin", "Lingala", "ln"),
    ("lit", "Lithuanian", "lt"),
    ("luo", "Luo", None),
    ("ltz", "Luxembourgish", "lb"),
    ("mkd", "Macedonian", "mk"),
    ("msa", "Malay", "ms"),
    ("mal", "Malayalam", "ml"),
    ("mlt", "Maltese", "mt"),
    ("zho", "Mandarin Chinese", "zh"),
    ("mri", "Māori", "mi"),
    ("mar", "Marathi", "mr"),
    ("mon", "Mongolian", "mn"),
    ("nep", "Nepali", "ne"),
    ("nso", "Northern Sotho", None),
    ("nor", "Norwegian", "no"),
    ("oci", "Occitan", "oc"),
    ("ori", "Odia", "or"),
    ("pus", "Pashto", "ps"),
    ("fas", "Persian", "fa"),
    ("pol", "Polish", "pl"),
    ("por", "Portuguese", "pt"),
    ("pan", "Punjabi", "pa"),
    ("ron", "Romanian", "ro"),
    ("rus", "Russian", "ru"),
    ("srp", "Serbian", "sr"),
    ("sna", "Shona", "sn"),
    ("snd", "Sindhi", "sd"),
    ("sin", "Sinhala", "si"),
    ("slk", "Slovak", "sk"),
    ("slv", "Slovenian", "sl"),
    ("som", "Somali", "so"),
    ("spa", "Spanish", "es"),
    ("swa", "Swahili", "sw"),
    ("swe", "Swedish", "sv"),
    ("tam", "Tamil", "ta"),
    ("tgk", "Tajik", "tg"),
    ("tel", "Telugu", "te"),
    ("tha", "Thai", "th"),
    ("tur", "Turkish", "tr"),
    ("ukr", "Ukrainian", "uk"),
    ("umb", "Umbundu", None),
    ("urd", "Urdu", "ur"),
    ("uzb", "Uzbek", "uz"),
    ("vie", "Vietnamese", "vi"),
    ("cym", "Welsh", "cy"),
    ("wol", "Wolof", "wo"),
    ("xho", "Xhosa", "xh"),
    ("zul", "Zulu", "zu"),
)

LANGUAGE_NAMES: dict[str, str] = {code: name for code, name, _ in _SCRIBE_V2}
_TO_639_1: dict[str, str] = {code: short for code, _, short in _SCRIBE_V2 if short}
_FROM_639_1: dict[str, str] = {short: code for code, short in _TO_639_1.items()}

# Codes a form or a provider may use for a language Scribe lists under another
# code: macrolanguage members, legacy and bibliographic codes.
_ALIASES: dict[str, str] = {
    "prs": "fas",  # Dari
    "pes": "fas",  # Iranian Persian
    "per": "fas",
    "tl": "fil",
    "tgl": "fil",
    "cmn": "zho",
    "chi": "zho",
    "nb": "nor",
    "nn": "nor",
    "nob": "nor",
    "nno": "nor",
    "ckb": "kur",  # Central Kurdish (Sorani)
    "kmr": "kur",  # Northern Kurdish (Kurmanji)
    "fuc": "ful",
    "fuv": "ful",
    "swh": "swa",
    "arb": "ara",
    "zsm": "msa",
    "may": "msa",
    "fre": "fra",
    "ger": "deu",
    "dut": "nld",
    "gre": "ell",
    "cze": "ces",
    "slo": "slk",
    "rum": "ron",
    "arm": "hye",
    "geo": "kat",
    "bur": "mya",
    "mac": "mkd",
    "wel": "cym",
    "ice": "isl",
}

# Native and common alternative names, for form languages written without a
# code ("Kiswahili", "Français").
_NAME_ALIASES: dict[str, str] = {
    "kiswahili": "swa",
    "francais": "fra",
    "français": "fra",
    "espanol": "spa",
    "español": "spa",
    "portugues": "por",
    "português": "por",
    "arabic": "ara",
    "العربية": "ara",
    "dari": "fas",
    "farsi": "fas",
    "tagalog": "fil",
    "chinese": "zho",
    "mandarin": "zho",
    "sorani": "kur",
    "kurmanji": "kur",
    "fula": "ful",
    "fulfulde": "ful",
    "pulaar": "ful",
    "luganda": "lug",
    "chichewa": "nya",
    "nyanja": "nya",
    "somali": "som",
    "soomaali": "som",
    "hausa": "hau",
    "amharic": "amh",
    "pashto": "pus",
    "pashtu": "pus",
    "burmese": "mya",
    "myanmar": "mya",
}

_NAME_TO_CODE: dict[str, str] = {
    **{name.lower(): code for code, name, _ in _SCRIBE_V2},
    **_NAME_ALIASES,
}

# "English (en)", "Français (fr-CA)", "Kiswahili"
_LABEL_LANGUAGE = re.compile(
    r"^\s*(?P<name>[^()]*?)\s*(?:\((?P<code>[A-Za-z]{2,3})(?:[-_][A-Za-z0-9]+)?\))?\s*$"
)


@dataclass(frozen=True)
class FormLanguage:
    """A language a form's labels are written in, and whether Scribe has it."""

    label: str  # as written in the form: "Français (fr)"
    code: str | None  # ISO 639-3 Scribe code, or None when Scribe does not list it


def normalize_language(code: str | None) -> str | None:
    """
    A Scribe (ISO 639-3) code for ``code`` given in 639-1, 639-3 or an alias,
    or None when Scribe does not list the language.
    """
    if not code:
        return None
    value = code.strip().lower().replace("_", "-").split("-")[0]
    if value in LANGUAGE_NAMES:
        return value
    if value in _FROM_639_1:
        return _FROM_639_1[value]
    aliased = _ALIASES.get(value)
    return aliased if aliased in LANGUAGE_NAMES else None


def kobo_language_code(code: str | None) -> str | None:
    """
    The code Kobo's transcript should be stored under: ISO 639-1 where one
    exists (``fr``), otherwise the 639-3 code.
    """
    normalized = normalize_language(code)
    if normalized is None:
        return code.strip().lower() if code else None
    return _TO_639_1.get(normalized, normalized)


def language_name(code: str | None) -> str | None:
    normalized = normalize_language(code)
    return LANGUAGE_NAMES.get(normalized) if normalized else None


def scribe_languages() -> list[dict[str, str]]:
    """Every Scribe v2 language, sorted by name, for a picker."""
    return [
        {"code": code, "name": name}
        for code, name in sorted(LANGUAGE_NAMES.items(), key=lambda item: item[1])
    ]


def match_form_language(label: str) -> FormLanguage | None:
    """
    Which Scribe language a form's label language is, from its code in
    parentheses or, failing that, its name. ``default`` (a form with one
    unnamed language) matches nothing.
    """
    text = (label or "").strip()
    if not text or text.lower() == "default":
        return None
    match = _LABEL_LANGUAGE.match(text)
    if not match:
        return FormLanguage(label=text, code=None)
    code = normalize_language(match.group("code"))
    if code is None:
        name = (match.group("name") or "").strip().lower()
        code = _NAME_TO_CODE.get(name)
    return FormLanguage(label=text, code=code)


def form_languages(languages: list[str]) -> list[FormLanguage]:
    """The form's label languages, each matched to Scribe, without duplicates."""
    found: list[FormLanguage] = []
    seen: set[str] = set()
    for label in languages:
        language = match_form_language(label)
        if language is None:
            continue
        key = language.code or language.label.lower()
        if key in seen:
            continue
        seen.add(key)
        found.append(language)
    return found
