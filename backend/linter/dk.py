"""Don't-know / refused / none detection used by several lint checks."""

from collections.abc import Iterator
from dataclasses import dataclass

from forms.schema import Choice, FormSchema, Question
from linter.questions import SELECT_TYPES, normalize_text

# Distinct conventions #32 asks us to treat as incompatible with each other.
NUMERIC_CONVENTIONS = frozenset({"-99", "99", "98", "999", "-999", "9999"})
STRING_CONVENTIONS = frozenset(
    {
        "dk",
        "dont_know",
        "do_not_know",
        "don_t_know",
        "dnk",
        "na",
        "n/a",
        "not_applicable",
    }
)

# Exclusive options on select_multiple: DK, refused, none.
_EXCLUSIVE_NAMES = STRING_CONVENTIONS | frozenset(
    {
        "refused",
        "refuse",
        "prefer_not_to_say",
        "none",
        "none_of_the_above",
        "dont_know_dont_want_to_answer",
    }
)
_EXCLUSIVE_LABEL_PHRASES = (
    "dont know",
    "do not know",
    "doesnt know",
    "does not know",
    "dk",
    "refused",
    "prefer not to say",
    "none of the above",
    "not applicable",
    "no sabe",
    "ne sais pas",
    "je ne sais pas",
)


@dataclass(frozen=True)
class DkOccurrence:
    convention: str
    question_path: str
    list_name: str
    choice_name: str


def _choice_is_exclusive(choice: Choice) -> bool:
    if choice.name.lower() in _EXCLUSIVE_NAMES:
        return True
    if choice.name in NUMERIC_CONVENTIONS or choice.name.lstrip("-").isdigit():
        if choice.name in NUMERIC_CONVENTIONS:
            return True
    for label in choice.label.values():
        normalized = normalize_text(label)
        if any(
            normalized == phrase or normalized.startswith(f"{phrase} ")
            for phrase in _EXCLUSIVE_LABEL_PHRASES
        ):
            return True
    return False


def exclusive_choices(schema: FormSchema, question: Question) -> list[Choice]:
    """Choices on this question that mean don't-know, refused, or none."""
    if question.type not in SELECT_TYPES:
        return []
    return [choice for choice in schema.choices_for(question) if _choice_is_exclusive(choice)]


def convention_for(choice: Choice) -> str:
    """
    The convention token this choice represents.

    Numeric codes stay numeric (``-99`` vs ``999`` are different conventions).
    String names are lowercased. A label-only match still reports the stored
    name, because that is what submissions will contain.
    """
    name = choice.name.strip()
    if name in NUMERIC_CONVENTIONS or _looks_numeric_code(name):
        return name
    return name.lower()


def _looks_numeric_code(name: str) -> bool:
    stripped = name.lstrip("-")
    return stripped.isdigit() and stripped in {item.lstrip("-") for item in NUMERIC_CONVENTIONS}


def iter_dk_occurrences(schema: FormSchema) -> Iterator[DkOccurrence]:
    """Every select choice in the form that looks like a DK/NA coding."""
    seen_on_question: set[tuple[str, str]] = set()
    for question in schema.questions:
        if question.type not in SELECT_TYPES or not question.list_name:
            continue
        for choice in exclusive_choices(schema, question):
            key = (question.path, choice.name)
            if key in seen_on_question:
                continue
            seen_on_question.add(key)
            yield DkOccurrence(
                convention=convention_for(choice),
                question_path=question.path,
                list_name=question.list_name,
                choice_name=choice.name,
            )


def group_conventions(schema: FormSchema) -> dict[str, list[DkOccurrence]]:
    grouped: dict[str, list[DkOccurrence]] = {}
    for occurrence in iter_dk_occurrences(schema):
        grouped.setdefault(occurrence.convention, []).append(occurrence)
    return grouped
