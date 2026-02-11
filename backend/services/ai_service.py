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
    """Service for AI-powered validation rue generation and suggestions."""
    
    def __init__(self):
        """Initialize OpenAI client with API key from environment."""
        self.api_key = os.getenv('OPENAI_API_KEY')
        if not self.api_key:
            logger.warning("OPENAI_API_KEY not set in environment. AI features will be unavailable.")
            self.client = None
        else:
            self.client = OpenAI(api_key=self.api_key)
        
        self.model = os.getenv('OPENAI_MODEL', 'gpt-5-mini')
        self.max_completion_tokens = int(os.getenv('OPENAI_MAX_TOKENS', '2500'))
        self.temperature = float(os.getenv('OPENAI_TEMPERATURE', '0.2'))
        self.timeout = 120  # seconds - GPT-5 models with reasoning can take longer
    
    def is_available(self) -> bool:
        """Check if AI service is available (API key configured)."""
        return self.client is not None
    
    def generate_rule_from_text(
        self,
        prompt: str,
        kobo_variables: List[Dict[str, Any]],
        existing_rules: Optional[List[Dict[str, str]]] = None,
        survey_context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Generate a validation rule from natural language description.
        
        Args:
            prompt: Natural language description of the rule
            kobo_variables: List of variable metadata from Kobo form
                           [{"name": "age", "type": "integer", "label": "Respondent Age"}, ...]
            existing_rules: Optional list of existing rules to avoid duplicates
                           [{"name": "...", "issue": "...", "expression": "..."}, ...]
            survey_context: Optional dict with global_parameters, core_identifiers, special_values
        
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
        
        # Build existing rules context
        existing_rules_text = ""
        if existing_rules and len(existing_rules) > 0:
            existing_rules_text = "\n\nEXISTING RULES (avoid creating duplicates):\n"
            for rule in existing_rules[:20]:  # Limit to 20 to save tokens
                existing_rules_text += f"- {rule.get('name', 'Unnamed')}: {rule.get('expression', '')}\n"
        
        # Build survey context
        survey_context_text = ""
        if survey_context:
            survey_context_text = "\n\nSURVEY CONFIGURATION:\n"
            gp = survey_context.get('global_parameters', {})
            if gp.get('min_survey_duration_minutes'):
                survey_context_text += f"- Expected survey duration: {gp.get('min_survey_duration_minutes')}-{gp.get('max_survey_duration_minutes')} minutes\n"
            if gp.get('data_collection_start_date'):
                survey_context_text += f"- Data collection period: {gp.get('data_collection_start_date')} to {gp.get('data_collection_end_date')}\n"
            
            sv = survey_context.get('special_values', {})
            if sv:
                survey_context_text += f"- Special values: DK numeric = {sv.get('dk_value', -99)}, DK string = {sv.get('dk_string_value', 'dk')}\n"
        
        # Create system prompt
        system_prompt = """You are a data quality validation expert. Convert natural language rule descriptions into structured validation rules.

Your response will be automatically structured according to the provided schema. Focus on creating accurate, useful validation rules.

RULE LOGIC:
Rules use "flag when" logic: the condition describes the bad situation.
When the condition is TRUE, a quality issue is raised.
- CORRECT: age > 120 (flags impossibly high age)
- WRONG: age <= 120 (would flag every valid submission)

EXAMPLES:
1. Integer vs static value:
   Check: "Flag if age is over 120"
   Conditions: [{"variable": "age", "operator": ">", "value": "120", "valueType": "static"}]

2. Integer vs integer variable:
   Check: "Flag if child's age is greater than parent's age"
   Conditions: [{"variable": "age_child", "operator": ">", "value": "age_parent", "valueType": "variable"}]

3. Choice vs choice (logical consistency):
   Check: "Flag if respondent is male and pregnant"
   Conditions: [{"variable": "gender", "operator": "==", "value": "male", "valueType": "static"}, {"joiner": "&"}, {"variable": "pregnant", "operator": "==", "value": "yes", "valueType": "static"}]

DON'T KNOW VALUES:
- For categorical/choice questions: generally do NOT flag "don't know" responses unless they are critical required fields
- For numeric/integer questions: ALWAYS account for "don't know" values in range checks to avoid false flags
  Example: If DK = -999, use conditions like: (age > 120 & age != -999) OR (age < 0 & age != -999)

CONDITION STRUCTURE:
- Each condition has: variable (string), operator (==, !=, >, <, >=, <=, %in%), value (string), valueType ("static" or "variable")
- Multiple conditions are joined with {"joiner": "&"} for AND or {"joiner": "|"} for OR
- Example: [{"variable": "age", "operator": ">", "value": "100", "valueType": "static"}, {"joiner": "&"}, {"variable": "age", "operator": "<", "value": "150", "valueType": "static"}]

OPERATORS (STRICT - use ONLY these):
- ==, !=, >, <, >=, <= : standard comparisons
- %in% : value is in a list (use comma-separated values like "yes,no,maybe")
- Do NOT use XLSForm functions (count-selected, position, etc.)
- Do NOT create custom operators or expressions

VALUE TYPE:
- "static": literal value (numbers, strings, select choices)
- "variable": comparing with another variable name

ROSTER_NAME:
- null for main survey questions
- roster name string if rule applies to a repeat group"""

        # Create user prompt with all context
        user_prompt = f"""SURVEY VARIABLES (name: type - label [choices if applicable]):
{variables_context}{existing_rules_text}{survey_context_text}

USER REQUEST: {prompt}

Generate a validation rule matching the exact JSON schema."""

        # Define JSON schema for structured outputs
        rule_schema = {
            "type": "object",
            "properties": {
                "description": {
                    "type": "string",
                    "description": "Short descriptive name for the rule (e.g., 'Age exceeds 100')"
                },
                "issue_message": {
                    "type": "string",
                    "description": "Clear message shown when rule triggers (e.g., 'Respondent age is suspiciously high')"
                },
                "conditions": {
                    "type": "array",
                    "description": "Array of conditions and joiners. Each element is either a condition object or a joiner object",
                    "items": {
                        "anyOf": [
                            {
                                "type": "object",
                                "properties": {
                                    "variable": {
                                        "type": "string",
                                        "description": "Variable name from the survey"
                                    },
                                    "operator": {
                                        "type": "string",
                                        "enum": ["==", "!=", ">", "<", ">=", "<=", "%in%"],
                                        "description": "Comparison operator"
                                    },
                                    "value": {
                                        "type": "string",
                                        "description": "Value to compare against (for %in%, use comma-separated values)"
                                    },
                                    "valueType": {
                                        "type": "string",
                                        "enum": ["static", "variable"],
                                        "description": "Whether value is a literal (static) or another variable"
                                    }
                                },
                                "required": ["variable", "operator", "value", "valueType"],
                                "additionalProperties": False
                            },
                            {
                                "type": "object",
                                "properties": {
                                    "joiner": {
                                        "type": "string",
                                        "enum": ["&", "|"],
                                        "description": "Logical operator to join conditions (AND or OR)"
                                    }
                                },
                                "required": ["joiner"],
                                "additionalProperties": False
                            }
                        ]
                    },
                    "minItems": 1
                },
                "roster_name": {
                    "type": ["string", "null"],
                    "description": "Name of roster/repeat group if rule applies to one, otherwise null"
                }
            },
            "required": ["description", "issue_message", "conditions", "roster_name"],
            "additionalProperties": False
        }

        try:
            logger.info(f"Generating rule with OpenAI model {self.model}")
            start_time = time.time()
            
            # Build API call parameters
            api_params = {
                "model": self.model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                "max_completion_tokens": self.max_completion_tokens,
                "timeout": self.timeout,
                "response_format": {
                    "type": "json_schema",
                    "json_schema": {
                        "name": "validation_rule",
                        "strict": True,
                        "schema": rule_schema
                    }
                }
            }
            
            # Only add temperature for models that support it (GPT-5 models use default of 1)
            if not self.model.startswith('gpt-5'):
                api_params["temperature"] = self.temperature
            
            response = self.client.chat.completions.create(**api_params)
            
            elapsed = time.time() - start_time
            logger.info(f"OpenAI API call completed in {elapsed:.2f}s")
            
            # Check for refusals
            if hasattr(response.choices[0].message, 'refusal') and response.choices[0].message.refusal:
                logger.warning(f"Model refused to generate rule: {response.choices[0].message.refusal}")
                raise ValueError(f"AI refused to generate rule: {response.choices[0].message.refusal}")
            
            # Extract and parse response
            content = response.choices[0].message.content
            rule_data = json.loads(content)
            
            # Validate structure (structured outputs should guarantee this, but double-check)
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
        global_parameters: Optional[Dict[str, Any]] = None,
        special_values: Optional[Dict[str, Any]] = None,
        existing_rules: Optional[List[Dict[str, str]]] = None
    ) -> List[Dict[str, Any]]:
        """
        Suggest validation rules based on Kobo form structure.
        
        Args:
            kobo_variables: List of variable metadata from Kobo form
            global_parameters: Optional global parameters (date ranges, duration limits)
            special_values: Optional special values (dk_value, dk_string_value)
            existing_rules: Optional list of existing rules to avoid suggesting duplicates
        
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
            params_context = "\n\nGLOBAL PARAMETERS:\n"
            if global_parameters.get('data_collection_start_date'):
                params_context += f"- Data collection period: {global_parameters.get('data_collection_start_date')} to {global_parameters.get('data_collection_end_date')}\n"
            if global_parameters.get('min_survey_duration_minutes'):
                params_context += f"- Expected survey duration: {global_parameters.get('min_survey_duration_minutes')}-{global_parameters.get('max_survey_duration_minutes')} minutes\n"
        
        # Build special values context (DK values)
        special_values_context = ""
        if special_values:
            sv = special_values
            dk_num = sv.get('dk_value', -99)
            dk_str = sv.get('dk_string_value', 'dk')
            special_values_context = f"\n\nSPECIAL VALUES (Don't Know / Refused):\n- DK numeric value: {dk_num}\n- DK string value: \"{dk_str}\"\n"
        
        # Build existing rules context
        existing_rules_text = ""
        if existing_rules and len(existing_rules) > 0:
            existing_rules_text = "\n\nEXISTING RULES (do NOT suggest rules similar to these - suggest DIFFERENT rules):\n"
            for rule in existing_rules[:20]:  # Limit to 20 to save tokens
                existing_rules_text += f"- {rule.get('name', 'Unnamed')}: {rule.get('expression', '')}\n"
        
        # Create system prompt (simplified since structured outputs handles format)
        system_prompt = """You are a data quality expert reviewing a survey form. Suggest 5-10 practical validation rules based on the form structure.
Your response should be structured according to the provided schema. Focus on creating accurate, useful validation rules.

DO NOT suggest rules for:
- Out of period (interview date outside collection period)
- Weekend interviews
- Office hours checks
- Sampling frame checks
- Survey duration min/max (too short/long)

DO NOT suggest rules for:
- Statistical outliers (IQR, MAD, Z-score) on numeric variables

FOCUS on custom rules that require the Rule Builder:
1. Field-level range validation (age, income, household_size, counts, etc.)
2. Required/critical field checks (consent, key identifiers)
3. Logical consistency (e.g., if age < 18, check guardian consent)
4. Choice validation (DK in critical fields, invalid combinations)
5. Roster rules (min/max members, roster-specific ranges)
6. Impossible values (e.g., male + pregnant)
7. Business logic (ratios, referential integrity)

RULE LOGIC:
Rules use "flag when" logic: the condition describes the bad situation.
When the condition is TRUE, a quality issue is raised.
- CORRECT: age > 120 (flags impossibly high age)
- WRONG: age <= 120 (would flag every valid submission)

EXAMPLES:
1. Integer vs static value:
   Check: "Flag if age is over 120"
   Conditions: [{"variable": "age", "operator": ">", "value": "120", "valueType": "static"}]

2. Integer vs integer variable:
   Check: "Flag if child's age is greater than parent's age"
   Conditions: [{"variable": "age_child", "operator": ">", "value": "age_parent", "valueType": "variable"}]

3. Choice vs choice (logical consistency):
   Check: "Flag if respondent is male and pregnant"
   Conditions: [{"variable": "gender", "operator": "==", "value": "male", "valueType": "static"}, {"joiner": "&"}, {"variable": "pregnant", "operator": "==", "value": "yes", "valueType": "static"}]

DON'T KNOW VALUES:
- For categorical/choice questions: generally do NOT flag "don't know" responses unless they are critical required fields
- For numeric/integer questions: ALWAYS account for "don't know" values in range checks to avoid false flags
  Example: If DK = -999, use conditions like: (age > 120 & age != -999) OR (age < 0 & age != -999)

OPERATORS (STRICT - use ONLY these):
- ==, !=, >, <, >=, <= : standard comparisons
- %in% : value is in a list (use comma-separated values)
- Do NOT use XLSForm functions (count-selected, position, etc.)
- Do NOT create custom operators or expressions

REQUIREMENTS:
- Suggest 5-10 diverse rules
- Each rule must be different from existing rules, do not suggest duplicates or near-duplicates.
- Prioritize practical, actionable rules
- Use ONLY the operators listed above (==, !=, >, <, >=, <=, %in%)
- Set roster_name to null unless rule applies to a repeat group"""

        user_prompt = f"""SURVEY VARIABLES:
{variables_context}{params_context}{special_values_context}{existing_rules_text}

Analyze this survey form and suggest 5-10 validation rules. Each suggested rule must be different from existing rules."""

        # Define JSON schema for structured outputs (array wrapped in object)
        # Note: Root must be an object, so we wrap the array in a "rules" property
        rule_item_schema = {
            "type": "object",
            "properties": {
                "description": {
                    "type": "string",
                    "description": "Short descriptive name for the rule"
                },
                "issue_message": {
                    "type": "string",
                    "description": "Clear message shown when rule triggers"
                },
                "conditions": {
                    "type": "array",
                    "description": "Array of conditions and joiners",
                    "items": {
                        "anyOf": [
                            {
                                "type": "object",
                                "properties": {
                                    "variable": {"type": "string"},
                                    "operator": {
                                        "type": "string",
                                        "enum": ["==", "!=", ">", "<", ">=", "<=", "%in%"]
                                    },
                                    "value": {"type": "string"},
                                    "valueType": {
                                        "type": "string",
                                        "enum": ["static", "variable"]
                                    }
                                },
                                "required": ["variable", "operator", "value", "valueType"],
                                "additionalProperties": False
                            },
                            {
                                "type": "object",
                                "properties": {
                                    "joiner": {
                                        "type": "string",
                                        "enum": ["&", "|"]
                                    }
                                },
                                "required": ["joiner"],
                                "additionalProperties": False
                            }
                        ]
                    },
                    "minItems": 1
                },
                "roster_name": {
                    "type": ["string", "null"],
                    "description": "Name of roster/repeat group if rule applies to one, otherwise null"
                }
            },
            "required": ["description", "issue_message", "conditions", "roster_name"],
            "additionalProperties": False
        }

        suggestions_schema = {
            "type": "object",
            "properties": {
                "rules": {
                    "type": "array",
                    "description": "Array of suggested validation rules",
                    "items": rule_item_schema,
                    "minItems": 5,
                    "maxItems": 10
                }
            },
            "required": ["rules"],
            "additionalProperties": False
        }

        try:
            logger.info(f"Generating rule suggestions with OpenAI model {self.model}")
            start_time = time.time()
            
            # Build API call parameters
            api_params = {
                "model": self.model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                "max_completion_tokens": self.max_completion_tokens * 2,  # More tokens for multiple rules
                "timeout": self.timeout,
                "response_format": {
                    "type": "json_schema",
                    "json_schema": {
                        "name": "suggested_rules",
                        "strict": True,
                        "schema": suggestions_schema
                    }
                }
            }
            
            # Only add temperature for models that support it (GPT-5 models use default of 1)
            if not self.model.startswith('gpt-5'):
                api_params["temperature"] = self.temperature
            
            response = self.client.chat.completions.create(**api_params)
            
            elapsed = time.time() - start_time
            logger.info(f"OpenAI API call completed in {elapsed:.2f}s")
            
            # Check for refusals
            if hasattr(response.choices[0].message, 'refusal') and response.choices[0].message.refusal:
                logger.warning(f"Model refused to generate suggestions: {response.choices[0].message.refusal}")
                raise ValueError(f"AI refused to generate suggestions: {response.choices[0].message.refusal}")
            
            # Extract and parse response
            content = response.choices[0].message.content
            parsed = json.loads(content)
            
            # Extract rules array from the structured response
            if isinstance(parsed, dict) and 'rules' in parsed:
                rules_list = parsed['rules']
            else:
                raise ValueError("Response doesn't contain a 'rules' array")
            
            # Validate each rule (structured outputs should guarantee this, but double-check)
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
            if var.get('roster_name'):
                line += f" [roster: {var['roster_name']}]"
            if var.get('required'):
                line += f" [required: {var['required']}]"
            if var.get('relevant'):
                line += f" [relevant: {var['relevant']}]"
            if var.get('constraint'):
                line += f" [constraint: {var['constraint']}]"
            if choices:
                # Format choices: support both {"name": "x", "label": "y"} and plain strings
                choice_parts = []
                for c in choices[:10]:
                    if isinstance(c, dict):
                        choice_parts.append(f"{c.get('name', '')} ({c.get('label', '')})")
                    else:
                        choice_parts.append(str(c))
                line += f" [choices: {', '.join(choice_parts)}]"
            
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
