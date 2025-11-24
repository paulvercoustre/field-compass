import React, { useState, useEffect, useMemo } from 'react';
import { KoboToolData, StagedRule, RulePart, RuleCondition } from '../../types';
import ConditionRow from './ConditionRow';
import ErrorMessage from '../ui/ErrorMessage';
import FormField from '../ui/FormField';

interface RuleEditorProps {
  koboToolData: KoboToolData;
  onSave: (rule: Omit<StagedRule, 'id'>) => void;
  onCancel: () => void;
  editingRule: StagedRule | null;
}

const RuleEditor: React.FC<RuleEditorProps> = ({ koboToolData, onSave, onCancel, editingRule }) => {
  const [description, setDescription] = useState('');
  const [issueMessage, setIssueMessage] = useState('');
  const [conditions, setConditions] = useState<RulePart[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (editingRule) {
      setDescription(editingRule.description);
      setIssueMessage(editingRule.issue_message);
      setConditions(editingRule.conditions);
    } else {
      // Start with one empty condition for new rules
      setConditions([{ variable: '', operator: '==', value: '', valueType: 'static' }]);
    }
    // Reset errors and touched when switching between edit/new mode
    setErrors({});
    setTouched({});
  }, [editingRule]);

  const { ruleRosterName, isContextConsistent } = useMemo(() => {
      const allVariablesInRule = new Set<string>();
      conditions.forEach(c => {
        if ('variable' in c) {
          if (c.variable) allVariablesInRule.add(c.variable);
          if (c.valueType === 'variable' && c.value) allVariablesInRule.add(c.value);
        }
      });

      if (allVariablesInRule.size === 0) return { ruleRosterName: null, isContextConsistent: true };

      const variableNames = Array.from(allVariablesInRule);
      const firstVarInfo = koboToolData.variableMap.get(variableNames[0]);
      const baseRosterName = firstVarInfo?.roster_name ?? null;
      
      const consistent = variableNames.every(varName => {
          const varInfo = koboToolData.variableMap.get(varName);
          return (varInfo?.roster_name ?? null) === baseRosterName;
      });

      return { ruleRosterName: baseRosterName, isContextConsistent: consistent };
  }, [conditions, koboToolData.variableMap]);

  // Real-time validation
  useEffect(() => {
    const newErrors: Record<string, string> = {};
    
    if (touched.description && !description.trim()) {
      newErrors.description = 'Rule description is required';
    }
    
    if (touched.issueMessage && !issueMessage.trim()) {
      newErrors.issueMessage = 'Issue message is required';
    }
    
    const validConditions = conditions.filter(c => 'variable' in c && c.variable);
    if (touched.conditions && validConditions.length === 0) {
      newErrors.conditions = 'At least one complete condition is required';
    }
    
    if (!isContextConsistent) {
      newErrors.context = 'All variables in a rule must belong to the same context (main survey or a single roster)';
    }
    
    setErrors(newErrors);
  }, [description, issueMessage, conditions, touched, isContextConsistent]);

  const handleConditionChange = (index: number, updatedCondition: RuleCondition) => {
    const newConditions = [...conditions];
    newConditions[index] = updatedCondition;
    setConditions(newConditions);
  };
  
  const handleJoinerChange = (index: number, joiner: '&' | '|') => {
    const newConditions = [...conditions];
    newConditions[index] = { joiner };
    setConditions(newConditions);
  };

  const addCondition = () => {
    setConditions([...conditions, { joiner: '&' }, { variable: '', operator: '==', value: '', valueType: 'static' }]);
  };

  const removeCondition = (index: number) => {
    const newConditions = [...conditions];
    // If it's not the first condition, remove the preceding joiner as well.
    // If it is the first, remove the succeeding joiner.
    if (index > 0) {
      newConditions.splice(index - 1, 2);
    } else {
      newConditions.splice(index, 2);
    }
    setConditions(newConditions);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Mark all fields as touched
    setTouched({
      description: true,
      issueMessage: true,
      conditions: true,
    });
    
    // Check for errors
    const newErrors: Record<string, string> = {};
    if (!description.trim()) {
      newErrors.description = 'Rule description is required';
    }
    if (!issueMessage.trim()) {
      newErrors.issueMessage = 'Issue message is required';
    }
    
    const validConditions = conditions.filter(c => 'variable' in c && c.variable);
    if (validConditions.length === 0) {
      newErrors.conditions = 'At least one complete condition is required';
    }
    
    if (!isContextConsistent) {
      newErrors.context = 'All variables in a rule must belong to the same context (main survey or a single roster)';
    }
    
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      // Focus first error field
      const firstErrorField = document.getElementById('rule-description');
      if (firstErrorField) {
        firstErrorField.focus();
      }
      return;
    }

    // Clear errors and save
    setErrors({});
    setTouched({});
    onSave({ description, issue_message: issueMessage, conditions, roster_name: ruleRosterName });
    
    // Reset form if not editing
    if (!editingRule) {
      setDescription('');
      setIssueMessage('');
      setConditions([{ variable: '', operator: '==', value: '', valueType: 'static' }]);
    }
  };
  
  const handleBlur = (field: string) => {
    setTouched(prev => ({ ...prev, [field]: true }));
  };
  
  const isFormValid = !errors.description && !errors.issueMessage && !errors.conditions && !errors.context &&
    description.trim() && issueMessage.trim() && 
    conditions.some(c => 'variable' in c && c.variable) && isContextConsistent;
  
  const conditionParts = conditions.filter(c => 'variable' in c);

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <FormField
        label="Rule description"
        htmlFor="rule-description"
        required
        error={errors.description}
      >
        <input
          type="text"
          placeholder="e.g., the respondent age is less than 18"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => handleBlur('description')}
          className="bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
        />
      </FormField>
      
      <FormField
        label="Issue Message for Log"
        htmlFor="rule-issue"
        required
        error={errors.issueMessage}
        helpText="This message will appear in the quality log when this rule is triggered"
      >
        <input
          type="text"
          placeholder="e.g., Respondent minor"
          value={issueMessage}
          onChange={(e) => setIssueMessage(e.target.value)}
          onBlur={() => handleBlur('issueMessage')}
          className="bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
        />
      </FormField>

      <div>
        <h4 className="text-md font-semibold text-gray-800 dark:text-gray-200 mb-2">Condition (defines the error)</h4>
        {errors.context && (
          <ErrorMessage error={errors.context} className="mb-2" />
        )}
        {errors.conditions && (
          <ErrorMessage error={errors.conditions} className="mb-2" />
        )}
        <div className="space-y-4">
          {conditions.map((part, index) => {
            if ('joiner' in part) {
              return (
                <div key={index} className="flex justify-center">
                  <select
                    value={part.joiner}
                    onChange={(e) => handleJoinerChange(index, e.target.value as '&' | '|')}
                    className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md px-3 py-1 text-sm text-gray-900 dark:text-white focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    <option value="&">& AND</option>
                    <option value="|">| OR</option>
                  </select>
                </div>
              );
            }
            return (
              <ConditionRow
                key={index}
                condition={part}
                koboToolData={koboToolData}
                onChange={(updated) => handleConditionChange(index, updated)}
                onRemove={() => removeCondition(index)}
                canRemove={conditionParts.length > 1}
              />
            );
          })}
        </div>
      </div>
      
      <button 
        type="button"
        onClick={addCondition}
        className="text-indigo-400 hover:text-indigo-300 font-medium text-sm"
      >
        + Add Condition
      </button>

      <div className="flex items-center space-x-4 pt-4 border-t border-gray-200 dark:border-gray-700">
        <button 
          type="submit" 
          disabled={!isFormValid}
          className="px-4 py-2 font-bold text-white bg-indigo-600 rounded-md hover:bg-indigo-500 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-50 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-gray-900"
        >
          {editingRule ? 'Update Rule' : 'Add Rule to List'}
        </button>
        {editingRule && (
           <button 
            type="button" 
            onClick={onCancel} 
            className="px-4 py-2 font-bold text-white bg-gray-600 rounded-md hover:bg-gray-500 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-gray-900"
          >
            Cancel Edit
          </button>
        )}
      </div>
    </form>
  );
};

export default RuleEditor;