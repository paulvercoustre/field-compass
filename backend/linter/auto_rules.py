"""
Turn a lint finding into the ``rule_data`` shape ``validation_rules`` stores.

The runtime twin of a design-time finding. If the user can still change the
form they should; if they cannot, this is the HFC rule that catches the same
defect in incoming data. ``source`` is always ``linter`` so adopted rules are
distinguishable from hand-authored ones.
"""

from typing import Any

from forms.schema import Question
from linter.questions import is_valid_rule_identifier

LINTER_SOURCE = "linter"


def rule_name_for(check_id: str, question_path: str | None) -> str:
    """Stable name used as the idempotency key when adopting a finding."""
    path = question_path or "_form"
    return f"linter:{check_id}:{path}"


def _base_rule(
    check_id: str,
    question: Question,
    *,
    issue: str,
    check_expression: str,
    extra_variables: list[str] | None = None,
) -> dict[str, Any] | None:
    if not is_valid_rule_identifier(question.name):
        return None
    variables = [question.name, *(extra_variables or [])]
    return {
        "check_id": f"linter_{check_id}_{question.name}",
        "issue": issue,
        "check_expression": check_expression,
        "variables_involved": variables,
        "roster_name": question.repeat_name,
        "source": LINTER_SOURCE,
        "linter_check_id": check_id,
        "linter_question_path": question.path,
    }


def unbounded_numeric_rule(question: Question, upper: int | None) -> dict[str, Any] | None:
    if upper is None:
        return None
    return _base_rule(
        "unbounded_numeric",
        question,
        issue=f"{question.label_for() or question.name} is outside the expected range",
        check_expression=f"{question.name} > {upper}",
    )


def unbounded_date_future_rule(question: Question) -> dict[str, Any] | None:
    """
    Flag a date that is clearly in the far future (year 2100+).

    HFC custom rules evaluate against the submitted string; there is no
    ``today()`` in simpleeval, so this is a coarse safety net rather than a
    replacement for a form constraint of ``. <= today()``.
    """
    return _base_rule(
        "unbounded_date",
        question,
        issue=f"{question.label_for() or question.name} is an implausible future date",
        check_expression=f'{question.name} >= "2100-01-01"',
    )


def missing_required_rule(question: Question) -> dict[str, Any] | None:
    return _base_rule(
        "missing_required",
        question,
        issue=f"{question.label_for() or question.name} is blank",
        check_expression=f'{question.name} == ""',
    )


def dk_not_exclusive_rule(question: Question, choice_name: str) -> dict[str, Any] | None:
    """
    Flag a select_multiple where the exclusive option is one of several answers.

    Submissions store select_multiple as a space-delimited string. ``"dk"``
    alone is a legitimate exclusive answer; ``"dk rice"`` is the defect.
    Substring matching is done with a trailing/leading space so ``dk`` does
    not fire inside ``dont_know``.
    """
    if not is_valid_rule_identifier(question.name):
        return None
    code = choice_name.replace('"', "")
    expression = (
        f'({question.name} != "{code}") and '
        f'(("{code} " in {question.name}) or (" {code}" in {question.name}))'
    )
    return _base_rule(
        "dk_not_exclusive",
        question,
        issue=(f"{question.label_for() or question.name} combines '{code}' " "with another option"),
        check_expression=expression,
    )
