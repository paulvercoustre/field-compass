import { StagedRule, RulePart, RuleCondition } from '../types';

/**
 * Convert a StagedRule (frontend format) to database format
 * Database format: { check_id, issue, check_expression, variables_involved, roster_name }
 */
export const stagedRuleToDbFormat = (rule: StagedRule): {
  check_id: string;
  issue: string;
  check_expression: string;
  variables_involved: string[];
  roster_name: string | null;
} => {
  // Extract variables from conditions
  const variables = new Set<string>();
  rule.conditions.forEach(part => {
    if ('variable' in part) {
      if (part.variable) variables.add(part.variable);
      if (part.valueType === 'variable' && part.value) variables.add(part.value);
    }
  });

  // Build check expression from conditions
  const checkExpression = buildCheckExpression(rule.conditions);

  return {
    check_id: rule.description.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
    issue: rule.issue_message,
    check_expression: checkExpression,
    variables_involved: Array.from(variables),
    roster_name: rule.roster_name,
  };
};

/**
 * Convert database format to StagedRule (frontend format)
 */
export const dbFormatToStagedRule = (
  ruleId: string,
  ruleName: string,
  ruleData: {
    check_id?: string;
    issue: string;
    check_expression: string;
    variables_involved?: string[];
    roster_name?: string | null;
  }
): StagedRule => {
  // Parse check_expression back to conditions
  const conditions = parseCheckExpression(ruleData.check_expression, ruleData.variables_involved || []);

  return {
    id: ruleId,
    description: ruleName,
    issue_message: ruleData.issue,
    conditions: conditions,
    roster_name: ruleData.roster_name || null,
  };
};

/**
 * Build check expression string from conditions array
 * Example: [{variable: 'age', operator: '>', value: '90'}, {joiner: '&'}, {variable: 'income', operator: '<', value: '1000'}]
 * Result: "age > 90 & income < 1000"
 */
const buildCheckExpression = (conditions: RulePart[]): string => {
  const parts: string[] = [];
  
  conditions.forEach((part, index) => {
    if ('joiner' in part) {
      // Add joiner (convert & to &, | to |)
      parts.push(part.joiner === '&' ? '&' : '|');
    } else if ('variable' in part && part.variable) {
      // Add condition
      const conditionStr = buildConditionString(part);
      if (conditionStr) {
        parts.push(conditionStr);
      }
    }
  });
  
  return parts.join(' ').trim();
};

/**
 * Build a single condition string
 */
const buildConditionString = (condition: RuleCondition): string => {
  if (!condition.variable) return '';
  
  const varName = condition.variable;
  const operator = condition.operator;
  const value = condition.value;
  
  if (!value) return '';
  
  // Handle %in% operator specially
  if (operator === '%in%') {
    // Split comma-separated values and create OR conditions
    const values = value.split(',').map(v => v.trim()).filter(v => v);
    if (values.length === 0) return '';
    if (values.length === 1) {
      return `${varName} == ${formatValue(values[0], condition.valueType)}`;
    }
    // Multiple values: (var == val1 | var == val2 | ...)
    const orConditions = values.map(v => `${varName} == ${formatValue(v, condition.valueType)}`).join(' | ');
    return `(${orConditions})`;
  }
  
  // Regular operators
  return `${varName} ${operator} ${formatValue(value, condition.valueType)}`;
};

/**
 * Format value for expression (add quotes for strings, keep numbers as-is)
 */
const formatValue = (value: string, valueType: 'static' | 'variable'): string => {
  if (valueType === 'variable') {
    // Variable reference - no quotes
    return value;
  }
  
  // Static value - check if it's a number
  const numValue = parseFloat(value);
  if (!isNaN(numValue) && value.trim() === numValue.toString()) {
    return value; // Number, no quotes
  }
  
  // String - add quotes
  return `"${value}"`;
};

/**
 * Parse check expression back to conditions array
 * This is a simplified parser - may not handle all edge cases
 */
const parseCheckExpression = (expression: string, variables: string[]): RulePart[] => {
  // This is a basic parser - for production, consider a proper expression parser
  // For now, we'll try to parse simple expressions
  
  const conditions: RulePart[] = [];
  
  // Split by & and | (with spaces)
  const tokens = expression.split(/(\s+&\s+|\s+\|\s+)/);
  
  let currentJoiner: '&' | '|' | null = null;
  
  for (const token of tokens) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    
    if (trimmed === '&' || trimmed === '|') {
      if (currentJoiner) {
        conditions.push({ joiner: currentJoiner });
      }
      currentJoiner = trimmed as '&' | '|';
    } else {
      // Parse condition
      const condition = parseCondition(trimmed, variables);
      if (condition) {
        if (currentJoiner) {
          conditions.push({ joiner: currentJoiner });
          currentJoiner = null;
        }
        conditions.push(condition);
      }
    }
  }
  
  // If no conditions parsed, return a default empty condition
  if (conditions.length === 0) {
    return [{ variable: '', operator: '==', value: '', valueType: 'static' }];
  }
  
  return conditions;
};

/**
 * Parse a single condition string
 * Example: "age > 90" or 'income == "high"'
 */
const parseCondition = (conditionStr: string, variables: string[]): RuleCondition | null => {
  // Try to match: variable operator value
  // Operators: ==, !=, >, <, >=, <=
  
  const operators = ['>=', '<=', '==', '!=', '>', '<'];
  
  for (const op of operators) {
    const index = conditionStr.indexOf(op);
    if (index > 0) {
      const varName = conditionStr.substring(0, index).trim();
      const valueStr = conditionStr.substring(index + op.length).trim();
      
      // Remove quotes if present
      let value = valueStr.replace(/^["']|["']$/g, '');
      
      // Determine if value is a variable or static
      const valueType: 'static' | 'variable' = variables.includes(value) ? 'variable' : 'static';
      
      return {
        variable: varName,
        operator: op,
        value: value,
        valueType: valueType,
      };
    }
  }
  
  return null;
};

