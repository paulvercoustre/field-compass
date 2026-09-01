"""
XLSForm schema introspection.

Normalizes a KoboToolbox survey instrument into a single queryable structure,
regardless of which of the two dialects it arrives in:

- **api**  -- the ``content`` block of ``GET /assets/{uid}/``. Labels are arrays
  aligned to ``content.translations``, select lists live in
  ``select_from_list_name``, and every row carries ``$xpath`` -- the
  group-qualified path that Kobo also uses as the submission_data key and as
  the audit-log node.
- **xlsx** -- the sheet rows the frontend parser stores in
  ``config_data["kobo_tool"]``. Labels are ``label::Lang (xx)`` columns, select
  lists are embedded in the type string (``select_one my_list``), and no path
  is recorded at all, so it has to be reconstructed by walking group markers.

Pure parsing: no network, no database, no dependency on the rest of the app.
Every row is preserved, including groups, notes, and metadata types -- deciding
what is interesting is the caller's job.
"""

import re
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from typing import Any

# Key used for labels that carry no language, in either dialect: a bare `label`
# column in the xlsx dialect, or a null entry in `content.translations`.
DEFAULT_LANGUAGE = "default"

DIALECT_API = "api"
DIALECT_XLSX = "xlsx"

GROUP_OPEN_TYPES = frozenset({"begin_group", "begin_repeat"})
GROUP_CLOSE_TYPES = frozenset({"end_group", "end_repeat"})
REPEAT_OPEN_TYPES = frozenset({"begin_repeat"})
REPEAT_CLOSE_TYPES = frozenset({"end_repeat"})

# Types whose first operand names a choice list: `select_one my_list`.
# `select_one_from_file data.csv` names a file instead and is handled separately.
LIST_BEARING_TYPES = frozenset({"select_one", "select_multiple", "rank"})

# XLSForm historically allowed space-separated structural markers.
_LEGACY_STRUCTURAL_TYPES = (
    ("begin group", "begin_group"),
    ("end group", "end_group"),
    ("begin repeat", "begin_repeat"),
    ("end repeat", "end_repeat"),
)

_TRUTHY = frozenset({"yes", "true", "1"})

# Repeat instance indices, as they appear in audit-log nodes and ODK XML paths:
# `assets_operations/asset_roster[2]/asset_cost`.
_REPEAT_INDEX = re.compile(r"\[\d+\]")


def strip_repeat_indices(path: str) -> str:
    """
    Drop repeat instance indices from a path.

    Audit-log nodes and ODK XML paths address a specific repeat instance --
    ``assets_operations/asset_roster[2]/asset_cost`` -- but the form defines
    the question once. Callers resolving either against the schema need the
    index gone first.
    """
    return _REPEAT_INDEX.sub("", path or "")


def _as_bool(value: Any) -> bool:
    """Normalize XLSForm truthiness ('yes', 'true', True, 1) to a bool."""
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return str(value).strip().lower() in _TRUTHY


def _as_text(value: Any) -> str | None:
    """Return a stripped string, or None for absent/blank values."""
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def split_type(raw_type: Any) -> tuple[str, str | None, str | None, bool]:
    """
    Split an XLSForm type string.

    Returns ``(primary_type, list_name, file_name, or_other)``.

    Handles the cases the previous frontend parser got wrong: it split on the
    first space unconditionally, which mangles ``select_one_from_file`` (the
    operand is a filename, not a choice list) and silently swallowed the
    ``or_other`` suffix in ``select_one my_list or_other``.

        >>> split_type("select_one my_list or_other")
        ('select_one', 'my_list', None, True)
        >>> split_type("select_one_from_file districts.csv")
        ('select_one_from_file', None, 'districts.csv', False)
    """
    text = _as_text(raw_type)
    if not text:
        return "", None, None, False

    lowered = text.lower()
    for legacy, canonical in _LEGACY_STRUCTURAL_TYPES:
        if lowered == legacy or lowered.startswith(f"{legacy} "):
            return canonical, None, None, False

    parts = text.split()
    primary = parts[0]
    operands = parts[1:]

    or_other = any(part.lower() == "or_other" for part in operands)
    operands = [part for part in operands if part.lower() != "or_other"]

    list_name: str | None = None
    file_name: str | None = None
    if operands:
        if primary.endswith("_from_file"):
            file_name = operands[0]
        elif primary in LIST_BEARING_TYPES:
            list_name = operands[0]

    return primary, list_name, file_name, or_other


def _api_labels(value: Any, languages: list[str]) -> dict[str, str]:
    """Pair an API label array with `content.translations`."""
    if value is None:
        return {}

    if isinstance(value, list):
        labels: dict[str, str] = {}
        for index, item in enumerate(value):
            text = _as_text(item)
            if text is None:
                continue
            language = languages[index] if index < len(languages) else f"{DEFAULT_LANGUAGE}_{index}"
            labels[language] = text
        return labels

    text = _as_text(value)
    if text is None:
        return {}
    return {languages[0] if languages else DEFAULT_LANGUAGE: text}


def _xlsx_labels(row: dict[str, Any], prefix: str = "label") -> dict[str, str]:
    """Collect `label` / `label::Lang (xx)` columns from a sheet row."""
    labels: dict[str, str] = {}
    for key, value in row.items():
        if not isinstance(key, str):
            continue
        stripped_key = key.strip()
        if stripped_key == prefix:
            language = DEFAULT_LANGUAGE
        elif stripped_key.startswith(f"{prefix}::"):
            language = stripped_key.split("::", 1)[1].strip() or DEFAULT_LANGUAGE
        else:
            continue
        text = _as_text(value)
        if text is not None:
            labels[language] = text
    return labels


@dataclass(frozen=True)
class Question:
    """A single row of the survey sheet, normalized across both dialects."""

    name: str
    path: str
    group_path: str
    repeat_name: str | None
    type: str
    raw_type: str
    list_name: str | None
    file_name: str | None
    or_other: bool
    label: dict[str, str]
    required: bool
    constraint: str | None
    constraint_message: dict[str, str]
    relevant: str | None
    calculation: str | None
    raw: dict[str, Any]

    @property
    def is_structural(self) -> bool:
        """True for group and repeat markers, which are not answerable questions."""
        return self.type in GROUP_OPEN_TYPES or self.type in GROUP_CLOSE_TYPES

    def label_for(self, language: str | None = None) -> str:
        """
        Best available label, falling back to the question name.

        Without a language, prefers the default entry and otherwise takes the
        first available -- so callers that do not care about translations get
        something sensible instead of an empty string.
        """
        if language is not None and language in self.label:
            return self.label[language]
        if DEFAULT_LANGUAGE in self.label:
            return self.label[DEFAULT_LANGUAGE]
        for value in self.label.values():
            return value
        return self.name


@dataclass(frozen=True)
class Choice:
    """A single row of the choices sheet."""

    list_name: str
    name: str
    label: dict[str, str]
    raw: dict[str, Any]

    def label_for(self, language: str | None = None) -> str:
        """Best available label, falling back to the choice value."""
        if language is not None and language in self.label:
            return self.label[language]
        if DEFAULT_LANGUAGE in self.label:
            return self.label[DEFAULT_LANGUAGE]
        for value in self.label.values():
            return value
        return self.name


@dataclass
class FormSchema:
    """
    A normalized view of a survey instrument.

    ``questions`` preserves document order and every row, structural markers
    included. Filtering is left to callers -- see :meth:`iter_questions`.
    """

    questions: list[Question] = field(default_factory=list)
    choices_by_list: dict[str, list[Choice]] = field(default_factory=dict)
    languages: list[str] = field(default_factory=list)
    settings: dict[str, Any] = field(default_factory=dict)
    has_audit: bool | None = None
    dialect: str = DIALECT_XLSX

    _by_path: dict[str, Question] = field(default_factory=dict, init=False, repr=False)
    _by_name: dict[str, Question] = field(default_factory=dict, init=False, repr=False)

    def __post_init__(self) -> None:
        for question in self.questions:
            if not question.name:
                continue
            if question.path and question.path not in self._by_path:
                self._by_path[question.path] = question
            if question.name not in self._by_name:
                self._by_name[question.name] = question

    def __bool__(self) -> bool:
        return bool(self.questions)

    @property
    def is_empty(self) -> bool:
        return not self.questions

    def get(self, path_or_name: str | None) -> Question | None:
        """
        Look up a question by full path or by bare name.

        Resolution order is exact path, then exact name, then path suffix --
        so a config that only records ``sampling_admin1`` still resolves to
        ``sampling_information/sampling_admin1``. Repeat instance indices are
        stripped on a second pass, so an audit-log node such as
        ``roster[2]/cost`` resolves to the question that defines it. Ambiguous
        bare names resolve to the first match in document order.
        """
        key = (path_or_name or "").strip()
        if not key:
            return None

        for candidate_key in _dedupe([key, strip_repeat_indices(key)]):
            question = self._by_path.get(candidate_key) or self._by_name.get(candidate_key)
            if question is not None:
                return question

            suffix = f"/{candidate_key}"
            for question in self.questions:
                if question.name and question.path.endswith(suffix):
                    return question
        return None

    def iter_questions(self, type: str | Iterable[str] | None = None) -> Iterator[Question]:
        """
        Iterate questions in document order, optionally filtered by primary type.

        Structural markers (``begin_group`` and friends) are included unless
        filtered out, because a caller checking group balance needs them.
        """
        if type is None:
            yield from self.questions
            return

        wanted = {type} if isinstance(type, str) else set(type)
        for question in self.questions:
            if question.type in wanted:
                yield question

    def choices_for(self, question: Question) -> list[Choice]:
        """Choices bound to a question's list, or an empty list."""
        if not question.list_name:
            return []
        return self.choices_by_list.get(question.list_name, [])


def _dedupe(values: list[str]) -> list[str]:
    """Preserve order, drop repeats -- avoids scanning twice for indexless paths."""
    seen: list[str] = []
    for value in values:
        if value and value not in seen:
            seen.append(value)
    return seen


def _unwrap_content(source: Any) -> dict[str, Any]:
    """Accept a full asset payload, a bare `content` block, or a stored kobo_tool."""
    if not isinstance(source, dict):
        return {}
    content = source.get("content")
    if isinstance(content, dict):
        return content
    return source


def _detect_dialect(content: dict[str, Any]) -> str:
    """
    Tell the API dialect from the stored-sheet dialect.

    ``translations`` only exists on the API payload, and only API rows carry
    the ``$``-prefixed internal keys.
    """
    if "translations" in content:
        return DIALECT_API

    for row in content.get("survey") or []:
        if isinstance(row, dict) and ("$xpath" in row or "$kuid" in row):
            return DIALECT_API
    return DIALECT_XLSX


def _api_languages(content: dict[str, Any]) -> list[str]:
    """Normalize `content.translations`, mapping the null translation to a key."""
    translations = content.get("translations")
    if not isinstance(translations, list):
        return []
    return [_as_text(item) or DEFAULT_LANGUAGE for item in translations]


def _build_choices(
    content: dict[str, Any], dialect: str, languages: list[str]
) -> dict[str, list[Choice]]:
    choices_by_list: dict[str, list[Choice]] = {}

    for row in content.get("choices") or []:
        if not isinstance(row, dict):
            continue
        list_name = _as_text(row.get("list_name"))
        name = _as_text(row.get("name")) or _as_text(row.get("$autovalue"))
        if not list_name or name is None:
            continue

        labels = (
            _api_labels(row.get("label"), languages)
            if dialect == DIALECT_API
            else _xlsx_labels(row)
        )
        choices_by_list.setdefault(list_name, []).append(
            Choice(list_name=list_name, name=name, label=labels, raw=row)
        )

    return choices_by_list


def _build_question(
    row: dict[str, Any],
    dialect: str,
    languages: list[str],
    group_stack: list[str],
    repeat_stack: list[str],
) -> Question:
    """Normalize one survey row. Path resolution prefers Kobo's own `$xpath`."""
    raw_type = str(row.get("type") or "")
    primary, type_list_name, type_file_name, or_other = split_type(raw_type)

    name = _as_text(row.get("name")) or _as_text(row.get("$autoname")) or ""

    if dialect == DIALECT_API:
        list_name = _as_text(row.get("select_from_list_name")) or type_list_name
        file_name = _as_text(row.get("file")) or type_file_name
        labels = _api_labels(row.get("label"), languages)
        constraint_message = _api_labels(row.get("constraint_message"), languages)
    else:
        list_name = type_list_name or _as_text(row.get("list_name"))
        file_name = type_file_name
        labels = _xlsx_labels(row)
        constraint_message = _xlsx_labels(row, prefix="constraint_message")

    # `$xpath` is already group-qualified and matches submission_data keys, so
    # prefer it over anything we could reconstruct. The xlsx dialect has none.
    xpath = _as_text(row.get("$xpath"))
    if xpath:
        path = xpath
    elif name:
        path = "/".join([*group_stack, name])
    else:
        path = ""

    return Question(
        name=name,
        path=path,
        group_path="/".join(group_stack),
        repeat_name=repeat_stack[-1] if repeat_stack else None,
        type=primary,
        raw_type=raw_type,
        list_name=list_name,
        file_name=file_name,
        or_other=or_other,
        label=labels,
        required=_as_bool(row.get("required")),
        constraint=_as_text(row.get("constraint")),
        constraint_message=constraint_message,
        relevant=_as_text(row.get("relevant")),
        calculation=_as_text(row.get("calculation")),
        raw=row,
    )


def _build_questions(content: dict[str, Any], dialect: str, languages: list[str]) -> list[Question]:
    """Walk the survey sheet, tracking group and repeat nesting as it goes."""
    questions: list[Question] = []
    group_stack: list[str] = []
    repeat_stack: list[str] = []

    for row in content.get("survey") or []:
        if not isinstance(row, dict):
            continue

        primary, _, _, _ = split_type(row.get("type"))

        if primary in GROUP_CLOSE_TYPES:
            # Emitted before popping so the marker reports the group it closes.
            questions.append(_build_question(row, dialect, languages, group_stack, repeat_stack))
            if primary in REPEAT_CLOSE_TYPES and repeat_stack:
                repeat_stack.pop()
            if group_stack:
                group_stack.pop()
            continue

        question = _build_question(row, dialect, languages, group_stack, repeat_stack)
        questions.append(question)

        if primary in GROUP_OPEN_TYPES and question.name:
            group_stack.append(question.name)
            if primary in REPEAT_OPEN_TYPES:
                repeat_stack.append(question.name)

    return questions


def _resolve_has_audit(questions: list[Question], dialect: str) -> bool | None:
    """
    Whether the form enables audit logging.

    ``audit`` is a row in the survey sheet (``type: "audit"``), not a settings
    key. The frontend parser filters survey rows through an allowlist that
    excludes it, so on the stored dialect its absence proves nothing -- return
    None there rather than a false negative. See #32.
    """
    if any(question.type == "audit" for question in questions):
        return True
    return False if dialect == DIALECT_API else None


def _xlsx_languages(
    questions: list[Question], choices_by_list: dict[str, list[Choice]]
) -> list[str]:
    """Discover label languages from the columns actually present."""
    languages: list[str] = []
    for question in questions:
        for language in question.label:
            if language not in languages:
                languages.append(language)
    for choices in choices_by_list.values():
        for choice in choices:
            for language in choice.label:
                if language not in languages:
                    languages.append(language)
    return languages


def load_form_schema(source: Any) -> FormSchema:
    """
    Build a :class:`FormSchema` from either dialect.

    ``source`` may be a full Kobo asset payload, its bare ``content`` block, or
    a stored ``config_data["kobo_tool"]``. Malformed or missing input yields an
    empty schema rather than raising -- a survey configured before its form was
    attached is a normal state, not an error.
    """
    content = _unwrap_content(source)
    if not content:
        return FormSchema()

    dialect = _detect_dialect(content)
    languages = _api_languages(content) if dialect == DIALECT_API else []

    choices_by_list = _build_choices(content, dialect, languages)
    questions = _build_questions(content, dialect, languages)

    if dialect == DIALECT_XLSX:
        languages = _xlsx_languages(questions, choices_by_list)

    settings = content.get("settings")
    if not isinstance(settings, dict):
        settings = {}

    return FormSchema(
        questions=questions,
        choices_by_list=choices_by_list,
        languages=languages,
        settings=settings,
        has_audit=_resolve_has_audit(questions, dialect),
        dialect=dialect,
    )
