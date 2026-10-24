"""
Field Compass under load: reviewers working through their surveys, as the app
does it (docs/load-test.md).

Each simulated person signs in with a token from `scripts/loadtest.py seed`
(LOADTEST_ACCOUNTS, default loadtest.json) and, every 3 to 10 seconds, does
what reviewers do: opens a survey's dashboard, works the review queue, opens
submissions and their history, filters, adds a note, checks their account.
Like the app, they ask for /api/activity every minute in the background.

Nothing goes to Kobo or an AI provider: changing a submission's validation
status, which writes to Kobo, is left out.

    locust -f loadtest/locustfile.py --host https://app.fieldcompass.org \\
        --headless --users 50 --spawn-rate 2 --run-time 10m --csv results/50
"""

from __future__ import annotations

import itertools
import json
import os
import random
import time

from locust import HttpUser, between, task

with open(os.environ.get("LOADTEST_ACCOUNTS", "loadtest.json")) as accounts_file:
    ACCOUNTS = json.load(accounts_file)["accounts"]
_next_account = itertools.cycle(ACCOUNTS)

SEARCHES = ["Abala", "Dogo", "EN03", "went well", "Corrected"]
ACTIVITY_EVERY_SECONDS = 60


class Reviewer(HttpUser):
    wait_time = between(3, 10)

    def on_start(self) -> None:
        account = next(_next_account)
        self.client.headers["Authorization"] = f"Bearer {account['token']}"
        self.survey = account["survey_id"]
        self.submissions: list[int] = []
        self.last_activity = 0.0

    # --- helpers ----------------------------------------------------------------

    def _get(self, path: str, name: str, **params) -> dict | list | None:
        with self.client.get(path, params=params, name=name, catch_response=True) as response:
            if response.status_code != 200:
                response.failure(f"{response.status_code}: {response.text[:200]}")
                return None
            return response.json()

    def _background(self) -> None:
        """The app's minute-by-minute activity check."""
        if time.time() - self.last_activity >= ACTIVITY_EVERY_SECONDS:
            self.last_activity = time.time()
            self._get("/api/activity", "/api/activity")

    def _queue(self, **filters) -> None:
        params = {"survey_id": self.survey, **filters}
        page = self._get("/api/submissions", "/api/submissions [queue]", **params)
        if isinstance(page, dict) and page.get("submissions"):
            self.submissions = [item["_id"] for item in page["submissions"]]
        params.pop("page", None)
        params.pop("page_size", None)
        self._get("/api/submissions/facets", "/api/submissions/facets", **params)

    # --- what reviewers do ----------------------------------------------------------

    @task(3)
    def open_dashboard(self) -> None:
        self._background()
        self._get("/api/surveys", "/api/surveys")
        self._get(f"/api/surveys/{self.survey}", "/api/surveys/[id]")
        self._get("/api/progress", "/api/progress", survey_id=self.survey)
        self._get("/api/quality/overview", "/api/quality/overview", survey_id=self.survey)
        self._get("/api/performance", "/api/performance", survey_id=self.survey)
        self._get(f"/api/surveys/{self.survey}/runs", "/api/surveys/[id]/runs", limit=5)

    @task(6)
    def work_the_queue(self) -> None:
        self._background()
        self._queue(review="needs_review", page=1, page_size=50)
        if self.submissions:
            submission = random.choice(self.submissions)
            self._get(
                f"/api/submissions/{submission}", "/api/submissions/[id]", survey_id=self.survey
            )
            self._get(
                f"/api/submissions/{submission}/history",
                "/api/submissions/[id]/history",
                survey_id=self.survey,
            )

    @task(2)
    def filter_and_search(self) -> None:
        self._background()
        self._queue(review="all", q=random.choice(SEARCHES), page=1, page_size=50)
        self._queue(review="all", sort="enumerator", page=random.randint(2, 10), page_size=50)

    @task(1)
    def questions(self) -> None:
        self._background()
        self._get("/api/quality/questions", "/api/quality/questions", survey_id=self.survey)

    @task(1)
    def add_a_note(self) -> None:
        self._background()
        if not self.submissions:
            return
        submission = random.choice(self.submissions)
        with self.client.patch(
            f"/api/submissions/{submission}/reviewer-notes",
            params={"survey_id": self.survey},
            json={"reviewer_notes": f"Load test note {random.randint(1, 1000)}"},
            name="/api/submissions/[id]/reviewer-notes",
            catch_response=True,
        ) as response:
            if response.status_code != 200:
                response.failure(f"{response.status_code}: {response.text[:200]}")

    @task(1)
    def account(self) -> None:
        self._background()
        self._get("/api/users/me", "/api/users/me")
        self._get("/api/notifications", "/api/notifications")
        self._get("/api/ai/usage", "/api/ai/usage")
