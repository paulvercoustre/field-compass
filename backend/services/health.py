"""
Whether Field Compass is working, for an uptime monitor: GET /api/health.

/health (main.py) only says the API answers and reaches its database: the
deploy script and CI ask it, with no worker running. /api/health also checks
Redis, which carries every background job, and that the scheduled tasks ran
recently: the five-minute sweep (services/transcription_worker.py) records a
heartbeat. It also checks the disk the database lives on, the VM's, which on
one machine is what usually fills up and stops everything. Both answer 503
when something is down, so a monitor alerts on the status code alone.
docs/monitoring.md sets the monitor up.
"""

from __future__ import annotations

import logging
import shutil
import time
from dataclasses import dataclass

import redis

from services.database import init_db
from settings import get_settings

logger = logging.getLogger(__name__)

HEARTBEAT_KEY = "field-compass:heartbeat:scheduled-tasks"
# Three missed five-minute sweeps.
STALE_AFTER_SECONDS = 15 * 60
# The share of the disk in use past which the check fails: room to act before
# Postgres stops writing.
DISK_FULL_SHARE = 0.9
_STARTED = time.time()


@dataclass(frozen=True)
class Health:
    database: bool
    redis: bool
    # ok | stalled | starting (no heartbeat yet, the API just started) | unknown (no Redis)
    scheduled_tasks: str
    disk_used: float = 0.0

    @property
    def healthy(self) -> bool:
        return (
            self.database
            and self.redis
            and self.scheduled_tasks in ("ok", "starting")
            and self.disk_used < DISK_FULL_SHARE
        )

    def as_dict(self) -> dict[str, str]:
        return {
            "status": "healthy" if self.healthy else "unhealthy",
            "database": "connected" if self.database else "disconnected",
            "redis": "connected" if self.redis else "disconnected",
            "scheduled_tasks": self.scheduled_tasks,
            "disk": f"{round(self.disk_used * 100)}% used",
        }


def _redis() -> redis.Redis:
    return redis.Redis.from_url(
        get_settings().celery_broker_url, socket_timeout=2, socket_connect_timeout=2
    )


def record_heartbeat() -> None:
    """Called by the scheduled sweep: the scheduled tasks are running."""
    try:
        _redis().set(HEARTBEAT_KEY, int(time.time()), ex=24 * 3600)
    except redis.RedisError as error:
        logger.warning("Could not record the scheduled tasks' heartbeat: %s", error)


def disk_used() -> float:
    """The share of this machine's disk in use (a container sees its host's)."""
    usage = shutil.disk_usage("/")
    return usage.used / usage.total if usage.total else 0.0


def check(now: float | None = None) -> Health:
    now = now or time.time()
    database = init_db()
    disk = disk_used()
    try:
        client = _redis()
        client.ping()
        stored = client.get(HEARTBEAT_KEY)
    except redis.RedisError:
        return Health(database, False, "unknown", disk)
    if isinstance(stored, (bytes, str)):
        fresh = now - int(stored) < STALE_AFTER_SECONDS
        return Health(database, True, "ok" if fresh else "stalled", disk)
    # Redis restarted with the VM, or the very first deploy: give the sweep its time.
    starting = now - _STARTED < STALE_AFTER_SECONDS
    return Health(database, True, "starting" if starting else "stalled", disk)
