import React, { useEffect, useRef, useState } from 'react';
import { useActivity } from '../../contexts/ActivityContext';
import { useSurvey } from '../../contexts/SurveyContext';
import { getSurveyRuns, RunSummary } from '../../services/activityApi';
import { ApiError } from '../../services/apiBase';
import { timeAgo } from '../../utils/timeAgo';
import Button from '../ui/Button';
import Banner from '../ui/Banner';
import { RefreshIcon } from '../ui/icons';

const busy = (run: RunSummary | null) => !!run && (run.status === 'queued' || run.status === 'running');

/**
 * "Refresh from Kobo" for a survey page, with when the data last came from
 * Kobo. The pull runs in the background and its progress and outcome are
 * shown by the activity indicator in the top bar, the same on every page; the
 * page only re-reads its data once the pull's submissions are stored
 * (`onLanded`). Viewers can't pull, so they see only when it last happened.
 */
export const usePull = (onLanded?: () => void) => {
  const { selectedSurvey } = useSurvey();
  const { startPull, latestRunFor } = useActivity();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const surveyId = selectedSurvey?.survey_id;
  const canPull = selectedSurvey?.permission !== 'viewer';
  const run = surveyId ? latestRunFor(surveyId) : null;
  const pulling = busy(run);

  // When the data last came from Kobo: the start of the latest pull that
  // stored its submissions (a failed or stopped one didn't, or not all).
  // Undefined while unknown, null when there has been none.
  const [lastPulled, setLastPulled] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    setLastPulled(undefined);
    if (!surveyId || pulling) return;
    let cancelled = false;
    getSurveyRuns(surveyId, 20)
      .then(({ runs }) => {
        const stored = runs.find((r) => r.kind === 'pull' && (r.status === 'finished' || r.status === 'background'));
        if (!cancelled) setLastPulled(stored?.started_at ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [surveyId, pulling]);

  // Fetching and checking are done once the run leaves queued/running: what
  // follows (AI review, transcripts) does not change these pages' counts.
  const onLandedRef = useRef(onLanded);
  onLandedRef.current = onLanded;
  const wasPulling = useRef<{ surveyId?: string; pulling: boolean }>({ surveyId, pulling });
  useEffect(() => {
    const before = wasPulling.current;
    wasPulling.current = { surveyId, pulling };
    if (before.surveyId === surveyId && before.pulling && !pulling) onLandedRef.current?.();
  }, [surveyId, pulling]);

  useEffect(() => setStartError(null), [surveyId]);

  const start = async () => {
    if (!surveyId) return;
    setStarting(true);
    setStartError(null);
    try {
      await startPull(surveyId);
    } catch (err) {
      // 409: a pull is already under way; startPull tracks it, so the button
      // and the indicator show it. Anything else did not start at all.
      if (!(err instanceof ApiError && err.status === 409)) {
        setStartError(err instanceof Error ? err.message : 'Could not start the pull.');
      }
    } finally {
      setStarting(false);
    }
  };

  return {
    run,
    pulling,
    starting,
    start,
    startError,
    clearStartError: () => setStartError(null),
    disabled: !surveyId,
    canPull,
    lastPulled,
  };
};

type Pull = ReturnType<typeof usePull>;

/** "Last pulled 3 h ago", kept current while the page stays open. */
const LastPulled: React.FC<{ at: string | null | undefined }> = ({ at }) => {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => tick((n) => n + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  if (at === undefined) return null;
  return (
    <span
      className="hidden text-xs text-gray-500 sm:inline dark:text-gray-400"
      title={at ? new Date(at).toLocaleString() : undefined}
    >
      {at ? `Last pulled ${timeAgo(at)}` : 'Not pulled from Kobo yet'}
    </span>
  );
};

export const PullButton: React.FC<{ pull: Pull }> = ({ pull }) => (
  <div className="flex items-center gap-3">
    {!pull.pulling && <LastPulled at={pull.lastPulled} />}
    {pull.canPull && (
      <Button
        variant="primary"
        onClick={pull.start}
        disabled={pull.disabled || pull.pulling}
        loading={pull.starting || pull.pulling}
        icon={<RefreshIcon />}
      >
        {pull.pulling ? 'Pulling…' : 'Refresh from Kobo'}
      </Button>
    )}
  </div>
);

/** Why a pull could not start (no Kobo key, no project, worker down). */
export const PullStartError: React.FC<{ pull: Pull }> = ({ pull }) =>
  pull.startError ? (
    <Banner tone="error" className="mt-3" onDismiss={pull.clearStartError}>
      {pull.startError}
    </Banner>
  ) : null;
