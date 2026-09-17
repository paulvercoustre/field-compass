"""Import every check module so ``@lint_check`` registrations run."""

from linter.checks import constraints, setup  # noqa: F401

__all__ = ["constraints", "setup"]
