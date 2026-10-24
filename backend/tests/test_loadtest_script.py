"""
scripts/loadtest.py runs on the production database: it must make only what
it says, and clean up only that.
"""

import importlib.util
from datetime import datetime
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy.orm import sessionmaker

from database.models import SubmissionCurrent, SurveyAccess, SurveyConfig, User
from services.auth import decode_access_token

_spec = importlib.util.spec_from_file_location(
    "loadtest", Path(__file__).parent.parent / "scripts" / "loadtest.py"
)
assert _spec and _spec.loader
loadtest = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(loadtest)


@pytest.fixture
def sessions(test_db, monkeypatch):
    factory = sessionmaker(bind=test_db.get_bind(), autoflush=False)
    monkeypatch.setattr(loadtest, "SessionLocal", factory)
    return factory


def test_seed_pull_and_clean_up_only_what_it_made(test_db, sessions, test_survey_config):
    someone = User(user_id=uuid4(), email="real@example.org", username="real")
    test_db.add(someone)
    test_db.add(
        SubmissionCurrent(
            _id=123,
            _uuid="real-1",
            survey_id=test_survey_config.survey_id,
            _submission_time=datetime(2026, 10, 1),
            end=datetime(2026, 10, 1),
            submission_data={},
        )
    )
    test_db.commit()

    made = loadtest.seed(teams=2, members=2, submissions=20, token_hours=1)

    accounts = test_db.query(User).filter(User.email.like(f"%@{loadtest.DOMAIN}")).all()
    assert len(accounts) == 4 and len(made["accounts"]) == 4
    first = decode_access_token(made["accounts"][0]["token"])
    assert first is not None and first.email.endswith(loadtest.DOMAIN)
    surveys = test_db.query(SurveyConfig).filter(SurveyConfig.kobo_asset_id.like("loadtest%")).all()
    assert len(surveys) == 2
    assert test_db.query(SurveyAccess).count() == 2  # the second member of each team
    ids = [row._id for row in test_db.query(SubmissionCurrent).filter(SubmissionCurrent._id != 123)]
    assert len(ids) == 40 and min(ids) >= loadtest.FIRST_ID

    loadtest.pulls(minutes=0, every=0, new=5, edits=2)  # one pull, then time is up
    test_db.expire_all()
    assert test_db.query(SubmissionCurrent).filter(SubmissionCurrent._id != 123).count() == 45

    loadtest.cleanup()
    test_db.expire_all()
    assert test_db.query(User).filter(User.email.like(f"%@{loadtest.DOMAIN}")).count() == 0
    assert (
        test_db.query(SurveyConfig).filter(SurveyConfig.kobo_asset_id.like("loadtest%")).count()
        == 0
    )
    assert test_db.query(SubmissionCurrent).count() == 1  # the real one
    assert test_db.get(User, someone.user_id) is not None


def test_stops_before_touching_a_real_submission(test_db, sessions, test_survey_config):
    test_db.add(
        SubmissionCurrent(
            _id=loadtest.FIRST_ID + 1_000_001,
            _uuid="real-big",
            survey_id=test_survey_config.survey_id,
            _submission_time=datetime(2026, 10, 1),
            end=datetime(2026, 10, 1),
            submission_data={},
        )
    )
    test_db.commit()
    with pytest.raises(SystemExit, match="would clash"):
        loadtest.seed(teams=1, members=1, submissions=5, token_hours=1)
    assert test_db.query(User).count() == 0
