"""Load a FormSchema from a stored survey config or a raw form payload."""

import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from database.models import SurveyConfig
from forms.schema import FormSchema, load_form_schema

logger = logging.getLogger(__name__)

# Sheet columns the constraint checks and the consent walk read. Forms linked
# to Kobo before the linter shipped were stored without any of them.
LOGIC_COLUMNS = ("required", "constraint", "relevant", "calculation", "group_relevant")


@dataclass
class SurveyForm:
    schema: FormSchema
    # True when the only copy we could read has no skip logic, constraints,
    # or required flags at all -- so checks that read them would report every
    # question as unconstrained rather than saying nothing.
    logic_missing: bool = False


def schema_from_payload(payload: Any) -> FormSchema:
    """Accept a kobo_tool, an asset content block, or a full asset payload."""
    if not payload:
        return FormSchema()
    return load_form_schema(payload)


def stored_form_has_logic(payload: Any) -> bool:
    """Whether any stored survey row carries one of the logic columns."""
    if not isinstance(payload, dict):
        return False
    content = payload.get("content") if isinstance(payload.get("content"), dict) else payload
    for row in content.get("survey") or []:
        if not isinstance(row, dict):
            continue
        for column in LOGIC_COLUMNS:
            value = row.get(column)
            if value not in (None, "", [], False):
                return True
    return False


def load_survey_form(
    survey: SurveyConfig,
    fetch_live: Callable[[str], Any] | None = None,
) -> SurveyForm:
    """
    The stored form, or the live Kobo form when the stored copy has no logic.

    ``fetch_live`` takes the asset UID and returns the Kobo asset payload; it
    is only called for a stored form with none of :data:`LOGIC_COLUMNS`. A
    form that genuinely has no logic costs one extra fetch and lints the same.
    """
    stored = (survey.config_data or {}).get("kobo_tool")
    schema = schema_from_payload(stored)
    if schema.is_empty or stored_form_has_logic(stored):
        return SurveyForm(schema=schema)

    if fetch_live is not None and survey.kobo_asset_id:
        try:
            live = schema_from_payload(fetch_live(survey.kobo_asset_id))
        except Exception as exc:
            logger.warning("Live form fetch for lint failed (%s): %s", survey.kobo_asset_id, exc)
        else:
            if not live.is_empty:
                return SurveyForm(schema=live)

    return SurveyForm(schema=schema, logic_missing=True)
