"""Adopt lint findings as HFC validation rules (#34)."""

from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from database.models import ValidationRule
from linter.auto_rules import rule_name_for
from linter.models import LintFinding, LintReport


def _key(check_id: str, question_path: str | None) -> tuple[str, str]:
    return (check_id, question_path or "")


def select_findings(report: LintReport, selections: list[dict[str, str]]) -> list[LintFinding]:
    wanted = {_key(item["check_id"], item.get("question_path")) for item in selections}
    return [
        finding
        for finding in report.findings
        if _key(finding.check_id, finding.question_path) in wanted
    ]


def adopt_findings(
    db: Session,
    survey_id: UUID,
    findings: list[LintFinding],
    *,
    is_active: bool = True,
) -> list[ValidationRule]:
    """
    Create HFC rules for findings that carry ``auto_rule``.

    Idempotent: a finding whose deterministic ``rule_name`` already exists is
    left untouched. Findings without ``auto_rule`` are skipped.
    """
    created: list[ValidationRule] = []
    for finding in findings:
        if not finding.auto_rule:
            continue
        name = rule_name_for(finding.check_id, finding.question_path)
        existing = (
            db.query(ValidationRule)
            .filter(
                ValidationRule.survey_id == survey_id,
                ValidationRule.rule_name == name,
            )
            .first()
        )
        if existing:
            created.append(existing)
            continue
        rule_data: dict[str, Any] = dict(finding.auto_rule)
        rule_data.setdefault("source", "linter")
        rule_data.setdefault("linter_check_id", finding.check_id)
        rule = ValidationRule(
            survey_id=survey_id,
            rule_name=name,
            rule_data=rule_data,
            is_active=is_active,
        )
        db.add(rule)
        created.append(rule)
    db.commit()
    for rule in created:
        db.refresh(rule)
    return created
