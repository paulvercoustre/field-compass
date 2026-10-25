"""
The API won't start outside development with a JWT secret anyone can read:
the default in settings.py and the .env.example placeholder are public.

Checked when services.auth is imported, so each case imports it afresh in
its own interpreter.
"""

import os
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]


def _start(**env: str) -> subprocess.CompletedProcess:
    clean = {k: v for k, v in os.environ.items() if k not in ("ENVIRONMENT", "JWT_SECRET_KEY")}
    return subprocess.run(
        [sys.executable, "-c", "import services.auth"],
        cwd=BACKEND,
        env={**clean, **env},
        capture_output=True,
        check=False,
        text=True,
    )


@pytest.mark.parametrize("secret", [None, "generate_me_openssl_rand_hex_32"])
def test_a_public_secret_stops_the_api_outside_development(secret):
    env = {"ENVIRONMENT": "production"}
    if secret:
        env["JWT_SECRET_KEY"] = secret
    started = _start(**env)
    assert started.returncode != 0
    assert "JWT_SECRET_KEY" in started.stderr


def test_a_secret_of_its_own_starts():
    assert _start(ENVIRONMENT="production", JWT_SECRET_KEY="a" * 64).returncode == 0


def test_development_runs_without_one():
    assert _start(ENVIRONMENT="development").returncode == 0
