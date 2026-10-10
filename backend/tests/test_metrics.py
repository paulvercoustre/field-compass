"""
The counts and measurements every data page shares (services/metrics.py,
etl/duration.py): one definition each, so the screens agree.
"""

from datetime import datetime

import pytest

from database.models import SubmissionCurrent
from etl.duration import AUDIT, START_END, interview_minutes
from services.metrics import counts, is_approved, is_not_approved, summarise
from services.progress import compute_performance
from services.survey_config import built_in_checks

CONFIG = {
    "core_identifiers": {
        "uuid": "_uuid",
        "enumerator": "enumerator_id",
        "start_time": "start",
        "end_time": "end",
    }
}


def _sub(enumerator="e1", *, issues=0, decision=None, data=None, dk=None):
    """A submission; `dk` is (don't-know answers, answers that allow one)."""
    dk_count, dk_eligible = dk or (None, None)
    return SubmissionCurrent(
        submission_data={"enumerator_id": enumerator, **(data or {})},
        data_quality_issues=[{"check": "c", "field": "f"} for _ in range(issues)],
        kobo_validation_status=decision,
        # The legacy status disagrees on purpose: the counts must not read it.
        qa_status="FLAGGED",
        dk_count=dk_count,
        dk_eligible_count=dk_eligible,
    )


class TestCounts:
    def test_they_add_up_by_the_queue_s_own_states(self):
        subs = [
            _sub(issues=2),  # Needs review
            _sub(issues=1, decision="On Hold"),  # On hold, still flagged
            _sub(),  # Clean
            _sub(issues=1, decision="Approved"),  # Approved, still flagged
            _sub(decision="Not Approved"),  # Not approved
        ]
        tally = counts(subs)
        assert tally["submissions"] == 5
        assert (tally["needs_review"], tally["on_hold"], tally["clean"]) == (1, 1, 1)
        assert (tally["approved"], tally["not_approved"], tally["reviewed"]) == (1, 1, 2)
        assert tally["submissions"] == sum(
            tally[k] for k in ("needs_review", "on_hold", "clean", "approved", "not_approved")
        )
        # Flagged is about the checks, whatever was decided.
        assert (tally["flagged"], tally["issues"]) == (3, 4)

    def test_kobo_decides_approved_and_not_approved(self):
        assert is_approved(_sub(decision=" approved "))
        assert not is_approved(_sub(decision="On Hold"))
        assert is_not_approved(_sub(decision="Not Approved"))
        assert not is_not_approved(_sub(decision="On Hold"))
        assert not is_not_approved(_sub())


class TestMeasurements:
    def test_dont_know_rate_counts_only_questions_that_allow_one(self):
        # 2 of 10 and 0 of 30: 2 of 40, not the mean of 20% and 0%. A
        # submission with nothing to measure leaves the rate alone.
        summary = summarise([_sub(dk=(2, 10)), _sub(dk=(0, 30)), _sub()], CONFIG)
        assert summary.dk_rate == 5.0

    def test_nothing_measured_is_null_not_zero(self):
        summary = summarise([_sub()], CONFIG)
        assert summary.dk_rate is None
        assert summary.duration_minutes is None
        assert summary.duration_measured == 0
        assert summarise([], CONFIG).issues_per_submission is None

    def test_duration_is_the_median_and_falls_back_to_start_and_end(self):
        subs = [
            _sub(data={"active_interview_time": 6}),
            _sub(data={"active_interview_time": 30}),
            # No audit log: the form's own start and end, in a group.
            _sub(data={"grp/start": "2026-03-01T10:00:00Z", "grp/end": "2026-03-01T10:20:00Z"}),
        ]
        summary = summarise(subs, CONFIG)
        assert summary.duration_minutes == 20.0
        assert (summary.duration_measured, summary.duration_from_start_end) == (3, 1)

    def test_issues_per_submission_counts_every_submission_once(self):
        assert summarise(
            [_sub(issues=3), _sub(), _sub(), _sub()], CONFIG
        ).issues_per_submission == (0.75)


class TestInterviewMinutes:
    def test_audit_time_first(self):
        data = {"active_interview_time": "12.5", "start": "2026-03-01T10:00:00", "end": "x"}
        assert interview_minutes(data, "start", "end") == (12.5, AUDIT)

    @pytest.mark.parametrize("audit", [None, "not a number"])
    def test_start_and_end_otherwise(self, audit):
        data = {"start": "2026-03-01T10:00:00+04:30", "end": "2026-03-01T10:45:00+04:30"}
        if audit is not None:
            data["active_interview_time"] = audit
        assert interview_minutes(data, "start", "end") == (45.0, START_END)

    @pytest.mark.parametrize(
        "data",
        [
            {},
            {"start": "2026-03-01T10:00:00"},
            {"start": "2026-03-01T10:00:00Z", "end": "2026-03-01T10:30:00"},  # zone and none
            {"start": "yesterday", "end": "today"},
        ],
    )
    def test_unknown_is_none(self, data):
        assert interview_minutes(data, "start", "end") == (None, None)


def test_field_team_and_data_quality_agree():
    """The team's figures are Data quality's: every submission, an enumerator or not."""
    subs = [
        _sub("e1", issues=2, dk=(1, 10), data={"active_interview_time": 6}),
        _sub("e1", decision="Approved", dk=(0, 10), data={"active_interview_time": 25}),
        _sub("e2", issues=1, decision="Not Approved", data={"active_interview_time": 31}),
        _sub("e2", decision="On Hold", dk=(3, 20)),
        _sub(None, issues=3, data={"active_interview_time": 40}),
    ]
    performance = compute_performance(subs, CONFIG)
    assert performance.team == summarise(subs, CONFIG)
    assert performance.team.issues_per_submission == 1.2
    e1, e2 = performance.enumerators
    assert (e1.id, e1.submissions, e1.flagged, e1.approved) == ("e1", 2, 1, 1)
    assert (e2.not_approved, e2.on_hold, e2.dk_rate) == (1, 1, 15.0)
    assert performance.no_enumerator is not None
    assert (performance.no_enumerator.submissions, performance.no_enumerator.issues) == (1, 3)


def test_a_submission_time_is_not_a_duration():
    """Kobo's upload time says when the phone sent the form, not how long it took."""
    sub = _sub()
    sub._submission_time = datetime(2026, 3, 1, 12)
    sub.end = datetime(2026, 3, 1, 13)
    assert summarise([sub], CONFIG).duration_minutes is None


class TestTheCallSheetsFigures:
    def test_checks_count_submissions_not_issues(self):
        # Two outliers on one submission flag it once for that check.
        subs = [_sub(), _sub(), _sub()]
        subs[0].data_quality_issues = [{"check": "outlier_x"}, {"check": "outlier_x"}]
        subs[1].data_quality_issues = [{"check": "outlier_x"}, {"check": "duration_too_short"}]
        assert summarise(subs, CONFIG).checks == {"outlier_x": 2, "duration_too_short": 1}

    def test_the_middle_half_of_durations(self):
        subs = [_sub(data={"active_interview_time": m}) for m in (10, 20, 30, 40, 50)]
        summary = summarise(subs, CONFIG)
        assert (summary.duration_p25, summary.duration_minutes, summary.duration_p75) == (
            20.0,
            30.0,
            40.0,
        )
        one = summarise([_sub(data={"active_interview_time": 12})], CONFIG)
        assert (one.duration_p25, one.duration_p75) == (12.0, 12.0)

    def test_by_day_and_first_and_last(self):
        days = [datetime(2026, 9, 20, 9), datetime(2026, 9, 20, 18), datetime(2026, 9, 21, 8)]
        subs = [_sub(issues=n) for n in (2, 0, 1)]
        for sub, day in zip(subs, days, strict=True):
            sub._submission_time = day
        summary = summarise(subs, CONFIG)
        assert [(d.day, d.submissions, d.flagged, d.issues) for d in summary.daily] == [
            ("2026-09-20", 2, 1, 2),
            ("2026-09-21", 1, 1, 1),
        ]
        assert (summary.first_submission, summary.last_submission) == (
            "2026-09-20T09:00:00",
            "2026-09-21T08:00:00",
        )

    def test_an_enumerator_s_durations_are_listed(self):
        subs = [_sub("e1", data={"active_interview_time": 6.04}), _sub("e1")]
        assert compute_performance(subs, CONFIG).enumerators[0].durations == [6.0]


class TestChecksOn:
    def test_a_new_survey_has_them_all_off(self):
        checks = built_in_checks({})
        assert len(checks) == 10
        assert not any(on for _, on in checks)

    def test_each_reads_its_own_setting(self):
        config = {
            "global_parameters": {"min_survey_duration_minutes": 15},
            "quality_checks": {
                "flag_weekend": True,
                # Outliers with no question to look at, and AI review with no
                # answer to read, cannot run: they are off.
                "flag_outliers": True,
                "outlier_variables": [],
                "flag_llm_qualitative": True,
                "llm_qualitative_fields": [],
            },
        }
        on = {key for key, is_on in built_in_checks(config) if is_on}
        assert on == {"interview_on_weekend", "duration_too_short"}
        performance = compute_performance([], {**CONFIG, **config})
        assert set(performance.checks_on) == on and len(performance.checks_off) == 8
