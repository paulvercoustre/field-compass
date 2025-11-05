import React, { useState, useEffect, useMemo } from 'react';
import { KoboToolData, StagedRule, RulePart, RuleCondition } from '../../types';
import ConditionRow from './ConditionRow';

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

  useEffect(() => {
    if (editingRule) {
      setDescription(editingRule.description);
      setIssueMessage(editingRule.issue_message);
      setConditions(editingRule.conditions);
    } else {
      // Start with one empty condition for new rules
      setConditions([{ variable: '', operator: '==', value: '', valueType: 'static' }]);
    }
  }, [editingRule]);

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


  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!description || !issueMessage) {
      alert("Please fill in both the Rule name and Issue Message fields.");
      return;
    }
    const validConditions = conditions.filter(c => 'variable' in c && c.variable);
    if (validConditions.length === 0) {
        alert("A rule must have at least one complete condition.");
        return;
    }
    if (!isContextConsistent) {
        alert("Validation Error: All variables in a rule must belong to the same context (main survey or a single roster).");
        return;
    }

    onSave({ description, issue_message: issueMessage, conditions, roster_name: ruleRosterName });
  };
  
  const conditionParts = conditions.filter(c => 'variable' in c);

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex flex-col">
        <label htmlFor="rule-description" className="mb-1 text-sm font-medium text-gray-400">Rule description</label>
        <input
          id="rule-description"
          type="text"
          placeholder="e.g., the respondent age is less than 18"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white focus:ring-indigo-500 focus:border-indigo-500"
        />
      </div>
      <div className="flex flex-col">
        <input
          id="rule-issue"
          type="text"
          placeholder="Issue Message for Log (e.g., Respondent minor)"
          value={issueMessage}
          onChange={(e) => setIssueMessage(e.target.value)}
          className="bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white focus:ring-indigo-500 focus:border-indigo-500"
        />
      </div>

      <div>
        <h4 className="text-md font-semibold text-gray-200 mb-2">Condition (defines the error)</h4>
         {!isContextConsistent && <p className="text-red-400 text-sm mb-2">Error: Variables from different contexts are mixed.</p>}
        <div className="space-y-4">
          {conditions.map((part, index) => {
            if ('joiner' in part) {
              return (
                <div key={index} className="flex justify-center">
                  <select
                    value={part.joiner}
                    onChange={(e) => handleJoinerChange(index, e.target.value as '&' | '|')}
                    className="bg-gray-900 border border-gray-600 rounded-md px-3 py-1 text-sm text-white focus:ring-indigo-500 focus:border-indigo-500"
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

      <div className="flex items-center space-x-4 pt-4 border-t border-gray-700">
        <button type="submit" className="px-4 py-2 font-bold text-white bg-indigo-600 rounded-md hover:bg-indigo-500 transition-colors">
          {editingRule ? 'Update Rule' : 'Add Rule to List'}
        </button>
        {editingRule && (
           <button type="button" onClick={onCancel} className="px-4 py-2 font-bold text-white bg-gray-600 rounded-md hover:bg-gray-500 transition-colors">
            Cancel Edit
          </button>
        )}
      </div>
    </form>
  );
};

export default RuleEditor;