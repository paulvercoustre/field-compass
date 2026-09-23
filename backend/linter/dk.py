"""
Don't-know / refused / not-applicable / none detection.

The codes a form uses for these answers are what the DK rate is computed from
(``etl/dk_utils.py``), so the linter has to recognise them without being told
what they are. Recognition runs in three layers, cheapest first:

1. **Keywords** — ``dont know``, ``ne sais pas``, ``refused`` anywhere on token
   boundaries; short codes like ``dk`` and ``na`` only as the whole value,
   because matched anywhere they fire on ``national`` and ``nap time``.
2. **Abbreviation edges** — a leading or trailing ``dk`` token, so ``dk_smtg``
   and ``hh_size_dk`` are found rather than missed for not matching exactly.
3. **Fuzzy match** — catches typos (``refusd``, ``dont knwo``) at a threshold
   high enough that near-neighbours of real answers (``refugee``, ``no one``)
   do not match.

The four meanings are kept apart. A ``none`` option and a ``dk`` option are
different answers, and treating them as one convention reported every form
that had both as inconsistently coded.
"""

from collections.abc import Iterator
from dataclasses import dataclass
from difflib import SequenceMatcher

from forms.schema import Choice, FormSchema, Question
from linter.questions import SELECT_TYPES, normalize_text

DONT_KNOW = "dont_know"
REFUSED = "refused"
NOT_APPLICABLE = "not_applicable"
NONE = "none"

# Report order, and the wording used in findings.
CATEGORY_LABELS: dict[str, str] = {
    DONT_KNOW: "don't know",
    REFUSED: "refused",
    NOT_APPLICABLE: "not applicable",
    NONE: "none",
}

# Numeric sentinels. #32 asks that a form mixing these be reported, so they all
# read as don't-know rather than being split across categories by code.
NUMERIC_CONVENTIONS = frozenset({"-99", "99", "98", "-98", "999", "-999", "9999"})

# Words and word sequences, matched anywhere on token boundaries in the choice
# name or any of its labels: "no" never matches inside "none", and "not know"
# matches "does not know".
_PHRASES: dict[str, tuple[str, ...]] = {
    DONT_KNOW: (
        "dont know",
        "do not know",
        "not know",
        "doesnt know",
        "does not know",
        "unknown",
        "no sabe",
        "ne sais pas",
    ),
    REFUSED: (
        "refused",
        "refuse",
        "refusal",
        "no answer",
        "no response",
        "prefer not to say",
        "prefer not to answer",
        "declined",
        "declined to answer",
    ),
    NOT_APPLICABLE: (
        "not applicable",
        "does not apply",
    ),
    NONE: (
        "none",
        "none of the above",
        "none of these",
        "nothing",
    ),
}

# Short codes, matched only as the whole value. Allowed to appear anywhere,
# `na` would fire on "national" and `nap` on "nap time".
_ABBREVIATIONS: dict[str, str] = {
    "dk": DONT_KNOW,
    "dnk": DONT_KNOW,
    "nsp": DONT_KNOW,
    "na": NOT_APPLICABLE,
    "n a": NOT_APPLICABLE,
    "nap": NOT_APPLICABLE,
}

# The subset specific enough to still count when glued to a question name:
# `dk_smtg`, `hh_size_dk`. `rf` was left out — `rf_maize` is rainfed maize.
_EDGE_ABBREVIATIONS: dict[str, str] = {
    "dk": DONT_KNOW,
    "dnk": DONT_KNOW,
    "nsp": DONT_KNOW,
    "na": NOT_APPLICABLE,
}

# Above `refused`/`refugee` (0.857) and `none`/`no one` (0.8), below the
# distance an actual typo introduces.
_FUZZY_THRESHOLD = 0.88

# Shorter than this, an edit is as likely to be a different word as a typo.
_FUZZY_MIN_LENGTH = 4


@dataclass(frozen=True)
class SpecialOccurrence:
    """One choice that means don't-know, refused, not-applicable, or none."""

    category: str
    convention: str
    question_path: str
    list_name: str
    choice_name: str


def _is_numeric_sentinel(name: str) -> bool:
    return name.strip() in NUMERIC_CONVENTIONS


def _contains_phrase(text: str, phrase: str) -> bool:
    """Whole-token containment, so `no` does not match inside `none`."""
    return f" {phrase} " in f" {text} "


def _fuzzy_matches(text: str, phrase: str) -> bool:
    if len(text) < _FUZZY_MIN_LENGTH or len(phrase) < _FUZZY_MIN_LENGTH:
        return False
    return SequenceMatcher(None, text, phrase).ratio() >= _FUZZY_THRESHOLD


def classify_text(value: str | None) -> str | None:
    """
    The category ``value`` expresses, or None when it reads as a real answer.

    Categories are tested in :data:`CATEGORY_LABELS` order, so a label reading
    "Don't know / refused" is reported as don't-know.
    """
    # Tested before normalizing, which strips the sign that tells `-99` and
    # `99` apart.
    if _is_numeric_sentinel(value or ""):
        return DONT_KNOW

    normalized = normalize_text(value)
    if not normalized:
        return None

    if normalized in _ABBREVIATIONS:
        return _ABBREVIATIONS[normalized]

    for category in CATEGORY_LABELS:
        if any(_contains_phrase(normalized, phrase) for phrase in _PHRASES[category]):
            return category

    tokens = normalized.split()
    for edge in {tokens[0], tokens[-1]}:
        category = _EDGE_ABBREVIATIONS.get(edge)
        if category is not None:
            return category

    for category in CATEGORY_LABELS:
        for phrase in _PHRASES[category]:
            if _fuzzy_matches(normalized, phrase):
                return category
            if " " not in phrase and any(_fuzzy_matches(token, phrase) for token in tokens):
                return category

    return None


def classify_choice(choice: Choice) -> str | None:
    """
    The category this choice expresses.

    The stored name is read first: it is what submissions contain, and it is
    the more deliberate of the two. Labels are the fallback for forms that
    code by number.

    A numeric sentinel is the exception: ``98`` is "refused" on some forms and
    "don't know" on others, so its label decides when it has one that says.
    Only an unlabelled sentinel defaults to don't-know.
    """
    if _is_numeric_sentinel(choice.name):
        for label in choice.label.values():
            category = classify_text(label)
            if category is not None:
                return category
        return DONT_KNOW
    for value in (choice.name, *choice.label.values()):
        category = classify_text(value)
        if category is not None:
            return category
    return None


def exclusive_choices(schema: FormSchema, question: Question) -> list[Choice]:
    """
    Choices that should not be selectable alongside a real answer.

    All four categories qualify: "none of the above" ticked with a real option
    is as unusable a response as "don't know" ticked with one.
    """
    if question.type not in SELECT_TYPES:
        return []
    return [
        choice for choice in schema.choices_for(question) if classify_choice(choice) is not None
    ]


def convention_for(choice: Choice) -> str:
    """
    The code this choice is stored as — what a submission will actually carry.

    Numeric codes keep their sign and digits (``-99`` and ``999`` are different
    conventions). Names are lowercased. A choice matched on its label still
    reports the name, because that is the value the DK rate has to be told to
    look for.
    """
    name = choice.name.strip()
    if _is_numeric_sentinel(name):
        return name
    return name.lower()


def iter_special_occurrences(schema: FormSchema) -> Iterator[SpecialOccurrence]:
    """Every select choice in the form that carries one of the four meanings."""
    seen: set[tuple[str, str]] = set()
    for question in schema.questions:
        if question.type not in SELECT_TYPES or not question.list_name:
            continue
        for choice in schema.choices_for(question):
            category = classify_choice(choice)
            if category is None:
                continue
            key = (question.path, choice.name)
            if key in seen:
                continue
            seen.add(key)
            yield SpecialOccurrence(
                category=category,
                convention=convention_for(choice),
                question_path=question.path,
                list_name=question.list_name,
                choice_name=choice.name,
            )


def group_conventions(schema: FormSchema) -> dict[str, dict[str, list[SpecialOccurrence]]]:
    """Occurrences by category, then by the code they are stored as."""
    grouped: dict[str, dict[str, list[SpecialOccurrence]]] = {}
    for occurrence in iter_special_occurrences(schema):
        by_convention = grouped.setdefault(occurrence.category, {})
        by_convention.setdefault(occurrence.convention, []).append(occurrence)
    return grouped


@dataclass(frozen=True)
class DontKnowCode:
    """A stored code that means don't-know, and where the form offers it."""

    name: str
    label: str
    lists: tuple[str, ...]


def dont_know_codes(schema: FormSchema) -> list[DontKnowCode]:
    """
    Every choice name in the form that means don't-know, once each.

    This is what the survey screens pre-fill as the don't-know answer options,
    so the linter and the configuration read the form the same way: a code the
    linter reports as a second don't-know convention is one the screens
    select. Every choice list is read, used or not, in form order. Names are
    compared ignoring case, as the DK rate compares them.
    """
    found: dict[str, tuple[Choice, list[str]]] = {}
    for list_name, choices in schema.choices_by_list.items():
        for choice in choices:
            if classify_choice(choice) != DONT_KNOW:
                continue
            key = choice.name.strip().lower()
            if not key:
                continue
            entry = found.setdefault(key, (choice, []))
            if list_name not in entry[1]:
                entry[1].append(list_name)
    return [
        DontKnowCode(name=choice.name.strip(), label=choice.label_for(), lists=tuple(lists))
        for choice, lists in found.values()
    ]
