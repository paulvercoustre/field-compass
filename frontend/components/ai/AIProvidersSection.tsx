import React, { useCallback, useEffect, useState } from 'react';
import {
  AI_PRESETS,
  AIConnection,
  deleteAIConnection,
  describeAIError,
  listAIConnections,
  testAIConnection,
} from '../../services/aiConnectionsApi';
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

/** Account Settings: the user's own AI providers, which surveys use them, and their health. */
const AIProvidersSection: React.FC = () => {
  const [connections, setConnections] = useState<AIConnection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AIConnection | 'new' | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setConnections(await listAIConnections());
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

  const handleDelete = async (connection: AIConnection) => {
    const using = connection.surveys.length;
    const warning = using
      ? `\n\n${using} survey${using > 1 ? 's' : ''} using it will go back to the Field Compass AI allowance.`
      : '';
    if (!window.confirm(`Delete "${connection.label}"?${warning}`)) return;
    setBusyId(connection.connection_id);
    try {
      await deleteAIConnection(connection.connection_id);
      setConnections((current) => current.filter((c) => c.connection_id !== connection.connection_id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the provider.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">AI providers</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Use your own OpenAI-compatible account for AI checks and rule writing on the surveys you own. Keys are
            stored encrypted and never shown again.
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
        <p className="text-sm text-gray-500 dark:text-gray-400">
          None yet. Your surveys use the Field Compass AI allowance.
        </p>
      ) : (
        <ul className="divide-y divide-gray-200 dark:divide-gray-700">
          {connections.map((connection) => (
            <li key={connection.connection_id} className="py-3 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-gray-900 dark:text-white">{connection.label}</span>
                  <AIStatusBadge status={connection.status} />
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 break-all">
                  {AI_PRESETS[connection.preset]?.name ?? connection.preset} · {connection.host} · {connection.check_model}
                  {connection.api_key_hint && ` · key ••••${connection.api_key_hint}`}
                </p>
                {connection.status === 'failing' && (
                  <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">{describeAIError(connection.last_error)}</p>
                )}
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {connection.surveys.length
                    ? `Used by: ${connection.surveys.map((s) => s.survey_name).join(', ')}`
                    : 'Not used by any survey yet.'}
                </p>
              </div>
              <div className="flex gap-2">
                {['Test', 'Edit', 'Delete'].map((action) => (
                  <button
                    key={action}
                    type="button"
                    disabled={busyId === connection.connection_id}
                    onClick={() =>
                      action === 'Test'
                        ? handleTest(connection)
                        : action === 'Edit'
                          ? setEditing(connection)
                          : handleDelete(connection)
                    }
                    className={`px-3 py-1.5 text-xs font-medium rounded-md border disabled:opacity-50 ${
                      action === 'Delete'
                        ? 'text-red-600 border-red-200 dark:border-red-900/60 hover:bg-red-50 dark:hover:bg-red-900/20'
                        : 'text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                  >
                    {action === 'Test' && busyId === connection.connection_id ? 'Testing…' : action}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <AIProviderDialog
          connection={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={replace}
        />
      )}
    </section>
  );
};

export default AIProvidersSection;
