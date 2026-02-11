"""
AI router for validation rule generation and suggestions.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from uuid import UUID
import logging

from services.database import get_db
from services.auth import get_current_active_user
from services.permissions import require_survey_access
from services.ai_service import ai_service
from database.models import SurveyConfig, User

logger = logging.getLogger(__name__)

router = APIRouter()


class GenerateRuleRequest(BaseModel):
    survey_id: str = Field(..., description="UUID of the survey")
    prompt: str = Field(..., min_length=1, max_length=1000, description="Natural language rule description")


class SuggestRulesRequest(BaseModel):
    survey_id: str = Field(..., description="UUID of the survey")


class RuleCondition(BaseModel):
    variable: str
    operator: str
    value: str
    valueType: str


class RuleJoiner(BaseModel):
    joiner: str


class GeneratedRule(BaseModel):
    description: str
    issue_message: str
    conditions: List[Dict[str, Any]]
    roster_name: Optional[str] = None


@router.post("/ai/generate-rule", response_model=GeneratedRule)
async def generate_rule_from_natural_language(
    request: GenerateRuleRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    Generate a validation rule from natural language description.
    
    The AI will analyze the survey's variables and convert the natural language
    prompt into a structured validation rule.
    
    Example:
        POST /api/ai/generate-rule
        {
            "survey_id": "123e4567-e89b-12d3-a456-426614174000",
            "prompt": "Flag if respondent age is greater than 100"
        }
    """
    # Check if AI service is available
    if not ai_service.is_available():
        raise HTTPException(
            status_code=503,
            detail="AI service is not available. Please configure OPENAI_API_KEY in the environment."
        )
    
    # Validate survey_id format
    try:
        survey_uuid = UUID(request.survey_id)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid survey_id format: {request.survey_id}"
        )
    
    # Check user has access to this survey (editors can create rules too)
    require_survey_access(db, current_user, survey_uuid, min_level='editor')
    
    # Fetch survey config
    survey_config = db.query(SurveyConfig).filter(
        SurveyConfig.survey_id == survey_uuid
    ).first()
    
    if not survey_config:
        raise HTTPException(
            status_code=404,
            detail=f"Survey configuration not found for survey_id: {request.survey_id}"
        )
    
    # Extract variables from config
    kobo_variables = _extract_variables_from_config(survey_config)
    
    if not kobo_variables:
        raise HTTPException(
            status_code=400,
            detail="No variables found in survey configuration. Please ensure the survey is properly configured."
        )
    
    # Get existing rules to provide as context
    from database.models import ValidationRule
    existing_rules = db.query(ValidationRule).filter(
        ValidationRule.survey_id == survey_uuid,
        ValidationRule.is_active == True
    ).all()
    
    existing_rules_context = [
        {
            "name": rule.rule_name,
            "issue": rule.rule_data.get('issue', ''),
            "expression": rule.rule_data.get('check_expression', '')
        }
        for rule in existing_rules
    ]
    
    # Extract survey context
    config_data = survey_config.config_data
    survey_context = {
        "global_parameters": config_data.get('global_parameters', {}),
        "core_identifiers": config_data.get('core_identifiers', {}),
        "special_values": config_data.get('special_values', {}),
    }
    
    # Generate rule using AI service
    try:
        rule_data = ai_service.generate_rule_from_text(
            prompt=request.prompt,
            kobo_variables=kobo_variables,
            existing_rules=existing_rules_context,
            survey_context=survey_context
        )
        
        logger.info(f"Successfully generated rule for survey {request.survey_id}: {rule_data.get('description')}")
        return GeneratedRule(**rule_data)
        
    except ValueError as e:
        logger.error(f"Failed to generate rule: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Unexpected error generating rule: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="An unexpected error occurred while generating the rule. Please try again."
        )


@router.post("/ai/suggest-rules", response_model=List[GeneratedRule])
async def suggest_validation_rules(
    request: SuggestRulesRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    Suggest validation rules based on the survey form structure.
    
    The AI will analyze the survey's variables and suggest 5-10 relevant
    validation rules based on best practices.
    
    Example:
        POST /api/ai/suggest-rules
        {
            "survey_id": "123e4567-e89b-12d3-a456-426614174000"
        }
    """
    # Check if AI service is available
    if not ai_service.is_available():
        raise HTTPException(
            status_code=503,
            detail="AI service is not available. Please configure OPENAI_API_KEY in the environment."
        )
    
    # Validate survey_id format
    try:
        survey_uuid = UUID(request.survey_id)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid survey_id format: {request.survey_id}"
        )
    
    # Check user has access to this survey (editors can create rules too)
    require_survey_access(db, current_user, survey_uuid, min_level='editor')
    
    # Fetch survey config
    survey_config = db.query(SurveyConfig).filter(
        SurveyConfig.survey_id == survey_uuid
    ).first()
    
    if not survey_config:
        raise HTTPException(
            status_code=404,
            detail=f"Survey configuration not found for survey_id: {request.survey_id}"
        )
    
    # Extract variables, global parameters, and special values from config
    config_data = survey_config.config_data
    kobo_variables = _extract_variables_from_config(survey_config)
    global_parameters = config_data.get('global_parameters', {})
    special_values = config_data.get('special_values', {})
    
    if not kobo_variables:
        raise HTTPException(
            status_code=400,
            detail="No variables found in survey configuration. Please ensure the survey is properly configured."
        )
    
    # Get existing rules to avoid suggesting duplicates
    from database.models import ValidationRule
    existing_rules = db.query(ValidationRule).filter(
        ValidationRule.survey_id == survey_uuid,
        ValidationRule.is_active == True
    ).all()
    
    existing_rules_context = [
        {
            "name": rule.rule_name,
            "issue": rule.rule_data.get('issue', ''),
            "expression": rule.rule_data.get('check_expression', '')
        }
        for rule in existing_rules
    ]
    
    # Generate suggestions using AI service
    try:
        suggestions = ai_service.suggest_rules(
            kobo_variables=kobo_variables,
            global_parameters=global_parameters,
            special_values=special_values,
            existing_rules=existing_rules_context
        )
        
        logger.info(f"Successfully generated {len(suggestions)} rule suggestions for survey {request.survey_id}")
        return [GeneratedRule(**rule) for rule in suggestions]
        
    except ValueError as e:
        logger.error(f"Failed to generate suggestions: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Unexpected error generating suggestions: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="An unexpected error occurred while generating suggestions. Please try again."
        )


def _extract_variables_from_config(survey_config: SurveyConfig) -> List[Dict[str, Any]]:
    """
    Extract variable information from survey config for AI context.
    
    Returns list of dicts with: name, type, label, roster_name, relevant, constraint,
    choices (if applicable - list of {name, label} for select questions)
    """
    variables = []
    config_data = survey_config.config_data
    
    # Try to get variables from kobo_tool if available
    kobo_tool = config_data.get('kobo_tool', {})
    
    # Extract from survey sheet
    survey_sheet = kobo_tool.get('survey', [])
    choices_sheet = kobo_tool.get('choices', [])
    
    # Use configured label column for choices
    label_col_choices = kobo_tool.get('label_column_choices', 'label::English (en)')
    
    # Build choices lookup: list_name -> [{"name": "yes", "label": "Yes"}, ...]
    choices_by_list: Dict[str, List[Dict[str, str]]] = {}
    for choice in choices_sheet:
        list_name = choice.get('list_name')
        choice_name = choice.get('name')
        if list_name and choice_name:
            choice_label = choice.get(label_col_choices, choice.get('label', choice_name))
            if list_name not in choices_by_list:
                choices_by_list[list_name] = []
            choices_by_list[list_name].append({'name': choice_name, 'label': choice_label})
    
    # Use configured label column for survey questions
    label_col_survey = kobo_tool.get('label_column_survey', 'label::English (en)')
    
    # Extract variables from survey
    for question in survey_sheet:
        q_type = question.get('type', '')
        q_name = question.get('name', '')
        q_label = question.get(label_col_survey, question.get('label::English (en)', question.get('label', '')))
        
        # Skip metadata fields and groups (but keep 'calculate' as it can contain numeric calculations)
        if not q_name or q_type in ['begin_group', 'end_group', 'begin_repeat', 'end_repeat', 'note']:
            continue
        
        var_info = {
            'name': q_name,
            'type': q_type,
            'label': q_label
        }
        
        # Add roster_name if question belongs to a repeat group
        roster_name = question.get('roster_name')
        if roster_name:
            var_info['roster_name'] = roster_name
        
        # Add relevant (skip logic) if present
        relevant = question.get('relevant', '')
        if relevant:
            var_info['relevant'] = relevant
        
        # Add constraint if present
        constraint = question.get('constraint', '')
        if constraint:
            var_info['constraint'] = constraint
        
        # Add required field if present
        required = question.get('required', '')
        if required:
            var_info['required'] = required
        
        # Add choices if select question (with name and label)
        list_name = question.get('list_name')
        if not list_name and ('select_one' in q_type or 'select_multiple' in q_type):
            type_parts = q_type.split()
            if len(type_parts) > 1:
                list_name = type_parts[1]
        if list_name and list_name in choices_by_list:
            var_info['choices'] = choices_by_list[list_name]
        
        variables.append(var_info)
    
    # If no kobo_tool data, try to extract from other config sections
    if not variables:
        # Try to get from variable_map if available
        variable_map = config_data.get('variable_map', {})
        for var_name, var_data in variable_map.items():
            variables.append({
                'name': var_name,
                'type': var_data.get('type', 'unknown'),
                'label': var_data.get('label', '')
            })
    
    return variables
