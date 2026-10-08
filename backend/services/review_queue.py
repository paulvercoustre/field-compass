"""
The review queue on the Submissions page: which submissions a reviewer sees,
in what order, and the counts the tabs and the filter menu show.

A submission is in one of four review states:

- **needs review**: it has findings and no decision in Kobo yet;
- **on hold**: Kobo says On Hold;
- **reviewed**: any other decision in Kobo (Approved, Not Approved);
- **clean**: no findings and no decision. Clean submissions are only in "All";
  the ones whose checks have all finished can be approved together.

The tabs filter by state. Issue, enumerator, sampling-variable and search
filters narrow every tab. Each count in the filter menu leaves out its own
dimension, so it says how many a click would show: the tab counts ignore the
tab, the issue counts ignore the issue filter, and so on.
"""

from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any

from database.models import SubmissionCurrent
from services.submission_filters import answer_text

NEEDS_REVIEW = "needs_review"
ON_HOLD = "on_hold"
REVIEWED = "reviewed"
ALL = "all"
CLEAN = "clean"  # a state, not a tab
TABS = (NEEDS_REVIEW, ON_HOLD, REVIEWED, ALL)
SORTS = ("issues", "newest", "oldest", "enumerator")

# The enumerator filter's value for submissions with no enumerator recorded.
NO_ENUMERATOR = "__none__"

# AI review states that leave nothing unchecked: done, or nothing to review.
_AI_REVIEW_DONE = ("success", "skipped")


def review_state(sub: SubmissionCurrent) -> str:
    """Where a submission stands in review (see the module docstring)."""
    status = (sub.kobo_validation_status or "").strip()
    if status.lower() == "on hold":
        return ON_HOLD
    if status:
        return REVIEWED
    return NEEDS_REVIEW if sub.data_quality_issues else CLEAN


def default_tab(tab_counts: dict[str, int]) -> str:
    """Needs review when anything does, otherwise everything."""
    return NEEDS_REVIEW if tab_counts.get(NEEDS_REVIEW) else ALL


def default_sort(tab: str) -> str:
    """Most issues first while triaging; newest first when browsing."""
    return "issues" if tab in (NEEDS_REVIEW, ON_HOLD) else "newest"


@dataclass(frozen=True)
class QueueFilters:
    """The filters the queue narrows by, beyond the survey and its context filters."""

    tab: str | None = None
    issues: Sequence[str] = ()
    enumerators: Sequence[str] = ()
    sampling: dict[str, list[str]] = field(default_factory=dict)
    search: str | None = None


@dataclass
class _Row:
    sub: SubmissionCurrent
    state: str
    checks: frozenset[str]
    enumerator: str | None
    groups: dict[str, str | None]
    found: bool


def _answer_texts(value: Any) -> Iterable[str]:
    """Every answer inside a submission's data, repeats included, as text."""
    if isinstance(value, dict):
        for key, inner in value.items():
            if not str(key).startswith("_"):
                yield from _answer_texts(inner)
    elif isinstance(value, list):
        for inner in value:
            yield from _answer_texts(inner)
    elif value is not None:
        yield str(value)


def _found(sub: SubmissionCurrent, needle: str) -> bool:
    if needle in str(sub._id):
        return True
    return any(needle in text.lower() for text in _answer_texts(sub.submission_data or {}))


class ReviewQueue:
    """A survey's submissions, with what each filter needs worked out once."""

    def __init__(
        self,
        submissions: Iterable[SubmissionCurrent],
        filters: QueueFilters,
        *,
        enumerator_field: str | None,
        sampling_cols: Sequence[str],
    ):
        self.filters = filters
        self._enumerator_field = enumerator_field
        # Only the survey's own sampling columns can be filtered on.
        self._sampling = {
            col: values
            for col, values in filters.sampling.items()
            if col in sampling_cols and values
        }
        self._sampling_cols = list(sampling_cols)
        self._issues = set(filters.issues)
        self._enumerators = set(filters.enumerators) if enumerator_field else set()
        needle = (filters.search or "").strip().lower()
        self._rows = [
            _Row(
                sub=sub,
                state=review_state(sub),
                checks=frozenset(
                    issue.get("check")
                    for issue in sub.data_quality_issues or []
                    if issue.get("check")
                ),
                enumerator=answer_text(sub.submission_data, enumerator_field)
                if enumerator_field
                else None,
                groups={col: answer_text(sub.submission_data, col) for col in self._sampling_cols},
                found=not needle or _found(sub, needle),
            )
            for sub in submissions
        ]
        self.tab_counts = self._tab_counts()
        self.tab = filters.tab if filters.tab in TABS else default_tab(self.tab_counts)

    # --- one test per dimension; `skip` leaves a dimension out ---------------

    def _keeps(self, row: _Row, skip: str | None = None) -> bool:
        if not row.found:
            return False
        if skip != "tab" and self.tab != ALL and row.state != self.tab:
            return False
        if skip != "issues" and self._issues and not (row.checks & self._issues):
            return False
        if (
            skip != "enumerators"
            and self._enumerators
            and (row.enumerator or NO_ENUMERATOR) not in self._enumerators
        ):
            return False
        return all(
            col == skip or row.groups.get(col) in values for col, values in self._sampling.items()
        )

    def _tab_counts(self) -> dict[str, int]:
        states = Counter(row.state for row in self._rows if self._keeps(row, skip="tab"))
        return {
            NEEDS_REVIEW: states[NEEDS_REVIEW],
            ON_HOLD: states[ON_HOLD],
            REVIEWED: states[REVIEWED],
            ALL: sum(states.values()),
        }

    # --- what the page shows -------------------------------------------------

    def submissions(self, sort: str | None = None) -> tuple[list[SubmissionCurrent], str]:
        """The submissions in the current tab under every filter, sorted; and the sort used."""
        sort = sort if sort in SORTS else default_sort(self.tab)
        rows = [row for row in self._rows if self._keeps(row)]
        newest_first = sorted(rows, key=lambda row: row.sub._submission_time, reverse=True)
        if sort == "oldest":
            rows = newest_first[::-1]
        elif sort == "issues":
            rows = sorted(newest_first, key=lambda row: -len(row.sub.data_quality_issues or []))
        elif sort == "enumerator":
            rows = sorted(
                newest_first, key=lambda row: (row.enumerator is None, row.enumerator or "")
            )
        else:
            rows = newest_first
        return [row.sub for row in rows], sort

    def issue_counts(self) -> list[tuple[str, int]]:
        """Submissions per check that fired, most first."""
        counts: Counter[str] = Counter()
        for row in self._rows:
            if self._keeps(row, skip="issues"):
                counts.update(row.checks)
        return sorted(counts.items(), key=lambda item: (-item[1], item[0]))

    def enumerator_counts(self) -> list[tuple[str, int]]:
        if not self._enumerator_field:
            return []
        counts = Counter(
            row.enumerator or NO_ENUMERATOR
            for row in self._rows
            if self._keeps(row, skip="enumerators")
        )
        # Those with none recorded come last, however many.
        return sorted(
            counts.items(), key=lambda item: (item[0] == NO_ENUMERATOR, -item[1], item[0])
        )

    def sampling_counts(self) -> list[tuple[str, list[tuple[str, int]]]]:
        out = []
        for col in self._sampling_cols:
            counts = Counter(
                row.groups[col]
                for row in self._rows
                if row.groups.get(col) is not None and self._keeps(row, skip=col)
            )
            out.append((col, sorted(counts.items(), key=lambda item: (-item[1], item[0]))))
        return out

    def clean(self, busy: set[int]) -> tuple[list[SubmissionCurrent], int]:
        """
        Clean submissions under the filters (any tab): the ones every check has
        finished on, which may be approved together; and how many are still
        waiting for an AI review or a transcript. ``busy`` holds the submissions
        with recordings still being transcribed, or that could not be.
        """
        ready: list[SubmissionCurrent] = []
        waiting = 0
        for row in self._rows:
            if row.state != CLEAN or not self._keeps(row, skip="tab"):
                continue
            sub = row.sub
            if sub._id in busy or (sub.llm_check_status or "skipped") not in _AI_REVIEW_DONE:
                waiting += 1
            else:
                ready.append(sub)
        return ready, waiting
