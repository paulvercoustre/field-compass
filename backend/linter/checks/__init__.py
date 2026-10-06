"""Import every check module so ``@lint_check`` registrations run."""

from linter.checks import constraints, flow, setup, translations

__all__ = ["constraints", "flow", "setup", "translations"]
