import React, { useCallback, useEffect, useState } from 'react';
import { useActivity } from '../../contexts/ActivityContext';
import {
  AI_FEATURES,
  AIConnection,
  AIKeyUse,
  describeAIError,
  listAIConnections,
  providerName,
  setSurveyAIConnection,
} from '../../services/aiConnectionsApi';

interface SurveyKeyPickerProps {
  surveyId: string;
  /** Which feature of the survey the key is for. */
  use: AIKeyUse;
  /** E.g. "500 translations a month"; shown with the included option. */
  included?: string | null;
  /** Called after the survey changed key, so the card can show the change. */
  onChange?: () => void;
}

/**
 * Survey settings: which key a feature of this survey runs on -- the included
 * usage, or one of the owner's own API keys of the right kind. Shown to the
 * survey's owner only: a key is spent on their behalf. Account settings › AI
 * integration lists the same choice from the key's side.
 */
const SurveyKeyPicker: React.FC<SurveyKeyPickerProps> = ({ surveyId, use, included, onChange }) => {
  const { navigate } = useActivity();
  const [keys, setKeys] = useState<AIConnection[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const feature = AI_FEATURES[use];

  const load = useCallback(async () => {
    try {
      const all = await listAIConnections();
      setKeys(all.filter((key) => key.kind === feature.kind));
    } catch {
      setKeys([]);
    }
  }, [feature.kind]);

  useEffect(() => {
    load();
  }, [load, surveyId]);

  if (keys === null) return null;

  const current = keys.find((key) => key.surveys.some((s) => s.survey_id === surveyId && s.uses.includes(use)));
  const toAccountKeys = () => navigate({ view: 'userSettings', tab: 'ai' });

  const choose = async (connectionId: string) => {
    setSaving(true);
    setError(null);
    try {
      await setSurveyAIConnection(surveyId, connectionId || null, use);
      await load();
      onChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the key.');
    } finally {
      setSaving(false);
    }
  };

  const includedOption = `Included usage${included ? ` · ${included}` : ''}`;

  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-gray-700 dark:bg-gray-900/40">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label htmlFor={`key-${use}`} className="text-sm font-medium text-gray-900 dark:text-white">
          Runs on
        </label>
        {keys.length === 0 ? (
          <span className="text-sm text-gray-700 dark:text-gray-300">
            {includedOption}
            <span className="text-gray-500 dark:text-gray-400">
              {' · '}
              <button type="button" onClick={toAccountKeys} className="font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400">
                Add your own API key
              </button>{' '}
              for no Field Compass limit
            </span>
          </span>
        ) : (
          <select
            id={`key-${use}`}
            value={current?.connection_id ?? ''}
            disabled={saving}
            onChange={(e) => choose(e.target.value)}
            className="min-w-0 max-w-full flex-1 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60 sm:max-w-md dark:border-gray-600 dark:bg-gray-900 dark:text-white"
          >
            <option value="">{includedOption}</option>
            <optgroup label="Your API keys (no Field Compass limit)">
              {keys.map((key) => (
                <option key={key.connection_id} value={key.connection_id}>
                  {[key.label, providerName(key.preset), key.kind === 'review' ? key.check_model : null]
                    .filter(Boolean)
                    .join(' · ')}
                  {key.status === 'failing' ? ' (not working)' : ''}
                </option>
              ))}
            </optgroup>
          </select>
        )}
      </div>
      {current?.status === 'failing' && (
        <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-300">
          {describeAIError(current.last_error)} {feature.name} is paused until the key passes a check in{' '}
          <button type="button" onClick={toAccountKeys} className="font-medium underline underline-offset-2">
            Account settings
          </button>
          .
        </p>
      )}
      {current && current.status !== 'failing' && (
        <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
          {feature.name} for this survey is paid by your {providerName(current.preset)} account.
        </p>
      )}
      {error && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
};

export default SurveyKeyPicker;
