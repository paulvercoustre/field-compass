"""
Design-time form linter.

Runs on an XLSForm that already deploys (pyxform / Kobo have said yes) and
reports the properties that silently disable Field Compass checks or let
avoidable field errors through. No LLM in this package: every check is a
pure function of ``FormSchema``.
"""

from linter.engine import run_lint
from linter.models import LintContext, LintFinding, LintReport

__all__ = [
    "LintContext",
    "LintFinding",
    "LintReport",
    "run_lint",
]
