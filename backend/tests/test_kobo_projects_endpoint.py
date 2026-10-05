"""
Tests for GET /api/kobo/assets, the project picker on the create-survey screen.

Picking a project by name replaces finding it in Kobo and copying its link
across. The list has to put the projects people configure first, say which
ones Field Compass already reads, and fail in a way that leaves the
paste-a-link route open.
"""

from unittest.mock import MagicMock, patch

import pytest
import requests
from fastapi.testclient import TestClient

from database.models import Base, SurveyConfig
from etl.kobo_fetcher import KoboFetcher
from tests.test_api_endpoints import (
    TEST_USER_ID,
    TestingSessionLocal,
    _ensure_test_user,
    engine,
    override_current_user,
    override_get_db,
)


def _asset(uid, name, status, modified, **extra):
    return {
        "uid": uid,
        "name": name,
        "asset_type": "survey",
        "deployment_status": status,
        "date_modified": modified,
        "owner__username": "field_team",
        **extra,
    }


ASSETS = [
    _asset("aArchivedProj01", "Old baseline", "archived", "2026-09-30T10:00:00Z"),
    _asset("aDraftProject01", "Endline draft", "draft", "2026-10-01T10:00:00Z"),
    _asset(
        "aDeployedOld001",
        "Market monitoring",
        "deployed",
        "2026-08-01T10:00:00Z",
        deployment__submission_count=412,
    ),
    _asset(
        "aDeployedNew001",
        "Household survey",
        "deployed",
        "2026-09-15T10:00:00Z",
        deployment__submission_count=0,
    ),
]


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


def _list(client, assets=ASSETS):
    with (
        patch("routers.kobo.get_user_kobo_token", return_value="tok"),
        patch("routers.kobo.KoboFetcher.list_survey_assets", return_value=assets),
    ):
        return client.get("/api/kobo/assets")


class TestKoboProjectList:
    def test_deployed_first_then_drafts_then_archived_newest_first(self, client):
        response = _list(client)

        assert response.status_code == 200
        assert [p["uid"] for p in response.json()] == [
            "aDeployedNew001",
            "aDeployedOld001",
            "aDraftProject01",
            "aArchivedProj01",
        ]

    def test_carries_what_the_picker_shows(self, client):
        project = next(p for p in _list(client).json() if p["uid"] == "aDeployedOld001")

        assert project["name"] == "Market monitoring"
        assert project["status"] == "deployed"
        assert project["submission_count"] == 412
        assert project["owner_username"] == "field_team"
        assert project["existing_survey_name"] is None

    def test_marks_projects_a_survey_already_reads(self, client):
        db = TestingSessionLocal()
        _ensure_test_user(db)
        db.add(
            SurveyConfig(
                survey_name="Market monitoring 2026",
                kobo_asset_id="aDeployedOld001",
                config_data={},
                user_id=TEST_USER_ID,
            )
        )
        db.commit()
        db.close()

        by_uid = {p["uid"]: p for p in _list(client).json()}

        assert by_uid["aDeployedOld001"]["existing_survey_name"] == "Market monitoring 2026"
        assert by_uid["aDeployedNew001"]["existing_survey_name"] is None

    @pytest.mark.parametrize(
        "fields, expected",
        [
            ({"has_deployment": False}, "draft"),
            ({"has_deployment": True, "deployment__active": True}, "deployed"),
            ({"has_deployment": True, "deployment__active": False}, "archived"),
        ],
    )
    def test_status_from_older_kobo_fields(self, client, fields, expected):
        """Kobo servers without `deployment_status` still report the old flags."""
        asset = {"uid": "aOlderServer01", "name": "Older", **fields}

        assert _list(client, [asset]).json()[0]["status"] == expected

    def test_assets_with_unusable_uids_are_dropped(self, client):
        """The uid later goes into an upstream path, so the list only offers valid ones."""
        assets = [*ASSETS, {"uid": "../etc", "name": "Bad"}, {"name": "No uid"}]

        uids = [p["uid"] for p in _list(client, assets).json()]

        assert len(uids) == len(ASSETS)

    def test_missing_kobo_token_is_actionable(self, client):
        with patch("routers.kobo.get_user_kobo_token", return_value=None):
            response = client.get("/api/kobo/assets")

        assert response.status_code == 400
        assert "account settings" in response.json()["detail"]

    def test_rejected_key_says_so(self, client):
        rejected = requests.HTTPError(response=MagicMock(status_code=401))
        with (
            patch("routers.kobo.get_user_kobo_token", return_value="tok"),
            patch("routers.kobo.KoboFetcher.list_survey_assets", side_effect=rejected),
        ):
            response = client.get("/api/kobo/assets")

        assert response.status_code == 502
        assert "did not accept your API key" in response.json()["detail"]

    def test_kobo_failure_becomes_a_502_without_leaking_internals(self, client):
        with (
            patch("routers.kobo.get_user_kobo_token", return_value="tok"),
            patch(
                "routers.kobo.KoboFetcher.list_survey_assets",
                side_effect=RuntimeError("token=secret123 connection refused"),
            ),
        ):
            response = client.get("/api/kobo/assets")

        assert response.status_code == 502
        assert "secret123" not in response.text
        assert "paste a project link" in response.json()["detail"]


def _page(results, next_url=None):
    response = MagicMock()
    response.json.return_value = {"results": results, "next": next_url}
    return response


class TestListSurveyAssets:
    def test_asks_kobo_for_survey_assets_only(self):
        fetcher = KoboFetcher(api_token="tok", api_url="https://kf.kobotoolbox.org/api/v2")
        with patch.object(fetcher, "_make_request", return_value={"results": []}) as first:
            fetcher.list_survey_assets()

        assert first.call_args.kwargs["params"]["q"] == "asset_type:survey"

    def test_follows_next_pages_on_the_same_server(self):
        fetcher = KoboFetcher(api_token="tok", api_url="https://kf.kobotoolbox.org/api/v2")
        first = {
            "results": [{"uid": "a1"}],
            "next": "https://kf.kobotoolbox.org/api/v2/assets/?p=2",
        }
        with (
            patch.object(fetcher, "_make_request", return_value=first),
            patch.object(fetcher.session, "get", return_value=_page([{"uid": "a2"}])),
        ):
            assets = fetcher.list_survey_assets()

        assert [a["uid"] for a in assets] == ["a1", "a2"]

    def test_does_not_send_the_token_to_another_host(self):
        fetcher = KoboFetcher(api_token="tok", api_url="https://kf.kobotoolbox.org/api/v2")
        first = {"results": [{"uid": "a1"}], "next": "https://elsewhere.example/assets/?p=2"}
        with (
            patch.object(fetcher, "_make_request", return_value=first),
            patch.object(fetcher.session, "get") as get,
        ):
            assets = fetcher.list_survey_assets()

        get.assert_not_called()
        assert [a["uid"] for a in assets] == ["a1"]

    def test_stops_after_max_pages(self):
        fetcher = KoboFetcher(api_token="tok", api_url="https://kf.kobotoolbox.org/api/v2")
        more = "https://kf.kobotoolbox.org/api/v2/assets/?p=next"
        first = {"results": [{"uid": "a0"}], "next": more}
        with (
            patch.object(fetcher, "_make_request", return_value=first),
            patch.object(fetcher.session, "get", return_value=_page([{"uid": "aN"}], more)) as get,
        ):
            assets = fetcher.list_survey_assets(max_pages=3)

        assert get.call_count == 2
        assert len(assets) == 3
