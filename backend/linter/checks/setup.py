"""
Setup-critical checks (#32).

These decide whether Field Compass can work on a form at all. They run at
connect time so a user finds out before a collection round is wasted.
"""

from collections.abc import Iterable

from etl.dk_utils import dk_string_tokens
from forms.schema import FormSchema
from linter.dk import CATEGORY_LABELS, DONT_KNOW, dont_know_codes, group_conventions
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

# "today" is deliberately not a token: as a word it matches labels such as
# "meals eaten today". The `today` metadata row is recognised by name instead.
INTERVIEW_DATE_TOKENS = (
    "interview date",
    "date interview",
    "survey date",
    "date of interview",
)


@lint_check("audit_not_enabled", severity="error", tags=("setup",))
def check_audit_not_enabled(schema: FormSchema, ctx: LintContext) -> Iterable[LintFinding]:
    """
    Duration, active interview time, and speeding all come from the audit log.

    ``has_audit`` is None on a stored form whose audit row was stripped and
    whose screens did not record it. Absence cannot be proven then, so the
    finding says so as a note rather than raising a false error or, worse,
    saying nothing and letting "no findings" read as "audit is fine".
    """
    del ctx
    if schema.has_audit is True:
        return []
    if schema.has_audit is None:
        return [
            finding_for(
                "audit_not_enabled",
                "info",
                message="Could not tell whether this form records an audit log.",
                why_it_matters=(
                    "The saved copy of this form does not say whether it has an "
                    "`audit` row. If it does not, interview duration and speeding "
                    "checks will be empty for every submission."
                ),
                suggested_fix=(
                    "Read the form from the Kobo project again and save, or confirm "
                    "the survey sheet has a row of type `audit`."
                ),
            )
        ]
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
    """
    One meaning coded more than one way.

    Compared within a meaning, never across: a form with a `dk` option and a
    `none` option is coded consistently, and reporting that pair was a false
    positive. Only don't-know is an error — it is the one the DK rate reads.
    """
    del ctx
    findings: list[LintFinding] = []
    grouped = group_conventions(schema)

    for category, wording in CATEGORY_LABELS.items():
        conventions = grouped.get(category) or {}
        if len(conventions) <= 1:
            continue

        lines = []
        for convention, occurrences in sorted(conventions.items()):
            paths = ", ".join(item.question_path for item in occurrences[:8])
            extra = "" if len(occurrences) <= 8 else f" (+{len(occurrences) - 8} more)"
            lines.append(f"{convention}: {paths}{extra}")

        findings.append(
            finding_for(
                "inconsistent_dk_coding",
                "error" if category == DONT_KNOW else "warning",
                message=(
                    f"This form codes “{wording}” as "
                    + ", ".join(f"`{code}`" for code in sorted(conventions))
                    + "."
                ),
                why_it_matters=(
                    "Don't-know rates only count the codes Field Compass is told "
                    "to look for. A second code for the same answer is silently "
                    "counted as a real answer, which understates the rate rather "
                    "than failing loudly."
                )
                if category == DONT_KNOW
                else (
                    f"Two codes for “{wording}” have to be handled separately "
                    "everywhere downstream — in exports, in filters, and in every "
                    "rule written against the question. It is usually a sign the "
                    "form was assembled from more than one module."
                ),
                suggested_fix=(
                    "Pick one code and use it on every list. Occurrences:\n" + "\n".join(lines)
                ),
            )
        )

    return findings


@lint_check("no_enumerator_field", severity="error", tags=("setup",))
def check_no_enumerator_field(schema: FormSchema, ctx: LintContext) -> Iterable[LintFinding]:
    # The field the survey is already configured to use wins, whatever it is
    # called: "collector_code" is a fine enumerator field once chosen.
    configured = ((ctx.config_data or {}).get("core_identifiers") or {}).get("enumerator")
    if configured and schema.get(configured) is not None:
        return []
    # Kobo's `username` metadata records the account that submitted, which is
    # how teams that give each enumerator a login identify them.
    if any(question.type == "username" for question in schema.questions):
        return []
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
                "named something like `enumerator_id`, or a `username` metadata row "
                "if each enumerator submits from their own Kobo account."
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
        if question.name == "today":
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


@lint_check("dk_codes_not_counted", severity="warning", tags=("setup", "dk"))
def check_dk_codes_not_counted(schema: FormSchema, ctx: LintContext) -> Iterable[LintFinding]:
    """
    Don't-know codes the form uses that this survey is not set up to count.

    Only runs against a saved survey: before one exists there is no
    configuration to compare with, and the create screen pre-selects every
    code this check would report.
    """
    if ctx.config_data is None:
        return []
    special_values = ctx.config_data.get("special_values") or {}
    counted = dk_string_tokens(special_values)
    counted.add(str(special_values.get("dk_value", -99)).strip().lower())

    missing = [code for code in dont_know_codes(schema) if code.name.lower() not in counted]
    if not missing:
        return []
    described = ", ".join(
        f"`{code.name}` ({code.label})"
        if code.label.lower() != code.name.lower()
        else f"`{code.name}`"
        for code in missing
    )
    return [
        finding_for(
            "dk_codes_not_counted",
            "warning",
            message=f"The form codes don't-know as {described}, which this survey does not count.",
            why_it_matters=(
                "The don't-know rate only counts the answer options listed in the "
                "survey settings. Every submission that uses these codes is counted "
                "as a real answer, so the rate reads lower than it is."
            ),
            suggested_fix=(
                "In survey settings, under Don't know — answer options, add: "
                + ", ".join(code.name for code in missing)
                + "."
            ),
        )
    ]
