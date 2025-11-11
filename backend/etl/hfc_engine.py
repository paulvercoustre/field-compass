"""
High-Frequency Check (HFC) Engine
Performs data quality checks on submissions based on validation rules.
"""

import re
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional, Tuple
from sqlalchemy.orm import Session
import logging

from database.models import ValidationRule, SurveyConfig
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
            start_time: Submission start time (from metadata, optional)
            end_time: Submission end time (from metadata, optional)
            
        Returns:
            List of QualityIssue objects
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
        
        # 3. Check date range
        date_value, date_field_path = self._get_field_value(submission_data, self.date_interview_field)
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
                    # Check against allowed date range
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
                    
                    # Check for weekend interviews (optional)
                    weekday = interview_date.weekday()  # 0=Monday, 6=Sunday
                    if weekday >= 5:  # Saturday or Sunday
                        issues.append(QualityIssue(
                            check="interview_on_weekend",
                            field=date_field_path or self.date_interview_field,
                            value=str(interview_date),
                            message=f"Interview conducted on weekend: {interview_date.strftime('%A')}"
                        ))
            except Exception as e:
                logger.debug(f"Could not parse date for validation: {e}")
        
        # 4. Check survey duration
        duration_issues = self._check_duration(submission_data, start_time, end_time)
        issues.extend(duration_issues)
        
        return issues
    
    def _check_duration(
        self, 
        submission_data: Dict[str, Any],
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None
    ) -> List[QualityIssue]:
        """Check survey duration against min/max limits."""
        issues = []
        
        # Try to get active_interview_time from audit logs (if available)
        active_time = submission_data.get('active_interview_time')
        
        if active_time is not None:
            try:
                duration_minutes = float(active_time)
                
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
        elif start_time and end_time:
            # Use provided start/end times from metadata
            try:
                duration_minutes = (end_time - start_time).total_seconds() / 60
                
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
                logger.debug(f"Could not calculate duration from start/end times: {e}")
        else:
            # Fallback: try to find start/end times in submission data (for backwards compatibility)
            start_time_data, _ = self._get_field_value(submission_data, self.start_time_field)
            end_time_data, _ = self._get_field_value(submission_data, self.end_time_field)
            
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
        
        return issues
    
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
                # Use the variable name from config in the expression, but get value from actual path
                eval_context[var] = value
                logger.debug(f"Rule '{check_id}': variable '{var}' = {value} (from field '{field_path}')")
            eval_context['__builtins__'] = {}
            
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
        Safely evaluate a boolean expression.
        
        This is a simplified evaluator. For production, consider using:
        - ast.literal_eval for simple expressions
        - A proper expression parser library
        - Restricted Python execution environment
        """
        try:
            # Replace variable names with their values
            # Need to format values properly: quote strings, keep numbers as-is
            for var, value in context.items():
                if var == '__builtins__':
                    continue
                # Escape special regex characters
                var_pattern = re.escape(var)
                
                # Format the value for replacement
                if isinstance(value, str):
                    # String values need to be quoted
                    # Escape any quotes in the string value itself
                    escaped_value = value.replace('"', '\\"')
                    replacement = f'"{escaped_value}"'
                elif isinstance(value, (int, float)):
                    # Numeric values don't need quotes
                    replacement = str(value)
                elif value is None:
                    # None becomes None (Python keyword)
                    replacement = "None"
                else:
                    # For other types, convert to string and quote
                    replacement = f'"{str(value)}"'
                
                # Replace variable names (whole word match)
                expression = re.sub(rf'\b{var_pattern}\b', replacement, expression)
            
            # Convert logical operators from frontend format to Python format
            # Frontend uses & and |, Python uses 'and' and 'or'
            # Need to be careful: & and | can appear in other contexts (like & in "&" string)
            # So we replace them only when they're standalone operators (with spaces around them)
            expression = re.sub(r'\s+&\s+', ' and ', expression)
            expression = re.sub(r'\s+\|\s+', ' or ', expression)
            
            logger.debug(f"After variable replacement and operator conversion: {expression}")
            
            # Evaluate the expression
            # WARNING: This uses eval() which can be unsafe. In production, use a proper parser.
            # For now, we'll restrict to simple comparisons and basic math
            # Allow quotes for string literals, and 'and'/'or' keywords
            # Check that expression only contains safe characters
            # Allow alphanumeric, spaces, operators, quotes, and Python keywords 'and'/'or'
            safe_chars = set('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+-*/.()<>=! "\' ')
            if all(c in safe_chars or c.isspace() for c in expression):
                result = eval(expression, {"__builtins__": {}})
                return bool(result)
            else:
                # Log which characters are problematic
                problematic = [c for c in expression if c not in safe_chars and not c.isspace()]
                logger.warning(f"Expression contains disallowed characters: {problematic} in expression: {expression}")
                return False
        except Exception as e:
            logger.warning(f"Error evaluating expression '{expression}': {e}", exc_info=True)
            return False
    
    def determine_qa_status(self, issues: List[QualityIssue], kobo_validation_status: Optional[str] = None) -> Optional[str]:
        """
        Determine QA status based on HFC issues and Kobo validation status.
        
        Status priority:
        1. If Kobo = "Not Approved" or "Flagged for Removal" → REJECTED (highest priority)
        2. If Kobo = "On Hold" → Don't change (keep current status)
        3. If HFC finds issues → FLAGGED (unless already rejected in Kobo)
        4. If Kobo = "Approved" and no HFC issues → APPROVED
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
            
            # If Kobo says Approved and no HFC issues, approve
            if kobo_status_lower == "approved" and not issues:
                return "APPROVED"
        
        # If HFC finds issues, flag (unless already rejected in Kobo, which we checked above)
        if issues:
            return "FLAGGED"
        
        # No Kobo status and no HFC issues = ready for approval
        return "PENDING_APPROVAL"

