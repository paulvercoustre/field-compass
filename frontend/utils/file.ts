
import { GlobalParameters, StagedRule, KoboVariable, RulePart, RuleCondition } from '../types';

const compileRuleFromStructure = (ruleData: StagedRule, variableMap: Map<string, KoboVariable> | undefined) => {
    const conditions: string[] = [];
    const variables_involved = new Set<string>();

    ruleData.conditions.forEach(part => {
        if ('joiner' in part) {
            conditions.push(` ${part.joiner} `);
        } else {
            const cond = part as RuleCondition;
            let { variable, operator, value, valueType } = cond;
            if (!variable) return;
            variables_involved.add(variable);
            
            const variableInfo = variableMap?.get(variable);

            if (valueType === 'static') {
                // For 'is one of', format as c('a', 'b', 'c')
                if (operator === '%in%') {
                    const values = value.split(',').map(v => `'${v.trim()}'`).join(', ');
                    value = `c(${values})`;
                } 
                // Quote non-numeric values for other operators
                else if (variableInfo?.type !== 'integer' && variableInfo?.type !== 'decimal' && (isNaN(Number(value)) || value.trim() === '')) {
                    value = `'${value}'`;
                }
            } else {
                variables_involved.add(value);
            }
            conditions.push(`${variable} ${operator} ${value}`);
        }
    });
    
    return { 
        check_expression: conditions.join(''),
        variables_involved: Array.from(variables_involved)
    };
};


export const saveJsonToFile = (
    globalParameters: GlobalParameters, 
    stagedRules: StagedRule[],
    variableMap: Map<string, KoboVariable> | undefined
) => {
    const finalRules = stagedRules.map(rule => {
        const { check_expression, variables_involved } = compileRuleFromStructure(rule, variableMap);
        return {
            id: rule.id,
            issue: rule.description,
            check_id: rule.issue_message,
            roster_name: rule.roster_name || null,
            variables_involved: variables_involved,
            check_expression: check_expression
        };
    });

    const finalJsonOutput = {
        global_parameters: {
            ...globalParameters,
            min_survey_duration_minutes: Number(globalParameters.min_survey_duration_minutes) || null,
            max_survey_duration_minutes: Number(globalParameters.max_survey_duration_minutes) || null,
        },
        validation_rules: finalRules
    };

    const dataStr = JSON.stringify(finalJsonOutput, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
    const exportFileDefaultName = 'validation_rules.json';
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
};