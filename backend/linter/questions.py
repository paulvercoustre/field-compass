"""Shared question classification used by several checks."""

from collections.abc import Iterator
from re import compile as re_compile

from forms.schema import GROUP_CLOSE_TYPES, GROUP_OPEN_TYPES, FormSchema, Question

# Rows that are never answered. Metadata types are filled by Collect itself.
STRUCTURAL_TYPES = GROUP_OPEN_TYPES | GROUP_CLOSE_TYPES
METADATA_TYPES = frozenset(
    {
        "start",
        "end",
        "today",
        "audit",
        "deviceid",
        "subscriberid",
        "simserial",
        "phonenumber",
        "username",
        "email",
        "start-geopoint",
        "background-audio",
        "calculate",
        "note",
        "acknowledge",
        "hidden",
    }
)
NUMERIC_TYPES = frozenset({"integer", "decimal"})
SELECT_TYPES = frozenset({"select_one", "select_multiple", "rank"})
DATE_TYPES = frozenset({"date", "datetime", "today"})

_WORD = re_compile(r"[a-z0-9]+")


def normalize_text(value: str | None) -> str:
    """Lowercase, strip punctuation to spaces — for vocabulary matching."""
    if not value:
        return ""
    return " ".join(_WORD.findall(value.lower().replace("'", "")))


def question_search_text(question: Question) -> str:
    """Name, path tail, and every label, normalized into one string."""
    parts = [question.name, question.path.rsplit("/", 1)[-1], *question.label.values()]
    return " ".join(normalize_text(part) for part in parts if part)


def has_vocabulary(text: str, tokens: tuple[str, ...]) -> bool:
    """True when any token appears as a whole word (or multi-word phrase)."""
    if not text:
        return False
    padded = f" {text} "
    return any(f" {normalize_text(token)} " in padded for token in tokens if token)


def is_answerable(question: Question) -> bool:
    """A row a respondent (or enumerator) actually fills in."""
    if not question.name or question.is_structural:
        return False
    return question.type not in METADATA_TYPES and question.type not in STRUCTURAL_TYPES


def iter_answerable(schema: FormSchema) -> Iterator[Question]:
    for question in schema.questions:
        if is_answerable(question):
            yield question


def is_valid_rule_identifier(name: str) -> bool:
    """simpleeval can only bind names that are valid Python identifiers."""
    return bool(name) and name.isidentifier()


def _raw_list(value: object) -> list[str]:
    """A stored column that may hold a list or a single string."""
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item or "").strip()]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


def _path_prefixes(group_path: str) -> list[str]:
    parts = [part for part in group_path.split("/") if part]
    return ["/".join(parts[: index + 1]) for index in range(len(parts))]


def enclosing_relevants(schema: FormSchema, question: Question) -> list[str]:
    """
    ``relevant`` expressions of every group and repeat around ``question``.

    A form gated on consent usually puts the condition on a group, not on each
    question inside it. Read from the group rows when the schema has them (an
    API payload), and from the ``group_relevant`` column the create/settings
    screens store, because the stored sheet rows drop group markers.
    """
    relevants = _raw_list((question.raw or {}).get("group_relevant"))
    if question.group_path:
        prefixes = set(_path_prefixes(question.group_path))
        for row in schema.questions:
            if row.type in GROUP_OPEN_TYPES and row.path in prefixes and row.relevant:
                if row.relevant not in relevants:
                    relevants.append(row.relevant)
    return relevants


def container_names(schema: FormSchema) -> set[str]:
    """
    Names of groups and repeats, which ``${...}`` may legitimately reference.

    ``count(${hh_roster})`` names a repeat, not a question. Stored sheet rows
    have no group markers, so the names are also recovered from the
    ``roster_name`` and ``group_path`` columns written alongside each row.
    """
    names: set[str] = set()
    for question in schema.questions:
        raw = question.raw or {}
        if question.type in GROUP_OPEN_TYPES and question.name:
            names.add(question.name)
        if question.repeat_name:
            names.add(question.repeat_name)
        names.update(_raw_list(raw.get("roster_name")))
        for group_path in (question.group_path, *_raw_list(raw.get("group_path"))):
            names.update(part for part in (group_path or "").split("/") if part)
    return names
