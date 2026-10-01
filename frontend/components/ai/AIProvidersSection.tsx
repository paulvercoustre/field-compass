import React, { useCallback, useEffect, useState } from 'react';
import {
  AI_PRESETS,
  AIConnection,
  deleteAIConnection,
  describeAIError,
  listAIConnections,
  setSurveyAIConnection,
  testAIConnection,
} from '../../services/aiConnectionsApi';
import { getSurveys, Survey } from '../../services/progressApi';
import AIProviderDialog from './AIProviderDialog';

export const AIStatusBadge: React.FC<{ status: AIConnection['status'] }> = ({ status }) => {
  const styles = {
    ok: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    failing: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    untested: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  }[status];
  const text = { ok: 'Connected', failing: 'Not working', untested: 'Not tested' }[status];
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${styles}`}>{text}</span>;
};

const smallButton =
  'px-3 py-1.5 text-xs font-medium rounded-md border disabled:opacity-50 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700';

/**
 * Account Settings: the user's own AI providers, their health, and which of
 * the user's surveys use each. A survey uses at most one; the rest use the
 * Field Compass AI allowance.
 */
const AIProvidersSection: React.FC = () => {
  const [connections, setConnections] = useState<AIConnection[]>([]);
  const [ownedSurveys, setOwnedSurveys] = useState<Survey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AIConnection | 'new' | null>(null);
  const [choosingSurveysFor, setChoosingSurveysFor] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AIConnection | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, surveys] = await Promise.all([listAIConnections(), getSurveys()]);
      setConnections(list);
      setOwnedSurveys(surveys.filter((survey) => survey.is_owner));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your AI providers.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const replace = (updated: AIConnection) =>
    setConnections((current) => {
      const exists = current.some((c) => c.connection_id === updated.connection_id);
      return exists
        ? current.map((c) => (c.connection_id === updated.connection_id ? updated : c))
        : [...current, updated];
    });

  const handleTest = async (connection: AIConnection) => {
    setBusyId(connection.connection_id);
    try {
      replace(await testAIConnection(connection.connection_id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not test the provider.');
    } finally {
      setBusyId(null);
    }
  };

  /** Use (or stop using) a provider for one survey; a survey moves off any other provider. */
  const toggleSurvey = async (connection: AIConnection, surveyId: string, use: boolean) => {
    setBusyId(connection.connection_id);
    try {
      await setSurveyAIConnection(surveyId, use ? connection.connection_id : null);
      setConnections(await listAIConnections());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change which surveys use this provider.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleting) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteAIConnection(deleting.connection_id);
      setConnections((current) => current.filter((c) => c.connection_id !== deleting.connection_id));
      setDeleting(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Could not delete the provider.');
    } finally {
      setIsDeleting(false);
    }
  };

  const providerFor = (surveyId: string) =>
    connections.find((c) => c.surveys.some((s) => s.survey_id === surveyId));

  return (
    <section className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">AI providers</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Use your own OpenAI-compatible account for AI checks and rule writing on surveys you own. Surveys without
            one use the Field Compass AI allowance. Keys are stored encrypted and never shown again.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="flex-shrink-0 px-3 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700"
        >
          Add a provider
        </button>
      </div>

      {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {isLoading ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
      ) : connections.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">None yet. Your surveys use the Field Compass AI allowance.</p>
      ) : (
        <ul className="divide-y divide-gray-200 dark:divide-gray-700">
          {connections.map((connection) => {
            const busy = busyId === connection.connection_id;
            const choosing = choosingSurveysFor === connection.connection_id;
            return (
              <li key={connection.connection_id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gray-900 dark:text-white">{connection.label}</span>
                      <AIStatusBadge status={connection.status} />
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 break-all">
                      {AI_PRESETS[connection.preset]?.name ?? connection.preset} · {connection.host} ·{' '}
                      {connection.check_model}
                      {connection.api_key_hint && ` · key ••••${connection.api_key_hint}`}
                    </p>
                    {connection.status === 'failing' && (
                      <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                        {describeAIError(connection.last_error)} AI checks on its surveys are paused until it passes a test.
                      </p>
                    )}
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {connection.surveys.length
                        ? `Used by: ${connection.surveys.map((s) => s.survey_name).join(', ')}`
                        : 'Not used by any survey yet.'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      aria-expanded={choosing}
                      onClick={() => setChoosingSurveysFor(choosing ? null : connection.connection_id)}
                      className={smallButton}
                    >
                      Surveys
                    </button>
                    <button type="button" disabled={busy} onClick={() => handleTest(connection)} className={smallButton}>
                      {busy ? 'Working…' : 'Test'}
                    </button>
                    <button type="button" disabled={busy} onClick={() => setEditing(connection)} className={smallButton}>
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setDeleteError(null);
                        setDeleting(connection);
                      }}
                      className="px-3 py-1.5 text-xs font-medium rounded-md border disabled:opacity-50 text-red-600 border-red-200 dark:border-red-900/60 hover:bg-red-50 dark:hover:bg-red-900/20"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {choosing && (
                  <fieldset className="mt-3 p-3 rounded-md bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700">
                    <legend className="px-1 text-xs font-medium text-gray-700 dark:text-gray-300">
                      Surveys that use {connection.label}
                    </legend>
                    {ownedSurveys.length === 0 ? (
                      <p className="text-xs text-gray-500 dark:text-gray-400">You don't own any surveys yet.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {ownedSurveys.map((survey) => {
                          const current = providerFor(survey.survey_id);
                          const usesThis = current?.connection_id === connection.connection_id;
                          return (
                            <label key={survey.survey_id} className="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
                              <input
                                type="checkbox"
                                checked={usesThis}
                                disabled={busy}
                                onChange={(e) => toggleSurvey(connection, survey.survey_id, e.target.checked)}
                                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600 dark:border-gray-600 dark:bg-gray-700"
                              />
                              {survey.survey_name}
                              {current && !usesThis && (
                                <span className="text-xs text-gray-500 dark:text-gray-400">(uses {current.label})</span>
                              )}
                            </label>
                          );
                        })}
                      </div>
                    )}
                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                      For these surveys, the answers to the questions selected for AI checks are sent, with their
                      question labels, to {connection.label} ({connection.host}).
                    </p>
                  </fieldset>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <AIProviderDialog
          connection={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={replace}
        />
      )}

      {/* Delete confirmation: same dialog style as deleting a survey */}
      {deleting && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-ai-provider-title"
            className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 border border-gray-200 dark:border-gray-700"
          >
            <h2 id="delete-ai-provider-title" className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              Delete AI provider
            </h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              Are you sure you want to delete <strong className="text-gray-900 dark:text-white">{deleting.label}</strong>?
              <br />
              <br />
              {deleting.surveys.length > 0
                ? `${deleting.surveys.length} survey${deleting.surveys.length > 1 ? 's' : ''} using it (${deleting.surveys
                    .map((s) => s.survey_name)
                    .join(', ')}) will go back to the Field Compass AI allowance. `
                : ''}
              Its stored key is deleted and cannot be recovered.
            </p>
            {deleteError && (
              <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg mb-4">
                <p className="text-sm text-red-600 dark:text-red-400">{deleteError}</p>
              </div>
            )}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleting(null)}
                disabled={isDeleting}
                className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={isDeleting}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-red-300 dark:disabled:bg-red-700 disabled:cursor-not-allowed text-sm font-medium"
              >
                {isDeleting ? 'Deleting...' : 'Delete Provider'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default AIProvidersSection;
