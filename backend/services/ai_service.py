"""
AI Service for OpenAI integration
Provides rule generation and suggestion functionality using OpenAI GPT models.
"""

import logging
import os
from typing import Any

from etl.dk_utils import (
    describe_dk_codes,
    describe_dk_strings,
    dk_numeric_codes,
    dk_string_tokens,
)
from services.ai_client import AIClient, ResolvedProvider, UsageRecorder, operator_provider
from services.ai_errors import AUTH, BAD_RESPONSE, NOT_CONFIGURED, PROVIDER_QUOTA, AIError

logger = logging.getLogger(__name__)


def rule_error_message(error: AIError) -> str:
    """What the rule builder shows when the AI call behind it fails."""
    if error.category == AUTH:
        return "The AI provider rejected the key. Ask the administrator to check it."
    if error.category == PROVIDER_QUOTA:
        return "The AI provider account is out of credit."
    if error.category == NOT_CONFIGURED:
        return "AI features are not set up on this server."
    if error.category == BAD_RESPONSE:
        return "AI generated an invalid response. Please try again."
    return f"AI service error: {error.message}"


class AIService:
    """Service for AI-powered validation rue generation and suggestions."""

    def __init__(self):
        """Initialize OpenAI client with API key from environment."""
        self.api_key = os.getenv("OPENAI_API_KEY")
        if not self.api_key:
            logger.warning(
                "OPENAI_API_KEY not set in environment. AI features will be unavailable."
            )

        base_model = os.getenv("OPENAI_MODEL", "gpt-5-mini")
        self.rule_gen_model = os.getenv("OPENAI_RULE_GEN_MODEL", base_model)
        self.qual_check_model = os.getenv("OPENAI_QUAL_CHECK_MODEL", base_model)
        self.max_completion_tokens = int(os.getenv("OPENAI_MAX_TOKENS", "2500"))
        self.rule_gen_max_completion_tokens = int(
            os.getenv("OPENAI_RULE_GEN_MAX_TOKENS", str(self.max_completion_tokens))
        )
        self.qual_check_max_completion_tokens = int(
            os.getenv("OPENAI_QUAL_CHECK_MAX_TOKENS", str(self.max_completion_tokens))
        )
        # Suggestions write 5-10 rules, and a reasoning model's thinking counts
        # against the same limit: at 2 x 2,500 tokens gpt-5 often ran out
        # before writing any of them. A limit costs nothing until it is used.
        self.rule_suggest_max_completion_tokens = int(
            os.getenv("OPENAI_RULE_SUGGEST_MAX_TOKENS", "16000")
        )
        # Sent with rule writing on the operator key only (an endpoint that
        # rejects it is not asked again); empty to leave the model's default.
        self.rule_gen_reasoning_effort = (
            os.getenv("OPENAI_RULE_GEN_REASONING_EFFORT", "low").strip() or None
        )
        self.temperature = float(os.getenv("OPENAI_TEMPERATURE", "0.2"))
        self.timeout = 120  # seconds - GPT-5 models with reasoning can take longer
        self.ai = AIClient(timeout=self.timeout, temperature=self.temperature)

    def is_available(self) -> bool:
        """Check if AI service is available (API key configured)."""
        return bool(self.api_key)

    def generate_rule_from_text(
        self,
        prompt: str,
        kobo_variables: list[dict[str, Any]],
        existing_rules: list[dict[str, str]] | None = None,
        survey_context: dict[str, Any] | None = None,
        record: UsageRecorder | None = None,
        provider: ResolvedProvider | None = None,
        end_user: str | None = None,
    ) -> dict[str, Any]:
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
        if provider is None and not self.is_available():
            raise ValueError("AI service is not available. Please configure OPENAI_API_KEY.")

        # Build variable context for the prompt
        variables_context = self._format_variables_context(kobo_variables)

        # Build existing rules context
        existing_rules_text = ""
        if existing_rules and len(existing_rules) > 0:
            existing_rules_text = "\n\nEXISTING RULES (avoid creating duplicates):\n"
            for rule in existing_rules[:20]:  # Limit to 20 to save tokens
                existing_rules_text += (
                    f"- {rule.get('name', 'Unnamed')}: {rule.get('expression', '')}\n"
                )

        # Build survey context
        survey_context_text = ""
        if survey_context:
            survey_context_text = "\n\nSURVEY CONFIGURATION:\n"
            gp = survey_context.get("global_parameters", {})
            if gp.get("min_survey_duration_minutes"):
                survey_context_text += f"- Expected survey duration: {gp.get('min_survey_duration_minutes')}-{gp.get('max_survey_duration_minutes')} minutes\n"
            if gp.get("data_collection_start_date"):
                survey_context_text += f"- Data collection period: {gp.get('data_collection_start_date')} to {gp.get('data_collection_end_date')}\n"

            sv = survey_context.get("special_values", {})
            if sv:
                survey_context_text += f"- Special values: DK numeric = {describe_dk_codes(dk_numeric_codes(sv))}, DK string = {describe_dk_strings(sv.get('dk_string_value', 'dk'))}\n"

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
- Each condition has: variable (string), operator (==, !=, >, <, >=, <=, %in%, is_empty, is_not_empty), value (string), valueType ("static" or "variable")
- Multiple conditions are joined with {"joiner": "&"} for AND or {"joiner": "|"} for OR
- Example: [{"variable": "age", "operator": ">", "value": "100", "valueType": "static"}, {"joiner": "&"}, {"variable": "age", "operator": "<", "value": "150", "valueType": "static"}]

OPERATORS (STRICT - use ONLY these):
- ==, !=, >, <, >=, <= : standard comparisons
- %in% : value is in a list (use comma-separated values like "yes,no,maybe")
- is_empty / is_not_empty : the question was shown but left blank / was answered. Set value to "". A question hidden by skip logic is never empty.
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
                    "description": "Short descriptive name for the rule (e.g., 'Age exceeds 100')",
                },
                "issue_message": {
                    "type": "string",
                    "description": "Clear message shown when rule triggers (e.g., 'Respondent age is suspiciously high')",
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
                                        "description": "Variable name from the survey",
                                    },
                                    "operator": {
                                        "type": "string",
                                        "enum": [
                                            "==",
                                            "!=",
                                            ">",
                                            "<",
                                            ">=",
                                            "<=",
                                            "%in%",
                                            "is_empty",
                                            "is_not_empty",
                                        ],
                                        "description": "Comparison operator",
                                    },
                                    "value": {
                                        "type": "string",
                                        "description": "Value to compare against (for %in%, use comma-separated values)",
                                    },
                                    "valueType": {
                                        "type": "string",
                                        "enum": ["static", "variable"],
                                        "description": "Whether value is a literal (static) or another variable",
                                    },
                                },
                                "required": ["variable", "operator", "value", "valueType"],
                                "additionalProperties": False,
                            },
                            {
                                "type": "object",
                                "properties": {
                                    "joiner": {
                                        "type": "string",
                                        "enum": ["&", "|"],
                                        "description": "Logical operator to join conditions (AND or OR)",
                                    }
                                },
                                "required": ["joiner"],
                                "additionalProperties": False,
                            },
                        ]
                    },
                    "minItems": 1,
                },
                "roster_name": {
                    "type": ["string", "null"],
                    "description": "Name of roster/repeat group if rule applies to one, otherwise null",
                },
            },
            "required": ["description", "issue_message", "conditions", "roster_name"],
            "additionalProperties": False,
        }

        try:
            rule_data = self.ai.complete_json(
                provider or operator_provider(self.rule_gen_model),
                name="validation_rule",
                system=system_prompt,
                user=user_prompt,
                schema=rule_schema,
                max_output=self.rule_gen_max_completion_tokens,
                record=record,
                end_user=end_user,
                reasoning_effort=self._reasoning_effort(provider),
            )
        except AIError as error:
            logger.warning("Rule generation failed: %s", error)
            raise ValueError(rule_error_message(error)) from error

        self._validate_rule_structure(rule_data)
        logger.info(f"Successfully generated rule: {rule_data.get('description')}")
        return rule_data

    def suggest_rules(
        self,
        kobo_variables: list[dict[str, Any]],
        global_parameters: dict[str, Any] | None = None,
        special_values: dict[str, Any] | None = None,
        existing_rules: list[dict[str, str]] | None = None,
        record: UsageRecorder | None = None,
        provider: ResolvedProvider | None = None,
        end_user: str | None = None,
    ) -> list[dict[str, Any]]:
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
        if provider is None and not self.is_available():
            raise ValueError("AI service is not available. Please configure OPENAI_API_KEY.")

        # Build variable context
        variables_context = self._format_variables_context(kobo_variables)

        # Build context about global parameters
        params_context = ""
        if global_parameters:
            params_context = "\n\nGLOBAL PARAMETERS:\n"
            if global_parameters.get("data_collection_start_date"):
                params_context += f"- Data collection period: {global_parameters.get('data_collection_start_date')} to {global_parameters.get('data_collection_end_date')}\n"
            if global_parameters.get("min_survey_duration_minutes"):
                params_context += f"- Expected survey duration: {global_parameters.get('min_survey_duration_minutes')}-{global_parameters.get('max_survey_duration_minutes')} minutes\n"

        # Build special values context (DK values)
        special_values_context = ""
        if special_values:
            sv = special_values
            dk_num = describe_dk_codes(dk_numeric_codes(sv))
            dk_str = describe_dk_strings(sv.get("dk_string_value", "dk"))
            special_values_context = f"\n\nSPECIAL VALUES (Don't Know / Refused):\n- DK numeric value: {dk_num}\n- DK string value: {dk_str}\n"

        # Build existing rules context
        existing_rules_text = ""
        if existing_rules and len(existing_rules) > 0:
            existing_rules_text = "\n\nEXISTING RULES (do NOT suggest rules similar to these - suggest DIFFERENT rules):\n"
            for rule in existing_rules[:20]:  # Limit to 20 to save tokens
                existing_rules_text += (
                    f"- {rule.get('name', 'Unnamed')}: {rule.get('expression', '')}\n"
                )

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
- is_empty / is_not_empty : the question was shown but left blank / was answered. Set value to "". A question hidden by skip logic is never empty.
- Do NOT use XLSForm functions (count-selected, position, etc.)
- Do NOT create custom operators or expressions

REQUIREMENTS:
- Suggest 5-10 diverse rules
- Each rule must be different from existing rules, do not suggest duplicates or near-duplicates.
- Prioritize practical, actionable rules
- Use ONLY the operators listed above (==, !=, >, <, >=, <=, %in%, is_empty, is_not_empty)
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
                    "description": "Short descriptive name for the rule",
                },
                "issue_message": {
                    "type": "string",
                    "description": "Clear message shown when rule triggers",
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
                                        "enum": [
                                            "==",
                                            "!=",
                                            ">",
                                            "<",
                                            ">=",
                                            "<=",
                                            "%in%",
                                            "is_empty",
                                            "is_not_empty",
                                        ],
                                    },
                                    "value": {"type": "string"},
                                    "valueType": {"type": "string", "enum": ["static", "variable"]},
                                },
                                "required": ["variable", "operator", "value", "valueType"],
                                "additionalProperties": False,
                            },
                            {
                                "type": "object",
                                "properties": {"joiner": {"type": "string", "enum": ["&", "|"]}},
                                "required": ["joiner"],
                                "additionalProperties": False,
                            },
                        ]
                    },
                    "minItems": 1,
                },
                "roster_name": {
                    "type": ["string", "null"],
                    "description": "Name of roster/repeat group if rule applies to one, otherwise null",
                },
            },
            "required": ["description", "issue_message", "conditions", "roster_name"],
            "additionalProperties": False,
        }

        suggestions_schema = {
            "type": "object",
            "properties": {
                "rules": {
                    "type": "array",
                    "description": "Array of suggested validation rules",
                    "items": rule_item_schema,
                    "minItems": 5,
                    "maxItems": 10,
                }
            },
            "required": ["rules"],
            "additionalProperties": False,
        }

        try:
            parsed = self.ai.complete_json(
                provider or operator_provider(self.rule_gen_model),
                name="suggested_rules",
                system=system_prompt,
                user=user_prompt,
                schema=suggestions_schema,
                max_output=self.rule_suggest_max_completion_tokens,
                # Only the envelope: a bad rule is dropped below, not the reply.
                check_schema={
                    "type": "object",
                    "properties": {"rules": {"type": "array", "items": {"type": "object"}}},
                    "required": ["rules"],
                },
                record=record,
                end_user=end_user,
                reasoning_effort=self._reasoning_effort(provider),
            )
        except AIError as error:
            logger.warning("Rule suggestions failed: %s", error)
            raise ValueError(rule_error_message(error)) from error

        validated_rules = []
        for rule in parsed["rules"]:
            try:
                self._validate_rule_structure(rule)
                validated_rules.append(rule)
            except Exception as e:
                logger.warning(f"Skipping invalid suggested rule: {e}")

        logger.info(f"Successfully generated {len(validated_rules)} rule suggestions")
        return validated_rules

    def _reasoning_effort(self, provider: ResolvedProvider | None) -> str | None:
        """The operator's chosen effort; a user's own provider keeps its model's default."""
        return self.rule_gen_reasoning_effort if provider is None else None

    def _format_variables_context(self, kobo_variables: list[dict[str, Any]]) -> str:
        """Format Kobo variables into a readable context string for the prompt."""
        lines = []
        for var in kobo_variables[:50]:  # Limit to 50 variables to stay within token limits
            name = var.get("name", "unknown")
            var_type = var.get("type", "unknown")
            label = var.get("label", "")
            choices = var.get("choices", [])

            line = f"- {name}: {var_type}"
            if label:
                line += f" ({label})"
            if var.get("roster_name"):
                line += f" [roster: {var['roster_name']}]"
            if var.get("required"):
                line += f" [required: {var['required']}]"
            if var.get("relevant"):
                line += f" [relevant: {var['relevant']}]"
            if var.get("constraint"):
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

        return "\n".join(lines)

    def check_qualitative_responses(
        self,
        field_values: dict[str, str],
        question_contexts: dict[str, str],
        dk_codes: list[int | float],
        dk_string: str | list[str] | None,
        check_types: list[str],
        record: UsageRecorder | None = None,
        provider: ResolvedProvider | None = None,
        end_user: str | None = None,
    ) -> list[dict[str, Any]]:
        """
        Check qualitative text responses for quality issues using a cheap model.

        Returns:
            List of issues with keys: field, value, check_type, message, reasoning

        Raises:
            AIError: when the call fails or the reply is unusable. An empty
                list always means "checked, nothing found" -- never "could
                not check".
        """
        if provider is None and not self.is_available():
            raise AIError(NOT_CONFIGURED, "No AI provider is configured (OPENAI_API_KEY).")

        if not field_values:
            return []

        allowed_check_types = {"content_quality", "relevance", "completeness"}
        selected_types = [c for c in check_types if c in allowed_check_types]
        if not selected_types:
            selected_types = ["content_quality", "relevance", "completeness"]

        fields_text = []
        for field, value in field_values.items():
            context = question_contexts.get(field, field)
            fields_text.append(f"Field: {field}\nQuestion: {context}\nResponse: {value}")

        fields_combined = "\n\n".join(fields_text)

        # Either coding may be absent: a survey need not have numeric DK codes.
        dk_parts = []
        if dk_codes:
            dk_parts.append(f"{describe_dk_codes(dk_codes)} (numeric)")
        if dk_string_tokens({"dk_string_value": dk_string}):
            dk_parts.append(f"{describe_dk_strings(dk_string)} (text)")
        dk_coding = " or ".join(dk_parts) or "nothing special in this survey"
        dk_reminder = f'\nRemember: {dk_coding} are valid "Don\'t Know" values.' if dk_parts else ""

        system_prompt = f"""You are a data quality expert analyzing survey text responses.

IMPORTANT CONTEXT:
- "Don't Know" responses are coded as {dk_coding}
- These are valid responses and should not be flagged
- Support multilingual responses and evaluate in the response's language
- Always provide your response in english
- Only flag when the issue is severe enough to make the response unusable for analysis. When in doubt, do not flag.

DO NOT FLAG:
- Spelling mistakes, typos, or translation errors when the meaning is understandable
- Grammar mistakes or awkward phrasing when the intent is clear
- Doubled/repeated words (e.g., "the the")
- Minor formatting issues (numbering gaps, extra list items beyond requested range)
- Ambiguous terms that could be typos when the overall response is coherent
"""
        user_prompt = f"""Analyze these survey responses for quality issues:

{fields_combined}

Check only these issue types: {", ".join(selected_types)}.

Issue definitions:
- content_quality: Only flag when the response is unintelligible: random characters, nonsensical strings, or text that conveys no meaningful information. Do NOT flag typos, spelling errors, or awkward wording when meaning is clear.
- relevance: Only flag when the response is clearly off-topic and does not address the question at all. Do NOT flag imperfect or tangential answers.
- completeness: Only flag when the response is too vague or empty to be useful. Do NOT flag: listing more items than requested, numbering gaps, or minor structural issues.

Examples of responses to NOT flag (meaning is clear):
- "Due to low price of the the products" (typo, meaning clear)
- "1. Pot 2. Heater 5. Cast 6. Dish" (numbering gap, possible typo, but list is interpretable)
- Listing 6 items when asked for 3-5 (over-complete is acceptable)

Return only clear issues. If no clear issue exists, return an empty list.{dk_reminder}"""

        response_schema = {
            "type": "object",
            "properties": {
                "issues": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "field": {"type": "string"},
                            "value": {"type": "string"},
                            "check_type": {
                                "type": "string",
                                "enum": ["content_quality", "relevance", "completeness"],
                            },
                            "message": {"type": "string"},
                            "reasoning": {"type": "string"},
                        },
                        "required": ["field", "value", "check_type", "message", "reasoning"],
                        "additionalProperties": False,
                    },
                }
            },
            "required": ["issues"],
            "additionalProperties": False,
        }

        try:
            parsed = self.ai.complete_json(
                provider or operator_provider(self.qual_check_model),
                name="qualitative_check_results",
                system=system_prompt,
                user=user_prompt,
                schema=response_schema,
                max_output=self.qual_check_max_completion_tokens,
                record=record,
                end_user=end_user,
            )
        except AIError as error:
            logger.warning("Qualitative check failed (%s)", error)
            raise
        return [issue for issue in parsed["issues"] if issue.get("check_type") in selected_types]

    def _validate_rule_structure(self, rule: dict[str, Any]) -> None:
        """
        Validate that a rule has the required structure.

        Raises:
            ValueError: If rule structure is invalid
        """
        required_fields = ["description", "issue_message", "conditions"]
        for field in required_fields:
            if field not in rule:
                raise ValueError(f"Rule missing required field: {field}")

        if not isinstance(rule["conditions"], list):
            raise ValueError("conditions must be a list")

        if len(rule["conditions"]) == 0:
            raise ValueError("conditions cannot be empty")

        # Validate condition structure
        for condition in rule["conditions"]:
            if "joiner" in condition:
                # Joiner element
                if condition["joiner"] not in ["&", "|"]:
                    raise ValueError(f"Invalid joiner: {condition['joiner']}")
            else:
                # Condition element
                required_condition_fields = ["variable", "operator", "value", "valueType"]
                for field in required_condition_fields:
                    if field not in condition:
                        raise ValueError(f"Condition missing required field: {field}")

                if condition["operator"] not in ["==", "!=", ">", "<", ">=", "<=", "%in%"]:
                    raise ValueError(f"Invalid operator: {condition['operator']}")

                if condition["valueType"] not in ["static", "variable"]:
                    raise ValueError(f"Invalid valueType: {condition['valueType']}")


# Global instance
ai_service = AIService()
