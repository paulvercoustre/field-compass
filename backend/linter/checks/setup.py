"""
Setup-critical checks (#32).

These decide whether Field Compass can work on a form at all. They run at
connect time so a user finds out before a collection round is wasted.
"""

from collections.abc import Iterable

from forms.schema import FormSchema
from linter.dk import group_conventions
from linter.models import LintContext, LintFinding, finding_for
from linter.questions import (
    DATE_TYPES,
    SELECT_TYPES,
    has_vocabulary,
    iter_answerable,
    question_search_text,
)
from linter.registry import lint_check

ENUMERATOR_TOKENS = (
    "enumerator",
    "enumerator id",
    "enumerator name",
    "enumerator code",
    "enum id",
    "enum name",
    "interviewer",
    "interviewer id",
    "interviewer name",
    "data collector",
)

SAMPLING_TOKENS = (
    "admin1",
    "admin2",
    "admin3",
    "admin 1",
    "admin 2",
    "province",
    "district",
    "region",
    "village",
    "cluster",
    "stratum",
    "strata",
    "livelihood",
    "sampling",
    "governorate",
    "commune",
    "kebele",
    "woreda",
    "payam",
    "county",
)

INTERVIEW_DATE_TOKENS = (
    "today",
    "interview date",
    "date interview",
    "survey date",
    "date of interview",
)


@lint_check("audit_not_enabled", severity="error", tags=("setup",))
def check_audit_not_enabled(schema: FormSchema, ctx: LintContext) -> Iterable[LintFinding]:
    """
    Duration, active interview time, and speeding all come from the audit log.

    ``has_audit`` is None on a stored xlsx dialect that has had the audit row
    stripped — we cannot prove absence, so we stay silent rather than raise a
    false error. The API dialect reports False when the row is missing.
    """
    del ctx
    if schema.has_audit is not False:
        return []
    return [
        finding_for(
            "audit_not_enabled",
            "error",
            message="This form does not record an audit log.",
            why_it_matters=(
                "Interview duration, active interview time, and speeding detection "
                "all come from the audit log. Without it those metrics are empty "
                "for every submission, and the log cannot be added retroactively."
            ),
            suggested_fix="Add a row of type `audit` to the survey sheet.",
        )
    ]


@lint_check("inconsistent_dk_coding", severity="error", tags=("setup", "dk"))
def check_inconsistent_dk_coding(schema: FormSchema, ctx: LintContext) -> Iterable[LintFinding]:
    del ctx
    grouped = group_conventions(schema)
    if len(grouped) <= 1:
        return []

    lines = []
    for convention, occurrences in sorted(grouped.items()):
        paths = ", ".join(item.question_path for item in occurrences[:8])
        extra = "" if len(occurrences) <= 8 else f" (+{len(occurrences) - 8} more)"
        lines.append(f"{convention}: {paths}{extra}")

    return [
        finding_for(
            "inconsistent_dk_coding",
            "error",
            message=(
                "This form codes “don't know” in more than one way: "
                + ", ".join(sorted(grouped))
                + "."
            ),
            why_it_matters=(
                "Don't-know rates only count the codes Field Compass is told to "
                "look for. A second convention is silently treated as a real "
                "answer, which understates the DK rate rather than failing loudly."
            ),
            suggested_fix=(
                "Pick one convention and use it on every list. Occurrences:\n" + "\n".join(lines)
            ),
        )
    ]


@lint_check("no_enumerator_field", severity="error", tags=("setup",))
def check_no_enumerator_field(schema: FormSchema, ctx: LintContext) -> Iterable[LintFinding]:
    del ctx
    for question in iter_answerable(schema):
        if has_vocabulary(question_search_text(question), ENUMERATOR_TOKENS):
            return []
    return [
        finding_for(
            "no_enumerator_field",
            "error",
            message="No question looks like an enumerator identifier.",
            why_it_matters=(
                "The Field Team page, per-enumerator quality comparison, and the "
                "enumerator filter on Submissions all need a question that records "
                "who conducted the interview. Without one they stay empty."
            ),
            suggested_fix=(
                "Add a required select_one or text question for the enumerator ID, "
                "named something like `enumerator_id`."
            ),
        )
    ]


@lint_check("sampling_var_not_select", severity="warning", tags=("setup", "sampling"))
def check_sampling_var_not_select(schema: FormSchema, ctx: LintContext) -> Iterable[LintFinding]:
    del ctx
    findings: list[LintFinding] = []
    for question in iter_answerable(schema):
        if not has_vocabulary(question_search_text(question), SAMPLING_TOKENS):
            continue
        if question.type in SELECT_TYPES:
            continue
        findings.append(
            finding_for(
                "sampling_var_not_select",
                "warning",
                question=question,
                message=(
                    f"“{question.label_for()}” ({question.name}) looks like a "
                    f"sampling variable but is {question.type}, not a select."
                ),
                why_it_matters=(
                    "Collection targets per choice, and checking that a submitted "
                    "stratum is a legal value, both need a choice list. Free text "
                    "cannot be validated against the form and cannot produce a "
                    "target table."
                ),
                suggested_fix=(
                    f"Change `{question.name}` to `select_one` (or `select_multiple`) "
                    "with an explicit choice list."
                ),
            )
        )
    return findings


@lint_check("no_interview_date", severity="warning", tags=("setup",))
def check_no_interview_date(schema: FormSchema, ctx: LintContext) -> Iterable[LintFinding]:
    del ctx
    for question in schema.questions:
        if question.type in DATE_TYPES:
            return []
        if question.name and has_vocabulary(question_search_text(question), INTERVIEW_DATE_TOKENS):
            return []
    return [
        finding_for(
            "no_interview_date",
            "warning",
            message="No date question and no `today` metadata field.",
            why_it_matters=(
                "Date-range and weekend checks need the date the interview took "
                "place, which is not the same as the time Kobo received the "
                "submission. Without one, those checks never run."
            ),
            suggested_fix=(
                "Add a `today` metadata row, or a `date` question for the " "interview date."
            ),
        )
    ]
