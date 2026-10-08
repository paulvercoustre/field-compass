"""
A Kobo form as a survey stores it, in ``config_data["kobo_tool"]``.

The stored shape is XLSForm sheet rows: one per question, translations in
``label::<language>`` columns, the way an uploaded XLSForm used to arrive.
Group and repeat rows are not kept; what the app needs from them travels on
each question instead: the group's path, the conditions it puts on the
question, and its label.

Built here for both ways a form arrives: the Kobo form endpoint, whose rows
the create and settings screens save, and every pull, which keeps the stored
copy in step with the form in Kobo.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from database.models import SurveyConfig
from forms import DEFAULT_LANGUAGE, FormSchema, load_form_schema
from forms.schema import GROUP_OPEN_TYPES
from linter.questions import enclosing_relevants

logger = logging.getLogger(__name__)


def label_column(language: str, prefix: str = "label") -> str:
    """The column a translation is stored in: ``label::English (en)``, or ``label`` for an untranslated form."""
    return prefix if not language or language == DEFAULT_LANGUAGE else f"{prefix}::{language}"


def _label_columns(labels: dict[str, str], prefix: str = "label") -> dict[str, str]:
    return {label_column(language, prefix): text for language, text in labels.items()}


def stored_form(schema: FormSchema) -> dict[str, Any]:
    """The form's question and choice rows, and whether it keeps an audit log."""
    group_labels = {
        row.path: row.label for row in schema.questions if row.type in GROUP_OPEN_TYPES and row.path
    }

    survey: list[dict[str, Any]] = []
    for question in schema.questions:
        # Notes are kept: a submission's answers show them where the
        # enumerator saw them.
        if not question.name or question.is_structural:
            continue
        row: dict[str, Any] = {
            "type": question.type,
            "name": question.name,
            **_label_columns(question.label),
            "roster_name": question.repeat_name,
            "list_name": question.list_name,
        }
        optional = {
            "required": "yes" if question.required else None,
            "constraint": question.constraint,
            "relevant": question.relevant,
            "calculation": question.calculation,
            "choice_filter": (question.raw or {}).get("choice_filter") or None,
            # The groups around the question: their path, and the conditions
            # they put on it (a consent gate, usually), which the checks'
            # skip logic and the linter read.
            "group_path": question.group_path or None,
            "group_relevant": enclosing_relevants(schema, question),
        }
        row.update({key: value for key, value in optional.items() if value})
        # `group_label::English (en)`: the title of the group it sits in.
        row.update(_label_columns(group_labels.get(question.group_path, {}), "group_label"))
        survey.append(row)

    choices = [
        # The form's own columns first, so they can never replace the name or a label.
        {
            **choice.columns(),
            "list_name": list_name,
            "name": choice.name,
            **_label_columns(choice.label),
        }
        for list_name, list_choices in schema.choices_by_list.items()
        for choice in list_choices
    ]
    return {"survey": survey, "choices": choices, "has_audit": schema.has_audit}


def refresh_stored_form(survey: SurveyConfig, fetch_asset: Callable[[str], Any]) -> bool:
    """
    Bring the survey's stored form in step with its Kobo project; True when
    it changed. The label language chosen in Settings is kept.

    Best effort: when Kobo can't be read, or has no form, the stored copy
    stays as it is and the pull goes on with it.
    """
    if not survey.kobo_asset_id:
        return False
    try:
        schema = load_form_schema(fetch_asset(survey.kobo_asset_id))
    except Exception as exc:  # noqa: BLE001 -- a stale form must not stop a pull
        logger.warning("Could not read the form of %s from Kobo: %s", survey.kobo_asset_id, exc)
        return False
    if schema.is_empty:
        return False

    fresh = stored_form(schema)
    config = dict(survey.config_data or {})
    stored = config.get("kobo_tool") or {}
    if all(stored.get(key) == value for key, value in fresh.items()):
        return False
    # An old nested copy (`{"content": {...}}`) would be read before the rows.
    kept = {key: value for key, value in stored.items() if key != "content"}
    config["kobo_tool"] = {**kept, **fresh}
    survey.config_data = config
    return True
