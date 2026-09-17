"""Load a FormSchema from a stored survey config or a raw form payload."""

from typing import Any

from database.models import SurveyConfig
from forms.schema import FormSchema, load_form_schema


def schema_from_payload(payload: Any) -> FormSchema:
    """Accept a kobo_tool, an asset content block, or a full asset payload."""
    if not payload:
        return FormSchema()
    return load_form_schema(payload)


def schema_from_survey(survey: SurveyConfig) -> FormSchema:
    config = survey.config_data or {}
    return schema_from_payload(config.get("kobo_tool"))
