"""
Missing-constraint checks (#33).

The largest category of avoidable field errors is a question that accepts
values it should reject. Each of these has a known XLSForm idiom.
"""

from collections.abc import Iterable

from forms.schema import Choice, FormSchema, Question
from linter.auto_rules import (
    dk_not_exclusive_rule,
    missing_required_rule,
    unbounded_date_future_rule,
    unbounded_numeric_rule,
)
from linter.dk import CATEGORY_LABELS, DONT_KNOW, classify_choice, exclusive_choices
from linter.expressions import (
    has_exclusive_select_constraint,
    referenced_choice_equalities,
    required_choice_equalities,
    unresolved_references,
)
from linter.models import LintContext, LintFinding, finding_for
from linter.questions import (
    NUMERIC_TYPES,
    has_vocabulary,
    headline_label,
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


def _joined_meanings(choices: list[Choice]) -> str:
    """“Don't know” and “None”, each meaning once, capitalised for a headline."""
    meanings: list[str] = []
    for choice in choices:
        meaning = f"“{_meaning_of(choice).capitalize()}”"
        if meaning not in meanings:
            meanings.append(meaning)
    return meanings[0] if len(meanings) == 1 else ", ".join(meanings[:-1]) + f" or {meanings[-1]}"


def _meaning_of(choice: Choice) -> str:
    """Wording for a choice `exclusive_choices` has already classified."""
    return CATEGORY_LABELS[classify_choice(choice) or DONT_KNOW]


@lint_check("dk_not_exclusive", severity="error", tags=("constraints", "dk", "form_logic"))
def check_dk_not_exclusive(schema: FormSchema, ctx: LintContext) -> Iterable[LintFinding]:
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
        codes = [choice.name for choice in unconstrained]
        described = ", ".join(
            f"“{choice.name}” ({_meaning_of(choice)})" for choice in unconstrained
        )
        selected = " or ".join(f"selected(., '{code}')" for code in codes)
        findings.append(
            finding_for(
                "dk_not_exclusive",
                "error",
                question=question,
                message=(
                    f"“{headline_label(question, ctx.language)}” allows "
                    + _joined_meanings(unconstrained)
                    + " to be ticked with other answers"
                ),
                details=(f"`{question.name}` lets {described} be selected alongside real answers."),
                why_it_matters=(
                    "A don't-know, refused, or none option selected alongside a "
                    "real answer is not a usable response, and it also corrupts "
                    "the don't-know rate."
                ),
                suggested_fix=f"not(({selected}) and count-selected(.) > 1)",
                auto_rule=dk_not_exclusive_rule(question, codes, ctx.language),
            )
        )
    return findings


@lint_check("unbounded_numeric", severity="warning", tags=("constraints", "form_logic"))
def check_unbounded_numeric(schema: FormSchema, ctx: LintContext) -> Iterable[LintFinding]:
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
                message=f"“{headline_label(question, ctx.language)}” accepts any number",
                details=(f"`{question.name}` is {question.type} with no constraint.{extra}"),
                why_it_matters=(
                    "Unconstrained numeric questions are the main upstream source "
                    "of outliers. The form can reject impossible values at entry; "
                    "a quality rule can only flag them after the interview."
                ),
                suggested_fix=suggested,
                auto_rule=unbounded_numeric_rule(question, upper, ctx.language),
            )
        )
    return findings


@lint_check("unbounded_date", severity="warning", tags=("constraints", "form_logic"))
def check_unbounded_date(schema: FormSchema, ctx: LintContext) -> Iterable[LintFinding]:
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
                message=f"“{headline_label(question, ctx.language)}” accepts any date",
                details=f"`{question.name}` is a date with no constraint.",
                why_it_matters=(
                    "Without a constraint, enumerators can enter future birthdates "
                    "and interview dates outside the collection period. Those only "
                    "surface later, as quality flags."
                ),
                suggested_fix=suggested,
                auto_rule=unbounded_date_future_rule(question, ctx.language) if past else None,
            )
        )
    return findings


@lint_check("missing_required", severity="warning", tags=("constraints", "form_logic"))
def check_missing_required(schema: FormSchema, ctx: LintContext) -> Iterable[LintFinding]:
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
                message=f"“{headline_label(question, ctx.language)}” can be left blank",
                details=(
                    f"`{question.name}` looks like an identifier or consent question "
                    "but is not required."
                ),
                why_it_matters=(
                    "Blank enumerator, consent, or case identifiers make every "
                    "downstream check that keys on them silently skip the row."
                ),
                suggested_fix="Set `required` to `yes` on this question.",
                auto_rule=missing_required_rule(question, ctx.language),
            )
        )
    return findings


def _missing_choices(schema: FormSchema) -> Iterable[tuple[Question, str, str, str, bool]]:
    """
    Each condition's comparison with a choice value the list does not contain:
    the question, the one it names, the value, its list, and whether the
    condition cannot hold without that comparison.

    Restricted to this statically-decidable case. Questions with
    ``choice_filter`` are skipped — those filters are data-dependent.
    """
    for question in schema.questions:
        if not is_answerable(question) or not question.relevant:
            continue
        if _has_choice_filter(question):
            continue
        required = required_choice_equalities(question.relevant)
        for ref_name, value in dict.fromkeys(referenced_choice_equalities(question.relevant)):
            referenced = schema.get(ref_name)
            if referenced is None or not referenced.list_name:
                continue
            names = {choice.name for choice in schema.choices_for(referenced)}
            # `or_other` adds an "other" choice the list does not carry.
            if value in names or (value == "other" and referenced.or_other):
                continue
            yield question, ref_name, value, referenced.list_name, (ref_name, value) in required


@lint_check("unreachable_question", severity="warning", tags=("constraints", "form_logic"))
def check_unreachable_question(schema: FormSchema, ctx: LintContext) -> Iterable[LintFinding]:
    """A `relevant` that cannot hold: it requires a choice the list does not contain."""
    return [
        finding_for(
            "unreachable_question",
            "warning",
            question=question,
            message=f"“{headline_label(question, ctx.language)}” can never be shown",
            details=(
                f"`{question.name}` is relevant when `{ref_name}` is `{value}`, "
                f"but that value is not in the `{list_name}` list."
            ),
            why_it_matters=(
                "The question can never display, so it will always be "
                "blank. Anything that depends on it — skip logic, "
                "calculations, quality rules — is dead code."
            ),
            suggested_fix=f"Use a value that exists on `{list_name}`, or add `{value}` to that list.",
        )
        for question, ref_name, value, list_name, required in _missing_choices(schema)
        if required
    ]


@lint_check("condition_missing_choice", severity="warning", tags=("constraints", "form_logic"))
def check_condition_missing_choice(schema: FormSchema, ctx: LintContext) -> Iterable[LintFinding]:
    """
    A comparison with a missing choice the condition can hold without, inside
    ``not()`` or an ``or``. It is never true, so the question still shows, but
    not when meant: `not(selected(${q}, 'typo'))` shows it every time.
    """
    return [
        finding_for(
            "condition_missing_choice",
            "warning",
            question=question,
            message=f"“{headline_label(question, ctx.language)}” has a condition on a missing choice",
            details=(
                f"`{question.name}`'s condition checks whether `{ref_name}` is `{value}`, "
                f"but that value is not in the `{list_name}` list, so that part of the "
                "condition is never true."
            ),
            why_it_matters=(
                "The question is shown, but not when you meant it to be. With "
                "`not(…)` around that part, it is shown every time, even to "
                "those it was meant to skip."
            ),
            suggested_fix=f"Use a value that exists on `{list_name}`, or add `{value}` to that list.",
        )
        for question, ref_name, value, list_name, required in _missing_choices(schema)
        if not required
    ]


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
                message=f"Choice list “{list_name}” is never used",
                details=f"No question points at the `{list_name}` choice list.",
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
                message=f"Calculation “{question.name}” refers to a missing question",
                details=(
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
