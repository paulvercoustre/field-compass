"""Runtime implementation for qualitative check background jobs."""

from __future__ import annotations

from datetime import datetime
import logging
from typing import Any, Dict, List
from uuid import UUID

from database.models import SubmissionCurrent, SurveyConfig
from etl.hfc_engine import HFCEngine
from services.ai_service import AIService
from services.database import SessionLocal

logger = logging.getLogger(__name__)

LLM_ISSUE_SOURCE = "llm_qualitative_v1"


def _extract_question_contexts(config_data: Dict[str, Any], fields: List[str]) -> Dict[str, str]:
    """Get question labels for monitored fields."""
    kobo_tool = config_data.get("kobo_tool", {}) or {}
    survey_questions = kobo_tool.get("survey", []) or []
    label_col = kobo_tool.get("label_column_survey", "label::English (en)")

    contexts: Dict[str, str] = {}
    for field in fields:
        question = next((q for q in survey_questions if q.get("name") == field), None)
        if not question:
            contexts[field] = field
            continue
        contexts[field] = question.get(label_col) or question.get("label") or field
    return contexts


def _is_llm_issue(issue: Dict[str, Any]) -> bool:
    """Identify qualitative LLM issues in the issue list."""
    metadata = issue.get("metadata", {}) or {}
    return bool(
        metadata.get("source") == LLM_ISSUE_SOURCE or issue.get("check", "").startswith("qual_")
    )


def run_qualitative_check_job(payload: Dict[str, Any], job_id: str) -> Dict[str, Any]:
    """Run qualitative checks for one submission and persist status/issues."""
    db = SessionLocal()
    try:
        survey_id = UUID(payload["survey_id"])
        submission_id = int(payload["submission_id"])
        requested_rules_hash = payload["llm_rules_hash"]
        requested_input_hash = payload["llm_input_hash"]

        submission = (
            db.query(SubmissionCurrent)
            .filter(
                SubmissionCurrent._id == submission_id,
                SubmissionCurrent.survey_id == survey_id,
            )
            .with_for_update()
            .first()
        )
        if not submission:
            logger.warning("Qualitative worker: submission not found id=%s", submission_id)
            return {"status": "missing_submission", "submission_id": submission_id}

        survey_config = (
            db.query(SurveyConfig).filter(SurveyConfig.survey_id == survey_id).first()
        )
        if not survey_config:
            submission.llm_check_status = "failed"
            submission.llm_last_error = "Survey config not found"
            submission.llm_checked_at = datetime.utcnow()
            db.commit()
            return {"status": "missing_survey_config", "submission_id": submission_id}

        # Ignore stale/old jobs.
        if (
            submission.llm_rules_hash != requested_rules_hash
            or submission.llm_input_hash != requested_input_hash
        ):
            logger.info("Skipping stale qualitative job for submission %s", submission_id)
            return {"status": "stale_job", "submission_id": submission_id}

        submission.llm_check_status = "running"
        submission.llm_job_id = job_id
        submission.llm_started_at = datetime.utcnow()
        submission.llm_last_error = None
        db.commit()

        engine = HFCEngine(db, survey_config)
        ai_service = AIService()
        if not ai_service.is_available():
            submission.llm_check_status = "failed"
            submission.llm_last_error = "AI service unavailable (OPENAI_API_KEY missing)"
            submission.llm_checked_at = datetime.utcnow()
            db.commit()
            return {"status": "ai_unavailable", "submission_id": submission_id}

        llm_fields = engine.llm_qualitative_fields
        question_contexts = _extract_question_contexts(survey_config.config_data, llm_fields)

        field_values: Dict[str, str] = {}
        for field in llm_fields:
            value, _ = engine._get_field_value(submission.submission_data, field)
            if not isinstance(value, str):
                continue
            text = value.strip()
            if not text:
                continue
            if text.lower() == engine.dk_string_value.lower():
                continue
            field_values[field] = text

        llm_results: List[Dict[str, Any]] = []
        if field_values:
            llm_results = ai_service.check_qualitative_responses(
                field_values=field_values,
                question_contexts=question_contexts,
                dk_numeric=engine.dk_value,
                dk_string=engine.dk_string_value,
                check_types=engine.llm_check_types,
            )

        existing_issues = submission.data_quality_issues or []
        non_llm_issues = [issue for issue in existing_issues if not _is_llm_issue(issue)]
        llm_issues = []
        checked_at = datetime.utcnow().isoformat()

        for result in llm_results:
            llm_issues.append(
                {
                    "check": f"qual_{result.get('check_type', 'unknown')}",
                    "field": result.get("field", ""),
                    "value": result.get("value"),
                    "message": result.get("message", "Qualitative issue detected"),
                    "metadata": {
                        "source": LLM_ISSUE_SOURCE,
                        "llm_checked_at": checked_at,
                        "llm_rule_version": requested_rules_hash,
                        "llm_model": ai_service.qual_check_model,
                        "llm_reasoning": result.get("reasoning", ""),
                    },
                }
            )

        # Idempotent update: replace all prior LLM issues with fresh set.
        submission.data_quality_issues = non_llm_issues + llm_issues
        submission.llm_check_status = "success"
        submission.llm_model_used = ai_service.qual_check_model
        submission.llm_checked_at = datetime.utcnow()
        submission.llm_last_error = None
        db.commit()

        return {
            "status": "success",
            "submission_id": submission_id,
            "issues_count": len(llm_issues),
        }
    except Exception as exc:
        logger.error("Qualitative worker runtime failure: %s", exc, exc_info=True)
        try:
            # Best-effort failure persistence.
            survey_id = UUID(payload["survey_id"])
            submission_id = int(payload["submission_id"])
            failed_submission = (
                db.query(SubmissionCurrent)
                .filter(
                    SubmissionCurrent._id == submission_id,
                    SubmissionCurrent.survey_id == survey_id,
                )
                .first()
            )
            if failed_submission:
                failed_submission.llm_check_status = "failed"
                failed_submission.llm_last_error = str(exc)[:1000]
                failed_submission.llm_checked_at = datetime.utcnow()
                db.commit()
        except Exception:
            db.rollback()
        raise
    finally:
        db.close()

