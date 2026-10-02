import React, { useEffect, useState } from 'react';
import { StagedRule } from '../../types';
import { getSuggestedRules } from '../../services/aiApi';
import { generateUUID } from '../../utils/uuid';
import ErrorMessage from '../ui/ErrorMessage';
import { Spinner } from '../Spinner';
import { describeConditions } from './conditionText';

interface AISuggestedRulesProps {
  surveyId: string;
  onRulesAdded: (rules: StagedRule[]) => void | Promise<void>;
  /** Fetch suggestions as soon as this mounts, rather than waiting for a click. */
  autoStart?: boolean;
  /** Shows a Cancel button that closes the list. */
  onClose?: () => void;
}

const describeError = (message: string): string => {
  if (message.includes('Not authenticated')) {
    return 'Your session has expired. Refresh the page and sign in again.';
  }
  if (message.includes('AI service is not available')) {
    return 'AI is not set up for this survey. Add a provider in Account settings → AI integration.';
  }
  return message;
};

const AISuggestedRules: React.FC<AISuggestedRulesProps> = ({
  surveyId,
  onRulesAdded,
  autoStart = false,
  onClose,
}) => {
  const [suggestions, setSuggestions] = useState<Array<Omit<StagedRule, 'id'>> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const handleGetSuggestions = async () => {
    setIsLoading(true);
    setError(null);
    setSuggestions(null);
    setSelectedIds(new Set());

    try {
      const suggestedRules = await getSuggestedRules(surveyId);
      setSuggestions(suggestedRules);
      setSelectedIds(new Set(suggestedRules.map((_, idx) => idx)));
    } catch (err) {
      setError(describeError(err instanceof Error ? err.message : 'Could not get suggestions'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (autoStart) handleGetSuggestions();
    // Runs once on open; a new survey remounts the component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSelection = (index: number) => {
    const next = new Set(selectedIds);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setSelectedIds(next);
  };

  const handleAddSelected = async () => {
    if (!suggestions) return;
    const selectedRules = suggestions
      .filter((_, idx) => selectedIds.has(idx))
      .map((rule) => ({ ...rule, id: generateUUID() }));
    if (selectedRules.length === 0) return;

    setIsAdding(true);
    try {
      await onRulesAdded(selectedRules);
      setSuggestions(null);
      setSelectedIds(new Set());
      onClose?.();
    } finally {
      setIsAdding(false);
    }
  };

  const secondaryButton =
    'h-8 rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-900 shadow-xs hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';

  return (
    <div className="space-y-3">
      {!autoStart && suggestions === null && !isLoading && (
        <button type="button" onClick={handleGetSuggestions} className={secondaryButton}>
          Suggest checks from my form
        </button>
      )}

      {isLoading && (
        <div className="flex items-center gap-2 py-2 text-sm text-gray-500 dark:text-gray-400">
          <Spinner size="sm" />
          Reading your form…
        </div>
      )}

      {error && <ErrorMessage error={error} autoHide={false} />}

      {suggestions && suggestions.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400">No suggestions for this form.</p>
      )}

      {suggestions && suggestions.length > 0 && (
        <ul className="max-h-96 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
          {suggestions.map((suggestion, index) => (
            <li key={index}>
              <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-900">
                <input
                  type="checkbox"
                  checked={selectedIds.has(index)}
                  onChange={() => toggleSelection(index)}
                  className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-gray-900 dark:text-white">{suggestion.description}</span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400">{suggestion.issue_message}</span>
                  <code className="mt-1 block truncate font-mono text-xs text-gray-600 dark:text-gray-300">
                    {describeConditions(suggestion.conditions)}
                  </code>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {(onClose || (suggestions && suggestions.length > 0)) && (
        <div className="flex items-center justify-end gap-2">
          {onClose && (
            <button type="button" onClick={onClose} className={secondaryButton}>
              Cancel
            </button>
          )}
          {suggestions && suggestions.length > 0 && (
            <button
              type="button"
              onClick={handleAddSelected}
              disabled={selectedIds.size === 0 || isAdding}
              className="h-8 rounded-md bg-indigo-600 px-3 text-sm font-medium text-white shadow-xs hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isAdding ? 'Adding…' : `Add ${selectedIds.size} ${selectedIds.size === 1 ? 'check' : 'checks'}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default AISuggestedRules;
