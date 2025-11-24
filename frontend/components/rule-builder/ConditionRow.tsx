import React from 'react';
import { KoboToolData, RuleCondition } from '../../types';

interface ConditionRowProps {
  condition: RuleCondition;
  koboToolData: KoboToolData;
  onChange: (condition: RuleCondition) => void;
  onRemove: () => void;
  canRemove: boolean;
}

const operators = [
    { value: '==', label: 'is equal to' },
    { value: '!=', label: 'is not equal to' },
    { value: '>', label: 'is greater than' },
    { value: '<', label: 'is less than' },
    { value: '>=', label: 'is greater than or equal to' },
    { value: '<=', label: 'is less than or equal to' },
    { value: '%in%', label: 'is one of (comma-separated)' },
];

const ConditionRow: React.FC<ConditionRowProps> = ({ condition, koboToolData, onChange, onRemove, canRemove }) => {
  
  const handleValueTypeToggle = (type: 'static' | 'variable') => {
    onChange({ ...condition, valueType: type, value: '' }); // Reset value on toggle
  };

  const selectedVarInfo = koboToolData.variableMap.get(condition.variable);
  const isSelectQuestion = selectedVarInfo?.type.startsWith('select');
  const isNumericVariable = selectedVarInfo?.type === 'integer' || selectedVarInfo?.type === 'decimal' || selectedVarInfo?.type === 'calculate';
  const choicesForVar = isSelectQuestion 
    ? koboToolData.choices.filter(c => c.list_name === selectedVarInfo?.choiceListName)
    : [];
  // Deduplicate choices just in case
  const uniqueChoices = Array.from(new Map(choicesForVar.map(choice => [choice.name, choice])).values());

  const renderValueInput = () => {
    if (condition.valueType === 'variable') {
      return (
        <select 
            value={condition.value} 
            onChange={e => onChange({ ...condition, value: e.target.value })}
            className="flex-1 min-w-0 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
        >
            <option value="">Select variable...</option>
            {koboToolData.survey.map(q => {
                const context = q.roster_name ? `(${q.roster_name})` : '(Main)';
                return <option key={q.name} value={q.name} title={q['label::English (en)']}>{`${context} ${q.name}`}</option>;
            })}
        </select>
      );
    }
    
    if (isSelectQuestion && condition.operator !== '%in%') {
        return (
            <select
                value={condition.value}
                onChange={e => onChange({ ...condition, value: e.target.value })}
                className="flex-1 min-w-0 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            >
                <option value="">Select choice...</option>
                {uniqueChoices.map(c => <option key={c.name} value={c.name}>{c['label::English (en)'] || c.name}</option>)}
            </select>
        );
    }

    return (
      <input
        type={isNumericVariable ? "number" : "text"}
        placeholder={condition.operator === '%in%' ? 'value1, value2' : isNumericVariable ? 'Enter number' : 'Enter static value'}
        value={condition.value}
        onChange={e => onChange({ ...condition, value: e.target.value })}
        className="flex-1 min-w-0 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
      />
    );
  };

  return (
    <div className="flex items-center gap-2 p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md overflow-hidden">
      {/* Variable Select */}
      <select 
        value={condition.variable} 
        onChange={e => onChange({ ...condition, variable: e.target.value, value: '' })} // Reset value on var change
        className="flex-shrink-0 w-48 min-w-0 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
      >
        <option value="">Select variable...</option>
        {koboToolData.survey.map(q => {
          const context = q.roster_name ? `(${q.roster_name})` : '(Main)';
          return <option key={q.name} value={q.name} title={q['label::English (en)']}>{`${context} ${q.name}`}</option>;
        })}
      </select>
      
      {/* Operator Select */}
      <select 
        value={condition.operator} 
        onChange={e => onChange({ ...condition, operator: e.target.value })}
        className="flex-shrink-0 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
      >
        {operators.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
      </select>
      
      {/* Value Input Area */}
      <div className="flex-1 flex items-center gap-2 min-w-0">
        <div className="flex-shrink-0 flex rounded-md bg-gray-200 dark:bg-gray-900 p-0.5">
            <button type="button" onClick={() => handleValueTypeToggle('static')} className={`px-2 py-1 text-xs rounded ${condition.valueType === 'static' ? 'bg-indigo-600 text-white' : 'text-gray-700 dark:text-white hover:bg-gray-300 dark:hover:bg-gray-700'}`}>Value</button>
            <button type="button" onClick={() => handleValueTypeToggle('variable')} className={`px-2 py-1 text-xs rounded ${condition.valueType === 'variable' ? 'bg-indigo-600 text-white' : 'text-gray-700 dark:text-white hover:bg-gray-300 dark:hover:bg-gray-700'}`}>Variable</button>
        </div>
        {renderValueInput()}
      </div>

      {/* Remove Button */}
      <button
        type="button"
        onClick={onRemove}
        disabled={!canRemove}
        title="Remove Condition"
        className="flex-shrink-0 p-2 text-gray-400 rounded-full disabled:text-gray-600 disabled:cursor-not-allowed hover:bg-gray-700 hover:text-red-400"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
};

export default ConditionRow;