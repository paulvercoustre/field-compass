"""
Missing-constraint checks (#33).

The largest category of avoidable field errors is a question that accepts
values it should reject. Each of these has a known XLSForm idiom.
"""

from collections.abc import Iterable

from forms.schema import FormSchema, Question
from linter.auto_rules import (
    dk_not_exclusive_rule,
    unbounded_date_future_rule,
    unbounded_numeric_rule,
)
from linter.dk import exclusive_choices
from linter.expressions import (
    has_exclusive_select_constraint,
    referenced_choice_equalities,
    unresolved_references,
)
from linter.models import LintContext, LintFinding, finding_for
from linter.questions import (
    NUMERIC_TYPES,
    has_vocabulary,
    is_answerable,
    iter_answerable,
    question_search_text,
)
from linter.registry import lint_check

_AGE_TOKENS = ("age", "age years", "how old")
_HH_SIZE_TOKENS = (
    "household size",
    "hh size",
    "number of members",
    "hhsize",
    "hh size",
    "household members",
)
_PAST_DATE_TOKENS = (
    "birth",
    "dob",
    "date of birth",
    "born",
    "interview date",
    "date of interview",
)
_IDENTIFIER_TOKENS = (
    "enumerator",
    "enumerator id",
    "interviewer",
    "consent",
    "household id",
    "hh id",
    "case id",
    "respondent id",
    "interview id",
)


def _inferred_numeric_upper(question: Question) -> int | None:
    text = question_search_text(question)
    if has_vocabulary(text, _AGE_TOKENS):
        return 120
    if has_vocabulary(text, _HH_SIZE_TOKENS):
        return 40
    return None


def _looks_like_identifier(question: Question) -> bool:
    return has_vocabulary(question_search_text(question), _IDENTIFIER_TOKENS)


def _has_choice_filter(question: Question) -> bool:
    raw = question.raw or {}
    return bool(str(raw.get("choice_filter") or "").strip())


@lint_check("dk_not_exclusive", severity="error", tags=("constraints", "dk", "form_logic"))
def check_dk_not_exclusive(schema: FormSchema, ctx: LintContext) -> Iterable[LintFinding]:
    del ctx
    findings: list[LintFinding] = []
    for question in iter_answerable(schema):
        if question.type != "select_multiple":
            continue
        exclusives = exclusive_choices(schema, question)
        if not exclusives:
            continue
        unconstrained = [
            choice
            for choice in exclusives
            if not has_exclusive_select_constraint(question.constraint, choice.name)
        ]
        if not unconstrained:
            continue
        code = unconstrained[0].name
        findings.append(
            finding_for(
                "dk_not_exclusive",
                "error",
                question=question,
                message=(
                    f"“{question.label_for()}” lets “{code}” be selected with " "other options."
                ),
                why_it_matters=(
                    "A don't-know, refused, or none option selected alongside a "
                    "real answer is not a usable response, and it also corrupts "
                    "the don't-know rate."
                ),
                suggested_fix=(f"not(selected(., '{code}') and count-selected(.) > 1)"),
                auto_rule=dk_not_exclusive_rule(question, code),
            )
        )
    return findings


@lint_check("unbounded_numeric", severity="warning", tags=("constraints", "form_logic"))
def check_unbounded_numeric(schema: FormSchema, ctx: LintContext) -> Iterable[LintFinding]:
    del ctx
    findings: list[LintFinding] = []
    for question in iter_answerable(schema):
        if question.type not in NUMERIC_TYPES:
            continue
        if question.constraint:
            continue
        upper = _inferred_numeric_upper(question)
        if upper is not None:
            suggested = f"(. >= 0 and . <= {upper}) or . = -99"
            extra = f" A typical range for this question is 0–{upper}."
        else:
            suggested = "Add a constraint with a plausible min and max, and allow the DK code."
            extra = ""
        findings.append(
            finding_for(
                "unbounded_numeric",
                "warning",
                question=question,
                message=(
                    f"“{question.label_for()}” ({question.name}) is "
                    f"{question.type} with no constraint.{extra}"
                ),
                why_it_matters=(
                    "Unconstrained numeric questions are the main upstream source "
                    "of outliers. The form can reject impossible values at entry; "
                    "a quality rule can only flag them after the interview."
                ),
                suggested_fix=suggested,
                auto_rule=unbounded_numeric_rule(question, upper),
            )
        )
    return findings


@lint_check("unbounded_date", severity="warning", tags=("constraints", "form_logic"))
def check_unbounded_date(schema: FormSchema, ctx: LintContext) -> Iterable[LintFinding]:
    del ctx
    findings: list[LintFinding] = []
    for question in iter_answerable(schema):
        if question.type != "date":
            continue
        if question.constraint:
            continue
        past = has_vocabulary(question_search_text(question), _PAST_DATE_TOKENS)
        suggested = ". <= today()" if past else "Add a constraint, e.g. `. <= today()`."
        findings.append(
            finding_for(
                "unbounded_date",
                "warning",
                question=question,
                message=(
                    f"“{question.label_for()}” ({question.name}) is a date with " "no constraint."
                ),
                why_it_matters=(
                    "Without a constraint, enumerators can enter future birthdates "
                    "and interview dates outside the collection period. Those only "
                    "surface later, as quality flags."
                ),
                suggested_fix=suggested,
                auto_rule=unbounded_date_future_rule(question) if past else None,
            )
        )
    return findings


@lint_check("missing_required", severity="warning", tags=("constraints", "form_logic"))
def check_missing_required(schema: FormSchema, ctx: LintContext) -> Iterable[LintFinding]:
    del ctx
    findings: list[LintFinding] = []
    for question in iter_answerable(schema):
        if question.required:
            continue
        if not _looks_like_identifier(question):
            continue
        findings.append(
            finding_for(
                "missing_required",
                "warning",
                question=question,
                message=(
                    f"“{question.label_for()}” ({question.name}) looks like an "
                    "identifier or consent question but is not required."
                ),
                why_it_matters=(
                    "Blank enumerator, consent, or case identifiers make every "
                    "downstream check that keys on them silently skip the row."
                ),
                suggested_fix="Set `required` to `yes` on this question.",
                # No runtime twin: Kobo leaves a blank answer out of the
                # submission, and the HFC engine skips any rule whose variable
                # is absent, so a "is blank" rule could never fire.
                auto_rule=None,
            )
        )
    return findings


@lint_check("unreachable_question", severity="warning", tags=("constraints", "form_logic"))
def check_unreachable_question(schema: FormSchema, ctx: LintContext) -> Iterable[LintFinding]:
    """
    A `relevant` that references a choice value the list does not contain.

    Restricted to this statically-decidable case. Questions with
    ``choice_filter`` are skipped — those filters are data-dependent.
    """
    del ctx
    findings: list[LintFinding] = []
    for question in schema.questions:
        if not is_answerable(question) or not question.relevant:
            continue
        if _has_choice_filter(question):
            continue
        for ref_name, value in referenced_choice_equalities(question.relevant):
            referenced = schema.get(ref_name)
            if referenced is None or not referenced.list_name:
                continue
            names = {choice.name for choice in schema.choices_for(referenced)}
            if value in names:
                continue
            findings.append(
                finding_for(
                    "unreachable_question",
                    "warning",
                    question=question,
                    message=(
                        f"“{question.label_for()}” is relevant when "
                        f"`{ref_name}` is `{value}`, but that value is not in "
                        f"the `{referenced.list_name}` list."
                    ),
                    why_it_matters=(
                        "The question can never display, so it will always be "
                        "blank. Anything that depends on it — skip logic, "
                        "calculations, quality rules — is dead code."
                    ),
                    suggested_fix=(
                        f"Use a value that exists on `{referenced.list_name}`, "
                        f"or add `{value}` to that list."
                    ),
                )
            )
    return findings


@lint_check("orphan_choice_list", severity="info", tags=("constraints",))
def check_orphan_choice_list(schema: FormSchema, ctx: LintContext) -> Iterable[LintFinding]:
    del ctx
    used = {question.list_name for question in schema.questions if question.list_name}
    findings: list[LintFinding] = []
    for list_name in sorted(schema.choices_by_list):
        if list_name in used:
            continue
        findings.append(
            finding_for(
                "orphan_choice_list",
                "info",
                message=f"Choice list `{list_name}` is defined but never used.",
                why_it_matters=(
                    "An unused list is usually a leftover from a renamed question. "
                    "It does not break collection, but it is a sign the form and "
                    "the choices sheet have drifted."
                ),
                suggested_fix=f"Delete the `{list_name}` rows from the choices sheet, or point a select question at it.",
            )
        )
    return findings


@lint_check("broken_calculation", severity="error", tags=("constraints", "form_logic"))
def check_broken_calculation(schema: FormSchema, ctx: LintContext) -> Iterable[LintFinding]:
    del ctx
    findings: list[LintFinding] = []
    for question in schema.questions:
        if question.type != "calculate" or not question.calculation:
            continue
        missing = unresolved_references(question.calculation, schema)
        if not missing:
            continue
        findings.append(
            finding_for(
                "broken_calculation",
                "error",
                question=question,
                message=(
                    f"Calculate `{question.name}` references "
                    + ", ".join(f"`{name}`" for name in missing)
                    + ", which are not in this form."
                ),
                why_it_matters=(
                    "A calculation that cannot resolve produces blanks or errors "
                    "in every submission, and any quality rule that reads it "
                    "will skip the row."
                ),
                suggested_fix=(
                    "Point the calculation at a question that exists, or restore "
                    "the missing question."
                ),
            )
        )
    return findings
