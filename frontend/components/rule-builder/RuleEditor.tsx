import React, { useState, useEffect, useMemo } from 'react';
import { KoboToolData, StagedRule, RulePart, RuleCondition } from '../../types';
import ConditionRow from './ConditionRow';
import ErrorMessage from '../ui/ErrorMessage';
import FormField from '../ui/FormField';

interface RuleEditorProps {
  koboToolData: KoboToolData;
  onSave: (rule: Omit<StagedRule, 'id'>) => void | Promise<void>;
  onCancel: () => void;
  editingRule: StagedRule | null;
  /** Prefills a new rule, e.g. with what AI wrote, without turning the form into an edit. */
  seed?: Omit<StagedRule, 'id'> | null;
  /** Shows Cancel even for a new rule; an edit always shows it. */
  showCancel?: boolean;
  submitLabel?: string;
}

const inputClass =
  'w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md shadow-xs px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500';

const RuleEditor: React.FC<RuleEditorProps> = ({ koboToolData, onSave, onCancel, editingRule, seed = null, showCancel = false, submitLabel }) => {
  const [description, setDescription] = useState('');
  const [issueMessage, setIssueMessage] = useState('');
  const [conditions, setConditions] = useState<RulePart[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const source = editingRule ?? seed;
    if (source) {
      setDescription(source.description);
      setIssueMessage(source.issue_message);
      setConditions(source.conditions.length ? source.conditions : [{ variable: '', operator: '==', value: '', valueType: 'static' }]);
    } else {
      // Start with one empty condition for new rules
      setConditions([{ variable: '', operator: '==', value: '', valueType: 'static' }]);
    }
    // Reset errors and touched when switching between edit/new mode
    setErrors({});
    setTouched({});
  }, [editingRule, seed]);

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
      newErrors.description = 'Name is required';
    }
    
    if (touched.issueMessage && !issueMessage.trim()) {
      newErrors.issueMessage = 'Message is required';
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

  const handleSubmit = async (e: React.FormEvent) => {
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
      newErrors.description = 'Name is required';
    }
    if (!issueMessage.trim()) {
      newErrors.issueMessage = 'Message is required';
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
    setIsSaving(true);
    try {
      await onSave({ description, issue_message: issueMessage, conditions, roster_name: ruleRosterName });
    } finally {
      setIsSaving(false);
    }
    
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
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField
          label="Name"
          htmlFor="rule-description"
          required
          error={errors.description}
        >
          <input
            type="text"
            placeholder="e.g. Respondent under 18"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => handleBlur('description')}
            className={inputClass}
          />
        </FormField>

        <FormField
          label="Flag message"
          htmlFor="rule-issue"
          required
          error={errors.issueMessage}
        >
          <input
            type="text"
            placeholder="e.g. The respondent is a minor"
            value={issueMessage}
            onChange={(e) => setIssueMessage(e.target.value)}
            onBlur={() => handleBlur('issueMessage')}
            className={inputClass}
          />
        </FormField>
      </div>

      <div>
        <p className="mb-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">Flag when</p>
        {errors.context && (
          <ErrorMessage error={errors.context} className="mb-2" />
        )}
        {errors.conditions && (
          <ErrorMessage error={errors.conditions} className="mb-2" />
        )}
        <div className="space-y-2">
          {conditions.map((part, index) => {
            if ('joiner' in part) {
              return (
                <select
                  key={index}
                  value={part.joiner}
                  onChange={(e) => handleJoinerChange(index, e.target.value as '&' | '|')}
                  aria-label="Combine with"
                  className="block h-7 rounded-md border border-gray-300 bg-white px-2 text-xs font-medium text-gray-700 shadow-xs dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
                >
                  <option value="&">AND</option>
                  <option value="|">OR</option>
                </select>
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
        <button
          type="button"
          onClick={addCondition}
          className="mt-2 text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
        >
          + Add condition
        </button>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-gray-100 pt-4 dark:border-gray-800">
        {(editingRule || showCancel) && (
          <button
            type="button"
            onClick={onCancel}
            className="h-8 rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-900 shadow-xs hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={!isFormValid || isSaving}
          className="h-8 rounded-md bg-indigo-600 px-3 text-sm font-medium text-white shadow-xs hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSaving ? 'Saving…' : submitLabel ?? (editingRule ? 'Save changes' : 'Save check')}
        </button>
      </div>
    </form>
  );
};

export default RuleEditor;