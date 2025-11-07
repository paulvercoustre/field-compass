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
        
        # Extract configuration
        self.uuid_field = self.config_data.get('uuid', '_uuid')
        self.enumerator_field = self.config_data.get('enumerator', 'enumerator_id')
        self.date_interview_field = self.config_data.get('date_interview', 'today')
        self.start_time_field = self.config_data.get('start_time', 'start')
        self.end_time_field = self.config_data.get('end_time', 'end')
        self.dk_value = self.config_data.get('dk_value', -99)
        self.dk_string_value = self.config_data.get('dk_string_value', 'dk')
        
        # Date range from config
        self.data_collection_start_date = self.config_data.get('data_collection_start_date')
        self.data_collection_end_date = self.config_data.get('data_collection_end_date')
        
        # Duration limits
        self.min_survey_duration_minutes = self.config_data.get('min_survey_duration_minutes')
        self.max_survey_duration_minutes = self.config_data.get('max_survey_duration_minutes')
    
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
    
    def run_checks(self, submission_data: Dict[str, Any], submission_uuid: str) -> List[QualityIssue]:
        """
        Run all HFC checks on a submission.
        
        Args:
            submission_data: Submission data dictionary
            submission_uuid: UUID of the submission
            
        Returns:
            List of QualityIssue objects
        """
        issues = []
        
        # Run basic checks
        issues.extend(self._run_basic_checks(submission_data, submission_uuid))
        
        # Run custom validation rules from database
        issues.extend(self._run_custom_rules(submission_data, submission_uuid))
        
        return issues
    
    def _run_basic_checks(self, submission_data: Dict[str, Any], submission_uuid: str) -> List[QualityIssue]:
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
        duration_issues = self._check_duration(submission_data)
        issues.extend(duration_issues)
        
        return issues
    
    def _check_duration(self, submission_data: Dict[str, Any]) -> List[QualityIssue]:
        """Check survey duration against min/max limits."""
        issues = []
        
        # Try to get active_interview_time from audit logs (if available)
        active_time = submission_data.get('active_interview_time')
        
        if active_time is not None:
            try:
                duration_minutes = float(active_time)
                
                if self.min_survey_duration_minutes and duration_minutes < self.min_survey_duration_minutes:
                    issues.append(QualityIssue(
                        check="duration_too_short",
                        field="active_interview_time",
                        value=duration_minutes,
                        message=f"Active survey duration too short ({duration_minutes:.2f} min < {self.min_survey_duration_minutes} min)"
                    ))
                
                if self.max_survey_duration_minutes and duration_minutes > self.max_survey_duration_minutes:
                    issues.append(QualityIssue(
                        check="duration_too_long",
                        field="active_interview_time",
                        value=duration_minutes,
                        message=f"Active survey duration too long ({duration_minutes:.2f} min > {self.max_survey_duration_minutes} min)"
                    ))
            except (ValueError, TypeError):
                pass
        else:
            # Fallback: calculate from start/end times
            start_time, _ = self._get_field_value(submission_data, self.start_time_field)
            end_time, _ = self._get_field_value(submission_data, self.end_time_field)
            
            if start_time and end_time:
                try:
                    if isinstance(start_time, str):
                        start_dt = datetime.fromisoformat(start_time.replace('Z', '+00:00'))
                    else:
                        start_dt = start_time
                    
                    if isinstance(end_time, str):
                        end_dt = datetime.fromisoformat(end_time.replace('Z', '+00:00'))
                    else:
                        end_dt = end_time
                    
                    duration_minutes = (end_dt - start_dt).total_seconds() / 60
                    
                    if self.min_survey_duration_minutes and duration_minutes < self.min_survey_duration_minutes:
                        issues.append(QualityIssue(
                            check="duration_too_short",
                            field="duration_minutes",
                            value=duration_minutes,
                            message=f"Survey duration too short ({duration_minutes:.2f} min < {self.min_survey_duration_minutes} min)"
                        ))
                    
                    if self.max_survey_duration_minutes and duration_minutes > self.max_survey_duration_minutes:
                        issues.append(QualityIssue(
                            check="duration_too_long",
                            field="duration_minutes",
                            value=duration_minutes,
                            message=f"Survey duration too long ({duration_minutes:.2f} min > {self.max_survey_duration_minutes} min)"
                        ))
                except Exception as e:
                    logger.debug(f"Could not calculate duration: {e}")
        
        return issues
    
    def _run_custom_rules(self, submission_data: Dict[str, Any], submission_uuid: str) -> List[QualityIssue]:
        """Run custom validation rules from database."""
        issues = []
        
        # Fetch active validation rules for this survey
        rules = self.db.query(ValidationRule).filter(
            ValidationRule.survey_id == self.survey_config.survey_id,
            ValidationRule.is_active == True
        ).all()
        
        for rule in rules:
            try:
                rule_data = rule.rule_data
                rule_issues = self._evaluate_rule(rule_data, submission_data, submission_uuid)
                issues.extend(rule_issues)
            except Exception as e:
                logger.error(f"Error evaluating rule '{rule.rule_name}': {e}")
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
            logger.debug(f"Rule '{check_id}' skipped: missing variables {missing_vars}")
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
            eval_context['__builtins__'] = {}
            
            # Replace common operators and functions for safety
            # This is a simplified version - in production, consider using a proper expression evaluator
            result = self._safe_eval(check_expression, eval_context)
            
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
            logger.warning(f"Error evaluating expression '{check_expression}' for rule '{check_id}': {e}")
        
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
            for var, value in context.items():
                # Escape special regex characters
                var_pattern = re.escape(var)
                # Replace variable names (whole word match)
                expression = re.sub(rf'\b{var_pattern}\b', str(value), expression)
            
            # Evaluate the expression
            # WARNING: This uses eval() which can be unsafe. In production, use a proper parser.
            # For now, we'll restrict to simple comparisons and basic math
            allowed_chars = set('0123456789+-*/.()<>=!&| ')
            if all(c in allowed_chars or c.isdigit() or c in '+-*/.()<>=!&| ' for c in expression):
                result = eval(expression, {"__builtins__": {}})
                return bool(result)
            else:
                logger.warning(f"Expression contains disallowed characters: {expression}")
                return False
        except Exception as e:
            logger.warning(f"Error evaluating expression: {e}")
            return False
    
    def determine_qa_status(self, issues: List[QualityIssue]) -> str:
        """
        Determine QA status based on issues found.
        
        Args:
            issues: List of quality issues
            
        Returns:
            QA status string
        """
        if not issues:
            return "PENDING_QA"
        
        # If any issues found, flag for review
        return "HFC_FLAGGED"

