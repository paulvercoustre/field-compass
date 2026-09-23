"""
Skip-logic and flow checks.

Whether the form's own logic holds together: questions that can still be
reached after an answer that should have ended the interview.
"""

from collections.abc import Iterable

from forms.schema import FormSchema, Question
from linter.models import LintContext, LintFinding, finding_for
from linter.questions import has_vocabulary, iter_answerable, question_search_text
from linter.registry import lint_check

CONSENT_TOKENS = (
    "consent",
    "consent given",
    "informed consent",
    "respondent consent",
)

# Types that collect something substantive even without `required`.
_SUBSTANTIVE_TYPES = frozenset({"text", "integer", "decimal", "geopoint"})

_SAMPLE_LIMIT = 6


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


@lint_check("consent_does_not_gate", severity="error", tags=("flow", "consent"))
def check_consent_does_not_gate(schema: FormSchema, ctx: LintContext) -> Iterable[LintFinding]:
    """
    A consent question that no later question is conditioned on.

    Only questions after the consent row are considered, and only the ones a
    refusal would leave standing: required items, and free-text or numeric
    items that collect something substantive regardless.
    """
    del ctx
    consent = _consent_question(schema)
    if consent is None:
        return []

    ungated: list[Question] = []
    seen_consent = False
    for question in iter_answerable(schema):
        if question.path == consent.path:
            seen_consent = True
            continue
        if not seen_consent:
            continue
        if _mentions_consent(question.relevant, consent):
            continue
        if question.required or question.type in _SUBSTANTIVE_TYPES:
            ungated.append(question)

    if not ungated:
        return []

    sample = ", ".join(question.name for question in ungated[:_SAMPLE_LIMIT])
    extra = "" if len(ungated) <= _SAMPLE_LIMIT else f" (+{len(ungated) - _SAMPLE_LIMIT} more)"
    return [
        finding_for(
            "consent_does_not_gate",
            "error",
            question=consent,
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
            suggested_fix=(
                f"Add `relevant` = `${{{consent.name}}} = 'yes'` to the questions that "
                "follow, or put them in a group with that condition."
            ),
        )
    ]
