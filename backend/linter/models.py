"""Dataclasses for lint findings and the report they roll up into."""

from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from typing import Any

from forms.schema import FormSchema, Question

SEVERITY_ERROR = "error"
SEVERITY_WARNING = "warning"
SEVERITY_INFO = "info"

SEVERITY_ORDER = {SEVERITY_ERROR: 0, SEVERITY_WARNING: 1, SEVERITY_INFO: 2}


@dataclass(frozen=True)
class LintFinding:
    """One result from one check, about one question or the form as a whole."""

    check_id: str
    severity: str
    message: str
    why_it_matters: str
    question_path: str | None = None
    suggested_fix: str | None = None
    auto_rule: dict[str, Any] | None = None

    def sort_key(self) -> tuple[int, str, str]:
        return (
            SEVERITY_ORDER.get(self.severity, 9),
            self.check_id,
            self.question_path or "",
        )

    def as_dict(self) -> dict[str, Any]:
        return {
            "check_id": self.check_id,
            "severity": self.severity,
            "question_path": self.question_path,
            "message": self.message,
            "why_it_matters": self.why_it_matters,
            "suggested_fix": self.suggested_fix,
            "auto_rule": self.auto_rule,
        }


@dataclass
class LintContext:
    """
    Optional extra input for checks that need more than the form.

    v1 checks are schema-only. ``config_data`` is accepted so a later pack can
    compare the form to a saved survey config without changing the check
    signature.
    """

    config_data: dict[str, Any] | None = None


@dataclass
class LintReport:
    findings: list[LintFinding] = field(default_factory=list)
    checks_run: list[str] = field(default_factory=list)
    checks_failed: list[str] = field(default_factory=list)
    question_count: int = 0
    has_audit: bool | None = None

    def grouped(self) -> dict[str, list[LintFinding]]:
        buckets: dict[str, list[LintFinding]] = {
            SEVERITY_ERROR: [],
            SEVERITY_WARNING: [],
            SEVERITY_INFO: [],
        }
        for finding in self.findings:
            buckets.setdefault(finding.severity, []).append(finding)
        return buckets

    def counts(self) -> dict[str, int]:
        grouped = self.grouped()
        return {severity: len(items) for severity, items in grouped.items()}

    def as_dict(self) -> dict[str, Any]:
        grouped = self.grouped()
        return {
            "findings": [finding.as_dict() for finding in self.findings],
            "by_severity": {
                severity: [finding.as_dict() for finding in items]
                for severity, items in grouped.items()
            },
            "counts": self.counts(),
            "checks_run": list(self.checks_run),
            "checks_failed": list(self.checks_failed),
            "question_count": self.question_count,
            "has_audit": self.has_audit,
        }


CheckFunc = Callable[[FormSchema, LintContext], Iterable[LintFinding]]


@dataclass(frozen=True)
class RegisteredCheck:
    check_id: str
    severity: str
    tags: tuple[str, ...]
    func: CheckFunc


def finding_for(
    check_id: str,
    severity: str,
    *,
    message: str,
    why_it_matters: str,
    question: Question | None = None,
    suggested_fix: str | None = None,
    auto_rule: dict[str, Any] | None = None,
) -> LintFinding:
    return LintFinding(
        check_id=check_id,
        severity=severity,
        message=message,
        why_it_matters=why_it_matters,
        question_path=question.path if question is not None else None,
        suggested_fix=suggested_fix,
        auto_rule=auto_rule,
    )
