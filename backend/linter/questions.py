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
