"""
Lint engine: run every registered check, never abort the run on one failure.
"""

import logging

from forms.schema import FormSchema
from linter import checks as _checks  # noqa: F401
from linter.models import LintContext, LintReport
from linter.questions import iter_answerable
from linter.registry import iter_checks

logger = logging.getLogger(__name__)


def run_lint(
    schema: FormSchema,
    enabled_checks: list[str] | None = None,
    ctx: LintContext | None = None,
) -> LintReport:
    """
    Run lint checks against ``schema``.

    ``enabled_checks`` restricts the run to those ids when provided; the
    default is every registered check. A check that raises is logged and
    skipped — one broken check must not hide the rest of the report.
    """
    context = ctx or LintContext()
    enabled = set(enabled_checks) if enabled_checks is not None else None
    report = LintReport(
        question_count=sum(1 for _ in iter_answerable(schema)),
        has_audit=schema.has_audit,
    )

    for check in iter_checks():
        if enabled is not None and check.check_id not in enabled:
            continue
        report.checks_run.append(check.check_id)
        try:
            findings = list(check.func(schema, context) or [])
        except Exception:
            logger.exception("Lint check %s failed", check.check_id)
            report.checks_failed.append(check.check_id)
            continue
        report.findings.extend(findings)

    report.findings.sort(key=lambda finding: finding.sort_key())
    return report
