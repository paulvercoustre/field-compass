"""
Check registry.

Checks register themselves with ``@lint_check`` when their module is imported.
``linter.checks`` is the import that actually loads them; the engine imports
that package so a new file dropped into ``checks/`` is enough, with no list
to keep in sync.
"""

from collections.abc import Iterable
from functools import wraps
from typing import Any

from linter.models import CheckFunc, RegisteredCheck

_CHECKS: dict[str, RegisteredCheck] = {}


def lint_check(
    check_id: str,
    *,
    severity: str,
    tags: tuple[str, ...] = (),
) -> Any:
    """Register a check function. Signature: ``(schema, ctx) -> Iterable[LintFinding]``."""

    def decorator(func: CheckFunc) -> CheckFunc:
        if check_id in _CHECKS:
            raise ValueError(f"Duplicate lint check id: {check_id}")
        _CHECKS[check_id] = RegisteredCheck(
            check_id=check_id,
            severity=severity,
            tags=tuple(tags),
            func=func,
        )

        @wraps(func)
        def wrapped(*args: Any, **kwargs: Any) -> Any:
            return func(*args, **kwargs)

        wrapped.check_id = check_id  # type: ignore[attr-defined]
        wrapped.severity = severity  # type: ignore[attr-defined]
        return wrapped

    return decorator


def iter_checks() -> Iterable[RegisteredCheck]:
    """Registered checks in a stable order (id, alphabetically)."""
    return tuple(_CHECKS[key] for key in sorted(_CHECKS))


def get_check(check_id: str) -> RegisteredCheck | None:
    return _CHECKS.get(check_id)


def registered_ids() -> tuple[str, ...]:
    return tuple(sorted(_CHECKS))
