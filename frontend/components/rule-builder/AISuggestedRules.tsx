import React, { useState } from 'react';
import { StagedRule } from '../../types';
import { getSuggestedRules } from '../../services/aiApi';
import { generateUUID } from '../../utils/uuid';
import ErrorMessage from '../ui/ErrorMessage';
import SuccessMessage from '../ui/SuccessMessage';

interface AISuggestedRulesProps {
  surveyId: string;
  onRulesAdded: (rules: StagedRule[]) => void;
}

const AISuggestedRules: React.FC<AISuggestedRulesProps> = ({
  surveyId,
  onRulesAdded,
}) => {
  const [suggestions, setSuggestions] = useState<Array<Omit<StagedRule, 'id'>>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [addedCount, setAddedCount] = useState<number>(0);
  const [showSuccess, setShowSuccess] = useState(false);

  const handleGetSuggestions = async () => {
    setIsLoading(true);
    setError(null);
    setSuggestions([]);
    setSelectedIds(new Set());
    setAddedCount(0);
    setShowSuccess(false);

    try {
      const suggestedRules = await getSuggestedRules(surveyId);
      setSuggestions(suggestedRules);
      
      setSelectedIds(new Set(suggestedRules.map((_, idx) => idx)));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to get suggestions';
      // Check for specific error types and provide better messages
      if (errorMessage.includes('Not authenticated')) {
        setError('Authentication error. Please try refreshing the page and logging in again.');
      } else if (errorMessage.includes('AI service is not available')) {
        setError('AI service is not configured. Please contact your administrator to set up the OpenAI API key.');
      } else {
        setError(errorMessage);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSelection = (index: number) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelectedIds(newSelected);
  };

  const handleAddSelected = () => {
    const selectedRules = suggestions
      .filter((_, idx) => selectedIds.has(idx))
      .map(rule => ({
        ...rule,
        id: generateUUID(),
      }));

    if (selectedRules.length > 0) {
      onRulesAdded(selectedRules);
      setAddedCount(selectedRules.length);
      setShowSuccess(true);
      setSuggestions([]);
      setSelectedIds(new Set());
      
      setTimeout(() => setShowSuccess(false), 3000);
    }
  };

  const handleClear = () => {
    setSuggestions([]);
    setSelectedIds(new Set());
    setError(null);
    setShowSuccess(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          AI will analyze your form and suggest relevant validation rules
        </p>
      </div>

      {suggestions.length === 0 ? (
        <button
          onClick={handleGetSuggestions}
          disabled={isLoading}
          className="w-full px-4 py-2 font-bold text-white bg-purple-600 rounded-md hover:bg-purple-500 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-gray-900"
        >
          {isLoading ? (
            <span className="flex items-center justify-center">
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Analyzing form...
            </span>
          ) : (
            '💡 Analyze Form & Suggest Rules'
          )}
        </button>
      ) : (
        <div className="flex space-x-2">
          <button
            onClick={handleAddSelected}
            disabled={selectedIds.size === 0}
            className="flex-1 px-4 py-2 font-medium text-white bg-green-600 rounded-md hover:bg-green-500 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
          >
            Add Selected ({selectedIds.size})
          </button>
          <button
            onClick={handleClear}
            className="px-4 py-2 font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
          >
            Clear
          </button>
        </div>
      )}

      {error && <ErrorMessage error={error} />}

      {showSuccess && (
        <SuccessMessage message={`${addedCount} rule${addedCount !== 1 ? 's' : ''} added to editor!`} />
      )}

      {suggestions.length > 0 && (
        <div className="space-y-2 max-h-[500px] overflow-y-auto">
          <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
            {suggestions.length} suggestions found. Select rules to add:
          </p>
          
          {suggestions.map((suggestion, index) => (
            <div
              key={index}
              className={`p-3 border rounded-md cursor-pointer transition-all ${
                selectedIds.has(index)
                  ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-300 dark:border-purple-700'
                  : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-purple-200 dark:hover:border-purple-800'
              }`}
              onClick={() => toggleSelection(index)}
            >
              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0 pt-0.5">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(index)}
                    onChange={() => toggleSelection(index)}
                    onClick={(e) => e.stopPropagation()}
                    className="h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {suggestion.description}
                    </p>
                    <span className="ml-2 flex-shrink-0 text-xs px-2 py-1 bg-purple-100 dark:bg-purple-800 text-purple-700 dark:text-purple-200 rounded">
                      AI
                    </span>
                  </div>
                  
                  <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                    {suggestion.issue_message}
                  </p>

                  <div className="mt-2 text-xs font-mono bg-gray-50 dark:bg-gray-900 p-2 rounded border border-gray-200 dark:border-gray-700">
                    {suggestion.conditions.map((condition, condIdx) => {
                      if ('joiner' in condition) {
                        return (
                          <span key={condIdx} className="text-purple-600 dark:text-purple-400 font-bold mx-1">
                            {condition.joiner === '&' ? 'AND' : 'OR'}
                          </span>
                        );
                      }
                      return (
                        <span key={condIdx}>
                          <span className="text-blue-600 dark:text-blue-400">{condition.variable}</span>
                          <span className="text-gray-500 dark:text-gray-400"> {condition.operator} </span>
                          <span className="text-green-600 dark:text-green-400">{condition.value}</span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {suggestions.length === 0 && !isLoading && (
        <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md border border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-600 dark:text-gray-400">
            💡 <strong>Tip:</strong> AI suggestions are based on your survey's structure and include:
          </p>
          <ul className="mt-2 text-xs text-gray-600 dark:text-gray-400 list-disc list-inside space-y-1">
            <li>Range validation for numeric fields</li>
            <li>Required field checks</li>
            <li>Duration anomaly detection</li>
            <li>Date validity checks</li>
            <li>Logical consistency rules</li>
          </ul>
        </div>
      )}
    </div>
  );
};

export default AISuggestedRules;
