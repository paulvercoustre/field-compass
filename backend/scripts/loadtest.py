#!/usr/bin/env python3
"""
Synthetic accounts and surveys for a load test (docs/load-test.md), on the
server under test. Nothing here reaches Kobo, an AI provider or anyone's
inbox: submissions are made up and pulled through the real pipeline with a
stand-in for Kobo, AI checks are off, and the accounts' addresses are on
loadtest.fieldcompass.invalid, a domain that can't receive mail.

On the VM:

    C="docker compose -f docker-compose.prod.yml"
    $C exec backend python scripts/loadtest.py seed > loadtest.json
    $C exec backend python scripts/loadtest.py pulls --minutes 20   # during the test
    $C exec backend python scripts/loadtest.py cleanup              # afterwards

``seed`` makes teams of accounts, each team sharing one survey (owned by its
first member, the others reviewers), pulls synthetic submissions into it,
and prints, as JSON, a short-lived token per account for the load generator.
``pulls`` pulls new and edited submissions into random team surveys, as
teams in the field would. ``cleanup`` deletes every account on the load-test
domain, with its surveys and everything recorded about it.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import or_

from database.models import (
    AppEvent,
    SubmissionCurrent,
    SurveyAccess,
    SurveyConfig,
    User,
    ValidationRule,
)
from etl.pipeline import ETLPipeline, PipelineTasks
from services.auth import create_access_token
from services.database import SessionLocal
from services.survey_deletion import delete_survey_and_data

DOMAIN = "loadtest.fieldcompass.invalid"
# Submission IDs are unique across every survey, so the made-up ones live far
# above Kobo's (in the hundreds of millions in 2026) and below the column's
# limit (2,147,483,647): 2,0TT,NNN,NNN for submission N of team TT.
FIRST_ID = 2_000_000_000
ENUMERATORS = [f"EN{n:02d}" for n in range(1, 16)]
VILLAGES = ["Abala", "Bambara", "Chetimari", "Dogo", "Erouf", "Falwel", "Gouré"]
RULES = [
    ("Respondent over 90", "age > 90", ["age"]),
    ("Respondent under 18", "age < 18", ["age"]),
    ("Negative income", "income < 0", ["income"]),
    ("Very large household", "household_size > 20", ["household_size"]),
    ("No household members", "household_size == 0", ["household_size"]),
    ("Village missing", "is_empty(village)", ["village"]),
]


class _Never:
    """A pull here sends no background job: AI, transcription and translation are off."""

    @staticmethod
    def apply_async(*args: Any, **kwargs: Any) -> None:
        raise RuntimeError("the load-test surveys have no AI, transcription or translation")


class _StandInKobo:
    """Answers the pipeline as Kobo would, from submissions made up here."""

    def __init__(self, submissions: list[dict[str, Any]]):
        self.submissions = submissions

    def get_asset_submissions(self, **_: Any) -> list[dict[str, Any]]:
        return self.submissions

    def get_asset_info(self, asset_uid: str) -> dict[str, Any]:
        return {}


def _config() -> dict[str, Any]:
    today = datetime.utcnow().date()
    return {
        "core_identifiers": {
            "uuid": "_uuid",
            "enumerator": "enumerator_id",
            "date_interview": "today",
            "start_time": "start",
            "end_time": "end",
        },
        "special_values": {"dk_value": -99, "dk_string_value": "dk"},
        "global_parameters": {
            "data_collection_start_date": str(today - timedelta(days=60)),
            "data_collection_end_date": str(today + timedelta(days=30)),
            "min_survey_duration_minutes": 10,
            "max_survey_duration_minutes": 120,
        },
        "quality_checks": {"flag_llm_qualitative": False},
    }


def _submission(survey_n: int, n: int, rng: random.Random, edited: bool = False) -> dict[str, Any]:
    """One made-up interview; about one in ten trips a rule or a duration check."""
    sent = datetime.utcnow() - timedelta(minutes=rng.randint(0, 30 * 24 * 60))
    minutes = rng.choice([rng.randint(15, 60)] * 9 + [rng.randint(2, 8)])
    start = sent - timedelta(minutes=minutes)
    odd = rng.random() < 0.1
    return {
        "_id": FIRST_ID + survey_n * 1_000_000 + n,
        "_uuid": f"loadtest-{survey_n}-{n}",
        "_submission_time": sent.strftime("%Y-%m-%dT%H:%M:%S"),
        "start": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "end": sent.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "today": sent.strftime("%Y-%m-%d"),
        "enumerator_id": rng.choice(ENUMERATORS),
        "age": rng.choice([95, 12]) if odd else rng.randint(18, 85),
        "income": -50 if odd and rng.random() < 0.3 else rng.randint(0, 400_000),
        "household_size": rng.randint(1, 12),
        "village": "" if odd and rng.random() < 0.3 else rng.choice(VILLAGES),
        "comments": "Corrected after a call back." if edited else "Interview went well.",
    }


def _pull(db, survey: SurveyConfig, submissions: list[dict[str, Any]]) -> dict[str, Any]:
    tasks = PipelineTasks(ai_review=_Never, transcription=_Never, translation=_Never)
    pipeline = ETLPipeline(db, kobo_fetcher=_StandInKobo(submissions), tasks=tasks)
    return pipeline.run_pipeline(str(survey.survey_id))


def _stored(db, survey: SurveyConfig) -> list[dict[str, Any]]:
    rows = db.query(SubmissionCurrent).filter(SubmissionCurrent.survey_id == survey.survey_id)
    return [row.submission_data for row in rows]


def _ids_free(db) -> None:
    """Stop before a made-up submission could land on a real one."""
    taken = (
        db.query(SubmissionCurrent._id)
        .join(SurveyConfig, SurveyConfig.survey_id == SubmissionCurrent.survey_id)
        .filter(SubmissionCurrent._id >= FIRST_ID, ~SurveyConfig.kobo_asset_id.like("loadtest%"))
        .first()
    )
    if taken:
        raise SystemExit(f"A real submission has ID {taken[0]}: the load test's IDs would clash.")


def seed(teams: int, members: int, submissions: int, token_hours: int) -> dict[str, Any]:
    if not 1 <= teams <= 99 or not 1 <= submissions < 1_000_000:
        raise SystemExit("Up to 99 teams and 999,999 submissions per survey.")
    rng = random.Random(42)
    out: dict[str, Any] = {"made_at": datetime.utcnow().isoformat() + "Z", "accounts": []}
    with SessionLocal() as db:
        if db.query(User).filter(User.email.like(f"%@{DOMAIN}")).first():
            raise SystemExit("Load-test accounts already exist: run cleanup first.")
        _ids_free(db)
        for team in range(1, teams + 1):
            people = []
            for member in range(1, members + 1):
                user = User(
                    user_id=uuid4(),
                    email=f"team{team:02d}-{member}@{DOMAIN}",
                    username=f"loadtest-{team:02d}-{member}",
                    full_name=f"Load test {team:02d}-{member}",
                    email_verified_at=datetime.utcnow(),
                    terms_accepted_at=datetime.utcnow(),
                )
                db.add(user)
                people.append(user)
            db.flush()
            survey = SurveyConfig(
                survey_id=uuid4(),
                survey_name=f"Load test survey {team:02d}",
                kobo_asset_id=f"loadtest{team:02d}",
                user_id=people[0].user_id,
                config_data=_config(),
            )
            db.add(survey)
            db.flush()
            for name, expression, variables in RULES:
                db.add(
                    ValidationRule(
                        survey_id=survey.survey_id,
                        rule_name=name,
                        rule_data={
                            "issue": name,
                            "check_id": name.lower().replace(" ", "_"),
                            "check_expression": expression,
                            "variables_involved": variables,
                        },
                    )
                )
            for person in people[1:]:
                db.add(
                    SurveyAccess(
                        survey_id=survey.survey_id,
                        user_id=person.user_id,
                        permission_level="editor",
                        granted_by=people[0].user_id,
                    )
                )
            db.commit()
            started = time.time()
            stats = _pull(db, survey, [_submission(team, n, rng) for n in range(submissions)])
            print(
                f"team {team:02d}: {stats.get('processed', submissions)} submissions "
                f"in {time.time() - started:.0f}s",
                file=sys.stderr,
            )
            for person in people:
                token = create_access_token(
                    data={"sub": str(person.user_id), "email": person.email},
                    expires_delta=timedelta(hours=token_hours),
                )
                out["accounts"].append({"token": token, "survey_id": str(survey.survey_id)})
    return out


def pulls(minutes: float, every: float, new: int, edits: int) -> None:
    """New and edited submissions into random load-test surveys, one pull at a time."""
    rng = random.Random()
    ends = time.time() + minutes * 60
    while True:
        with SessionLocal() as db:
            _ids_free(db)
            surveys = (
                db.query(SurveyConfig).filter(SurveyConfig.kobo_asset_id.like("loadtest%")).all()
            )
            if not surveys:
                raise SystemExit("No load-test surveys: run seed first.")
            survey = rng.choice(surveys)
            team = int(survey.kobo_asset_id.removeprefix("loadtest"))
            current = _stored(db, survey)
            for item in rng.sample(current, min(edits, len(current))):
                item.update(_submission(team, item["_id"] % 1_000_000, rng, edited=True))
            first = max((item["_id"] % 1_000_000 for item in current), default=-1) + 1
            current += [_submission(team, n, rng) for n in range(first, first + new)]
            started = time.time()
            _pull(db, survey, current)
            print(
                f"{survey.survey_name}: {len(current)} submissions, {new} new and {edits} "
                f"edited, in {time.time() - started:.1f}s",
                file=sys.stderr,
            )
        if time.time() + every >= ends:
            return
        time.sleep(every)


def cleanup() -> None:
    with SessionLocal() as db:
        users = db.query(User).filter(User.email.like(f"%@{DOMAIN}")).all()
        ids = [user.user_id for user in users]
        if not ids:
            print("Nothing to clean up.", file=sys.stderr)
            return
        surveys = db.query(SurveyConfig).filter(SurveyConfig.user_id.in_(ids)).all()
        survey_ids = [survey.survey_id for survey in surveys]
        db.query(AppEvent).filter(
            or_(AppEvent.user_id.in_(ids), AppEvent.survey_id.in_(survey_ids))
        ).delete(synchronize_session=False)
        for survey in surveys:
            delete_survey_and_data(db, survey)
        for user in users:
            db.delete(user)
        db.commit()
        print(f"Deleted {len(users)} accounts and {len(surveys)} surveys.", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    commands = parser.add_subparsers(dest="command", required=True)
    seeding = commands.add_parser("seed", help="make the accounts and surveys; print the tokens")
    seeding.add_argument("--teams", type=int, default=15)
    seeding.add_argument("--members", type=int, default=3)
    seeding.add_argument("--submissions", type=int, default=2000, help="per survey")
    seeding.add_argument("--token-hours", type=int, default=4)
    pulling = commands.add_parser("pulls", help="pull new and edited submissions meanwhile")
    pulling.add_argument("--minutes", type=float, default=20)
    pulling.add_argument("--every", type=float, default=20, help="seconds between pulls")
    pulling.add_argument("--new", type=int, default=50)
    pulling.add_argument("--edits", type=int, default=10)
    commands.add_parser("cleanup", help="delete every load-test account and survey")
    args = parser.parse_args()

    if args.command == "seed":
        print(json.dumps(seed(args.teams, args.members, args.submissions, args.token_hours)))
    elif args.command == "pulls":
        pulls(args.minutes, args.every, args.new, args.edits)
    else:
        cleanup()


if __name__ == "__main__":
    main()
