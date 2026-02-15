# Outlier Detection in Field Compass

## Overview

Field Compass includes automatic outlier detection for numeric variables as part of its High-Frequency Check (HFC) engine. This guide explains how outlier detection works, when it runs, what data it uses, and how to configure it.

## When Outlier Checks Run

Outlier checks are executed **during the ETL pipeline** as part of the HFC validation process:

1. **ETL Pipeline is triggered** (via API or CLI)
2. **Statistics are pre-computed** for all configured outlier variables using ALL existing submissions in the survey
3. **Each submission is validated** against these pre-computed statistics
4. **Outliers are flagged** and stored as quality issues in the database

### Key Points:
- ✅ Outlier checks run automatically during every ETL run
- ✅ Statistics are computed once per ETL run for consistency
- ✅ All submissions in the survey are checked, including both new and existing ones
- ❌ Outliers are NOT detected in real-time as data is submitted to Kobo
- ❌ Manual validation in the UI does NOT trigger outlier recalculation

## Data Used for Outlier Detection

### Statistical Baseline

Outlier detection uses **ALL submissions in the survey** to compute statistics:

```python
# From backend/etl/hfc_engine.py:precompute_outlier_statistics()
submissions = db.query(SubmissionCurrent).filter(
    SubmissionCurrent.survey_id == survey_id
).all()
```

### What This Means:

1. **Survey-wide statistics**: Each variable's statistics (mean, median, IQR, etc.) are calculated across ALL submissions for that survey
2. **No submission filtering**: All submissions are included regardless of:
   - Validation status (Approved, Not Approved, On Hold, Not Reviewed)
   - QA status (APPROVED, PENDING_APPROVAL, FLAGGED, REJECTED)
   - Date of submission
   - Enumerator
   - Any other filters

3. **Excluded values**:
   - Missing/null values
   - Non-numeric values
   - "Don't Know" (DK) values (configured via `dk_value` setting)

### Statistics Computed

For each outlier variable, the following statistics are calculated:

```python
{
    'mean': 45.2,           # Arithmetic mean
    'median': 42.0,         # Median value
    'std': 12.5,            # Standard deviation
    'q1': 35.0,             # First quartile (25th percentile)
    'q3': 55.0,             # Third quartile (75th percentile)
    'iqr': 20.0,            # Interquartile range (Q3 - Q1)
    'mad': 8.5,             # Median Absolute Deviation
    'mad_std': 12.6,        # MAD scaled to approximate std (1.4826 * MAD)
    'count': 150            # Number of valid values used
}
```

## Configuration

Outlier detection is configured in the survey's `config_data` JSON under the `quality_checks` section:

```json
{
  "quality_checks": {
    "flag_outliers": true,
    "outlier_variables": ["age", "income", "household_size"],
    "outlier_method": "iqr",
    "outlier_threshold": 1.5
  }
}
```

### Configuration Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `flag_outliers` | boolean | `false` | Enable/disable outlier detection |
| `outlier_variables` | array of strings | `[]` | List of variable names to check for outliers |
| `outlier_method` | string | `"iqr"` | Detection method: `"iqr"`, `"mad"`, or `"zscore"` |
| `outlier_threshold` | number | `1.5` | Threshold value (meaning depends on method) |

## Detection Methods

### 1. IQR (Interquartile Range) Method

**Default method** - Most commonly used, robust to extreme values.

**Formula:**
- Lower bound: Q1 - (threshold × IQR)
- Upper bound: Q3 + (threshold × IQR)
- A value is an outlier if it falls outside these bounds

**Threshold interpretation:**
- `1.5` (default): Standard "outlier" definition (values beyond the whiskers in box plots)
- `3.0`: "Far outlier" or "extreme outlier" definition
- Lower values = more sensitive (flags more outliers)
- Higher values = less sensitive (flags fewer outliers)

**Example:**
```
Q1 = 30, Q3 = 50, IQR = 20, threshold = 1.5
Lower bound = 30 - (1.5 × 20) = 0
Upper bound = 50 + (1.5 × 20) = 80
Any value < 0 or > 80 is flagged as an outlier
```

### 2. MAD (Median Absolute Deviation) Method

**Most robust method** - Resistant to extreme outliers, good for skewed distributions.

**Formula:**
- Modified Z-score: 0.6745 × (value - median) / MAD
- A value is an outlier if |modified Z-score| > threshold

**Threshold interpretation:**
- `3.5` (typical): Flags extreme values (comparable to 3 standard deviations)
- `2.5`: More sensitive
- MAD is more robust than standard deviation to extreme values

**Example:**
```
Median = 40, MAD = 5, threshold = 3.5
For value = 60:
Modified Z-score = 0.6745 × (60 - 40) / 5 = 2.7
Since 2.7 < 3.5, NOT an outlier

For value = 80:
Modified Z-score = 0.6745 × (80 - 40) / 5 = 5.4
Since 5.4 > 3.5, IS an outlier
```

### 3. Z-Score Method

**Classic statistical method** - Assumes normal distribution, sensitive to extreme values.

**Formula:**
- Z-score: (value - mean) / standard deviation
- A value is an outlier if |Z-score| > threshold

**Threshold interpretation:**
- `3.0` (typical): Values beyond 3 standard deviations (99.7% of data in normal distribution)
- `2.5`: More sensitive
- `2.0`: Very sensitive

**Example:**
```
Mean = 45, Std = 10, threshold = 3.0
For value = 80:
Z-score = (80 - 45) / 10 = 3.5
Since 3.5 > 3.0, IS an outlier
```

## Method Comparison

| Method | Robustness | Use Case | Typical Threshold |
|--------|------------|----------|-------------------|
| IQR | High | General purpose, skewed data | 1.5 (outliers), 3.0 (extreme) |
| MAD | Highest | Very skewed data, presence of extreme outliers | 3.5 |
| Z-score | Low | Normal distributions, no extreme outliers | 3.0 |

## Sample Size Considerations

The system provides warnings for small sample sizes:

| Sample Size | Status | Note |
|-------------|--------|------|
| < 2 values | No check performed | Cannot compute statistics |
| 2-4 values | Warning: "Very small sample size" | Results may be unreliable |
| 5-9 values | Note: "Small sample size" | Results should be interpreted cautiously |
| ≥ 10 values | Normal operation | Reliable statistics |

These warnings are included in the issue metadata.

## Outlier Issue Format

When an outlier is detected, it creates a `QualityIssue` with the following structure:

```json
{
  "check": "outlier_age",
  "field": "demographics/age",
  "value": 150,
  "message": "Value 150 is an outlier (IQR method, threshold: 1.5)",
  "metadata": {
    "method": "iqr",
    "threshold": 1.5,
    "bounds": {
      "lower_bound": 10.0,
      "upper_bound": 75.0
    },
    "statistics": {
      "mean": 42.5,
      "median": 41.0,
      "count": 245
    },
    "sample_size_warning": "NOTE: Small sample size"  // Only if < 10 values
  }
}
```

## Implementation Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    ETL Pipeline Starts                       │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Step 1: Pre-compute Statistics (Once per ETL run)          │
│  ─────────────────────────────────────────────────────      │
│  For each outlier_variable:                                 │
│    1. Query ALL submissions in survey                       │
│    2. Extract numeric values for variable                   │
│    3. Exclude nulls, non-numeric, DK values                 │
│    4. Calculate: mean, median, std, Q1, Q3, IQR, MAD        │
│    5. Cache statistics in memory                            │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Step 2: Process Each Submission                            │
│  ─────────────────────────────────────────────────────      │
│  For each submission:                                       │
│    1. Run HFC checks (including outlier checks)             │
│    2. For each outlier_variable:                            │
│       - Get value from submission                           │
│       - Retrieve cached statistics                          │
│       - Apply detection method (IQR/MAD/Z-score)            │
│       - Flag if outlier detected                            │
│    3. Store quality issues in database                      │
│    4. Update qa_status based on issues                      │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    ETL Pipeline Completes                    │
│  Results: X fetched, Y created, Z updated, W flagged        │
└─────────────────────────────────────────────────────────────┘
```

## Important Behavioral Notes

### 1. Statistics Are Survey-Wide
- Statistics are calculated from **all submissions** in the survey
- No filtering by enumerator, date, or validation status
- This ensures consistency but means:
  - Early submissions have limited baseline data
  - Low-quality submissions influence the baseline
  - Approved/rejected submissions are treated equally

### 2. Statistics Are Pre-computed
- Statistics are computed **once** at the start of each ETL run
- All submissions in that ETL run use the **same** statistical baseline
- This ensures:
  - Consistent outlier detection across all submissions
  - Better performance (no repeated calculations)
  - But: Statistics reflect the database state at ETL start, not updated per submission

### 3. Re-running ETL Updates Outliers
- Outlier status can **change** between ETL runs as:
  - More data is collected (statistics become more accurate)
  - Statistical baseline shifts
  - Threshold or method is changed in configuration
- Previously flagged outliers may be cleared
- Previously acceptable values may be flagged

### 4. No Real-time Detection
- Outliers are only detected during ETL runs
- Submissions in Kobo that haven't been processed by ETL have no outlier status
- Manual validation updates do NOT trigger outlier recalculation

## Best Practices

### 1. Bootstrap Period
Allow for a "bootstrap period" at the start of data collection:
- First 20-50 submissions may have unreliable outlier detection
- Consider disabling outlier checks or using higher thresholds initially
- Enable stricter checks once sufficient baseline data exists

### 2. Method Selection
- **Start with IQR (threshold: 1.5)**: Good default for most cases
- **Switch to MAD**: If you have very skewed data or extreme values affecting IQR
- **Use Z-score cautiously**: Only if you're confident data is normally distributed

### 3. Threshold Tuning
- Start conservative (higher threshold) to avoid false positives
- Monitor flagged values to assess if threshold is appropriate
- Adjust based on field context and data characteristics

### 4. Regular ETL Runs
- Run ETL regularly to keep outlier detection up-to-date
- More frequent runs = more accurate baselines
- Consider scheduled runs (e.g., daily) for active data collection

### 5. Variable Selection
- Choose variables where outliers are meaningful
- Avoid binary or categorical variables (use validation rules instead)
- Focus on continuous numeric variables (age, income, duration, counts, etc.)

### 6. Review Flagged Outliers
- Outliers aren't necessarily errors
- Review context: legitimate extreme values vs. data entry errors
- Use the Quality Dashboard to identify patterns

## Configuration Example

Here's a complete example for a household survey:

```json
{
  "core_identifiers": {
    "uuid": "_uuid",
    "enumerator": "enumerator_id",
    "date_interview": "interview_date"
  },
  "quality_checks": {
    "flag_outliers": true,
    "outlier_variables": [
      "respondent_age",
      "household_size",
      "monthly_income",
      "years_of_education"
    ],
    "outlier_method": "iqr",
    "outlier_threshold": 1.5,
    "dk_value": -99,
    "flag_weekend": true,
    "flag_out_of_period": true,
    "data_collection_start_date": "2024-01-01",
    "data_collection_end_date": "2024-12-31"
  },
  "sampling_frame": {
    "sampling_cols": ["district", "village"],
    "frame_data": [...]
  }
}
```

## Troubleshooting

### Issue: Too many false positives
**Solution:** Increase threshold or switch to MAD method

### Issue: Not detecting obvious outliers
**Solution:** Decrease threshold or check if variable is in `outlier_variables` list

### Issue: Outlier status keeps changing
**Solution:** This is normal as baseline evolves. Consider setting minimum submission count before enabling checks.

### Issue: No outliers detected at all
**Solution:** 
- Check `flag_outliers` is `true`
- Verify `outlier_variables` contains the correct variable names
- Check variable names match Kobo field names (including group paths)
- Ensure ETL has run at least once

### Issue: "No cached statistics available"
**Solution:** 
- ETL needs to run fully at least once to pre-compute statistics
- Check that there are at least 2 valid numeric values for the variable

## Future Enhancements

Potential improvements to outlier detection:

1. **Stratified outlier detection**: Calculate statistics per enumerator or geographic area
2. **Time-based baselines**: Use rolling windows or exclude old data
3. **Approved-only baselines**: Calculate statistics only from approved submissions
4. **Configurable exclusions**: Allow excluding certain submissions from baseline calculation
5. **Real-time detection**: Detect outliers as submissions arrive (requires architecture change)
6. **Multi-variable outlier detection**: Detect outliers in multivariate space (e.g., Mahalanobis distance)

## Related Documentation

- [ETL Package README](./backend/etl/README.md) - ETL pipeline overview
- [Quality Dashboard Spec](./docs/specs/quality-dashboard-spec.md) - Quality dashboard features
- [HFC Engine Code](./backend/etl/hfc_engine.py) - Implementation details
