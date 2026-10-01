import React, { useEffect, useState } from 'react';
import {
  AIConnection,
  AIConnectionSummary,
  describeAIError,
  listAIConnections,
  setSurveyAIConnection,
  testAIConnection,
} from '../../services/aiConnectionsApi';
import AIProviderDialog from './AIProviderDialog';
import { AIStatusBadge } from './AIProvidersSection';

interface SurveyAIProviderCardProps {
  surveyId: string;
  /** Only the survey's owner may change which provider it uses. */
  isOwner: boolean;
  current: AIConnectionSummary | null;
  onChanged: (summary: AIConnectionSummary | null) => void;
}

/**
 * Which AI provider a survey's checks and rule writing use: the Field Compass
 * allowance, or one of the owner's own providers. Says what is sent where.
 */
const SurveyAIProviderCard: React.FC<SurveyAIProviderCardProps> = ({ surveyId, isOwner, current, onChanged }) => {
  const [connections, setConnections] = useState<AIConnection[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDialog, setShowDialog] = useState(false);

  useEffect(() => {
    if (!isOwner) return;
    listAIConnections()
      .then(setConnections)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load your AI providers.'));
  }, [isOwner]);

  const choose = async (connectionId: string | null) => {
    setIsSaving(true);
    setError(null);
    try {
      const { ai_connection } = await setSurveyAIConnection(surveyId, connectionId);
      onChanged(ai_connection);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the AI provider.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    if (!current) return;
    setIsTesting(true);
    try {
      const tested = await testAIConnection(current.connection_id);
      onChanged({ ...current, status: tested.status, last_error: tested.last_error });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not test the provider.');
    } finally {
      setIsTesting(false);
    }
  };

  const handleAdded = (connection: AIConnection) => {
    setConnections((list) => [...list.filter((c) => c.connection_id !== connection.connection_id), connection]);
    if (connection.status === 'ok') choose(connection.connection_id);
  };

  const radio = 'h-4 w-4 text-indigo-600 border-gray-300 dark:border-gray-600 focus:ring-indigo-600';
  const sentTo = current ? `${current.label} (${current.host})` : 'the Field Compass AI provider (OpenAI)';

  return (
    <div className="p-3 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
      <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-2">AI provider</h3>

      {isOwner ? (
        <fieldset className="space-y-2" disabled={isSaving}>
          <legend className="sr-only">AI provider for this survey</legend>
          <label className="flex items-start gap-2 text-sm text-gray-900 dark:text-white">
            <input type="radio" name="ai-provider" className={`${radio} mt-0.5`} checked={!current} onChange={() => choose(null)} />
            <span>
              Field Compass AI allowance
              <span className="block text-xs text-gray-500 dark:text-gray-400">Included with Field Compass.</span>
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
              <input
                type="radio"
                name="ai-provider"
                className={radio}
                checked={Boolean(current)}
                disabled={connections.length === 0}
                onChange={() => connections[0] && choose(connections[0].connection_id)}
              />
              Your own provider
            </label>
            {connections.length > 0 && (
              <select
                aria-label="Your AI provider"
                value={current?.connection_id ?? ''}
                onChange={(e) => choose(e.target.value || null)}
                className="text-sm px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="">Choose…</option>
                {connections.map((c) => (
                  <option key={c.connection_id} value={c.connection_id}>
                    {c.label} — {c.check_model}
                  </option>
                ))}
              </select>
            )}
            {current && <AIStatusBadge status={current.status} />}
            {current && (
              <button
                type="button"
                onClick={handleTest}
                disabled={isTesting}
                className="px-2 py-1 text-xs font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
              >
                {isTesting ? 'Testing…' : 'Test'}
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowDialog(true)}
              className="px-2 py-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              + Add a provider
            </button>
          </div>
        </fieldset>
      ) : (
        <p className="text-sm text-gray-900 dark:text-white">
          {current ? (
            <>
              {current.label} <span className="text-gray-500 dark:text-gray-400">· {current.check_model}</span>{' '}
              <AIStatusBadge status={current.status} />
            </>
          ) : (
            'Field Compass AI allowance'
          )}
        </p>
      )}

      {current?.status === 'failing' && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          AI checks are paused: {describeAIError(current.last_error)}{' '}
          {isOwner ? 'Fix it in Account Settings › AI providers, then test it again.' : 'Ask the survey owner to fix it.'}
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
        What is sent: the answers to the questions selected below, with their question labels. Sent to: {sentTo}.
      </p>

      {showDialog && <AIProviderDialog onClose={() => setShowDialog(false)} onSaved={handleAdded} />}
    </div>
  );
};

export default SurveyAIProviderCard;
