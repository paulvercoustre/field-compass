"""
ETL API endpoints
Endpoints for triggering and monitoring ETL pipelines.
"""

import logging
from datetime import datetime
from uuid import UUID as UUIDType

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from database.models import Run, User
from models import BaseResponse
from services.auth import get_current_active_user, get_user_kobo_token
from services.database import get_db
from services.permissions import require_survey_access
from services.pull_worker import execute_pull, run_pull_task
from services.runs import RunAlreadyActive, fail_run, run_summary, start_pull

logger = logging.getLogger(__name__)

router = APIRouter()


def _already_running(db: Session, error: RunAlreadyActive) -> JSONResponse:
    summary = run_summary(db, error.run)
    who = summary["started_by"]["name"] or "someone"
    started = error.run.started_at or error.run.created_at
    when = started.strftime("%H:%M UTC") if started else "just now"
    return JSONResponse(
        status_code=409,
        content={
            "detail": f"A pull is already running, started by {who} at {when}.",
            "run": summary,
        },
    )


@router.post("/etl/run/{survey_id}")
async def run_etl_pipeline(
    survey_id: str,
    limit: int | None = Query(None, description="Maximum number of submissions to process"),
    start_date: str | None = Query(
        None, description="Only process submissions after this date (YYYY-MM-DD)"
    ),
    force_validation: bool = Query(
        False,
        description="Force revalidation of all submissions (ignores incremental optimization)",
    ),
    wait: bool = Query(
        False,
        description=(
            "Run the pull inside this request and return its counts, as this endpoint "
            "did before pulls ran in the background. Kept for scripts for one release."
        ),
    ),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Start a pull from KoboToolbox for a survey.

    The pull runs in the background and is recorded as a run: the response is
    ``202`` with the run, whose progress ``GET /api/runs/{run_id}`` reports
    (fetching, checks, then the AI reviews, transcriptions and Kobo sends it
    started). One pull at a time per survey: a second request gets ``409``
    with the run already under way.

    Requires editor access to the survey and the caller's own Kobo API key.
    """
    try:
        survey_uuid = UUIDType(survey_id)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid survey_id format: {survey_id}. Must be a valid UUID.",
        )

    survey = require_survey_access(db, current_user, survey_uuid, min_level="editor")

    start_datetime = None
    if start_date:
        try:
            start_datetime = datetime.strptime(start_date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(
                status_code=400, detail=f"Invalid date format: {start_date}. Use YYYY-MM-DD"
            )

    if not get_user_kobo_token(current_user):
        raise HTTPException(
            status_code=400,
            detail="Kobo API key not configured. Please set your API key in user settings.",
        )
    if not survey.kobo_asset_id:
        raise HTTPException(
            status_code=400,
            detail="This survey is not linked to a Kobo project yet. Add the project in Survey settings.",
        )

    try:
        run = start_pull(db, survey, current_user)
    except RunAlreadyActive as error:
        return _already_running(db, error)

    options = {
        "limit": limit,
        "start_date": start_datetime.strftime("%Y-%m-%d") if start_datetime else None,
        "force_validation": force_validation,
    }

    if wait:
        stats = execute_pull(run.run_id, options)
        db.expire_all()
        if stats is None:
            failed = db.query(Run).filter(Run.run_id == run.run_id).first()
            raise HTTPException(
                status_code=502, detail=(failed.error if failed else None) or "The pull failed."
            )
        return BaseResponse(
            success=True,
            message="Pull completed",
            data={
                "run_id": str(run.run_id),
                "fetched": stats["fetched"],
                "created": stats["created"],
                "updated": stats["updated"],
                "edited": stats["edited"],
                "validated": stats.get("validated", 0),
                "skipped": stats.get("skipped", 0),
                "validation_reasons": stats.get("validation_reasons", {}),
                "llm_queued": stats.get("llm_queued", 0),
                "llm_skipped": stats.get("llm_skipped", 0),
                "llm_not_run_allowance": stats.get("llm_not_run_allowance", 0),
                "llm_paused": stats.get("llm_paused", 0),
                "transcripts_queued": stats.get("transcripts_queued", 0),
                "hfc_flagged": stats["hfc_flagged"],
                "errors": stats["errors"],
                "duration_seconds": stats.get("duration_seconds", 0),
            },
        )

    try:
        result = run_pull_task.apply_async(
            kwargs={"run_id": str(run.run_id), "options": options}, task_id=str(run.run_id)
        )
        run.task_id = result.id
        db.commit()
    except Exception as exc:
        logger.error("Could not queue pull %s: %s", run.run_id, exc, exc_info=True)
        fail_run(db, run, "The pull could not start: the background worker is unavailable.")
        raise HTTPException(
            status_code=503,
            detail="The pull could not start: the background worker is unavailable. Try again shortly.",
        )

    db.refresh(run)
    return JSONResponse(
        status_code=202,
        content={
            "success": True,
            "message": "Pull started",
            "data": {"run_id": str(run.run_id), "run": run_summary(db, run)},
        },
    )
