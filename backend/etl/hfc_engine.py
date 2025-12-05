"""
High-Frequency Check (HFC) Engine
Performs data quality checks on submissions based on validation rules.
"""

import re
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional, Tuple
from sqlalchemy.orm import Session
import logging
from simpleeval import SimpleEval
import statistics
import math

from database.models import ValidationRule, SurveyConfig, SubmissionCurrent
from models import QualityIssue

logger = logging.getLogger(__name__)


class HFCEngine:
    """High-Frequency Check engine for data quality validation."""
    
    def __init__(self, db: Session, survey_config: SurveyConfig):
        """
        Initialize HFC engine.
        
        Args:
            db: Database session
            survey_config: Survey configuration object
        """
        self.db = db
        self.survey_config = survey_config
        self.config_data = survey_config.config_data
        
        # Extract configuration - handle nested structure
        core_identifiers = self.config_data.get('core_identifiers', {})
        special_values = self.config_data.get('special_values', {})
        global_parameters = self.config_data.get('global_parameters', {})
        quality_checks = self.config_data.get('quality_checks', {})
        
        # Core identifiers
        self.uuid_field = core_identifiers.get('uuid', '_uuid')
        self.enumerator_field = core_identifiers.get('enumerator', 'enumerator_id')
        self.date_interview_field = core_identifiers.get('date_interview', 'today')
        self.start_time_field = core_identifiers.get('start_time', 'start')
        self.end_time_field = core_identifiers.get('end_time', 'end')
        
        # Special values
        self.dk_value = special_values.get('dk_value', -99)
        self.dk_string_value = special_values.get('dk_string_value', 'dk')
        
        # Global parameters - date range
        self.data_collection_start_date = global_parameters.get('data_collection_start_date')
        self.data_collection_end_date = global_parameters.get('data_collection_end_date')
        
        # Global parameters - duration limits - ensure they're numbers or None
        min_duration = global_parameters.get('min_survey_duration_minutes')
        max_duration = global_parameters.get('max_survey_duration_minutes')
        try:
            self.min_survey_duration_minutes = float(min_duration) if min_duration is not None else None
        except (ValueError, TypeError):
            self.min_survey_duration_minutes = None
        try:
            self.max_survey_duration_minutes = float(max_duration) if max_duration is not None else None
        except (ValueError, TypeError):
            self.max_survey_duration_minutes = None

        # Quality checks configuration
        self.flag_out_of_period = quality_checks.get('flag_out_of_period', False)
        self.flag_weekend = quality_checks.get('flag_weekend', False)
        self.weekend_days = quality_checks.get('weekend_days', [5, 6]) # Default to Sat(5), Sun(6)
        self.flag_office_hours = quality_checks.get('flag_office_hours', False)
        self.office_hours_start = quality_checks.get('office_hours_start', '08:00')
        self.office_hours_end = quality_checks.get('office_hours_end', '17:00')
        self.flag_sampling_frame = quality_checks.get('flag_sampling_frame', False)
        
        # Outlier detection configuration
        self.flag_outliers = quality_checks.get('flag_outliers', False)
        self.outlier_variables = quality_checks.get('outlier_variables', [])
        self.outlier_method = quality_checks.get('outlier_method', 'iqr')  # 'iqr', 'mad', or 'zscore'
        self.outlier_threshold = quality_checks.get('outlier_threshold', 1.5)  # For IQR multiplier or Z-score threshold

        # Statistics cache for outlier detection - computed once per ETL run
        self._outlier_stats_cache: Dict[str, Dict[str, float]] = {}

        # Sampling frame configuration
        sampling_frame_config = self.config_data.get('sampling_frame', {})
        self.sampling_cols = sampling_frame_config.get('sampling_cols', [])
        self.frame_data = sampling_frame_config.get('frame_data', [])

    def precompute_outlier_statistics(self) -> None:
        """
        Pre-compute statistics for all configured outlier variables.
        This should be called once at the beginning of an ETL run to ensure
        consistent statistics across all submissions.
        """
        if not self.flag_outliers or not self.outlier_variables:
            return

        logger.info(f"Pre-computing outlier statistics for variables: {self.outlier_variables}")

        # Get all existing submissions for this survey
        submissions = self.db.query(SubmissionCurrent).filter(
            SubmissionCurrent.survey_id == self.survey_config.survey_id
        ).all()

        for variable in self.outlier_variables:
            try:
                # Extract values for this variable from all submissions
                values = []
                for submission in submissions:
                    value, _ = self._get_field_value(submission.submission_data, variable)
                    if value is None:
                        continue

                    # Convert to numeric
                    numeric_value = self._convert_value_type(value)
                    if not isinstance(numeric_value, (int, float)):
                        continue

                    # Skip DK values
                    if isinstance(numeric_value, (int, float)) and numeric_value == self.dk_value:
                        continue

                    values.append(float(numeric_value))

                # Compute statistics
                if len(values) >= 2:  # Need at least 2 values
                    stats = self._compute_statistics_from_values(values)
                    if stats:
                        self._outlier_stats_cache[variable] = stats
                        logger.debug(f"Pre-computed stats for {variable}: mean={stats['mean']:.3f}, count={stats['count']}")
                    else:
                        logger.warning(f"Failed to compute statistics for variable {variable}")
                else:
                    logger.warning(f"Insufficient data for outlier statistics on variable {variable} (only {len(values)} values)")

            except Exception as e:
                logger.error(f"Error pre-computing statistics for variable {variable}: {e}", exc_info=True)

    def _compute_statistics_from_values(self, values: List[float]) -> Optional[Dict[str, float]]:
        """
        Compute statistics from a list of values.

        Args:
            values: List of numeric values

        Returns:
            Dictionary with statistics or None if computation fails
        """
        try:
            values_sorted = sorted(values)
            n = len(values_sorted)

            # Basic statistics
            mean = statistics.mean(values)
            median = statistics.median(values)

            # Standard deviation
            std = statistics.stdev(values) if n > 1 else 0.0

            # Quartiles for IQR
            q1_idx = int(n * 0.25)
            q3_idx = int(n * 0.75)
            q1 = values_sorted[q1_idx] if q1_idx < n else values_sorted[0]
            q3 = values_sorted[q3_idx] if q3_idx < n else values_sorted[-1]
            iqr = q3 - q1 if q3 > q1 else 0.0

            # Median Absolute Deviation (MAD)
            deviations = [abs(v - median) for v in values]
            mad = statistics.median(deviations) if deviations else 0.0
            # Modified Z-score uses 1.4826 * MAD to approximate standard deviation
            mad_std = 1.4826 * mad if mad > 0 else 0.0

            return {
                'mean': mean,
                'median': median,
                'std': std,
                'q1': q1,
                'q3': q3,
                'iqr': iqr,
                'mad': mad,
                'mad_std': mad_std,
                'count': n
            }
        except Exception as e:
            logger.error(f"Error computing statistics from values: {e}", exc_info=True)
            return None

    def _convert_value_type(self, value: Any) -> Any:
        """
        Convert string numeric values to appropriate numeric types.

        This handles the case where Kobo API returns numeric values as strings.
        Attempts to convert strings that look like numbers to int/float.

        Args:
            value: The value to potentially convert

        Returns:
            The converted value (int, float, or original value if conversion fails)
        """
        if not isinstance(value, str):
            # Already a non-string type, return as-is
            return value

        # Skip empty strings and strings that are clearly not numbers
        if not value.strip() or value.lower() in ['dk', 'n/a', 'na', 'none', 'null']:
            return value

        # Try to convert to int first
        try:
            # Check if it's a whole number by converting to float first
            float_val = float(value)
            if float_val == int(float_val):
                return int(float_val)
            else:
                return float_val
        except (ValueError, TypeError):
            # Not a numeric string, return original value
            return value

    def _get_field_value(self, submission_data: Dict[str, Any], field_name: str) -> Tuple[Any, Optional[str]]:
        """
        Get field value from submission data, handling Kobo path-based field names.
        
        Kobo stores fields with full paths like 'module/variable' or 'module1/module2/variable',
        but config may only specify 'variable'. This function searches for the field by:
        1. Direct lookup (exact match)
        2. Path-based search (field name at end of path, e.g., 'module/variable' matches 'variable')
        
        Args:
            submission_data: Submission data dictionary
            field_name: Field name from config (may be just the variable name)
            
        Returns:
            Tuple of (value, actual_field_path) where actual_field_path is the full path found
        """
        # First try direct lookup
        if field_name in submission_data:
            return submission_data[field_name], field_name
        
        # Search for fields that end with the field name (path-based)
        # e.g., 'enumerator_id' should match 'sampling_information/enumerator_id'
        for key in submission_data.keys():
            if key.endswith(f'/{field_name}') or key == field_name:
                return submission_data[key], key
        
        # Not found
        return None, None
    
    def run_checks(
        self, 
        submission_data: Dict[str, Any], 
        submission_uuid: str,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None
    ) -> List[QualityIssue]:
        """
        Run all HFC checks on a submission.
        
        Args:
            submission_data: Submission data dictionary
            submission_uuid: UUID of the submission
            start_time: Submission start time (from metadata, optional, deprecated - not used)
            end_time: Submission end time (from metadata, optional, deprecated - not used)
            
        Returns:
            List of QualityIssue objects
            
        Note:
            Duration checks use audit logs (active_interview_time) or form fields (start/end).
            Metadata timestamps are NOT used for duration calculation.
        """
        issues = []
        
        # Run basic checks
        issues.extend(self._run_basic_checks(submission_data, submission_uuid, start_time, end_time))
        
        # Run custom validation rules from database
        issues.extend(self._run_custom_rules(submission_data, submission_uuid))
        
        return issues
    
    def _run_basic_checks(
        self, 
        submission_data: Dict[str, Any], 
        submission_uuid: str,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None
    ) -> List[QualityIssue]:
        """
        Run basic HFC checks.
        
        Note: start_time and end_time parameters are kept for API compatibility
        but are NOT used for duration checks (only audit logs and form fields are used).
        """
        """Run basic built-in checks."""
        issues = []
        
        # 1. Check for missing UUID
        if not submission_uuid or submission_uuid.strip() == '':
            issues.append(QualityIssue(
                check="missing_uuid",
                field=self.uuid_field,
                value=None,
                message="Missing UUID"
            ))
        
        # 2. Check for missing enumerator ID
        enumerator_id, enumerator_field_path = self._get_field_value(submission_data, self.enumerator_field)
        if not enumerator_id or (isinstance(enumerator_id, str) and enumerator_id.strip() == ''):
            issues.append(QualityIssue(
                check="missing_enumerator",
                field=enumerator_field_path or self.enumerator_field,
                value=enumerator_id,
                message=f"Missing enumerator ID in field '{enumerator_field_path or self.enumerator_field}'"
            ))
        
        # 3. Check date range and time
        date_value, date_field_path = self._get_field_value(submission_data, self.date_interview_field)
        start_time_value, start_time_path = self._get_field_value(submission_data, self.start_time_field)

        if date_value:
            try:
                # Try to parse date (handle various formats)
                if isinstance(date_value, str):
                    # Try ISO format first
                    try:
                        interview_date = datetime.fromisoformat(date_value.replace('Z', '+00:00')).date()
                    except:
                        # Try other common formats
                        for fmt in ['%Y-%m-%d', '%d/%m/%Y', '%m/%d/%Y']:
                            try:
                                interview_date = datetime.strptime(date_value, fmt).date()
                                break
                            except:
                                continue
                        else:
                            raise ValueError(f"Could not parse date: {date_value}")
                elif isinstance(date_value, datetime):
                    interview_date = date_value.date()
                else:
                    interview_date = None
                
                if interview_date:
                    # Check against allowed date range (if flag is enabled)
                    if self.flag_out_of_period:
                        if self.data_collection_start_date:
                            try:
                                start_date = datetime.fromisoformat(self.data_collection_start_date).date()
                                if interview_date < start_date:
                                    issues.append(QualityIssue(
                                        check="date_out_of_range",
                                        field=date_field_path or self.date_interview_field,
                                        value=str(interview_date),
                                        message=f"Interview date {interview_date} is before allowed start date {start_date}"
                                    ))
                            except:
                                pass
                        
                        if self.data_collection_end_date:
                            try:
                                end_date = datetime.fromisoformat(self.data_collection_end_date).date()
                                if interview_date > end_date:
                                    issues.append(QualityIssue(
                                        check="date_out_of_range",
                                        field=date_field_path or self.date_interview_field,
                                        value=str(interview_date),
                                        message=f"Interview date {interview_date} is after allowed end date {end_date}"
                                    ))
                            except:
                                pass
                    
                    # Check for weekend interviews (if flag is enabled)
                    if self.flag_weekend:
                        weekday = interview_date.weekday()  # 0=Monday, 6=Sunday
                        if weekday in self.weekend_days:
                            issues.append(QualityIssue(
                                check="interview_on_weekend",
                                field=date_field_path or self.date_interview_field,
                                value=str(interview_date),
                                message=f"Interview conducted on weekend: {interview_date.strftime('%A')}"
                            ))

            except Exception as e:
                logger.debug(f"Could not parse date for validation: {e}")
        
        # Check office hours
        if self.flag_office_hours and start_time_value:
            try:
                # Try to extract time from start_time_value
                submission_time = None
                if isinstance(start_time_value, str):
                    try:
                        # Try ISO datetime
                        dt = datetime.fromisoformat(start_time_value.replace('Z', '+00:00'))
                        submission_time = dt.time()
                    except:
                         # Try parsing as just time if possible (though unlikely for Kobo 'start')
                         pass
                elif isinstance(start_time_value, datetime):
                    submission_time = start_time_value.time()
                
                if submission_time:
                    office_start = datetime.strptime(self.office_hours_start, "%H:%M").time()
                    office_end = datetime.strptime(self.office_hours_end, "%H:%M").time()
                    
                    if submission_time < office_start or submission_time > office_end:
                         issues.append(QualityIssue(
                            check="interview_out_of_office_hours",
                            field=start_time_path or self.start_time_field,
                            value=str(submission_time),
                            message=f"Interview started outside office hours ({self.office_hours_start} - {self.office_hours_end}): {submission_time}"
                        ))
            except Exception as e:
                logger.debug(f"Could not parse time for office hours validation: {e}")

        # 4. Check sampling frame (if flag is enabled)
        if self.flag_sampling_frame:
            sampling_frame_issues = self._check_sampling_frame(submission_data)
            issues.extend(sampling_frame_issues)

        # 5. Check survey duration
        # Note: start_time/end_time are not used - duration check uses audit logs or form fields only
        duration_issues = self._check_duration(submission_data)
        issues.extend(duration_issues)
        
        # 6. Check for outliers (if flag is enabled)
        if self.flag_outliers and self.outlier_variables:
            outlier_issues = self._check_outliers(submission_data, submission_uuid)
            issues.extend(outlier_issues)
        
        return issues
    
    def _check_duration(
        self, 
        submission_data: Dict[str, Any],
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None
    ) -> List[QualityIssue]:
        """
        Check survey duration against min/max limits.
        
        Uses two-tier approach:
        1. Priority 1: active_interview_time from audit logs (if available)
        2. Priority 2: start/end fields from submission_data (form timestamps)
        
        Note: Does NOT use metadata timestamps (_submission_time, end) as these
        represent server upload time, not actual form duration.
        """
        issues = []
        
        logger.debug(f"Duration check: min={self.min_survey_duration_minutes}, max={self.max_survey_duration_minutes}")
        
        # Priority 1: Try to get active_interview_time from audit logs (if available)
        active_time = submission_data.get('active_interview_time')
        logger.debug(f"Duration check: active_interview_time from data={active_time}")
        
        if active_time is not None:
            try:
                duration_minutes = float(active_time)
                logger.debug(f"Using active_interview_time: {duration_minutes} minutes")
                
                if self.min_survey_duration_minutes is not None and duration_minutes < self.min_survey_duration_minutes:
                    issues.append(QualityIssue(
                        check="duration_too_short",
                        field="active_interview_time",
                        value=duration_minutes,
                        message=f"Active survey duration too short ({duration_minutes:.2f} min < {self.min_survey_duration_minutes} min)"
                    ))
                
                if self.max_survey_duration_minutes is not None and duration_minutes > self.max_survey_duration_minutes:
                    issues.append(QualityIssue(
                        check="duration_too_long",
                        field="active_interview_time",
                        value=duration_minutes,
                        message=f"Active survey duration too long ({duration_minutes:.2f} min > {self.max_survey_duration_minutes} min)"
                    ))
            except (ValueError, TypeError):
                pass
        else:
            # Priority 2: Use start/end fields from submission data (form timestamps)
            logger.debug(f"Using submission data fields: {self.start_time_field}, {self.end_time_field}")
            logger.debug(f"Submission data keys (sample): {list(submission_data.keys())[:20]}")
            start_time_data, start_field_path = self._get_field_value(submission_data, self.start_time_field)
            end_time_data, end_field_path = self._get_field_value(submission_data, self.end_time_field)
            logger.debug(f"Found in submission data: start={start_time_data} (path={start_field_path}), end={end_time_data} (path={end_field_path})")
            
            if start_time_data and end_time_data:
                try:
                    if isinstance(start_time_data, str):
                        start_dt = datetime.fromisoformat(start_time_data.replace('Z', '+00:00'))
                    else:
                        start_dt = start_time_data
                    
                    if isinstance(end_time_data, str):
                        end_dt = datetime.fromisoformat(end_time_data.replace('Z', '+00:00'))
                    else:
                        end_dt = end_time_data
                    
                    duration_minutes = (end_dt - start_dt).total_seconds() / 60
                    logger.debug(f"Using submission data timestamps: {duration_minutes} minutes")
                    
                    if self.min_survey_duration_minutes is not None and duration_minutes < self.min_survey_duration_minutes:
                        issues.append(QualityIssue(
                            check="duration_too_short",
                            field="duration_minutes",
                            value=duration_minutes,
                            message=f"Survey duration too short ({duration_minutes:.2f} min < {self.min_survey_duration_minutes} min)"
                        ))
                    
                    if self.max_survey_duration_minutes is not None and duration_minutes > self.max_survey_duration_minutes:
                        issues.append(QualityIssue(
                            check="duration_too_long",
                            field="duration_minutes",
                            value=duration_minutes,
                            message=f"Survey duration too long ({duration_minutes:.2f} min > {self.max_survey_duration_minutes} min)"
                        ))
                except Exception as e:
                    logger.debug(f"Could not calculate duration from submission data fields: {e}")
            else:
                logger.debug("No start/end time data found in submission data fields - cannot calculate duration")
        
        logger.debug(f"Duration check complete: {len(issues)} issues found")
        return issues
    
    def _check_sampling_frame(self, submission_data: Dict[str, Any]) -> List[QualityIssue]:
        """
        Check if submission's sampling column values match the sampling frame.
        
        If the combination of sampling column values from the submission doesn't exist
        in the sampling frame, this creates a quality issue.
        
        Args:
            submission_data: Submission data dictionary
            
        Returns:
            List of QualityIssue objects (empty if no issues found)
        """
        issues = []
        
        # Skip check if sampling frame is not configured
        if not self.sampling_cols or not self.frame_data:
            logger.debug("Sampling frame check skipped: no sampling_cols or frame_data configured")
            return issues
        
        # Extract sampling column values from submission
        submission_values = {}
        missing_cols = []
        
        for col in self.sampling_cols:
            value, field_path = self._get_field_value(submission_data, col)
            if value is None and field_path is None:
                missing_cols.append(col)
            else:
                # Convert to string for comparison (handle None values)
                submission_values[col] = str(value) if value is not None else "Unknown"
        
        # If any required sampling columns are missing, skip the check
        if missing_cols:
            logger.debug(f"Sampling frame check skipped: missing columns {missing_cols} in submission")
            return issues
        
        # Build a set of valid combinations from frame_data
        # Each combination is a tuple of (col1_value, col2_value, ...)
        valid_combinations = set()
        for row in self.frame_data:
            combo = tuple(
                str(row.get(col, "Unknown")) if row.get(col) is not None else "Unknown"
                for col in self.sampling_cols
            )
            valid_combinations.add(combo)
        
        # Check if submission's combination exists in frame
        submission_combo = tuple(submission_values[col] for col in self.sampling_cols)
        
        if submission_combo not in valid_combinations:
            # Build a descriptive message showing the values
            combo_description = ", ".join(
                f"{col}={submission_values[col]}" for col in self.sampling_cols
            )
            
            issues.append(QualityIssue(
                check="sampling_frame_mismatch",
                field=", ".join(self.sampling_cols),
                value=combo_description,
                message=f"Submission sampling combination not in sampling frame: {combo_description}"
            ))
            logger.debug(f"Sampling frame check failed: combination {submission_combo} not found in frame")
        else:
            logger.debug(f"Sampling frame check passed: combination {submission_combo} found in frame")
        
        return issues
    
    def _check_outliers(self, submission_data: Dict[str, Any], submission_uuid: str) -> List[QualityIssue]:
        """
        Check for outliers in specified variables using the configured method.

        Args:
            submission_data: Submission data dictionary
            submission_uuid: UUID of the current submission (to exclude from stats computation)

        Returns:
            List of QualityIssue objects (empty if no outliers found)
        """
        issues = []

        if not self.outlier_variables:
            return issues
        
        # Compute statistics for each variable from all existing submissions
        for variable in self.outlier_variables:
            try:
                # Get value for this variable from current submission
                value, field_path = self._get_field_value(submission_data, variable)
                
                # Skip if value is missing or is a special value (DK/NA)
                if value is None:
                    continue
                
                # Convert to numeric if possible
                numeric_value = self._convert_value_type(value)
                if not isinstance(numeric_value, (int, float)):
                    continue  # Skip non-numeric values
                
                # Check for DK values
                if isinstance(numeric_value, (int, float)) and numeric_value == self.dk_value:
                    continue
                
                # Get cached statistics for this variable
                stats = self._outlier_stats_cache.get(variable)

                if stats is None:
                    logger.debug(f"Outlier check skipped for '{variable}': no cached statistics available")
                    continue

                # Check for small datasets and provide warning context
                sample_size_warning = ""
                if stats['count'] < 5:
                    sample_size_warning = "WARNING: Very small sample size"
                elif stats['count'] < 10:
                    sample_size_warning = "NOTE: Small sample size"
                
                # Check if value is an outlier using the configured method
                is_outlier = self._is_outlier(numeric_value, stats, self.outlier_method, self.outlier_threshold)
                
                if is_outlier:
                    method_name = self.outlier_method.upper()

                    # Calculate bounds for display
                    bounds_info = self._get_outlier_bounds(numeric_value, stats, self.outlier_method, self.outlier_threshold)

                    # Include statistical context in metadata
                    metadata = {
                        "method": self.outlier_method,
                        "threshold": self.outlier_threshold,
                        "bounds": bounds_info,
                        "statistics": {
                            "mean": round(stats['mean'], 3),
                            "median": round(stats['median'], 3),
                            "count": stats['count']
                        }
                    }

                    # Add sample size warning if applicable
                    if sample_size_warning:
                        metadata["sample_size_warning"] = sample_size_warning

                    issues.append(QualityIssue(
                        check=f"outlier_{variable}",
                        field=field_path or variable,
                        value=numeric_value,
                        message=f"Value {numeric_value} is an outlier ({method_name} method, threshold: {self.outlier_threshold})",
                        metadata=metadata
                    ))
                    logger.debug(f"Outlier detected: {variable}={numeric_value} using {self.outlier_method}")
                    
            except Exception as e:
                logger.warning(f"Error checking outlier for variable '{variable}': {e}", exc_info=True)
                continue
        
        return issues
    
    def _compute_variable_statistics(self, variable: str, exclude_uuid: Optional[str] = None) -> Optional[Dict[str, float]]:
        """
        Compute statistics for a variable from all submissions in the survey.
        
        Args:
            variable: Variable name to compute statistics for
            exclude_uuid: Optional UUID to exclude from computation (current submission)
            
        Returns:
            Dictionary with statistics (mean, median, std, q1, q3, mad) or None if insufficient data
        """
        # Query all submissions for this survey
        query = self.db.query(SubmissionCurrent).filter(
            SubmissionCurrent.survey_id == self.survey_config.survey_id
        )
        
        # Exclude current submission if provided
        if exclude_uuid:
            query = query.filter(SubmissionCurrent._uuid != exclude_uuid)
        
        submissions = query.all()
        
        # Extract values for this variable
        values = []
        for submission in submissions:
            value, _ = self._get_field_value(submission.submission_data, variable)
            if value is None:
                continue
            
            # Convert to numeric
            numeric_value = self._convert_value_type(value)
            if not isinstance(numeric_value, (int, float)):
                continue
            
            # Skip DK values
            if isinstance(numeric_value, (int, float)) and numeric_value == self.dk_value:
                continue
            
            values.append(float(numeric_value))
        
        # Handle small datasets - need at least 2 values, but provide warnings for very small datasets
        if len(values) < 2:
            return None  # Can't compute meaningful statistics with less than 2 values
        
        # Compute statistics
        try:
            values_sorted = sorted(values)
            n = len(values_sorted)
            
            # Basic statistics
            mean = statistics.mean(values)
            median = statistics.median(values)
            
            # Standard deviation
            if n > 1:
                std = statistics.stdev(values) if n > 1 else 0.0
            else:
                std = 0.0
            
            # Quartiles for IQR
            q1_idx = int(n * 0.25)
            q3_idx = int(n * 0.75)
            q1 = values_sorted[q1_idx] if q1_idx < n else values_sorted[0]
            q3 = values_sorted[q3_idx] if q3_idx < n else values_sorted[-1]
            iqr = q3 - q1 if q3 > q1 else 0.0
            
            # Median Absolute Deviation (MAD) for robust outlier detection
            deviations = [abs(v - median) for v in values]
            mad = statistics.median(deviations) if deviations else 0.0
            # Modified Z-score uses 1.4826 * MAD to approximate standard deviation
            mad_std = 1.4826 * mad if mad > 0 else 0.0
            
            return {
                'mean': mean,
                'median': median,
                'std': std,
                'q1': q1,
                'q3': q3,
                'iqr': iqr,
                'mad': mad,
                'mad_std': mad_std,
                'count': n
            }
        except Exception as e:
            logger.warning(f"Error computing statistics for variable '{variable}': {e}", exc_info=True)
            return None
    
    def _is_outlier(self, value: float, stats: Dict[str, float], method: str, threshold: float) -> bool:
        """
        Check if a value is an outlier using the specified method.
        
        Args:
            value: Value to check
            stats: Statistics dictionary from _compute_variable_statistics
            method: Method to use ('iqr', 'mad', or 'zscore')
            threshold: Threshold value (multiplier for IQR/MAD, or z-score threshold)
            
        Returns:
            True if value is an outlier, False otherwise
        """
        if method == 'iqr':
            # IQR method: outlier if value < Q1 - threshold*IQR or value > Q3 + threshold*IQR
            q1 = stats['q1']
            q3 = stats['q3']
            iqr = stats['iqr']
            
            if iqr == 0:
                return False  # Can't detect outliers if IQR is 0
            
            lower_bound = q1 - threshold * iqr
            upper_bound = q3 + threshold * iqr
            
            return value < lower_bound or value > upper_bound
        
        elif method == 'mad':
            # Modified Z-score using MAD: outlier if |modified_z_score| > threshold
            # Formula: M = 0.6745 * (x - median) / MAD
            median = stats['median']
            mad = stats['mad']
            
            if mad == 0:
                return False  # Can't detect outliers if MAD is 0
            
            modified_z_score = 0.6745 * (value - median) / mad
            
            return abs(modified_z_score) > threshold
        
        elif method == 'zscore':
            # Z-score method: outlier if |z_score| > threshold
            mean = stats['mean']
            std = stats['std']
            
            if std == 0:
                return False  # Can't detect outliers if std is 0
            
            z_score = (value - mean) / std
            
            return abs(z_score) > threshold
        
        else:
            logger.warning(f"Unknown outlier method: {method}")
            return False

    def _get_outlier_bounds(self, value: float, stats: Dict[str, float], method: str, threshold: float) -> Dict[str, float]:
        """
        Calculate the upper and lower bounds for an outlier based on the detection method.

        Args:
            value: The outlier value (for context)
            stats: Statistics dictionary
            method: Detection method ('iqr', 'mad', or 'zscore')
            threshold: Threshold value

        Returns:
            Dictionary with lower_bound and upper_bound
        """
        if method == 'iqr':
            q1 = stats['q1']
            q3 = stats['q3']
            iqr = stats['iqr']

            if iqr == 0:
                return {"lower_bound": q1, "upper_bound": q3, "note": "No variation in data"}

            lower_bound = q1 - threshold * iqr
            upper_bound = q3 + threshold * iqr

            return {"lower_bound": round(lower_bound, 3), "upper_bound": round(upper_bound, 3)}

        elif method == 'mad':
            median = stats['median']
            mad = stats['mad']

            if mad == 0:
                return {"lower_bound": median, "upper_bound": median, "note": "No variation in data"}

            # For MAD, the bounds are theoretical - we show the threshold distance from median
            # The actual bounds depend on the MAD value and threshold
            bound_distance = (threshold * mad) / 0.6745  # Convert back to approximate std units

            lower_bound = median - bound_distance
            upper_bound = median + bound_distance

            return {"lower_bound": round(lower_bound, 3), "upper_bound": round(upper_bound, 3)}

        elif method == 'zscore':
            mean = stats['mean']
            std = stats['std']

            if std == 0:
                return {"lower_bound": mean, "upper_bound": mean, "note": "No variation in data"}

            lower_bound = mean - threshold * std
            upper_bound = mean + threshold * std

            return {"lower_bound": round(lower_bound, 3), "upper_bound": round(upper_bound, 3)}

        else:
            return {"lower_bound": 0, "upper_bound": 0, "note": "Unknown method"}
    
    def _run_custom_rules(self, submission_data: Dict[str, Any], submission_uuid: str) -> List[QualityIssue]:
        """Run custom validation rules from database."""
        issues = []
        
        # Fetch active validation rules for this survey
        rules = self.db.query(ValidationRule).filter(
            ValidationRule.survey_id == self.survey_config.survey_id,
            ValidationRule.is_active == True
        ).all()
        
        logger.debug(f"Found {len(rules)} active validation rules for survey {self.survey_config.survey_id}")
        
        for rule in rules:
            try:
                rule_data = rule.rule_data
                logger.debug(f"Evaluating rule '{rule.rule_name}' with expression: {rule_data.get('check_expression')}")
                rule_issues = self._evaluate_rule(rule_data, submission_data, submission_uuid)
                if rule_issues:
                    logger.info(f"Rule '{rule.rule_name}' generated {len(rule_issues)} issue(s)")
                issues.extend(rule_issues)
            except Exception as e:
                logger.error(f"Error evaluating rule '{rule.rule_name}': {e}", exc_info=True)
                continue
        
        return issues
    
    def _evaluate_rule(self, rule_data: Dict[str, Any], submission_data: Dict[str, Any], submission_uuid: str) -> List[QualityIssue]:
        """
        Evaluate a single validation rule.
        
        Rule format:
        {
            "check_id": "outlier_age",
            "issue": "Age is an outlier",
            "check_expression": "age > 90",
            "variables_involved": ["age"],
            "roster_name": null  # or name of roster if checking roster data
        }
        """
        issues = []
        
        check_id = rule_data.get('check_id', 'unknown')
        issue_message = rule_data.get('issue', 'Validation rule failed')
        check_expression = rule_data.get('check_expression')
        variables_involved = rule_data.get('variables_involved', [])
        
        if not check_expression:
            return issues
        
        # Check if all required variables exist (using path-based lookup)
        missing_vars = []
        var_values = {}
        for var in variables_involved:
            value, field_path = self._get_field_value(submission_data, var)
            if value is None and field_path is None:
                missing_vars.append(var)
            else:
                var_values[var] = (value, field_path or var)
        
        if missing_vars:
            logger.debug(f"Rule '{check_id}' skipped: missing variables {missing_vars} in submission {submission_uuid}")
            return issues
        
        # Filter out rows with NA or DK values in relevant columns
        for var in variables_involved:
            value, field_path = var_values[var]
            if value is None:
                return issues  # Skip if any required variable is None
            
            # Check for DK value
            if isinstance(value, (int, float)) and value == self.dk_value:
                return issues  # Skip if DK value
            if isinstance(value, str) and value == self.dk_string_value:
                return issues  # Skip if DK string value
        
        # Evaluate the check expression
        try:
            # Create a safe evaluation context using the found field paths
            eval_context = {}
            for var in variables_involved:
                value, field_path = var_values[var]
                # Convert string numeric values to appropriate types (handles Kobo API string numbers)
                converted_value = self._convert_value_type(value)
                # Use the variable name from config in the expression, but get value from actual path
                eval_context[var] = converted_value
                logger.debug(f"Rule '{check_id}': variable '{var}' = {converted_value} (converted from {value!r}, from field '{field_path}')")
            
            logger.debug(f"Rule '{check_id}': evaluating expression '{check_expression}' with context {eval_context}")
            
            # Replace common operators and functions for safety
            # This is a simplified version - in production, consider using a proper expression evaluator
            result = self._safe_eval(check_expression, eval_context)
            
            logger.debug(f"Rule '{check_id}': expression result = {result}")
            
            if result:
                # Rule failed - create issue
                field = variables_involved[0] if variables_involved else 'unknown'
                value, field_path = var_values.get(field, (submission_data.get(field, 'N/A'), field))
                actual_field = field_path if field_path else field
                
                issues.append(QualityIssue(
                    check=check_id,
                    field=actual_field,
                    value=value,
                    message=issue_message
                ))
        except Exception as e:
            logger.warning(f"Error evaluating expression '{check_expression}' for rule '{check_id}': {e}", exc_info=True)
        
        return issues
    
    def _safe_eval(self, expression: str, context: Dict[str, Any]) -> bool:
        """
        Safely evaluate a boolean expression using simpleeval.
        
        Uses the simpleeval library which provides a safe expression evaluator
        that prevents code injection attacks while supporting common Python
        expressions and operators.
        
        Args:
            expression: Expression string to evaluate (e.g., "age > 90")
            context: Dictionary of variable names to values
            
        Returns:
            Boolean result of the expression evaluation
        """
        try:
            # Convert logical operators from frontend format to Python format
            # Frontend uses & and |, Python uses 'and' and 'or'
            # Need to be careful: & and | can appear in other contexts (like & in "&" string)
            # So we replace them only when they're standalone operators (with spaces around them)
            expression = re.sub(r'\s+&\s+', ' and ', expression)
            expression = re.sub(r'\s+\|\s+', ' or ', expression)
            
            logger.debug(f"After operator conversion: {expression}")
            
            # Prepare names dictionary for simpleeval (exclude __builtins__)
            names = {k: v for k, v in context.items() if k != '__builtins__'}
            
            logger.debug(f"Evaluating expression '{expression}' with names: {list(names.keys())}")
            
            # Create SimpleEval instance with names from context
            # SimpleEval is safe by default - it doesn't allow dangerous operations
            evaluator = SimpleEval(names=names)
            
            # Evaluate the expression
            result = evaluator.eval(expression)
            
            logger.debug(f"Expression result: {result}")
            
            # Convert result to boolean
            return bool(result)
            
        except Exception as e:
            logger.warning(f"Error evaluating expression '{expression}': {e}", exc_info=True)
            return False
    
    def determine_qa_status(self, issues: List[QualityIssue], kobo_validation_status: Optional[str] = None) -> Optional[str]:
        """
        Determine QA status based on HFC issues and Kobo validation status.
        
        Status priority:
        1. If Kobo = "Not Approved" or "Flagged for Removal" → REJECTED (highest priority)
        2. If Kobo = "On Hold" → Don't change (keep current status)
        3. If Kobo = "Approved" → APPROVED (Kobo is source of truth even if HFC finds issues)
        4. If HFC finds issues → FLAGGED (when Kobo hasn't approved and submission isn't rejected)
        5. If no Kobo status and no HFC issues → PENDING_APPROVAL
        
        Args:
            issues: List of quality issues from HFC checks
            kobo_validation_status: Kobo's validation status (Approved, Not Approved, On Hold, etc.)
            
        Returns:
            QA status string: PENDING_APPROVAL, FLAGGED, APPROVED, or REJECTED
        """
        # First check Kobo validation status (rejection takes highest priority)
        if kobo_validation_status:
            kobo_status_lower = kobo_validation_status.lower().strip()
            
            # Rejection in Kobo takes priority over everything
            if kobo_status_lower in ["not approved", "flagged for removal"]:
                return "REJECTED"
            
            # On Hold doesn't change status
            if kobo_status_lower == "on hold":
                # Don't change status if On Hold - return None to indicate no change
                # This will be handled by the caller
                return None
            
            # If Kobo says Approved, Kobo remains source of truth regardless of HFC issues
            if kobo_status_lower == "approved":
                return "APPROVED"
        
        # If HFC finds issues, flag (unless already rejected in Kobo, which we checked above)
        if issues:
            return "FLAGGED"
        
        # No Kobo status and no HFC issues = ready for approval
        return "PENDING_APPROVAL"
