"""
Collection progress and field-team performance, from a survey's submissions.

Pure functions over submissions already loaded and the survey's config; which
submissions count is the caller's choice (routers/progress.py). Targets come
from services/survey_config.py in whichever of its modes the survey uses.
"""

from collections import defaultdict
from typing import Any

from database.models import SubmissionCurrent
from forms.answers import answer_value
from schemas import (
    DetailedProgress,
    EnumeratorSummary,
    OverallProgress,
    PerformanceData,
    ProgressByColumn,
    ProgressData,
    UnavailableCapability,
)
from services.metrics import durations, summarise
from services.submission_filters import answer_text
from services.survey_config import (
    CAPABILITY_ENUMERATOR_PERFORMANCE,
    SAMPLING_MODE_BY_VARIABLE,
    SAMPLING_MODE_TOTAL,
    SAMPLING_MODE_UPLOADED,
    built_in_checks,
    get_enumerator_field,
    get_frame_data,
    get_sampling_cols,
    get_sampling_mode,
    get_sampling_variable,
    get_targets_by_value,
    get_total_target,
    has_targets,
    unavailable_capabilities,
)

# Target column names that don't need to match Kobo variables
TARGET_COLUMN_NAMES = [
    "target",
    "target_interviews",
    "target_interview",
    "target_count",
    "target_number",
    "interviews_target",
    "interview_target",
    "total_target",
    "expected_interviews",
    "expected_count",
    "sample_size",
    "sample_size_target",
]


def _is_target_column(column_name: str) -> bool:
    """Check if a column name is a target column."""
    normalized = column_name.lower().strip()
    return any(name in normalized for name in TARGET_COLUMN_NAMES)


def _percentage(conducted: int, target: int | None) -> float | None:
    """
    Percent of target conducted, or None when there is nothing to divide by.

    None, not 0 and not 100. The old code read
    `100.0 if target == 0 else ...`, so a survey with no targets divided by a
    total of zero and reported **100% complete** on its first submission --
    "nothing planned" rendering as "everything done". A target of zero is
    equally undividable, and gets the same answer: we do not know.
    """
    if not target or target <= 0:
        return None
    return round((conducted / target) * 100, 1)


def _collection_rate(submissions: list[SubmissionCurrent]) -> tuple[int, float | None]:
    """
    Days of collection so far, and the mean submissions per day.

    This is what a survey with no targets can honestly report instead of a
    percentage: not how much of a plan is done, but how fast data is arriving.

    Spans the first submission to the most recent inclusive, so a single day of
    collection is 1 day and not 0 -- which would divide by zero, and is also
    just wrong.
    """
    times = [sub._submission_time for sub in submissions if sub._submission_time is not None]
    if not times:
        return 0, None

    span_days = (max(times).date() - min(times).date()).days + 1
    return span_days, round(len(submissions) / span_days, 1)


def _calculate_targets_from_frame(
    frame_data: list[dict[str, Any]], sampling_cols: list[str], target_column: str | None = None
) -> tuple[
    int,
    dict[str, dict[str, int]],
    dict[tuple[str, ...], int],
    dict[tuple[str, ...], dict[str, str]],
]:
    """
    Calculate targets from sampling frame data.

    Returns:
        - total_target: Sum of all target values
        - targets_by_col: Dict mapping column_name -> value -> target count
        - targets_by_combo: Dict mapping (col1_value, col2_value, ...) -> target count
        - combo_values_map: Dict mapping combo tuple to dict of column -> value
    """
    total_target = 0
    targets_by_col: dict[str, dict[str, int]] = {col: defaultdict(int) for col in sampling_cols}
    targets_by_combo: dict[tuple[str, ...], int] = defaultdict(int)
    combo_values_map: dict[tuple[str, ...], dict[str, str]] = {}

    if not frame_data:
        return (
            total_target,
            {col: dict(targets_by_col[col]) for col in sampling_cols},
            dict(targets_by_combo),
            combo_values_map,
        )

    # Find target column if not provided
    if not target_column and frame_data:
        frame_headers = list(frame_data[0].keys())
        for header in frame_headers:
            if _is_target_column(header):
                target_column = header
                break

    # Aggregate targets from frame data
    for row in frame_data:
        # Get target value (default to 1 if no target column)
        target_value = 1
        if target_column and target_column in row:
            try:
                target_value = int(float(row[target_column]))  # Handle numeric strings
            except (ValueError, TypeError):
                target_value = 1

        total_target += target_value

        # Aggregate by each sampling column
        for col in sampling_cols:
            if col in row:
                col_value = str(row[col]) if row[col] is not None else "Unknown"
                targets_by_col[col][col_value] += target_value
            else:
                targets_by_col[col]["Unknown"] += target_value

        # Aggregate by combination of all sampling columns
        combo_key = tuple(
            str(row.get(col, "Unknown")) if row.get(col) is not None else "Unknown"
            for col in sampling_cols
        )
        targets_by_combo[combo_key] += target_value
        combo_values_map[combo_key] = {
            col: (str(row.get(col)) if row.get(col) is not None else "Unknown")
            for col in sampling_cols
        }

    return (
        total_target,
        {col: dict(targets_by_col[col]) for col in sampling_cols},
        dict(targets_by_combo),
        combo_values_map,
    )


def compute_progress(
    submissions: list[SubmissionCurrent], config: dict[str, Any] | None
) -> ProgressData:
    """Overall progress, progress per sampling column value, and per combination."""
    mode = get_sampling_mode(config)
    sampling_cols = get_sampling_cols(config)
    sampling_variable = get_sampling_variable(config)
    frame_data = get_frame_data(config)
    targets_available = has_targets(config)

    # Calculate targets from sampling frame. In every mode but `uploaded` this
    # returns empty structures, which is what makes the per-column and detailed
    # sections below fall through to describing what was collected.
    (
        frame_total_target,
        targets_by_col,
        targets_by_combo,
        targets_combo_values,
    ) = _calculate_targets_from_frame(frame_data, sampling_cols)

    total_conducted = len(submissions)

    # Per-value targets, in the one mode that has them without a file. Read
    # once here rather than per column: the same dict answers the overall
    # total, the per-value rows and the detailed rows.
    targets_by_value = get_targets_by_value(config) if mode == SAMPLING_MODE_BY_VARIABLE else {}

    if not targets_available:
        total_target = None
    elif mode == SAMPLING_MODE_TOTAL:
        total_target = get_total_target(config)
    elif mode == SAMPLING_MODE_BY_VARIABLE:
        total_target = sum(targets_by_value.values())
    else:
        total_target = frame_total_target

    days_active, submissions_per_day = _collection_rate(submissions)

    overall = OverallProgress(
        conducted=total_conducted,
        target=total_target,
        progress=_percentage(total_conducted, total_target),
        days_active=days_active,
        submissions_per_day=submissions_per_day,
    )

    # Group by each sampling column dynamically
    by_column: dict[str, list[ProgressByColumn]] = {}

    for col in sampling_cols:
        col_counts = defaultdict(int)

        # Count conducted surveys for each value in this column
        for sub in submissions:
            col_value = answer_value(sub.submission_data, col) or "Unknown"
            col_value = str(col_value) if col_value is not None else "Unknown"
            col_counts[col_value] += 1

        # Where this column's targets come from. A single total cannot be split
        # across values without inventing an allocation, so `total` mode
        # contributes none -- the overall percentage is the honest limit of what
        # one number supports.
        if mode == SAMPLING_MODE_UPLOADED:
            col_targets = targets_by_col.get(col, {})
        elif mode == SAMPLING_MODE_BY_VARIABLE and col == sampling_variable:
            col_targets = targets_by_value
        else:
            col_targets = {}

        # Build progress list for this column ensuring targets with zero conducted are included
        all_values = set(col_counts.keys()) | set(col_targets.keys())
        column_progress = []
        for col_value in sorted(all_values):
            conducted = col_counts.get(col_value, 0)
            target = col_targets.get(col_value) if col_targets else None
            column_progress.append(
                ProgressByColumn(
                    value=str(col_value),
                    conducted=conducted,
                    target=target,
                    progress=_percentage(conducted, target),
                    share=_percentage(conducted, total_conducted),
                )
            )

        by_column[col] = column_progress

    # Detailed breakdown (all sampling columns combined)
    detailed = []
    if sampling_cols and len(sampling_cols) > 0:
        combo_counts = defaultdict(int)
        combo_values_map = {}

        # Group submissions by all sampling column values
        for sub in submissions:
            combo_values = {}
            combo_key_parts = []

            for col in sampling_cols:
                col_value = answer_value(sub.submission_data, col) or "Unknown"
                col_value = str(col_value) if col_value is not None else "Unknown"
                combo_values[col] = col_value
                combo_key_parts.append(col_value)

            combo_key = tuple(combo_key_parts)
            combo_counts[combo_key] += 1
            # Store values dict for this combination (only need to store once per unique combo)
            if combo_key not in combo_values_map:
                combo_values_map[combo_key] = combo_values

        # Include combinations from frame even if no submissions. Without a
        # frame there is nothing to add: the observed combinations are the
        # whole story, and a row for a combination nobody planned would be
        # invented.
        frame_combos: dict[tuple[str, ...], int]
        if mode == SAMPLING_MODE_UPLOADED:
            frame_combos = targets_by_combo
        elif mode == SAMPLING_MODE_BY_VARIABLE:
            # One sampling column, so a "combination" is a single value.
            frame_combos = {(value,): target for value, target in targets_by_value.items()}
        else:
            frame_combos = {}
        all_combo_keys = set(combo_counts.keys()) | set(frame_combos.keys())

        # Build detailed progress entries
        for combo_key in sorted(all_combo_keys):
            conducted = combo_counts.get(combo_key, 0)
            target = frame_combos.get(combo_key) if frame_combos else None

            # Get the values dict for this combination
            # `targets_combo_values` is built from an uploaded frame. In
            # by_variable mode the combination is a single choice value, so it
            # maps back to the one sampling column directly -- without this a
            # value that has a target but no submissions yet would render as
            # "Unknown" rather than by its own name.
            by_variable_values = (
                {sampling_variable: combo_key[0]}
                if mode == SAMPLING_MODE_BY_VARIABLE and sampling_variable and combo_key
                else None
            )
            values_dict = (
                combo_values_map.get(combo_key)
                or targets_combo_values.get(combo_key)
                or by_variable_values
                or dict.fromkeys(sampling_cols, "Unknown")
            )

            detailed.append(
                DetailedProgress(
                    values=values_dict,
                    conducted=conducted,
                    target=target,
                    progress=_percentage(conducted, target),
                )
            )

    return ProgressData(
        mode=mode,
        overall=overall,
        byColumn=by_column,
        detailed=detailed,
        samplingColumns=sampling_cols,
    )


def performance_unavailable(config: dict[str, Any] | None) -> PerformanceData:
    """
    No enumerator configured: an empty result carrying the reason, rather than
    every submission bucketed under a phantom "Unknown" enumerator that reads
    as real data.
    """
    return PerformanceData(
        unavailable=[
            UnavailableCapability(**item)
            for item in unavailable_capabilities(config)
            if item["capability"] == CAPABILITY_ENUMERATOR_PERFORMANCE
        ],
    )


def compute_performance(
    submissions: list[SubmissionCurrent], config: dict[str, Any]
) -> PerformanceData:
    """
    The named counts and measurements per enumerator, for submissions with no
    enumerator recorded, and for the whole team (services/metrics.py). The
    team is every submission, so its figures are Data quality's exactly.
    """
    enumerator_field = get_enumerator_field(config)

    by_enumerator: dict[str, list[SubmissionCurrent]] = defaultdict(list)
    no_enumerator: list[SubmissionCurrent] = []
    for sub in submissions:
        enum_id = answer_text(sub.submission_data, enumerator_field) if enumerator_field else None
        if enum_id is None:
            # Not an enumerator called "Unknown": that would join the
            # enumerator count and the rankings as if it were someone.
            no_enumerator.append(sub)
            continue
        by_enumerator[enum_id].append(sub)

    checks = built_in_checks(config)
    return PerformanceData(
        team=summarise(submissions, config),
        enumerators=[
            EnumeratorSummary(
                id=enum_id,
                durations=[round(m, 1) for m in durations(subs, config)[0]],
                **summarise(subs, config).model_dump(),
            )
            for enum_id, subs in sorted(by_enumerator.items())
        ],
        no_enumerator=summarise(no_enumerator, config) if no_enumerator else None,
        checks_on=[key for key, on in checks if on],
        checks_off=[key for key, on in checks if not on],
    )
