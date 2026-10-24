"""
The data pages' answers, worked out once and reused until the survey changes.

Progress, Data quality, Field team and the review queue each read every
submission of a survey and add them up, and the people of a team ask for the
same pages: each one worked the same numbers out again (docs/load-test.md).
Now an answer is kept in Redis for ten minutes, under a key made of
everything it was worked out from:

- the page and its filters;
- a fingerprint of the survey's submissions and recordings: how many there
  are, and the sum of each row's xmin, the number of the transaction that
  wrote its current version. Every change to a row writes a new version, so a
  pull, an edit, a review decision or a note gives a new fingerprint, and the
  next request works the answer out afresh. Nothing has to remember to clear
  anything;
- the survey's settings, the day (Progress counts the last week) and the
  deployed release.

The fingerprint is read before the submissions, so an answer is never older
than its key. Without Redis, or on SQLite (the tests' database, which has no
xmin), every request works its answer out as before.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from collections.abc import Callable
from datetime import UTC, datetime
from functools import lru_cache
from typing import Any, Protocol, TypeVar

import orjson
import redis
from pydantic import BaseModel, ValidationError
from sqlalchemy import text
from sqlalchemy.orm import Session

from database.models import SurveyConfig
from services.monitoring import release
from settings import get_settings

logger = logging.getLogger(__name__)

EXPIRES_SECONDS = 600
PREFIX = "page:"

_FINGERPRINT = text(
    """
    SELECT
      (SELECT count(*) || ':' || coalesce(sum(xmin::text::bigint), 0)
         FROM submissions_current WHERE survey_id = :survey_id),
      (SELECT count(*) || ':' || coalesce(sum(xmin::text::bigint), 0)
         FROM audio_transcripts WHERE survey_id = :survey_id)
    """
)

M = TypeVar("M", bound=BaseModel)


class Store(Protocol):
    def get(self, name: str) -> Any: ...
    def set(self, name: str, value: str, ex: int) -> Any: ...


@lru_cache
def _store() -> Store:
    """One client per process, made on first use: after uvicorn starts its workers."""
    return redis.Redis.from_url(
        get_settings().celery_broker_url, socket_timeout=0.5, socket_connect_timeout=0.5
    )


_last_warning = {"at": 0.0}


def _warn(error: Exception) -> None:
    """Once a minute at most: Redis down would otherwise log every request."""
    if time.monotonic() - _last_warning["at"] > 60:
        _last_warning["at"] = time.monotonic()
        logger.warning("Page answers not kept, Redis unavailable: %s", error)


def fingerprint(db: Session, survey_id: Any) -> str | None:
    """The survey's submissions and recordings as they stand; None where there is no xmin."""
    if db.get_bind().dialect.name != "postgresql":
        return None
    submissions, recordings = db.execute(_FINGERPRINT, {"survey_id": survey_id}).one()
    return f"{submissions}/{recordings}"


def _settings_digest(config: Any) -> str:
    try:
        encoded = orjson.dumps(config, option=orjson.OPT_SORT_KEYS)
    except TypeError:  # an integer orjson can't write; the standard library can
        encoded = json.dumps(config, sort_keys=True, default=str).encode()
    return hashlib.sha256(encoded).hexdigest()


def key(survey: SurveyConfig, page: str, params: dict[str, Any], version: str) -> str:
    material = [
        release(),
        page,
        str(survey.survey_id),
        version,
        _settings_digest(survey.config_data),
        datetime.now(UTC).date().isoformat(),
        params,
    ]
    encoded = json.dumps(material, sort_keys=True, default=str).encode()
    return PREFIX + hashlib.sha256(encoded).hexdigest()


def cached(
    db: Session,
    survey: SurveyConfig,
    page: str,
    params: dict[str, Any],
    model: type[M],
    work_out: Callable[[], M],
) -> M:
    """The page's answer for these filters: kept, or worked out and kept."""
    version = fingerprint(db, survey.survey_id)
    if version is None:
        return work_out()
    name = key(survey, page, params, version)
    store = _store()
    try:
        kept = store.get(name)
    except redis.RedisError as error:
        _warn(error)
        return work_out()
    if kept is not None:
        try:
            return model.model_validate_json(kept)
        except ValidationError:
            pass  # kept by a release that shaped it differently: work it out again
    answer = work_out()
    try:
        store.set(name, answer.model_dump_json(by_alias=True), ex=EXPIRES_SECONDS)
    except redis.RedisError as error:
        _warn(error)
    return answer
