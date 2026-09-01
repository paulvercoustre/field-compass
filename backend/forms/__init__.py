"""
Survey instrument (XLSForm) introspection.

Deliberately kept out of the ``etl`` package: ``etl/__init__.py`` eagerly
imports the whole pipeline, so anything living there transitively pulls in
requests, pandas, celery, and openai. This package is stdlib-only, so the
linter and the config suggester can build on it without dragging the ETL
stack -- or its dependencies -- into their tests.
"""

from forms.schema import (
    DEFAULT_LANGUAGE,
    DIALECT_API,
    DIALECT_XLSX,
    Choice,
    FormSchema,
    Question,
    load_form_schema,
    split_type,
    strip_repeat_indices,
)

__all__ = [
    "DEFAULT_LANGUAGE",
    "DIALECT_API",
    "DIALECT_XLSX",
    "Choice",
    "FormSchema",
    "Question",
    "load_form_schema",
    "split_type",
    "strip_repeat_indices",
]
