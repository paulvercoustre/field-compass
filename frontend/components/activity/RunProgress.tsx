import React, { useState } from 'react';
import { isOpen, RunAction, RunSummary, stopRun, WorkBucket } from '../../services/activityApi';
import { NavigationTarget, useActivity } from '../../contexts/ActivityContext';
import { useAuth } from '../../contexts/AuthContext';
import { useSurvey } from '../../contexts/SurveyContext';
import ConfirmDialog from '../ui/ConfirmDialog';
import { Spinner } from '../Spinner';

const number = (n: number) => n.toLocaleString();
const plural = (n: number, one: string, many = `${one}s`) => `${number(n)} ${n === 1 ? one : many}`;

export const formatEta = (seconds: number | null | undefined): string | null => {
  if (seconds == null) return null;
  if (seconds < 60) return 'less than a minute left';
  const minutes = Math.round(seconds / 60);
  return minutes < 90 ? `about ${minutes} min left` : `about ${Math.round(minutes / 60)} h left`;
};

const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '';

export const runTitle = (run: RunSummary): string => {
  const who = run.started_by.name ? ` by ${run.started_by.name}` : '';
  const what = {
    pull: 'Pull',
    ai_rerun: 'AI review',
    transcription_rerun: 'Transcription',
    kobo_resend: 'Sending to Kobo',
  }[run.kind];
  return `${what} started${who}, ${time(run.started_at || run.created_at)}`;
};

export const runStatusLabel = (run: RunSummary): { label: string; tone: 'busy' | 'ok' | 'warn' | 'error' | 'muted' } => {
  switch (run.status) {
    case 'queued':
      return { label: 'Starting', tone: 'busy' };
    case 'running':
      return { label: run.stage === 'fetching' ? 'Pulling from Kobo' : 'Checking', tone: 'busy' };
    case 'background':
      return { label: run.stop_requested ? 'Stopping' : 'Working', tone: 'busy' };
    case 'failed':
      return { label: 'Failed', tone: 'error' };
    case 'stopped':
      return { label: 'Stopped', tone: 'muted' };
    default:
      return { label: run.problems.length ? 'Finished, with problems' : 'Finished', tone: run.problems.length ? 'warn' : 'ok' };
  }
};

/** Where a problem's action button goes. */
export const actionTarget = (action: RunAction, surveyId: string): { label: string; target: NavigationTarget } | null => {
  switch (action) {
    case 'open_ai_providers':
      return { label: 'Open AI settings', target: { view: 'userSettings', tab: 'ai' } };
    case 'open_ai_usage':
      return { label: 'See AI use', target: { view: 'userSettings', tab: 'ai' } };
    case 'open_kobo_settings':
      return { label: 'Open Kobo connection', target: { view: 'userSettings', tab: 'kobo' } };
    case 'open_transcription_settings':
      return { label: 'Open transcription settings', target: { view: 'settings', survey_id: surveyId, tab: 'transcription' } };
    default:
      return null;
  }
};

const StepIcon: React.FC<{ state: 'done' | 'busy' | 'warn' | 'waiting' }> = ({ state }) => {
  if (state === 'busy') return <Spinner size="sm" className="text-indigo-600 dark:text-indigo-400" />;
  if (state === 'waiting') return <span className="block h-2 w-2 rounded-full bg-gray-300 dark:bg-gray-600" aria-hidden="true" />;
  return (
    <svg
      className={`h-4 w-4 ${state === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {state === 'warn' ? <path d="M12 8v5M12 16.5h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /> : <path d="m5 12.5 4.5 4.5L19 7" />}
    </svg>
  );
};

const Bar: React.FC<{ done: number; total: number; label: string }> = ({ done, total, label }) => {
  const share = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div
      className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-label={label}
    >
      <div className="h-full rounded-full bg-indigo-500 transition-[width] duration-500" style={{ width: `${share}%` }} />
    </div>
  );
};

interface StepProps {
  state: 'done' | 'busy' | 'warn' | 'waiting';
  title: string;
  children?: React.ReactNode;
  bar?: { done: number; total: number };
}

const Step: React.FC<StepProps> = ({ state, title, children, bar }) => (
  <li className="flex gap-2.5">
    <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center">
      <StepIcon state={state} />
    </span>
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-sm font-medium text-gray-900 dark:text-white">{title}</span>
        {children && <span className="text-xs text-gray-600 dark:text-gray-400">{children}</span>}
      </div>
      {bar && bar.total > 0 && state === 'busy' && <Bar done={bar.done} total={bar.total} label={title} />}
    </div>
  </li>
);

const CountLink: React.FC<{ count: number; text: string; onClick?: () => void; tone?: 'warn' }> = ({ count, text, onClick, tone }) => {
  if (!count) return null;
  const className = tone === 'warn' ? 'text-amber-700 dark:text-amber-300' : '';
  return onClick ? (
    <button type="button" onClick={onClick} className={`underline decoration-dotted underline-offset-2 hover:text-gray-900 dark:hover:text-white ${className}`}>
      {number(count)} {text}
    </button>
  ) : (
    <span className={className}>
      {number(count)} {text}
    </span>
  );
};

/** Every item was queued again by a later run: counted there instead. */
const allHandedOff = (bucket: WorkBucket) => bucket.handed_off > 0 && bucket.queued === bucket.handed_off;

const bucketState = (bucket: WorkBucket): StepProps['state'] =>
  bucket.open > 0 ? 'busy' : bucket.failed > 0 ? 'warn' : 'done';

const sep = <span aria-hidden="true"> · </span>;

interface RunProgressProps {
  run: RunSummary;
  /** Hide the survey name (inside a survey's own page). */
  compact?: boolean;
}

/**
 * One run, stage by stage: fetched, checked, then the AI reviews,
 * transcriptions and Kobo sends it started, with counts, time left and
 * problems in words. Counts link to the matching submissions.
 */
const RunProgress: React.FC<RunProgressProps> = ({ run, compact = false }) => {
  const { navigate, trackRun } = useActivity();
  const { user } = useAuth();
  const { surveys } = useSurvey();
  const [confirmStop, setConfirmStop] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);

  const permission = surveys.find((s) => s.survey_id === run.survey_id)?.permission;
  const canStop =
    isOpen(run) && !run.stop_requested && (run.started_by.user_id === user?.user_id || permission === 'owner' || permission === 'admin');
  const toSubmissions = (filters: Record<string, unknown>) => () =>
    navigate({ view: 'dashboard', survey_id: run.survey_id, filters });

  const handleStop = async () => {
    setStopping(true);
    setStopError(null);
    try {
      trackRun(await stopRun(run.run_id));
      setConfirmStop(false);
    } catch (err) {
      setStopError(err instanceof Error ? err.message : 'Could not stop it.');
    } finally {
      setStopping(false);
    }
  };

  const status = runStatusLabel(run);
  const statusClass = {
    busy: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-400/25',
    ok: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/25',
    warn: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/25',
    error: 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-400/25',
    muted: 'bg-gray-100 text-gray-700 ring-gray-500/20 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-600/30',
  }[status.tone];

  const pull = run.pull;
  const ai = run.ai_checks;
  const transcripts = run.transcripts;
  const kobo = run.kobo;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {!compact && <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{run.survey_name}</p>}
          <p className="text-xs text-gray-500 dark:text-gray-400">{runTitle(run)}</p>
        </div>
        <span className={`inline-flex flex-shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${statusClass}`}>
          {status.label}
        </span>
      </div>

      {run.status === 'failed' && run.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-200">{run.error}</p>
      )}

      <ol className="space-y-2.5">
        {run.kind === 'pull' && run.status !== 'failed' && (
          <>
            <Step
              state={run.status === 'queued' || run.stage === 'fetching' ? 'busy' : 'done'}
              title={run.status === 'queued' ? 'Waiting to start' : run.stage === 'fetching' ? 'Fetching from Kobo…' : 'Fetched from Kobo'}
            >
              {pull && run.stage !== 'fetching' && run.status !== 'queued' && (
                <>
                  {plural(pull.fetched, 'submission')}
                  {run.status !== 'running' && (
                    <>
                      {sep}
                      {number(pull.new)} new
                      {pull.edited > 0 && (
                        <>
                          {sep}
                          {number(pull.edited)} edited
                        </>
                      )}
                    </>
                  )}
                </>
              )}
            </Step>
            {run.stage !== 'fetching' && run.status !== 'queued' && (
              <Step
                state={run.status === 'running' ? 'busy' : 'done'}
                title={run.status === 'running' ? 'Checking submissions…' : 'Quality checks'}
                bar={run.status === 'running' && pull ? { done: pull.processed ?? 0, total: pull.fetched } : undefined}
              >
                {run.status === 'running' && pull ? (
                  `${number(pull.processed ?? 0)} of ${number(pull.fetched)}`
                ) : pull ? (
                  <CountLink count={pull.flagged} text="flagged" onClick={toSubmissions({ qaStatuses: ['FLAGGED'] })} />
                ) : null}
                {run.status !== 'running' && pull && pull.flagged === 0 && 'nothing flagged'}
              </Step>
            )}
          </>
        )}

        {ai && allHandedOff(ai) && (
          <Step state="done" title="AI review">
            moved to a later run
          </Step>
        )}
        {ai && ai.queued > 0 && !allHandedOff(ai) && (
          <Step
            state={bucketState(ai)}
            title="AI review"
            bar={{ done: ai.done + ai.failed + ai.not_run, total: ai.queued - ai.handed_off }}
          >
            {number(ai.done)} of {number(ai.queued - ai.handed_off)}
            {ai.failed > 0 && (
              <>
                {sep}
                <CountLink count={ai.failed} text="failed" tone="warn" onClick={toSubmissions({ aiReview: 'failed' })} />
              </>
            )}
            {ai.not_run > 0 && (
              <>
                {sep}
                <CountLink count={ai.not_run} text="not run" onClick={toSubmissions({ aiReview: 'not_run' })} />
              </>
            )}
            {formatEta(ai.eta_seconds) && (
              <>
                {sep}
                {formatEta(ai.eta_seconds)}
              </>
            )}
          </Step>
        )}

        {transcripts && allHandedOff(transcripts) && (
          <Step state="done" title="Transcripts">
            moved to a later run
          </Step>
        )}
        {transcripts && transcripts.queued > 0 && !allHandedOff(transcripts) && (
          <Step
            state={bucketState(transcripts)}
            title="Transcripts"
            bar={{ done: transcripts.done + transcripts.failed + transcripts.not_run, total: transcripts.queued - transcripts.handed_off }}
          >
            {number(transcripts.done)} of {number(transcripts.queued - transcripts.handed_off)}
            {transcripts.minutes > 0 && (
              <>
                {sep}
                {transcripts.minutes} min of audio
              </>
            )}
            {(transcripts.flagged ?? 0) > 0 && (
              <>
                {sep}
                <CountLink count={transcripts.flagged ?? 0} text="flagged" tone="warn" onClick={toSubmissions({ qaStatuses: ['FLAGGED'], transcript: 'any' })} />
              </>
            )}
            {transcripts.failed > 0 && (
              <>
                {sep}
                <CountLink count={transcripts.failed} text="failed" tone="warn" onClick={toSubmissions({ transcript: 'failed' })} />
              </>
            )}
            {transcripts.not_run > 0 && (
              <>
                {sep}
                {number(transcripts.not_run)} not run
              </>
            )}
            {formatEta(transcripts.eta_seconds) && (
              <>
                {sep}
                {formatEta(transcripts.eta_seconds)}
              </>
            )}
          </Step>
        )}

        {kobo && kobo.queued > 0 && (
          <Step state={bucketState(kobo)} title="Sent to Kobo" bar={{ done: kobo.done + kobo.failed + kobo.not_run, total: kobo.queued }}>
            {number(kobo.done)} of {number(kobo.queued)}
            {kobo.edited_in_kobo > 0 && (
              <>
                {sep}
                {number(kobo.edited_in_kobo)} corrected in Kobo
              </>
            )}
            {kobo.failed > 0 && (
              <>
                {sep}
                <span className="text-amber-700 dark:text-amber-300">{number(kobo.failed)} couldn't be sent</span>
              </>
            )}
          </Step>
        )}
      </ol>

      {run.problems.length > 0 && (
        <ul className="space-y-1.5">
          {run.problems.map((problem) => {
            const action = actionTarget(problem.action, run.survey_id);
            return (
              <li
                key={problem.kind}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
              >
                <span className="min-w-0">{problem.text}</span>
                {action && (
                  <button
                    type="button"
                    onClick={() => navigate(action.target)}
                    className="flex-shrink-0 text-xs font-medium underline underline-offset-2 hover:no-underline"
                  >
                    {action.label}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {run.stop_requested && isOpen(run) && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Stopping: work already under way finishes; the rest runs on the next pull.
        </p>
      )}

      {canStop && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setConfirmStop(true)}
            className="text-xs font-medium text-gray-600 hover:text-red-700 dark:text-gray-400 dark:hover:text-red-300"
          >
            Stop remaining work
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirmStop}
        title="Stop remaining work?"
        confirmLabel="Stop"
        busy={stopping}
        onConfirm={handleStop}
        onCancel={() => setConfirmStop(false)}
      >
        <p>
          Queued AI reviews and transcriptions for <strong className="text-gray-900 dark:text-white">{run.survey_name}</strong> won't run now.
          Work already under way finishes.
        </p>
        <p>Everything stopped runs again on the next pull.</p>
        {stopError && <p className="text-red-600 dark:text-red-400">{stopError}</p>}
      </ConfirmDialog>
    </div>
  );
};

export default RunProgress;
