import React, { useEffect, useRef, useState } from 'react';
import { useActivity } from '../../contexts/ActivityContext';
import { useSurvey } from '../../contexts/SurveyContext';
import { ApiError, RunSummary } from '../../services/activityApi';
import Button from '../ui/Button';
import Banner from '../ui/Banner';
import { RefreshIcon } from '../ui/icons';

const busy = (run: RunSummary | null) => !!run && (run.status === 'queued' || run.status === 'running');

/**
 * "Refresh from Kobo" for a survey page. The pull runs in the background and
 * its progress and outcome are shown by the activity indicator in the top
 * bar, the same on every page; the page only re-reads its data once the
 * pull's submissions are stored (`onLanded`).
 */
export const usePull = (onLanded?: () => void) => {
  const { selectedSurvey } = useSurvey();
  const { startPull, latestRunFor } = useActivity();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const surveyId = selectedSurvey?.survey_id;
  const run = surveyId ? latestRunFor(surveyId) : null;
  const pulling = busy(run);

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

  return { run, pulling, starting, start, startError, clearStartError: () => setStartError(null), disabled: !surveyId };
};

type Pull = ReturnType<typeof usePull>;

export const PullButton: React.FC<{ pull: Pull }> = ({ pull }) => (
  <Button
    variant="primary"
    onClick={pull.start}
    disabled={pull.disabled || pull.pulling}
    loading={pull.starting || pull.pulling}
    icon={<RefreshIcon />}
  >
    {pull.pulling ? 'Pulling…' : 'Refresh from Kobo'}
  </Button>
);

/** Why a pull could not start (no Kobo key, no project, worker down). */
export const PullStartError: React.FC<{ pull: Pull }> = ({ pull }) =>
  pull.startError ? (
    <Banner tone="error" className="mt-3" onDismiss={pull.clearStartError}>
      {pull.startError}
    </Banner>
  ) : null;
