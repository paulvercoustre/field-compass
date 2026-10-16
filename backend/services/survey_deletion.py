"""
Deleting a survey and everything stored for it.

One place for it, because two things delete surveys: the owner deleting one,
and an account being deleted, which takes every survey it owns with it. A
survey left behind with no owner would keep its respondents' answers with no
one to ask for them to be removed.
"""

from sqlalchemy.orm import Session

from database.models import SubmissionCurrent, SurveyConfig, ValidationRule


def delete_survey_and_data(db: Session, survey: SurveyConfig) -> tuple[int, int]:
    """
    Delete the survey and its data, in the caller's transaction; the caller
    commits.

    Submissions are deleted here because their foreign key is RESTRICT; their
    edit history, and the survey's access, runs, transcripts, translations,
    AI usage and notifications, go with them by cascade.

    Returns the number of submissions and of validation rules deleted.
    """
    submissions = db.query(SubmissionCurrent).filter(
        SubmissionCurrent.survey_id == survey.survey_id
    )
    submissions_count = submissions.count()
    if submissions_count:
        submissions.delete()

    rules = db.query(ValidationRule).filter(ValidationRule.survey_id == survey.survey_id)
    rules_count = rules.count()
    if rules_count:
        rules.delete()

    db.delete(survey)
    return submissions_count, rules_count
