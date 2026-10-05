import React, { useEffect, useState } from 'react';
import { useActivity } from '../../contexts/ActivityContext';
import { useAuth } from '../../contexts/AuthContext';
import { useSurvey } from '../../contexts/SurveyContext';
import { getSurveyRuns, isOpen, RunSummary } from '../../services/activityApi';
import { Spinner } from '../Spinner';
import RunProgress, { runStatusLabel, runTitle } from './RunProgress';

/** One line for the header: what is running, briefly. */
const headline = (runs: RunSummary[]): string | null => {
  const open = runs.filter(isOpen);
  if (open.length === 0) return null;
  if (open.length > 1) return `${open.length} things running`;
  const run = open[0];
  const name = run.survey_name || 'Survey';
  if (run.status === 'queued') return `${name}: starting`;
  if (run.status === 'running') {
    return run.stage === 'fetching' ? `${name}: pulling from Kobo` : `${name}: checking`;
  }
  const parts: string[] = [];
  if (run.transcripts && run.transcripts.open > 0) {
    parts.push(`transcripts ${run.transcripts.done} of ${run.transcripts.queued - run.transcripts.handed_off}`);
  }
  if (run.translations && run.translations.open > 0) {
    parts.push(`translations ${run.translations.done} of ${run.translations.queued - run.translations.handed_off}`);
  }
  if (run.ai_checks && run.ai_checks.open > 0) {
    parts.push(`AI review ${run.ai_checks.done} of ${run.ai_checks.queued - run.ai_checks.handed_off}`);
  }
  if (run.kobo && run.kobo.open > 0) parts.push(`to Kobo ${run.kobo.done} of ${run.kobo.queued}`);
  return `${name}: ${parts.join(', ') || 'finishing'}`;
};

/** How one of your own runs ended, for the header until you have seen it. */
const outcome = (run: RunSummary): { tone: 'ok' | 'warn' | 'error' | 'muted'; text: string } => {
  const name = run.survey_name || 'Survey';
  if (run.status === 'failed') return { tone: 'error', text: run.kind === 'pull' ? `Couldn't pull ${name}` : `${name}: failed` };
  if (run.status === 'stopped') return { tone: 'muted', text: `${name}: stopped` };
  if (run.problems.length) return { tone: 'warn', text: `${name}: finished with problems` };
  if (run.kind === 'pull' && run.pull) return { tone: 'ok', text: `${name}: ${run.pull.new} new, ${run.pull.flagged} flagged` };
  return { tone: 'ok', text: `${name}: finished` };
};

const outcomeClass = {
  ok: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-200 dark:ring-emerald-400/25 dark:hover:bg-emerald-500/20',
  warn: 'bg-amber-50 text-amber-900 ring-amber-600/20 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-400/25 dark:hover:bg-amber-500/20',
  error: 'bg-red-50 text-red-800 ring-red-600/20 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-200 dark:ring-red-400/25 dark:hover:bg-red-500/20',
  muted: 'bg-gray-100 text-gray-700 ring-gray-500/20 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-600/30 dark:hover:bg-gray-700',
};

const OutcomeIcon: React.FC<{ tone: keyof typeof outcomeClass }> = ({ tone }) => (
  <svg className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {tone === 'ok' ? (
      <path d="m5 12.5 4.5 4.5L19 7" />
    ) : tone === 'muted' ? (
      <path d="M8 12h8" />
    ) : (
      <path d="M12 8v5M12 16.5h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    )}
  </svg>
);

const SEEN_KEY = 'fc_seen_runs';

const readSeen = (): string[] => {
  try {
    return JSON.parse(sessionStorage.getItem(SEEN_KEY) || '[]');
  } catch {
    return [];
  }
};

/**
 * Header control, on every page: a spinner and one line while anything runs;
 * then how your own last run ended (pulled, failed, problems) until you open
 * the panel, or for the ten minutes the server keeps a finished run. This is
 * where a pull reports back, whichever page started it.
 */
export const ActivityIndicator: React.FC = () => {
  const { runs, panelOpen, setPanelOpen } = useActivity();
  const { user } = useAuth();
  const [seen, setSeen] = useState<string[]>(readSeen);
  const line = headline(runs);

  // Opening the panel shows every finished run in full: they are seen.
  useEffect(() => {
    if (!panelOpen) return;
    const ended = runs.filter((run) => !isOpen(run)).map((run) => run.run_id);
    setSeen((current) => {
      if (ended.every((id) => current.includes(id))) return current;
      const next = [...current, ...ended.filter((id) => !current.includes(id))].slice(-50);
      try {
        sessionStorage.setItem(SEEN_KEY, JSON.stringify(next));
      } catch {
        // Storage can be refused; the outcome then shows again after a reload.
      }
      return next;
    });
  }, [panelOpen, runs]);

  const ended = line
    ? null
    : runs.find((run) => !isOpen(run) && run.started_by.user_id === user?.user_id && !seen.includes(run.run_id)) ?? null;
  const result = ended ? outcome(ended) : null;

  let control: React.ReactNode;
  if (line) {
    control = (
      <button
        type="button"
        onClick={() => setPanelOpen(true)}
        className="inline-flex max-w-[22rem] items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-800 ring-1 ring-inset ring-indigo-600/20 hover:bg-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-200 dark:ring-indigo-400/25 dark:hover:bg-indigo-500/20"
        aria-label={`Activity: ${line}`}
      >
        <Spinner size="sm" className="text-indigo-600 dark:text-indigo-300" />
        <span className="truncate">{line}</span>
      </button>
    );
  } else if (result) {
    control = (
      <button
        type="button"
        onClick={() => setPanelOpen(true)}
        className={`inline-flex max-w-[22rem] items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${outcomeClass[result.tone]}`}
        aria-label={`Activity: ${result.text}. Open for details.`}
      >
        <OutcomeIcon tone={result.tone} />
        <span className="truncate">{result.text}</span>
      </button>
    );
  } else {
    control = (
      <button
        type="button"
        onClick={() => setPanelOpen(true)}
        className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
        aria-label="Activity"
        title="Activity"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M22 12h-4l-3 8L9 4l-3 8H2" />
        </svg>
      </button>
    );
  }

  return (
    <>
      {control}
      {/* Says when a run ends, for screen readers; the control above changes too often to be live itself. */}
      <span className="sr-only" role="status">
        {result ? result.text : ''}
      </span>
    </>
  );
};

/** What happened before: a survey's last runs, one line each. */
const RecentRuns: React.FC<{ surveyId: string; exclude: Set<string> }> = ({ surveyId, exclude }) => {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSurveyRuns(surveyId, 10)
      .then((result) => !cancelled && setRuns(result.runs))
      .catch(() => !cancelled && setRuns([]));
    return () => {
      cancelled = true;
    };
  }, [surveyId]);

  const older = (runs ?? []).filter((run) => !exclude.has(run.run_id));
  if (runs === null) return <p className="text-xs text-gray-500 dark:text-gray-400">Loading…</p>;
  if (older.length === 0) return <p className="text-xs text-gray-500 dark:text-gray-400">No earlier pulls.</p>;
  return (
    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
      {older.map((run) => {
        const status = runStatusLabel(run);
        return (
          <li key={run.run_id} className="py-2">
            <button
              type="button"
              onClick={() => setExpanded(expanded === run.run_id ? null : run.run_id)}
              className="flex w-full items-center justify-between gap-3 text-left"
              aria-expanded={expanded === run.run_id}
            >
              <span className="min-w-0 truncate text-xs text-gray-700 dark:text-gray-300">
                {new Date(run.created_at || '').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · {runTitle(run)}
                {run.pull && ` · ${run.pull.new} new, ${run.pull.flagged} flagged`}
              </span>
              <span className="flex-shrink-0 text-xs text-gray-500 dark:text-gray-400">{status.label}</span>
            </button>
            {expanded === run.run_id && (
              <div className="mt-3 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                <RunProgress run={run} compact />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
};

/**
 * The activity panel: every run under way or just finished, stage by stage,
 * and the selected survey's earlier pulls.
 */
export const ActivityPanel: React.FC = () => {
  const { runs, panelOpen, setPanelOpen, refresh } = useActivity();
  const { selectedSurvey } = useSurvey();

  useEffect(() => {
    if (!panelOpen) return;
    refresh();
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setPanelOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen, refresh, setPanelOpen]);

  if (!panelOpen) return null;
  const open = runs.filter(isOpen);
  const recent = runs.filter((run) => !isOpen(run));

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-gray-950/20" onMouseDown={(e) => e.target === e.currentTarget && setPanelOpen(false)}>
      <aside
        role="dialog"
        aria-label="Activity"
        className="flex h-full w-full max-w-md flex-col border-l border-gray-200 bg-white shadow-popover animate-fade-in dark:border-gray-800 dark:bg-gray-950"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-800">
          <h2 className="text-base font-semibold tracking-tight text-gray-900 dark:text-white">Activity</h2>
          <button
            type="button"
            onClick={() => setPanelOpen(false)}
            className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-white"
            aria-label="Close"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
          <section>
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Running now</h3>
            {open.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">Nothing is running.</p>
            ) : (
              <div className="space-y-3">
                {open.map((run) => (
                  <div key={run.run_id} className="rounded-lg border border-gray-200 p-4 dark:border-gray-800">
                    <RunProgress run={run} />
                  </div>
                ))}
              </div>
            )}
          </section>

          {recent.length > 0 && (
            <section>
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Just finished</h3>
              <div className="space-y-3">
                {recent.map((run) => (
                  <div key={run.run_id} className="rounded-lg border border-gray-200 p-4 dark:border-gray-800">
                    <RunProgress run={run} />
                  </div>
                ))}
              </div>
            </section>
          )}

          {selectedSurvey && (
            <section>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Earlier on {selectedSurvey.survey_name}
              </h3>
              <RecentRuns surveyId={selectedSurvey.survey_id} exclude={new Set(runs.map((run) => run.run_id))} />
            </section>
          )}
        </div>
      </aside>
    </div>
  );
};

export default ActivityIndicator;
