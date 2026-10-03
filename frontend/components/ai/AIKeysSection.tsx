import React, { useCallback, useEffect, useState } from 'react';
import {
  AIConnection,
  AIKeyKind,
  deleteAIConnection,
  describeAIError,
  KEY_KINDS,
  listAIConnections,
  providerName,
  setSurveyAIConnection,
  testAIConnection,
} from '../../services/aiConnectionsApi';
import { getSurveys, Survey } from '../../services/progressApi';
import Banner from '../ui/Banner';
import Button from '../ui/Button';
import ConfirmDialog from '../ui/ConfirmDialog';
import { PlusIcon } from '../ui/icons';
import AIKeyDialog from './AIKeyDialog';

export const AIStatusBadge: React.FC<{ status: AIConnection['status'] }> = ({ status }) => {
  const styles = {
    ok: 'bg-emerald-50 text-emerald-800 ring-emerald-600/15 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20',
    failing: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20',
    untested: 'bg-gray-100 text-gray-700 ring-gray-500/20 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-600/30',
  }[status];
  const text = { ok: 'Connected', failing: 'Not working', untested: 'Not checked' }[status];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${styles}`}>{text}</span>;
};

const KIND_ORDER: AIKeyKind[] = ['review', 'transcription'];

/** What a survey sends with a key of each kind, said where the surveys are chosen. */
const SENT: Record<AIKeyKind, string> = {
  review: 'the answers to the questions chosen for AI review, with their question labels',
  transcription: 'the recordings of the questions chosen for transcription',
};

interface AIKeysSectionProps {
  /** Keys or the surveys using them changed: usage figures should be read again. */
  onChange?: () => void;
}

/**
 * Account settings › AI integration › Your keys. Both kinds of key, in one
 * list with the same row, actions and survey picker. A survey uses at most
 * one key of each kind; without one it runs on the included usage.
 */
const AIKeysSection: React.FC<AIKeysSectionProps> = ({ onChange }) => {
  const [connections, setConnections] = useState<AIConnection[]>([]);
  const [ownedSurveys, setOwnedSurveys] = useState<Survey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ connection?: AIConnection; kind: AIKeyKind } | null>(null);
  const [choosingSurveysFor, setChoosingSurveysFor] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AIConnection | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, surveys] = await Promise.all([listAIConnections(), getSurveys()]);
      setConnections(list);
      setOwnedSurveys(surveys.filter((survey) => survey.is_owner));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your keys.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const replace = (updated: AIConnection) => {
    setConnections((current) =>
      current.some((c) => c.connection_id === updated.connection_id)
        ? current.map((c) => (c.connection_id === updated.connection_id ? updated : c))
        : [...current, updated]
    );
    onChange?.();
  };

  const handleCheck = async (connection: AIConnection) => {
    setBusyId(connection.connection_id);
    try {
      replace(await testAIConnection(connection.connection_id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check the key.');
    } finally {
      setBusyId(null);
    }
  };

  /** Use (or stop using) a key for one survey; the survey leaves any other key of that kind. */
  const toggleSurvey = async (connection: AIConnection, surveyId: string, use: boolean) => {
    setBusyId(connection.connection_id);
    try {
      await setSurveyAIConnection(surveyId, use ? connection.connection_id : null, connection.kind);
      setConnections(await listAIConnections());
      onChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change which surveys use this key.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setIsDeleting(true);
    try {
      await deleteAIConnection(deleting.connection_id);
      setConnections((current) => current.filter((c) => c.connection_id !== deleting.connection_id));
      setDeleting(null);
      onChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the key.');
      setDeleting(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const keyFor = (kind: AIKeyKind, surveyId: string) =>
    connections.find((c) => c.kind === kind && c.surveys.some((s) => s.survey_id === surveyId));

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-card dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-1 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-gray-900 dark:text-white">Your keys</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Choose which surveys use each key. Surveys without one run on the included usage.
          </p>
        </div>
        <Button variant="secondary" icon={<PlusIcon />} onClick={() => setEditing({ kind: 'review' })}>
          Add key
        </Button>
      </div>

      {error && (
        <Banner tone="error" className="mt-3" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}

      {isLoading ? (
        <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">Loading…</p>
      ) : (
        KIND_ORDER.map((kind) => {
          const keys = connections.filter((c) => c.kind === kind);
          return (
            <div key={kind} className="mt-5">
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {KEY_KINDS[kind].name}
              </h3>
              {keys.length === 0 ? (
                <div className="flex items-center justify-between gap-3 border-t border-gray-100 py-3 dark:border-gray-800">
                  <p className="text-sm text-gray-500 dark:text-gray-400">No key: your surveys use the included usage.</p>
                  <Button size="sm" variant="ghost" icon={<PlusIcon />} onClick={() => setEditing({ kind })}>
                    Add key
                  </Button>
                </div>
              ) : (
                <ul className="divide-y divide-gray-100 border-t border-gray-100 dark:divide-gray-800 dark:border-gray-800">
                  {keys.map((connection) => {
                    const busy = busyId === connection.connection_id;
                    const choosing = choosingSurveysFor === connection.connection_id;
                    const detail = [
                      providerName(connection.preset),
                      connection.kind === 'review' ? connection.check_model : null,
                      connection.api_key_hint ? `••••${connection.api_key_hint}` : null,
                      connection.surveys.length
                        ? `${connection.surveys.length} ${connection.surveys.length === 1 ? 'survey' : 'surveys'}`
                        : 'no surveys yet',
                    ].filter(Boolean);
                    return (
                      <li key={connection.connection_id} className="py-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-gray-900 dark:text-white">{connection.label}</span>
                              <AIStatusBadge status={connection.status} />
                            </div>
                            <p className="mt-0.5 break-all text-xs text-gray-500 dark:text-gray-400">{detail.join(' · ')}</p>
                            {connection.last_error && (
                              <p className={`mt-1 text-xs ${connection.status === 'failing' ? 'text-amber-700 dark:text-amber-300' : 'text-gray-500 dark:text-gray-400'}`}>
                                {describeAIError(connection.last_error)}{' '}
                                {connection.status === 'failing'
                                  ? 'Its surveys are paused until it passes a check.'
                                  : 'Nothing is paused; check again later.'}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busy}
                              aria-expanded={choosing}
                              onClick={() => setChoosingSurveysFor(choosing ? null : connection.connection_id)}
                            >
                              Surveys
                            </Button>
                            <Button size="sm" variant="secondary" loading={busy} onClick={() => handleCheck(connection)}>
                              Check
                            </Button>
                            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setEditing({ connection, kind })}>
                              Edit
                            </Button>
                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDeleting(connection)}>
                              Delete
                            </Button>
                          </div>
                        </div>

                        {choosing && (
                          <fieldset className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
                            <legend className="px-1 text-xs font-medium text-gray-700 dark:text-gray-300">
                              Surveys that use {connection.label}
                            </legend>
                            {ownedSurveys.length === 0 ? (
                              <p className="text-xs text-gray-500 dark:text-gray-400">You don't own any surveys yet.</p>
                            ) : (
                              <div className="space-y-1.5">
                                {ownedSurveys.map((survey) => {
                                  const current = keyFor(kind, survey.survey_id);
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
                              For these surveys, {SENT[kind]} are sent to {providerName(connection.preset)}.
                            </p>
                          </fieldset>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })
      )}

      {editing && (
        <AIKeyDialog
          connection={editing.connection}
          initialKind={editing.kind}
          onClose={() => setEditing(null)}
          onSaved={replace}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Delete key?"
        confirmLabel="Delete key"
        busy={isDeleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
      >
        {deleting && (
          <>
            <p>
              <strong className="text-gray-900 dark:text-white">{deleting.label}</strong> is deleted and its stored key
              can't be recovered.
            </p>
            {deleting.surveys.length > 0 && (
              <p>
                {deleting.surveys.map((s) => s.survey_name).join(', ')} go back to the included usage.
              </p>
            )}
          </>
        )}
      </ConfirmDialog>
    </section>
  );
};

export default AIKeysSection;
