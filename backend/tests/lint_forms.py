"""
Form fixtures for the linter.

Each check has a form that triggers it and a form that does not, as required
by #32 and #33. Built as xlsx-dialect kobo_tool dicts so they match what the
create/settings screens persist.
"""


def _q(type: str, name: str, **extra):
    row = {"type": type, "name": name, "label::English (en)": extra.pop("label", name)}
    row.update(extra)
    return row


def _choice(list_name: str, name: str, label: str | None = None):
    return {
        "list_name": list_name,
        "name": name,
        "label::English (en)": label or name,
    }


def _ml(type: str, name: str, *, en: str, fr: str | None = None, **extra):
    """A row in a two-language form. `fr=None` is a missing translation."""
    row = {"type": type, "name": name, "label::English (en)": en}
    if fr is not None:
        row["label::French (fr)"] = fr
    row.update(extra)
    return row


def _ml_choice(list_name: str, name: str, *, en: str, fr: str | None = None):
    row = {"list_name": list_name, "name": name, "label::English (en)": en}
    if fr is not None:
        row["label::French (fr)"] = fr
    return row


def form(*survey, choices=None, settings=None):
    payload = {"survey": list(survey), "choices": list(choices or [])}
    if settings is not None:
        payload["settings"] = settings
    return payload


# --- setup-critical ----------------------------------------------------------

HEALTHY = form(
    _q("start", "start"),
    _q("audit", "audit"),
    _q("today", "today"),
    _q("select_one enumerator_id", "enumerator_id", label="Enumerator ID", required="yes"),
    _q("select_one yn", "consent", label="Does the respondent consent?", required="yes"),
    _q(
        "integer",
        "age",
        label="Respondent age",
        constraint="(. >= 0 and . <= 120) or . = -99",
        relevant="${consent} = 'yes'",
    ),
    _q(
        "select_one admin1",
        "district",
        label="District",
        required="yes",
        relevant="${consent} = 'yes'",
    ),
    _q(
        "select_multiple foods",
        "foods",
        label="Which foods?",
        constraint="not(selected(., 'dk') and count-selected(.) > 1)",
        relevant="${consent} = 'yes'",
    ),
    _q("calculate", "copy_district", calculation="${district}"),
    choices=[
        _choice("enumerator_id", "E01", "Amina"),
        _choice("yn", "yes", "Yes"),
        _choice("yn", "no", "No"),
        _choice("admin1", "north", "North"),
        _choice("admin1", "south", "South"),
        _choice("foods", "rice", "Rice"),
        _choice("foods", "dk", "Don't know"),
    ],
)

NO_AUDIT = form(
    _q("start", "start"),
    _q("select_one enumerator_id", "enumerator_id", label="Enumerator ID"),
    _q("today", "today"),
    choices=[_choice("enumerator_id", "E01")],
)

# API dialect is the only one that can prove audit is absent (xlsx stores None).
NO_AUDIT_API = {
    "translations": ["English (en)"],
    "survey": [
        {"type": "start", "name": "start", "$xpath": "start", "label": ["Start"]},
        {
            "type": "select_one",
            "name": "enumerator_id",
            "label": ["Enumerator ID"],
            "select_from_list_name": "enumerator_id",
            "$xpath": "enumerator_id",
        },
        {"type": "today", "name": "today", "$xpath": "today"},
    ],
    "choices": [{"list_name": "enumerator_id", "name": "E01", "label": ["Amina"]}],
}

INCONSISTENT_DK = form(
    _q("audit", "audit"),
    _q("select_one enumerator_id", "enumerator_id", label="Enumerator ID"),
    _q("today", "today"),
    _q("select_one yn", "q1", label="Question one"),
    _q("select_one yn2", "q2", label="Question two"),
    choices=[
        _choice("enumerator_id", "E01"),
        _choice("yn", "yes", "Yes"),
        _choice("yn", "dk", "Don't know"),
        _choice("yn2", "yes", "Yes"),
        _choice("yn2", "-99", "Don't know"),
    ],
)

# `dk` alongside `none` is two different answers, consistently coded. The
# prefixed `dk_income` is a second don't-know code and is the inconsistency.
MIXED_SPECIAL_VALUES = form(
    _q("audit", "audit"),
    _q("select_one enumerator_id", "enumerator_id", label="Enumerator ID"),
    _q("today", "today"),
    _q("select_one assets", "assets", label="Which assets?"),
    choices=[
        _choice("enumerator_id", "E01"),
        _choice("assets", "land", "Land"),
        _choice("assets", "dk", "Don't know"),
        _choice("assets", "none", "None"),
        _choice("assets", "no", "No"),
    ],
)

DK_PREFIXED_CODE = form(
    _q("audit", "audit"),
    _q("select_one enumerator_id", "enumerator_id", label="Enumerator ID"),
    _q("today", "today"),
    _q("select_one assets", "assets", label="Which assets?"),
    _q("select_one income", "income", label="Monthly income band"),
    choices=[
        _choice("enumerator_id", "E01"),
        _choice("assets", "land", "Land"),
        _choice("assets", "dk", "Don't know"),
        _choice("income", "low", "Under 100"),
        _choice("income", "dk_income", "Don't know"),
    ],
)

# --- translations ------------------------------------------------------------

# `age` has no French label, and so does the `no` option on `yn`.
UNTRANSLATED = form(
    _q("audit", "audit"),
    _q("today", "today"),
    _ml("select_one enumerator_id", "enumerator_id", en="Enumerator ID", fr="Code enquêteur"),
    _ml("integer", "age", en="Respondent age", constraint=". <= 120"),
    _ml("select_one yn", "owns_land", en="Do you own land?", fr="Possédez-vous des terres ?"),
    choices=[
        _ml_choice("enumerator_id", "E01", en="Amina", fr="Amina"),
        _ml_choice("yn", "yes", en="Yes", fr="Oui"),
        _ml_choice("yn", "no", en="No"),
    ],
)

TRANSLATED = form(
    _q("audit", "audit"),
    _q("today", "today"),
    _ml("select_one enumerator_id", "enumerator_id", en="Enumerator ID", fr="Code enquêteur"),
    _ml("integer", "age", en="Respondent age", fr="Âge du répondant", constraint=". <= 120"),
    choices=[_ml_choice("enumerator_id", "E01", en="Amina", fr="Amina")],
)

NO_ENUMERATOR = form(
    _q("audit", "audit"),
    _q("today", "today"),
    _q("integer", "age", label="Age", constraint=". <= 120"),
)

SAMPLING_AS_TEXT = form(
    _q("audit", "audit"),
    _q("select_one enumerator_id", "enumerator_id", label="Enumerator ID"),
    _q("today", "today"),
    _q("text", "district", label="What district are you in?"),
    choices=[_choice("enumerator_id", "E01")],
)

NO_INTERVIEW_DATE = form(
    _q("audit", "audit"),
    _q("select_one enumerator_id", "enumerator_id", label="Enumerator ID"),
    _q("integer", "age", label="Age", constraint=". <= 120"),
    choices=[_choice("enumerator_id", "E01")],
)

# --- constraints -------------------------------------------------------------

DK_NOT_EXCLUSIVE = form(
    _q("audit", "audit"),
    _q("select_one enumerator_id", "enumerator_id", label="Enumerator ID"),
    _q("today", "today"),
    _q("select_multiple foods", "foods", label="Which foods did you eat?"),
    choices=[
        _choice("enumerator_id", "E01"),
        _choice("foods", "rice", "Rice"),
        _choice("foods", "dk", "Don't know"),
    ],
)

DK_AND_NONE_NOT_EXCLUSIVE = form(
    _q("audit", "audit"),
    _q("select_one enumerator_id", "enumerator_id", label="Enumerator ID"),
    _q("today", "today"),
    _q("select_multiple foods", "foods", label="Which foods did you eat?"),
    choices=[
        _choice("enumerator_id", "E01"),
        _choice("foods", "rice", "Rice"),
        _choice("foods", "dk", "Don't know"),
        _choice("foods", "none", "None of the above"),
    ],
)

UNBOUNDED_AGE = form(
    _q("audit", "audit"),
    _q("select_one enumerator_id", "enumerator_id", label="Enumerator ID"),
    _q("today", "today"),
    _q("integer", "age", label="How old is the respondent?"),
    choices=[_choice("enumerator_id", "E01")],
)

UNBOUNDED_DATE = form(
    _q("audit", "audit"),
    _q("select_one enumerator_id", "enumerator_id", label="Enumerator ID"),
    _q("today", "today"),
    _q("date", "date_of_birth", label="Date of birth"),
    choices=[_choice("enumerator_id", "E01")],
)

MISSING_REQUIRED = form(
    _q("audit", "audit"),
    _q("select_one enumerator_id", "enumerator_id", label="Enumerator ID"),
    _q("today", "today"),
    _q("select_one yn", "consent", label="Does the respondent consent?"),
    choices=[
        _choice("enumerator_id", "E01"),
        _choice("yn", "yes"),
        _choice("yn", "no"),
    ],
)

UNREACHABLE = form(
    _q("audit", "audit"),
    _q("select_one enumerator_id", "enumerator_id", label="Enumerator ID"),
    _q("today", "today"),
    _q("select_one yn", "has_children", label="Any children?"),
    _q(
        "integer",
        "child_age",
        label="Age of child",
        relevant="${has_children} = 'yess'",
        constraint=". <= 17",
    ),
    choices=[
        _choice("enumerator_id", "E01"),
        _choice("yn", "yes"),
        _choice("yn", "no"),
    ],
)

# choice_filter means we must NOT flag even if relevant looks static.
UNREACHABLE_FILTERED = form(
    _q("audit", "audit"),
    _q("select_one enumerator_id", "enumerator_id", label="Enumerator ID"),
    _q("today", "today"),
    _q("select_one yn", "has_children", label="Any children?"),
    _q(
        "select_one yn",
        "child_in_school",
        label="In school?",
        relevant="${has_children} = 'yess'",
        choice_filter="${has_children}",
    ),
    choices=[
        _choice("enumerator_id", "E01"),
        _choice("yn", "yes"),
        _choice("yn", "no"),
    ],
)

ORPHAN_LIST = form(
    _q("audit", "audit"),
    _q("select_one enumerator_id", "enumerator_id", label="Enumerator ID"),
    _q("today", "today"),
    choices=[
        _choice("enumerator_id", "E01"),
        _choice("unused_list", "a", "A"),
    ],
)

BROKEN_CALC = form(
    _q("audit", "audit"),
    _q("select_one enumerator_id", "enumerator_id", label="Enumerator ID"),
    _q("today", "today"),
    _q("calculate", "copy", calculation="${missing_question}"),
    choices=[_choice("enumerator_id", "E01")],
)

CONSENT_UNGATED = form(
    _q("audit", "audit"),
    _q("select_one enumerator_id", "enumerator_id", label="Enumerator ID"),
    _q("today", "today"),
    _q("select_one yn", "consent", label="Does the respondent consent?", required="yes"),
    _q("text", "full_name", label="Full name", required="yes"),
    _q("integer", "age", label="Age", required="yes", constraint=". <= 120"),
    choices=[
        _choice("enumerator_id", "E01"),
        _choice("yn", "yes"),
        _choice("yn", "no"),
    ],
)

CONSENT_GATED = form(
    _q("audit", "audit"),
    _q("select_one enumerator_id", "enumerator_id", label="Enumerator ID"),
    _q("today", "today"),
    _q("select_one yn", "consent", label="Does the respondent consent?", required="yes"),
    _q(
        "text",
        "full_name",
        label="Full name",
        required="yes",
        relevant="${consent} = 'yes'",
    ),
    choices=[
        _choice("enumerator_id", "E01"),
        _choice("yn", "yes"),
        _choice("yn", "no"),
    ],
)
