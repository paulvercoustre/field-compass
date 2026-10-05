"""
The validation and AI-rules hashes must not move when only the code reading
the config changes.

Every submission stores the hash it was checked under; a different hash on
the next pull revalidates the whole survey. These values were computed before
the quality-check settings were typed (services/survey_config.py): a stored
50 must stay 50, an explicit null must stay null, and a value of the wrong
type must reach the hash as it was stored.
"""

from uuid import uuid4

import pytest

from database.models import SurveyConfig
from etl.hfc_engine import HFCEngine
from utils.rule_versioning import generate_llm_rules_hash

CONFIGS = {
    "empty": {},
    "typical": {
        "core_identifiers": {"enumerator": "enum", "date_interview": "today"},
        "special_values": {"dk_value": [-99, -98], "dk_string_value": ["dk", "refused"]},
        "global_parameters": {
            "data_collection_start_date": "2026-01-01",
            "data_collection_end_date": "2026-03-31",
            "min_survey_duration_minutes": 10,
            "max_survey_duration_minutes": 90.5,
        },
        "quality_checks": {
            "flag_out_of_period": True,
            "flag_weekend": True,
            "weekend_days": [4, 5],
            "flag_office_hours": True,
            "office_hours_start": "07:30",
            "office_hours_end": "18:00",
            "flag_outliers": True,
            "outlier_variables": ["income", "age"],
            "outlier_method": "mad",
            "outlier_threshold": 3,
            "flag_dk_percentage": True,
            "dk_percentage_threshold": 40,
            "flag_empty_percentage": True,
            "empty_percentage_threshold": 25.5,
            "flag_llm_qualitative": True,
            "llm_qualitative_fields": ["comments", "other"],
            "llm_check_types": ["relevance"],
        },
    },
    "explicit_nulls": {
        "global_parameters": {"min_survey_duration_minutes": None},
        "quality_checks": {
            "outlier_threshold": None,
            "outlier_variables": None,
            "dk_percentage_threshold": None,
            "llm_qualitative_fields": None,
            "llm_check_types": None,
        },
    },
    "wrong_types": {
        "global_parameters": {"min_survey_duration_minutes": "ten"},
        "quality_checks": {
            "flag_outliers": 1,
            "outlier_threshold": "2.5",
            "dk_percentage_threshold": "50",
            "outlier_variables": "income",
        },
    },
}

EXPECTED = {
    "empty": (
        "ef46b5f27abf092a",
        "f5233191f8362a14822d4481b2a6f4e5e57e98ade5678162e4833ab3577faf64",
    ),
    "explicit_nulls": (
        "c043ef822fed1034",
        "a4e63fad2587920964e5130300da231f1a3609197a4b8ac98409745a8da4d464",
    ),
    "typical": (
        "672557aa287d5285",
        "35c5048adc7dfae41f68f8587387851e84f4007d26c098dc226ed62ffb28aab5",
    ),
    "wrong_types": (
        "db4f447cc8b1a671",
        "f5233191f8362a14822d4481b2a6f4e5e57e98ade5678162e4833ab3577faf64",
    ),
}


@pytest.mark.parametrize("name", sorted(CONFIGS))
def test_hashes_are_stable(test_db, name):
    survey = SurveyConfig(survey_id=uuid4(), survey_name=name, config_data=CONFIGS[name])
    test_db.add(survey)
    test_db.commit()
    validation = HFCEngine(test_db, survey).compute_validation_hash()
    llm = generate_llm_rules_hash(CONFIGS[name], "gpt-test")
    assert (validation, llm) == EXPECTED[name]
