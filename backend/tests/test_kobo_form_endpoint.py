"""
Tests for GET /api/kobo/assets/{asset_uid}/form.

This is what lets a user configure a survey straight from their Kobo project
instead of exporting the XLSForm and uploading it. The browser cannot call
Kobo directly -- the API token is encrypted server-side -- so the failure
modes here are the ones a user actually hits: no token configured, a mistyped
project ID, Kobo unreachable, or a project with no deployed form.
"""

from copy import deepcopy
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from database.models import Base
from tests.test_api_endpoints import engine, override_current_user, override_get_db

ASSET = "aTestAsset123456"

ASSET_PAYLOAD = {
    "uid": ASSET,
    "name": "Market Assessment",
    "content": {
        "translations": ["English (en)", "Dari (da)"],
        "settings": {"id_string": "market_v1"},
        "survey": [
            {"type": "audit", "name": "audit", "$xpath": "audit", "$kuid": "k0"},
            {
                "type": "begin_group",
                "name": "intro",
                "label": ["Intro", "مقدمه"],
                "$xpath": "intro",
                "$kuid": "k1",
            },
            {
                "type": "select_one",
                "name": "enumerator_id",
                "label": ["Enumerator ID:", "شماره"],
                "select_from_list_name": "enums",
                "$xpath": "intro/enumerator_id",
                "$kuid": "k2",
            },
            {
                "type": "note",
                "name": "read_this",
                "label": ["Read aloud", "بخوان"],
                "$kuid": "k3",
            },
            {"type": "end_group", "$kuid": "k4"},
            {
                "type": "integer",
                "name": "age",
                "label": ["Age", "سن"],
                "constraint": ". <= 120",
                "required": True,
                "$xpath": "age",
                "$kuid": "k5",
            },
        ],
        "choices": [
            {
                "list_name": "enums",
                "name": "E01",
                "label": ["Amina", "امینه"],
                "province": "kabul",
                "team": 2,
                "$kuid": "c1",
                "media::image": ["a.png", None],
            },
            {"list_name": "enums", "name": "E02", "label": ["Bilal", "بلال"]},
        ],
    },
}


@pytest.fixture(scope="function")
def client():
    """Authenticated client whose test user has a Kobo token configured."""
    Base.metadata.create_all(bind=engine)

    from main import app
    from services.auth import get_current_active_user
    from services.database import get_db

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_active_user] = override_current_user

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)


def _get(client, uid=ASSET, **params):
    return client.get(f"/api/kobo/assets/{uid}/form", params=params)


class TestKoboAssetForm:
    def test_returns_the_form_as_a_survey_stores_it(self, client):
        with (
            patch("routers.kobo.get_user_kobo_token", return_value="tok"),
            patch("routers.kobo.KoboFetcher.get_asset_info", return_value=ASSET_PAYLOAD),
        ):
            response = _get(client)

        assert response.status_code == 200
        payload = response.json()

        assert payload["asset_uid"] == ASSET
        assert payload["asset_name"] == "Market Assessment"
        assert payload["languages"] == ["English (en)", "Dari (da)"]
        assert payload["has_audit"] is True
        # The choice's own columns come along, as text, for choice filters;
        # Kobo's bookkeeping and media do not.
        assert payload["choices"] == [
            {
                "list_name": "enums",
                "name": "E01",
                "label::English (en)": "Amina",
                "label::Dari (da)": "امینه",
                "province": "kabul",
                "team": "2",
            },
            {
                "list_name": "enums",
                "name": "E02",
                "label::English (en)": "Bilal",
                "label::Dari (da)": "بلال",
            },
        ]

    def test_questions_are_rows_with_every_translation(self, client):
        with (
            patch("routers.kobo.get_user_kobo_token", return_value="tok"),
            patch("routers.kobo.KoboFetcher.get_asset_info", return_value=ASSET_PAYLOAD),
        ):
            by_name = {row["name"]: row for row in _get(client).json()["survey"]}

        assert by_name["enumerator_id"] == {
            "type": "select_one",
            "name": "enumerator_id",
            "label::English (en)": "Enumerator ID:",
            "label::Dari (da)": "شماره",
            "roster_name": None,
            "list_name": "enums",
            "group_path": "intro",
            # Each question carries its group's label, which the group row no longer can.
            "group_label::English (en)": "Intro",
            "group_label::Dari (da)": "مقدمه",
        }
        assert by_name["age"]["constraint"] == ". <= 120"
        assert by_name["age"]["required"] == "yes"
        assert "group_path" not in by_name["age"]

    def test_questions_carry_their_groups_conditions(self, client):
        """Group rows are dropped, so the checks and linter need their `relevant` per question."""
        payload = deepcopy(ASSET_PAYLOAD)
        payload["content"]["survey"][1]["relevant"] = "${consent} = 'yes'"
        with (
            patch("routers.kobo.get_user_kobo_token", return_value="tok"),
            patch("routers.kobo.KoboFetcher.get_asset_info", return_value=payload),
        ):
            by_name = {row["name"]: row for row in _get(client).json()["survey"]}

        assert by_name["enumerator_id"]["group_relevant"] == ["${consent} = 'yes'"]
        assert "group_relevant" not in by_name["age"]

    def test_group_rows_are_left_out_and_notes_kept(self, client):
        """Group markers travel on each question; notes are shown with a submission's answers."""
        with (
            patch("routers.kobo.get_user_kobo_token", return_value="tok"),
            patch("routers.kobo.KoboFetcher.get_asset_info", return_value=ASSET_PAYLOAD),
        ):
            survey = _get(client).json()["survey"]

        assert [row["name"] for row in survey] == ["audit", "enumerator_id", "read_this", "age"]
        note = survey[2]
        assert note["type"] == "note"
        assert note["label::English (en)"] == "Read aloud"
        assert note["group_path"] == "intro"

    def test_missing_kobo_token_is_actionable(self, client):
        with patch("routers.kobo.get_user_kobo_token", return_value=None):
            response = _get(client)

        assert response.status_code == 400
        assert "user settings" in response.json()["detail"]

    @pytest.mark.parametrize("uid", ["not-a-uid", "../../etc/passwd", "bXX", "a"])
    def test_malformed_asset_id_is_rejected_before_calling_kobo(self, client, uid):
        """The uid is interpolated into the upstream path, so it is validated."""
        with (
            patch("routers.kobo.get_user_kobo_token", return_value="tok"),
            patch("routers.kobo.KoboFetcher.get_asset_info") as fetch,
        ):
            response = _get(client, uid=uid)

        assert response.status_code in (400, 404)
        fetch.assert_not_called()

    def test_kobo_failure_becomes_a_502_without_leaking_internals(self, client):
        with (
            patch("routers.kobo.get_user_kobo_token", return_value="tok"),
            patch(
                "routers.kobo.KoboFetcher.get_asset_info",
                side_effect=RuntimeError("token=secret123 connection refused"),
            ),
        ):
            response = _get(client)

        assert response.status_code == 502
        assert "secret123" not in response.text

    def test_project_with_no_form_is_reported_clearly(self, client):
        with (
            patch("routers.kobo.get_user_kobo_token", return_value="tok"),
            patch(
                "routers.kobo.KoboFetcher.get_asset_info",
                return_value={"uid": ASSET, "content": {}},
            ),
        ):
            response = _get(client)

        assert response.status_code == 404
        assert "Deploy the form" in response.json()["detail"]
