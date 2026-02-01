"""
AI Service for OpenAI integration
Provides rule generation and suggestion functionality using OpenAI GPT models.
"""

import os
import json
import logging
from typing import List, Dict, Any, Optional
from openai import OpenAI, OpenAIError
import time

logger = logging.getLogger(__name__)


class AIService:
    """Service for AI-powered validation rule generation and suggestions."""
    
    def __init__(self):
        """Initialize OpenAI client with API key from environment."""
        self.api_key = os.getenv('OPENAI_API_KEY')
        if not self.api_key:
            logger.warning("OPENAI_API_KEY not set in environment. AI features will be unavailable.")
            self.client = None
        else:
            self.client = OpenAI(api_key=self.api_key)
        
        self.model = os.getenv('OPENAI_MODEL', 'gpt-4o-mini')
        self.max_tokens = int(os.getenv('OPENAI_MAX_TOKENS', '1000'))
        self.temperature = float(os.getenv('OPENAI_TEMPERATURE', '0.2'))
        self.timeout = 30  # seconds
    
    def is_available(self) -> bool:
        """Check if AI service is available (API key configured)."""
        return self.client is not None
    
    def generate_rule_from_text(
        self,
        prompt: str,
        kobo_variables: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Generate a validation rule from natural language description.
        
        Args:
            prompt: Natural language description of the rule
            kobo_variables: List of variable metadata from Kobo form
                           [{"name": "age", "type": "integer", "label": "Respondent Age"}, ...]
        
        Returns:
            Dict with structure: {
                "description": str,
                "issue_message": str,
                "conditions": [{"variable": str, "operator": str, "value": str, "valueType": str}, ...],
                "roster_name": Optional[str]
            }
        
        Raises:
            ValueError: If AI service is not available or generation fails
        """
        if not self.is_available():
            raise ValueError("AI service is not available. Please configure OPENAI_API_KEY.")
        
        # Build variable context for the prompt
        variables_context = self._format_variables_context(kobo_variables)
        
        # Create system prompt
        system_prompt = """You are a data quality validation expert. Your task is to convert natural language rule descriptions into structured validation rules.

You must return ONLY valid JSON matching this exact schema:
{
  "description": "Short descriptive name for the rule (e.g., 'Age under 18')",
  "issue_message": "Clear message shown when rule triggers (e.g., 'Respondent is a minor')",
  "conditions": [
    {"variable": "variable_name", "operator": "==", "value": "value", "valueType": "static"}
  ],
  "roster_name": null
}

Supported operators: ==, !=, >, <, >=, <=, %in%
- For %in%, use comma-separated values in the value field (e.g., "yes,maybe")
- valueType is either "static" (for literal values) or "variable" (for comparing two variables)
- For multiple conditions, include {"joiner": "&"} or {"joiner": "|"} between conditions
- Always quote string values in the value field
- Numeric values should be unquoted

Important: Return ONLY the JSON object, no markdown formatting or explanations."""

        # Create user prompt
        user_prompt = f"""Survey Variables:
{variables_context}

User Request: {prompt}

Generate a validation rule for this request."""

        try:
            logger.info(f"Generating rule with OpenAI model {self.model}")
            start_time = time.time()
            
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=self.temperature,
                max_tokens=self.max_tokens,
                timeout=self.timeout,
                response_format={"type": "json_object"}  # Ensure JSON response
            )
            
            elapsed = time.time() - start_time
            logger.info(f"OpenAI API call completed in {elapsed:.2f}s")
            
            # Extract and parse response
            content = response.choices[0].message.content
            rule_data = json.loads(content)
            
            # Validate structure
            self._validate_rule_structure(rule_data)
            
            logger.info(f"Successfully generated rule: {rule_data.get('description')}")
            return rule_data
            
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse OpenAI response as JSON: {e}")
            raise ValueError("AI generated invalid response. Please try again.")
        except OpenAIError as e:
            logger.error(f"OpenAI API error: {e}")
            raise ValueError(f"AI service error: {str(e)}")
        except Exception as e:
            logger.error(f"Unexpected error in rule generation: {e}", exc_info=True)
            raise ValueError("Failed to generate rule. Please try again.")
    
    def suggest_rules(
        self,
        kobo_variables: List[Dict[str, Any]],
        global_parameters: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """
        Suggest validation rules based on Kobo form structure.
        
        Args:
            kobo_variables: List of variable metadata from Kobo form
            global_parameters: Optional global parameters (date ranges, duration limits)
        
        Returns:
            List of rule dictionaries with same structure as generate_rule_from_text
        
        Raises:
            ValueError: If AI service is not available or generation fails
        """
        if not self.is_available():
            raise ValueError("AI service is not available. Please configure OPENAI_API_KEY.")
        
        # Build variable context
        variables_context = self._format_variables_context(kobo_variables)
        
        # Build context about global parameters
        params_context = ""
        if global_parameters:
            params_context = "\n\nGlobal Parameters:\n"
            if global_parameters.get('data_collection_start_date'):
                params_context += f"- Data collection period: {global_parameters.get('data_collection_start_date')} to {global_parameters.get('data_collection_end_date')}\n"
            if global_parameters.get('min_survey_duration_minutes'):
                params_context += f"- Expected survey duration: {global_parameters.get('min_survey_duration_minutes')}-{global_parameters.get('max_survey_duration_minutes')} minutes\n"
        
        # Create system prompt
        system_prompt = """You are a data quality expert reviewing a survey form. Your task is to suggest 5-10 validation rules based on the form structure.

Focus on:
1. Range validation for numeric fields (age, household_size, income, etc.)
2. Required field checks for important fields
3. Duration anomalies (too short/long interviews)
4. Date validity (within collection period, not on weekends)
5. Logical consistency (e.g., if age < 18, check guardian consent)
6. Outlier detection for key variables
7. Data type validation

Return ONLY valid JSON array:
[
  {
    "description": "Short descriptive name",
    "issue_message": "Clear error message",
    "conditions": [{"variable": "name", "operator": "op", "value": "val", "valueType": "static"}],
    "roster_name": null
  }
]

Supported operators: ==, !=, >, <, >=, <=, %in%
- Use %in% for multiple choice validation
- Include {"joiner": "&"} or {"joiner": "|"} between conditions
- Prioritize practical, actionable rules
- Return 5-10 diverse rules

Important: Return ONLY the JSON array, no markdown or explanations."""

        user_prompt = f"""Survey Variables:
{variables_context}{params_context}

Analyze this survey form and suggest validation rules."""

        try:
            logger.info(f"Generating rule suggestions with OpenAI model {self.model}")
            start_time = time.time()
            
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=self.temperature,
                max_tokens=self.max_tokens * 2,  # More tokens for multiple rules
                timeout=self.timeout,
                response_format={"type": "json_object"}
            )
            
            elapsed = time.time() - start_time
            logger.info(f"OpenAI API call completed in {elapsed:.2f}s")
            
            # Extract and parse response
            content = response.choices[0].message.content
            parsed = json.loads(content)
            
            # Handle both array and object with array wrapper
            if isinstance(parsed, list):
                rules_list = parsed
            elif isinstance(parsed, dict) and 'rules' in parsed:
                rules_list = parsed['rules']
            else:
                # Try to extract first array-like value
                for value in parsed.values():
                    if isinstance(value, list):
                        rules_list = value
                        break
                else:
                    raise ValueError("Response doesn't contain a list of rules")
            
            # Validate each rule
            validated_rules = []
            for rule in rules_list:
                try:
                    self._validate_rule_structure(rule)
                    validated_rules.append(rule)
                except Exception as e:
                    logger.warning(f"Skipping invalid suggested rule: {e}")
                    continue
            
            logger.info(f"Successfully generated {len(validated_rules)} rule suggestions")
            return validated_rules
            
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse OpenAI response as JSON: {e}")
            raise ValueError("AI generated invalid response. Please try again.")
        except OpenAIError as e:
            logger.error(f"OpenAI API error: {e}")
            raise ValueError(f"AI service error: {str(e)}")
        except Exception as e:
            logger.error(f"Unexpected error in rule suggestions: {e}", exc_info=True)
            raise ValueError("Failed to generate suggestions. Please try again.")
    
    def _format_variables_context(self, kobo_variables: List[Dict[str, Any]]) -> str:
        """Format Kobo variables into a readable context string for the prompt."""
        lines = []
        for var in kobo_variables[:50]:  # Limit to 50 variables to stay within token limits
            name = var.get('name', 'unknown')
            var_type = var.get('type', 'unknown')
            label = var.get('label', '')
            choices = var.get('choices', [])
            
            line = f"- {name}: {var_type}"
            if label:
                line += f" ({label})"
            if choices:
                choice_str = ', '.join(choices[:10])  # Limit choices displayed
                line += f" [choices: {choice_str}]"
            
            lines.append(line)
        
        if len(kobo_variables) > 50:
            lines.append(f"... and {len(kobo_variables) - 50} more variables")
        
        return '\n'.join(lines)
    
    def _validate_rule_structure(self, rule: Dict[str, Any]) -> None:
        """
        Validate that a rule has the required structure.
        
        Raises:
            ValueError: If rule structure is invalid
        """
        required_fields = ['description', 'issue_message', 'conditions']
        for field in required_fields:
            if field not in rule:
                raise ValueError(f"Rule missing required field: {field}")
        
        if not isinstance(rule['conditions'], list):
            raise ValueError("conditions must be a list")
        
        if len(rule['conditions']) == 0:
            raise ValueError("conditions cannot be empty")
        
        # Validate condition structure
        for condition in rule['conditions']:
            if 'joiner' in condition:
                # Joiner element
                if condition['joiner'] not in ['&', '|']:
                    raise ValueError(f"Invalid joiner: {condition['joiner']}")
            else:
                # Condition element
                required_condition_fields = ['variable', 'operator', 'value', 'valueType']
                for field in required_condition_fields:
                    if field not in condition:
                        raise ValueError(f"Condition missing required field: {field}")
                
                if condition['operator'] not in ['==', '!=', '>', '<', '>=', '<=', '%in%']:
                    raise ValueError(f"Invalid operator: {condition['operator']}")
                
                if condition['valueType'] not in ['static', 'variable']:
                    raise ValueError(f"Invalid valueType: {condition['valueType']}")


# Global instance
ai_service = AIService()
