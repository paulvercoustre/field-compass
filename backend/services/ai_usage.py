"""Recording AI calls in ``ai_usage``: one row per call, success or not."""

from uuid import UUID

from sqlalchemy.orm import Session

from database.models import AIUsage
from services.ai_client import CallUsage, ResolvedProvider, UsageRecorder
from services.ai_pricing import cost_usd_micros
from services.ai_providers import note_outcome

QUALITATIVE_CHECK = "qualitative_check"
RULE_GENERATION = "rule_generation"
RULE_SUGGESTION = "rule_suggestion"
TRANSCRIPTION = "transcription"
TRANSLATION = "translation"


def usage_recorder(
    db: Session,
    survey_id: UUID,
    feature: str,
    submission_id: int | None = None,
    provider: ResolvedProvider | None = None,
    user_id: UUID | None = None,
    billed_user_id: UUID | None = None,
) -> UsageRecorder:
    """
    A recorder for AIClient that writes to ``db`` and commits.

    Commits on its own because a call is spent whether or not the caller's
    work later succeeds -- the allowance must count it either way. With the
    survey's own ``provider``, also updates that connection's health.
    ``billed_user_id`` is the account the call counts against -- the survey's
    owner -- and the cost is worked out now, at today's list price.
    """

    def record(call: CallUsage) -> None:
        try:
            db.add(
                AIUsage(
                    survey_id=survey_id,
                    feature=feature,
                    submission_id=submission_id,
                    model=call.model,
                    input_tokens=call.input_tokens,
                    output_tokens=call.output_tokens,
                    cached_input_tokens=call.cached_input_tokens,
                    reasoning_tokens=call.reasoning_tokens,
                    cost_usd_micros=cost_usd_micros(
                        call.model, call.input_tokens, call.output_tokens, call.cached_input_tokens
                    ),
                    outcome=call.outcome,
                    connection_id=provider.connection_id if provider else None,
                    user_id=user_id,
                    billed_user_id=billed_user_id,
                )
            )
            note_outcome(db, provider, call.outcome)
            db.commit()
        except Exception:
            db.rollback()
            raise

    return record
