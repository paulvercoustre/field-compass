"""
Cognitive pretest of a questionnaire (#39).

Two layers:

* **Structural** — always runs, no model. Walks the instrument against a
  handful of coverage profiles (consent refused; form has skip logic that
  never mentions consent) and reports instrument defects, not predicted
  answers.
* **Agent** — optional. Sends the form (labels, types, choices, skip logic)
  to the configured model and asks it to answer as those profiles, flagging
  rather than guessing. Schema only: no respondent data leaves this process.

The model is instructed to find instrument defects (unanswerable items,
double-barrelled questions, skip traps). It is not asked to predict what a
population would answer.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from forms.schema import FormSchema, Question
from linter.questions import (
    enclosing_relevants,
    has_vocabulary,
    iter_answerable,
    question_search_text,
)

logger = logging.getLogger(__name__)

CONSENT_TOKENS = (
    "consent",
    "consent given",
    "informed consent",
    "respondent consent",
)

PRETEST_PROFILES = (
    {
        "id": "household_no_children",
        "label": "Household with no children",
        "instruction": (
            "You are answering for a household that has no children and never had "
            "any. Flag any question that assumes children exist, cannot be answered "
            "honestly from the choices, or has skip logic that still asks about "
            "children after a 'no children' answer."
        ),
    },
    {
        "id": "polygamous_household",
        "label": "Polygamous household",
        "instruction": (
            "You are answering for a polygamous household. Flag questions whose "
            "choices or wording cannot represent that (e.g. spouse items that only "
            "allow one partner) or skip patterns that strand the respondent."
        ),
    },
    {
        "id": "consent_refused",
        "label": "Consent refused",
        "instruction": (
            "The respondent refuses consent. Flag any subsequent question that "
            "still appears, any required item after a refusal, and any skip "
            "pattern that does not end the interview."
        ),
    },
    {
        "id": "all_dk",
        "label": "All-DK respondent",
        "instruction": (
            "The respondent answers don't-know wherever the form allows it. Flag "
            "questions with no DK/refused option, and select_multiple items where "
            "DK can be ticked with other answers."
        ),
    },
)


@dataclass
class PretestFinding:
    check_id: str
    severity: str
    message: str
    why_it_matters: str
    question_path: str | None = None
    profile: str | None = None
    source: str = "structural"

    def as_dict(self) -> dict[str, Any]:
        return {
            "check_id": self.check_id,
            "severity": self.severity,
            "question_path": self.question_path,
            "message": self.message,
            "why_it_matters": self.why_it_matters,
            "profile": self.profile,
            "source": self.source,
        }


@dataclass
class PretestReport:
    findings: list[PretestFinding] = field(default_factory=list)
    profiles: list[str] = field(default_factory=list)
    agent_ran: bool = False
    agent_error: str | None = None
    question_count: int = 0
    form_logic_missing: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "findings": [finding.as_dict() for finding in self.findings],
            "profiles": list(self.profiles),
            "agent_ran": self.agent_ran,
            "agent_error": self.agent_error,
            "question_count": self.question_count,
            "form_logic_missing": self.form_logic_missing,
        }


def _consent_question(schema: FormSchema) -> Question | None:
    for question in iter_answerable(schema):
        if has_vocabulary(question_search_text(question), CONSENT_TOKENS):
            return question
    return None


def _mentions_consent(relevant: str | None, consent: Question) -> bool:
    if not relevant:
        return False
    lowered = relevant.lower()
    return consent.name.lower() in lowered or consent.path.lower() in lowered


def structural_pretest(schema: FormSchema) -> list[PretestFinding]:
    """Instrument defects that do not need a model."""
    findings: list[PretestFinding] = []
    consent = _consent_question(schema)
    if consent is None:
        return findings

    ungated: list[Question] = []
    seen_consent = False
    for question in iter_answerable(schema):
        if question.path == consent.path:
            seen_consent = True
            continue
        if not seen_consent:
            continue
        gates = [question.relevant, *enclosing_relevants(schema, question)]
        if any(_mentions_consent(relevant, consent) for relevant in gates):
            continue
        if question.required or question.type in {"text", "integer", "decimal", "geopoint"}:
            ungated.append(question)

    if ungated:
        sample = ", ".join(f"{item.name}" for item in ungated[:6])
        extra = "" if len(ungated) <= 6 else f" (+{len(ungated) - 6} more)"
        findings.append(
            PretestFinding(
                check_id="pretest_consent_does_not_gate",
                severity="error",
                question_path=consent.path,
                profile="consent_refused",
                source="structural",
                message=(
                    f"Consent (`{consent.name}`) does not gate later questions. "
                    f"A refusal still leaves these required or substantive: {sample}{extra}."
                ),
                why_it_matters=(
                    "If consent is refused the interview should stop. Questions that "
                    "keep appearing collect data the respondent did not agree to give, "
                    "and the consent check Field Compass runs cannot tell a clean "
                    "refusal from an interview that continued."
                ),
            )
        )
    return findings


def compact_form(schema: FormSchema, *, limit: int = 80) -> list[dict[str, Any]]:
    """Schema-only payload for the agent: no submission values."""
    rows: list[dict[str, Any]] = []
    for question in schema.questions:
        if question.is_structural:
            continue
        if not question.name:
            continue
        choices = [
            {"name": choice.name, "label": choice.label_for()}
            for choice in schema.choices_for(question)[:30]
        ]
        rows.append(
            {
                "path": question.path,
                "name": question.name,
                "type": question.type,
                "label": question.label_for(),
                "required": question.required,
                "constraint": question.constraint,
                "relevant": question.relevant,
                "calculation": question.calculation,
                "choices": choices or None,
            }
        )
        if len(rows) >= limit:
            break
    return rows


def run_pretest(
    schema: FormSchema,
    *,
    use_agent: bool = True,
    agent: Any | None = None,
    form_logic_missing: bool = False,
) -> PretestReport:
    """
    Run the structural walk, then optionally the agent walk.

    ``agent`` is any object with ``pretest_instrument(form, profiles)``. Tests
    pass a fake; production passes ``ai_service``.

    ``form_logic_missing`` skips both walks: they read skip logic, and on a
    form stored without it every consent gate looks absent.
    """
    report = PretestReport(
        profiles=[profile["id"] for profile in PRETEST_PROFILES],
        question_count=sum(1 for _ in iter_answerable(schema)),
        form_logic_missing=form_logic_missing,
    )
    if form_logic_missing:
        # The agent would be walking the same logic-free copy and would flag
        # the same missing gates, so it is skipped too.
        return report
    report.findings.extend(structural_pretest(schema))

    if not use_agent:
        return report

    if agent is None or not getattr(agent, "is_available", lambda: False)():
        report.agent_error = "AI service is not configured."
        return report

    try:
        raw = agent.pretest_instrument(compact_form(schema), list(PRETEST_PROFILES))
    except Exception as exc:
        logger.warning("Cognitive pretest agent failed: %s", exc)
        report.agent_error = (
            "The pretest agent could not complete. Structural findings are still shown."
        )
        return report

    report.agent_ran = True
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        message = str(item.get("message") or "").strip()
        if not message:
            continue
        report.findings.append(
            PretestFinding(
                check_id=str(item.get("check_id") or "pretest_agent"),
                severity=str(item.get("severity") or "warning"),
                question_path=item.get("question_path") or None,
                profile=item.get("profile") or None,
                source="agent",
                message=message,
                why_it_matters=str(
                    item.get("why_it_matters")
                    or "The pretest agent flagged this as an instrument defect."
                ),
            )
        )
    return report
