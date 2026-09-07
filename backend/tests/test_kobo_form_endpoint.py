"""
Tests for GET /api/kobo/assets/{asset_uid}/form.

This is what lets a user configure a survey straight from their Kobo project
instead of exporting the XLSForm and uploading it. The browser cannot call
Kobo directly -- the API token is encrypted server-side -- so the failure
modes here are the ones a user actually hits: no token configured, a mistyped
project ID, Kobo unreachable, or a project with no deployed form.
"""

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
                "$xpath": "age",
                "$kuid": "k5",
            },
        ],
        "choices": [
            {"list_name": "enums", "name": "E01", "label": ["Amina", "امینه"]},
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
    def test_returns_questions_and_choices(self, client):
        with patch("routers.kobo.get_user_kobo_token", return_value="tok"), patch(
            "routers.kobo.KoboFetcher.get_asset_info", return_value=ASSET_PAYLOAD
        ):
            response = _get(client)

        assert response.status_code == 200
        payload = response.json()

        assert payload["asset_uid"] == ASSET
        assert payload["asset_name"] == "Market Assessment"
        assert payload["languages"] == ["English (en)", "Dari (da)"]
        assert payload["has_audit"] is True
        assert payload["choice_lists"]["enums"][0] == {
            "name": "E01",
            "labels": {"English (en)": "Amina", "Dari (da)": "امینه"},
        }

    def test_questions_carry_group_qualified_paths(self, client):
        """Paths must match submission_data keys, not bare names."""
        with patch("routers.kobo.get_user_kobo_token", return_value="tok"), patch(
            "routers.kobo.KoboFetcher.get_asset_info", return_value=ASSET_PAYLOAD
        ):
            questions = _get(client).json()["questions"]

        by_name = {q["name"]: q for q in questions}
        assert by_name["enumerator_id"]["path"] == "intro/enumerator_id"
        assert by_name["enumerator_id"]["labels"] == {
            "English (en)": "Enumerator ID:",
            "Dari (da)": "شماره",
        }
        assert by_name["enumerator_id"]["list_name"] == "enums"

    def test_structural_rows_and_notes_are_excluded(self, client):
        """The caller is populating pickers, not rendering the form."""
        with patch("routers.kobo.get_user_kobo_token", return_value="tok"), patch(
            "routers.kobo.KoboFetcher.get_asset_info", return_value=ASSET_PAYLOAD
        ):
            types = {q["type"] for q in _get(client).json()["questions"]}

        assert types.isdisjoint({"begin_group", "end_group", "note"})
        assert "select_one" in types and "integer" in types

    def test_every_translation_is_returned(self, client):
        """
        All languages, not one resolved string: the client offers a language
        picker without refetching, and a fetched form can be stored in the same
        shape an uploaded XLSForm produces.
        """
        with patch("routers.kobo.get_user_kobo_token", return_value="tok"), patch(
            "routers.kobo.KoboFetcher.get_asset_info", return_value=ASSET_PAYLOAD
        ):
            questions = _get(client).json()["questions"]

        assert {q["name"]: q["labels"] for q in questions}["age"] == {
            "English (en)": "Age",
            "Dari (da)": "سن",
        }

    def test_missing_kobo_token_is_actionable(self, client):
        with patch("routers.kobo.get_user_kobo_token", return_value=None):
            response = _get(client)

        assert response.status_code == 400
        assert "user settings" in response.json()["detail"]

    @pytest.mark.parametrize("uid", ["not-a-uid", "../../etc/passwd", "bXX", "a"])
    def test_malformed_asset_id_is_rejected_before_calling_kobo(self, client, uid):
        """The uid is interpolated into the upstream path, so it is validated."""
        with patch("routers.kobo.get_user_kobo_token", return_value="tok"), patch(
            "routers.kobo.KoboFetcher.get_asset_info"
        ) as fetch:
            response = _get(client, uid=uid)

        assert response.status_code in (400, 404)
        fetch.assert_not_called()

    def test_kobo_failure_becomes_a_502_without_leaking_internals(self, client):
        with patch("routers.kobo.get_user_kobo_token", return_value="tok"), patch(
            "routers.kobo.KoboFetcher.get_asset_info",
            side_effect=RuntimeError("token=secret123 connection refused"),
        ):
            response = _get(client)

        assert response.status_code == 502
        assert "secret123" not in response.text

    def test_project_with_no_form_is_reported_clearly(self, client):
        with patch("routers.kobo.get_user_kobo_token", return_value="tok"), patch(
            "routers.kobo.KoboFetcher.get_asset_info", return_value={"uid": ASSET, "content": {}}
        ):
            response = _get(client)

        assert response.status_code == 404
        assert "Deploy the form" in response.json()["detail"]
