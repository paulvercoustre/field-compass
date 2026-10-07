import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  getActivity,
  isOpen,
  NotificationLink,
  RunSummary,
  startPull as startPullRequest,
} from '../services/activityApi';
import { ApiError } from '../services/apiBase';
import { useAuth } from './AuthContext';
import { NavigationTarget, useNavigation } from './NavigationContext';

/** Polling: often while something runs, rarely otherwise, and on focus. */
const ACTIVE_POLL_MS = 4000;
const IDLE_POLL_MS = 60000;

export const BROWSER_NOTIFICATIONS_KEY = 'fc_browser_notifications';

interface ActivityContextValue {
  runs: RunSummary[];
  active: boolean;
  unread: number;
  /** Changes whenever any run's counts change: a cue to re-read submissions. */
  version: string;
  refresh: () => Promise<void>;
  /** Start a pull; rejects with ApiError (409 carries the run under way in `body.run`). */
  startPull: (surveyId: string) => Promise<RunSummary>;
  /** Show a run straight away, before the next poll (re-runs started elsewhere). */
  trackRun: (run: RunSummary) => void;
  latestRunFor: (surveyId: string) => RunSummary | null;
  isSurveyBusy: (surveyId: string) => boolean;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  /** Navigate, closing the activity panel on the way. */
  navigate: (target: NavigationTarget | NotificationLink) => void;
}

const ActivityContext = createContext<ActivityContextValue | undefined>(undefined);

export const useActivity = () => {
  const context = useContext(ActivityContext);
  if (!context) throw new Error('useActivity must be used within an ActivityProvider');
  return context;
};

const finishedTitle = (run: RunSummary): string => {
  const name = run.survey_name || 'Survey';
  if (run.status === 'failed') return `Couldn't pull ${name} from Kobo`;
  if (run.kind === 'transcription_rerun') return `${name}: transcription finished`;
  if (run.kind === 'kobo_resend') return `${name}: transcripts sent to Kobo`;
  return `${name}: pull finished`;
};

const finishedBody = (run: RunSummary): string => {
  if (run.status === 'failed') return run.error || 'The pull failed.';
  const parts: string[] = [];
  if (run.pull) parts.push(`${run.pull.new} new, ${run.pull.flagged} flagged.`);
  if (run.ai_checks?.queued) parts.push(`${run.ai_checks.done} answers reviewed.`);
  if (run.transcripts?.queued) parts.push(`${run.transcripts.done} recordings transcribed.`);
  if (run.problems.length) parts.push(run.problems[0].text);
  return parts.join(' ');
};

const countsKey = (run: RunSummary) =>
  [
    run.run_id,
    run.status,
    run.stage,
    run.ai_checks?.done,
    run.ai_checks?.failed,
    run.ai_checks?.open,
    run.transcripts?.done,
    run.transcripts?.failed,
    run.transcripts?.open,
    run.kobo?.done,
    run.kobo?.open,
  ].join(':');

export const ActivityProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [activity, setActivity] = useState<Activity>({ runs: [], active: false, unread_notifications: 0 });
  const [panelOpen, setPanelOpen] = useState(false);
  const previous = useRef<Map<string, RunSummary>>(new Map());
  const timer = useRef<number | null>(null);
  const activityRef = useRef(activity);
  activityRef.current = activity;

  const announceFinished = useCallback(
    (runs: RunSummary[]) => {
      const before = previous.current;
      let enabled = false;
      try {
        enabled = localStorage.getItem(BROWSER_NOTIFICATIONS_KEY) === 'on';
      } catch {
        enabled = false;
      }
      for (const run of runs) {
        const earlier = before.get(run.run_id);
        const justEnded = earlier && isOpen(earlier) && !isOpen(run);
        if (
          justEnded &&
          enabled &&
          run.started_by.user_id === user?.user_id &&
          typeof Notification !== 'undefined' &&
          Notification.permission === 'granted' &&
          document.hidden
        ) {
          try {
            new Notification(finishedTitle(run), { body: finishedBody(run), tag: run.run_id });
          } catch {
            // Some browsers only allow notifications from a service worker.
          }
        }
      }
      previous.current = new Map(runs.map((run) => [run.run_id, run]));
    },
    [user?.user_id]
  );

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const next = await getActivity();
      announceFinished(next.runs);
      setActivity(next);
    } catch {
      // A failed poll changes nothing; the next one tries again.
    }
  }, [user, announceFinished]);

  // Poll: a timeout chain, so the interval follows whether anything runs.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const tick = async () => {
      await refresh();
      if (cancelled) return;
      timer.current = window.setTimeout(tick, activityRef.current.active ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    };
    tick();
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      if (timer.current) window.clearTimeout(timer.current);
      window.removeEventListener('focus', onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.user_id]);

  /** Poll sooner after something was started, rather than waiting a minute. */
  const pollSoon = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async function tick() {
      await refresh();
      timer.current = window.setTimeout(tick, activityRef.current.active ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    }, 1000);
  }, [refresh]);

  const trackRun = useCallback(
    (run: RunSummary) => {
      setActivity((current) => ({
        ...current,
        active: current.active || isOpen(run),
        runs: [run, ...current.runs.filter((r) => r.run_id !== run.run_id)],
      }));
      previous.current.set(run.run_id, run);
      pollSoon();
    },
    [pollSoon]
  );

  const startPull = useCallback(
    async (surveyId: string) => {
      try {
        const run = await startPullRequest(surveyId);
        trackRun(run);
        return run;
      } catch (error) {
        if (error instanceof ApiError && error.status === 409 && error.body?.run) {
          trackRun(error.body.run as RunSummary);
        }
        throw error;
      }
    },
    [trackRun]
  );

  const latestRunFor = useCallback(
    (surveyId: string) => activity.runs.find((run) => run.survey_id === surveyId) ?? null,
    [activity.runs]
  );

  const isSurveyBusy = useCallback(
    (surveyId: string) => activity.runs.some((run) => run.survey_id === surveyId && isOpen(run)),
    [activity.runs]
  );

  const { navigate: navigateTo } = useNavigation();
  const navigate = useCallback(
    (target: NavigationTarget | NotificationLink) => {
      setPanelOpen(false);
      navigateTo(target);
    },
    [navigateTo]
  );

  const version = useMemo(() => activity.runs.map(countsKey).join('|'), [activity.runs]);

  const value: ActivityContextValue = {
    runs: activity.runs,
    active: activity.active,
    unread: activity.unread_notifications,
    version,
    refresh,
    startPull,
    trackRun,
    latestRunFor,
    isSurveyBusy,
    panelOpen,
    setPanelOpen,
    navigate,
  };

  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>;
};
