"""Recording AI calls in ``ai_usage``: one row per call, success or not."""

from uuid import UUID

from sqlalchemy.orm import Session

from database.models import AIUsage
from services.ai_client import ResolvedProvider, UsageRecorder
from services.ai_providers import note_outcome

QUALITATIVE_CHECK = "qualitative_check"
RULE_GENERATION = "rule_generation"
RULE_SUGGESTION = "rule_suggestion"


def usage_recorder(
    db: Session,
    survey_id: UUID,
    feature: str,
    submission_id: int | None = None,
    provider: ResolvedProvider | None = None,
) -> UsageRecorder:
    """
    A recorder for AIClient that writes to ``db`` and commits.

    Commits on its own because a call is spent whether or not the caller's
    work later succeeds -- the allowance must count it either way. With the
    survey's own ``provider``, also updates that connection's health.
    """

    def record(model: str, outcome: str, input_tokens: int | None, output_tokens: int | None):
        try:
            db.add(
                AIUsage(
                    survey_id=survey_id,
                    feature=feature,
                    submission_id=submission_id,
                    model=model,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    outcome=outcome,
                    connection_id=provider.connection_id if provider else None,
                )
            )
            note_outcome(db, provider, outcome)
            db.commit()
        except Exception:
            db.rollback()
            raise

    return record
