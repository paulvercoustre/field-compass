"""HTTP tests for the lint endpoints."""

from unittest.mock import patch
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from database.models import Base, ValidationRule
from tests.lint_forms import LEGACY_STORED, UNBOUNDED_AGE
from tests.test_api_endpoints import (
    engine,
    override_current_user,
    override_get_db,
)


@pytest.fixture(scope="function")
def client():
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


def _create_survey(client, form):
    response = client.post(
        "/api/surveys",
        json={
            "survey_name": "Lint Survey",
            "kobo_asset_id": "aLintAsset1234567",
            "config_data": {
                "core_identifiers": {"uuid": "_uuid", "enumerator": "enumerator_id"},
                "kobo_tool": form,
            },
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


class TestLintEndpoints:
    def test_post_lint_on_a_raw_form(self, client):
        response = client.post("/api/lint", json={"form": UNBOUNDED_AGE})
        assert response.status_code == 200
        body = response.json()
        assert body["counts"]["warning"] >= 1
        checks = {item["check_id"] for item in body["findings"]}
        assert "unbounded_numeric" in checks
        keys = [
            (item["severity"], item["check_id"], item["question_path"] or "")
            for item in body["findings"]
        ]
        assert keys == sorted(
            keys,
            key=lambda item: ({"error": 0, "warning": 1, "info": 2}[item[0]], item[1], item[2]),
        )

    def test_get_survey_lint(self, client):
        survey = _create_survey(client, UNBOUNDED_AGE)
        response = client.get(f"/api/surveys/{survey['survey_id']}/lint")
        assert response.status_code == 200
        checks = {item["check_id"] for item in response.json()["findings"]}
        assert "unbounded_numeric" in checks

    def test_legacy_form_without_kobo_key_skips_logic_checks(self, client):
        survey = _create_survey(client, LEGACY_STORED)
        with patch("routers.lint.get_user_kobo_token", return_value=None):
            body = client.get(f"/api/surveys/{survey['survey_id']}/lint").json()
        assert body["form_logic_missing"] is True
        checks = {item["check_id"] for item in body["findings"]}
        assert checks.isdisjoint({"unbounded_numeric", "unbounded_date", "missing_required"})

    def test_legacy_form_is_linted_from_kobo(self, client):
        survey = _create_survey(client, LEGACY_STORED)
        live = {"content": UNBOUNDED_AGE}
        with patch("routers.lint.get_user_kobo_token", return_value="tok"), patch(
            "routers.lint.KoboFetcher.get_asset_info", return_value=live
        ) as fetch:
            body = client.get(f"/api/surveys/{survey['survey_id']}/lint").json()
        fetch.assert_called_once_with("aLintAsset1234567")
        assert body["form_logic_missing"] is False
        assert "unbounded_numeric" in {item["check_id"] for item in body["findings"]}

    def test_dk_values_endpoint_uses_the_linter_rules(self, client):
        choices = [
            {"list_name": "yn", "name": "yes", "label::English (en)": "Yes"},
            {"list_name": "yn", "name": "dk", "label::English (en)": "Don't know"},
            {"list_name": "c", "name": "98", "label::English (en)": "Refused"},
            {"list_name": "c", "name": "dnk_1", "label::English (en)": "Does not know"},
        ]
        response = client.post(
            "/api/lint/dk-values", json={"form": {"survey": [], "choices": choices}}
        )
        assert response.status_code == 200
        values = response.json()["values"]
        assert [value["name"] for value in values] == ["dk", "dnk_1"]
        assert values[0] == {"name": "dk", "label": "Don't know", "lists": ["yn"]}

    def test_survey_lint_compares_dk_codes_with_the_config(self, client):
        survey = _create_survey(client, UNBOUNDED_AGE)
        body = client.get(f"/api/surveys/{survey['survey_id']}/lint").json()
        assert "dk_codes_not_counted" not in {item["check_id"] for item in body["findings"]}

    def test_lint_without_a_form_is_actionable(self, client):
        survey = _create_survey(client, {"survey": [], "choices": []})
        response = client.get(f"/api/surveys/{survey['survey_id']}/lint")
        assert response.status_code == 400
        assert "form" in response.json()["detail"].lower()

    def test_adopt_rules_is_idempotent(self, client):
        survey = _create_survey(client, UNBOUNDED_AGE)
        survey_id = survey["survey_id"]
        lint = client.get(f"/api/surveys/{survey_id}/lint").json()
        age = next(
            item
            for item in lint["findings"]
            if item["check_id"] == "unbounded_numeric" and item["auto_rule"]
        )
        payload = {
            "items": [{"check_id": age["check_id"], "question_path": age["question_path"]}],
            "is_active": True,
        }
        first = client.post(f"/api/surveys/{survey_id}/lint/adopt-rules", json=payload)
        assert first.status_code == 200
        assert first.json()[0]["created"] is True
        second = client.post(f"/api/surveys/{survey_id}/lint/adopt-rules", json=payload)
        assert second.status_code == 200
        assert second.json()[0]["created"] is False
        assert first.json()[0]["rule_id"] == second.json()[0]["rule_id"]

        db_survey = UUID(survey_id)
        # The test client's session is closed; re-open via override_get_db.
        from tests.test_api_endpoints import TestingSessionLocal

        db = TestingSessionLocal()
        try:
            count = db.query(ValidationRule).filter(ValidationRule.survey_id == db_survey).count()
            assert count == 1
        finally:
            db.close()
