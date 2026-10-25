"""
A survey's submissions as the data pages read them: only the columns their
counts, checks and filters use, as read-only rows instead of whole submissions.

Progress, Data quality, Field team, By question and the review queue read
every submission of a survey on each request. Loaded whole, with the ORM's
bookkeeping for each, that was most of their time; these rows take a third of
it (docs/load-test.md).

A row reads like a submission (``row._id``, ``row.submission_data``, ...) but
can't be changed, and has nothing else: what changes submissions, or shows
them in full, loads them whole.
"""

from typing import cast
from uuid import UUID

from sqlalchemy.orm import Query, Session

from database.models import SubmissionCurrent

COLUMNS = (
    SubmissionCurrent._id,
    SubmissionCurrent._submission_time,
    SubmissionCurrent.submission_data,
    SubmissionCurrent.data_quality_issues,
    SubmissionCurrent.question_seconds,
    SubmissionCurrent.kobo_validation_status,
    SubmissionCurrent.dk_count,
    SubmissionCurrent.dk_eligible_count,
    SubmissionCurrent.llm_check_status,
)


def survey_rows(db: Session, survey_id: UUID) -> Query[SubmissionCurrent]:
    """The survey's submissions as rows; filter them as you would submissions."""
    query = db.query(*COLUMNS).filter(SubmissionCurrent.survey_id == survey_id)
    # Typed as submissions: the pages' functions read only these columns.
    return cast("Query[SubmissionCurrent]", query)


def whole(db: Session, survey_id: UUID, rows: list[SubmissionCurrent]) -> list[SubmissionCurrent]:
    """The survey's submissions these rows are, loaded whole, in the same order."""
    ids = [row._id for row in rows]
    if not ids:
        return []
    by_id = {
        sub._id: sub
        for sub in db.query(SubmissionCurrent).filter(
            SubmissionCurrent.survey_id == survey_id, SubmissionCurrent._id.in_(ids)
        )
    }
    return [by_id[i] for i in ids if i in by_id]
