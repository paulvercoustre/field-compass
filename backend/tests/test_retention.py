"""Usage records are kept for the retention period, then deleted."""

from datetime import datetime

import pytest

from database.models import AIUsage, AppEvent
from services import app_events
from services.retention_worker import delete_old_usage_records, months_before

NOW = datetime(2026, 10, 16, 3, 30)


@pytest.mark.parametrize(
    ("moment", "months", "expected"),
    [
        (datetime(2026, 10, 16, 3, 30), 24, datetime(2024, 10, 16, 3, 30)),
        (datetime(2026, 1, 15), 1, datetime(2025, 12, 15)),
        (datetime(2026, 3, 31), 1, datetime(2026, 2, 28)),
        (datetime(2028, 2, 29), 24, datetime(2026, 2, 28)),
        (datetime(2026, 12, 1), 12, datetime(2025, 12, 1)),
    ],
)
def test_months_before(moment, months, expected):
    assert months_before(moment, months) == expected


def test_records_past_the_period_are_deleted_and_the_rest_kept(test_db, test_survey_config):
    survey_id = test_survey_config.survey_id
    old, recent = datetime(2024, 10, 15), datetime(2024, 10, 17)
    for created_at in (old, recent):
        test_db.add(AppEvent(kind=app_events.LOGIN, created_at=created_at))
        test_db.add(
            AppEvent(
                kind=app_events.STAFF_SURVEY_ACCESS, survey_id=survey_id, created_at=created_at
            )
        )
        test_db.add(
            AIUsage(
                survey_id=survey_id,
                feature="qualitative_check",
                model="m",
                outcome="ok",
                created_at=created_at,
            )
        )
    test_db.commit()

    assert delete_old_usage_records(test_db, now=NOW, months=24) == (2, 1)

    assert {e.created_at for e in test_db.query(AppEvent)} == {recent}
    assert {u.created_at for u in test_db.query(AIUsage)} == {recent}
    # Nothing left to delete the second night.
    assert delete_old_usage_records(test_db, now=NOW, months=24) == (0, 0)


def test_the_period_comes_from_the_settings(test_db, monkeypatch):
    test_db.add(AppEvent(kind=app_events.LOGIN, created_at=datetime(2026, 4, 1)))
    test_db.commit()

    assert delete_old_usage_records(test_db, now=NOW) == (0, 0)  # 24 months by default

    monkeypatch.setenv("USAGE_RETENTION_MONTHS", "6")
    assert delete_old_usage_records(test_db, now=NOW) == (1, 0)
