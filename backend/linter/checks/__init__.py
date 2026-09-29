"""Import every check module so ``@lint_check`` registrations run."""

from linter.checks import constraints, flow, setup, translations  # noqa: F401

__all__ = ["constraints", "flow", "setup", "translations"]
