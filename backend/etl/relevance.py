"""
Whether a question was shown to the respondent, from the form's skip logic.

Kobo leaves an unanswered question out of the submission -- and does the same
for a question its ``relevant`` hid. Telling "left blank" from "never asked"
means evaluating that logic against the answers: the question's own
``relevant`` and that of every group around it.

This covers the XLSForm subset skip logic is written in: comparisons,
``and``/``or``/``not``, arithmetic, ``selected()``, ``count-selected()``,
``string-length()``, ``coalesce()`` and ``if()``. Anything else -- an unknown
function, a reference into a repeat, syntax this does not read -- comes back
as unknown (None), and callers treat unknown as "do not flag": a blank check
that guesses wrong fills the review queue with questions nobody was asked.
"""

import math
import re
from collections.abc import Callable
from typing import Any

from simpleeval import SimpleEval

from forms.schema import FormSchema, Question
from linter.questions import enclosing_relevants

# Returns the submitted value for a question name, or None when absent.
Lookup = Callable[[str], Any]

_REF = re.compile(r"\$\{([^}]+)\}")
# Quoted literals are copied through untouched; everything else is rewritten.
_LITERAL = re.compile(r"('[^']*'|\"[^\"]*\")")
# A lone `=` is XPath equality; `!=`, `<=`, `>=` are left alone.
_EQUALS = re.compile(r"(?<![!<>=])=(?!=)")

# XPath spellings that are not valid Python, in the order they are applied.
_REWRITES = (
    (re.compile(r"\bcount-selected\s*\("), "count_selected("),
    (re.compile(r"\bstring-length\s*\("), "string_length("),
    (re.compile(r"\bif\s*\("), "if_("),
    (re.compile(r"\btrue\s*\(\s*\)"), "True"),
    (re.compile(r"\bfalse\s*\(\s*\)"), "False"),
    (re.compile(r"\bdiv\b"), "/"),
    (re.compile(r"\bmod\b"), "%"),
)


class _Unknown(Exception):
    """The expression reads something this evaluator cannot."""


def _as_number(value: Any) -> float:
    """XPath number(): NaN for anything that is not one, so comparisons are false."""
    if isinstance(value, Answer):
        value = value.text
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, int | float):
        return float(value)
    try:
        return float(str(value).strip())
    except ValueError:
        return math.nan


class Answer:
    """
    A submitted value, compared the way XPath compares it.

    Kobo sends every answer as text. Against a number it compares as a number
    (``${age} >= 18``), against text as text (``${consent} = 'yes'``). An
    unanswered question is the empty string, as in the form itself.
    """

    __slots__ = ("text",)

    def __init__(self, raw: Any):
        self.text = "" if raw is None else str(raw).strip()

    def __bool__(self) -> bool:
        return self.text != ""

    def __str__(self) -> str:
        return self.text

    def __eq__(self, other: object) -> bool:
        if isinstance(other, bool):
            return bool(self) == other
        if isinstance(other, int | float):
            return _as_number(self) == other
        if isinstance(other, Answer):
            return self.text == other.text
        return self.text == str(other)

    def __ne__(self, other: object) -> bool:
        return not self.__eq__(other)

    __hash__ = None  # type: ignore[assignment]

    def __lt__(self, other: Any) -> bool:
        return _as_number(self) < _as_number(other)

    def __le__(self, other: Any) -> bool:
        return _as_number(self) <= _as_number(other)

    def __gt__(self, other: Any) -> bool:
        return _as_number(self) > _as_number(other)

    def __ge__(self, other: Any) -> bool:
        return _as_number(self) >= _as_number(other)

    def __add__(self, other: Any) -> float:
        return _as_number(self) + _as_number(other)

    def __radd__(self, other: Any) -> float:
        return _as_number(other) + _as_number(self)

    def __sub__(self, other: Any) -> float:
        return _as_number(self) - _as_number(other)

    def __rsub__(self, other: Any) -> float:
        return _as_number(other) - _as_number(self)

    def __mul__(self, other: Any) -> float:
        return _as_number(self) * _as_number(other)

    def __rmul__(self, other: Any) -> float:
        return _as_number(other) * _as_number(self)

    def __truediv__(self, other: Any) -> float:
        return _as_number(self) / _as_number(other)

    def __rtruediv__(self, other: Any) -> float:
        return _as_number(other) / _as_number(self)

    def __mod__(self, other: Any) -> float:
        return _as_number(self) % _as_number(other)

    def __rmod__(self, other: Any) -> float:
        return _as_number(other) % _as_number(self)


def _text(value: Any) -> str:
    return value.text if isinstance(value, Answer) else str(value)


def _if(condition: Any, when_true: Any, when_false: Any) -> Any:
    return when_true if condition else when_false


_FUNCTIONS: dict[str, Callable[..., Any]] = {
    "selected": lambda answer, choice: _text(choice) in _text(answer).split(),
    "count_selected": lambda answer: len(_text(answer).split()),
    "string_length": lambda value: len(_text(value)),
    "coalesce": lambda first, second: first if _text(first) else second,
    "if_": _if,
    "number": _as_number,
    "int": lambda value: int(_as_number(value)),
    "string": _text,
    "boolean": bool,
}


def _to_python(expression: str, refs: dict[str, str]) -> str:
    """Rewrite one XLSForm expression for simpleeval, recording each ${ref}."""

    def ref_name(match: re.Match[str]) -> str:
        name = match.group(1).strip()
        return refs.setdefault(name, f"_ref{len(refs)}")

    parts = []
    for index, part in enumerate(_LITERAL.split(expression)):
        if index % 2:  # a quoted literal
            parts.append(part)
            continue
        part = _REF.sub(ref_name, part)
        part = _EQUALS.sub("==", part)
        for pattern, replacement in _REWRITES:
            part = pattern.sub(replacement, part)
        parts.append(part)
    return "".join(parts)


def evaluate(expression: str, lookup: Lookup) -> bool | None:
    """The truth of one ``relevant`` expression, or None when it cannot be read."""
    refs: dict[str, str] = {}
    python = _to_python(expression, refs)

    names: dict[str, Any] = {}
    for name, alias in refs.items():
        value = lookup(name)
        if isinstance(value, list | dict):
            # A repeat: which instance the form meant is not knowable here.
            return None
        names[alias] = Answer(value)

    try:
        return bool(SimpleEval(names=names, functions=_FUNCTIONS).eval(python))
    except Exception:
        return None


def is_shown(schema: FormSchema, question: Question, lookup: Lookup) -> bool | None:
    """
    Whether ``question`` was shown: its own ``relevant`` and every enclosing
    group's all held. None when any of them cannot be evaluated, or when the
    question sits in a repeat (answers there are per instance).
    """
    # Stored sheet rows drop the repeat markers and keep a `roster_name` column.
    if question.repeat_name or (question.raw or {}).get("roster_name"):
        return None

    for expression in (*enclosing_relevants(schema, question), question.relevant):
        if not expression:
            continue
        shown = evaluate(expression, lookup)
        if shown is not True:
            return shown
    return True
