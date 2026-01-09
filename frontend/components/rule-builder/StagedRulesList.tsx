
import React from 'react';
import { StagedRule } from '../../types';

interface StagedRulesListProps {
  rules: StagedRule[];
  onEdit: (ruleId: string) => void;
  onDelete: (ruleId: string) => void;
  canEdit?: boolean; // Optional - if false, hide edit/delete buttons (for viewers)
}

const StagedRulesList: React.FC<StagedRulesListProps> = ({ rules, onEdit, onDelete, canEdit = true }) => {
  if (rules.length === 0) {
    return <p className="text-gray-500 text-center py-4">No rules have been added yet.</p>;
  }

  return (
    <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
      {rules.map(rule => (
        <div key={rule.id} className="p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md">
          <div className="flex justify-between items-start">
            <div>
              <p className="font-semibold text-gray-900 dark:text-white">{rule.description}</p>
              <p className="text-sm font-mono text-gray-600 dark:text-gray-400">{rule.issue_message}</p>
              {rule.roster_name && <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">Context: {rule.roster_name}</p>}
            </div>
            {canEdit && (
              <div className="flex space-x-2 flex-shrink-0 ml-2">
                <button 
                  onClick={() => onEdit(rule.id)}
                  className="p-1 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                  title="Edit Rule"
                >
                   <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.5L15.232 5.232z" />
                  </svg>
                </button>
                <button 
                  onClick={() => onDelete(rule.id)}
                  className="p-1 text-gray-600 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                  title="Delete Rule"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export default StagedRulesList;