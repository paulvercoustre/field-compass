import React from 'react';
import { ETLStats } from '../services/progressApi';

/**
 * Pulling from Kobo: the button and the outcome line, shared by every page
 * that offers a refresh.
 *
 * Each page used to build its own "ETL completed: …" string from the stats,
 * always in green, and none of them read `errors`. So a pull that never
 * reached Kobo read "0 fetched" in green -- which looks like "nothing new" --
 * and a pull whose checks crashed on most submissions still announced how
 * many it had flagged. Every outcome is now described here, once, and
 * anything short of a full pull is amber.
 */

export type PullTone = 'success' | 'warning' | 'error';

export interface PullOutcome {
  tone: PullTone;
  message: string;
  at: Date;
  /** The fix is in the Kobo connection settings, so offer a way there. */
  suggestConnectionCheck?: boolean;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const describePullResult = (stats: ETLStats): PullOutcome => {
  const at = new Date();
  const fetched = stats.fetched ?? 0;
  const errors = stats.errors ?? 0;

  if (stats.upstream_error && fetched === 0) {
    return {
      tone: 'warning',
      message:
        "Couldn't reach Kobo, or Kobo refused the request. Nothing was updated — what you see is unchanged.",
      at,
      suggestConnectionCheck: true,
    };
  }

  if (stats.upstream_error) {
    return {
      tone: 'warning',
      message: `Pulled ${plural(fetched, 'submission')}, but Kobo stopped responding before the end, so some may be missing. Try again to fetch the rest.`,
      at,
    };
  }

  if (errors > 0) {
    return {
      tone: 'warning',
      message: `Pulled ${plural(fetched, 'submission')}, but ${errors} couldn't be checked, so their flags may be missing or out of date. Try again; if it keeps happening, report it.`,
      at,
    };
  }

  if (fetched === 0) {
    return { tone: 'success', message: 'Kobo has no submissions for this project yet.', at };
  }

  const checked = stats.validated ?? 0;
  const unchanged = stats.skipped ?? 0;
  const aiQueued = stats.llm_queued ?? 0;
  const parts = [
    `Pulled ${plural(fetched, 'submission')} (${stats.created} new, ${stats.updated} updated).`,
    checked > 0
      ? `Checks ran on ${checked} and flagged ${stats.hfc_flagged}${unchanged > 0 ? `; ${unchanged} were unchanged since their last check` : ''}.`
      : 'No submission had changed since its last check.',
  ];
  if (aiQueued > 0) {
    parts.push(`AI checks are running on ${aiQueued} — results appear as they finish.`);
  }
  return { tone: 'success', message: parts.join(' '), at };
};

export const describePullFailure = (err: unknown): PullOutcome => {
  const at = new Date();
  const detail = err instanceof Error ? err.message : typeof err === 'string' ? err : '';

  if (/403|editor access/i.test(detail)) {
    return {
      tone: 'error',
      message: 'Only editors and owners can pull new data from Kobo. What you see is unchanged.',
      at,
    };
  }

  if (/api key not configured|no kobo api key/i.test(detail)) {
    return {
      tone: 'error',
      message: 'Connect your Kobo account before pulling data.',
      at,
      suggestConnectionCheck: true,
    };
  }

  return {
    tone: 'error',
    message: `Couldn't pull from Kobo${detail ? `: ${detail}` : ''}. What you see is unchanged.`,
    at,
  };
};

const TONE_CLASSES: Record<PullTone, string> = {
  success:
    'bg-green-50 dark:bg-green-900/50 border-green-200 dark:border-green-700 text-green-800 dark:text-green-200',
  warning:
    'bg-amber-50 dark:bg-amber-900/40 border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100',
  error: 'bg-red-50 dark:bg-red-900/50 border-red-200 dark:border-red-700 text-red-800 dark:text-red-200',
};

const formatTime = (date: Date) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

interface PullOutcomeBannerProps {
  outcome: PullOutcome | null;
  onRetry?: () => void;
  isPulling?: boolean;
}

export const PullOutcomeBanner: React.FC<PullOutcomeBannerProps> = ({ outcome, onRetry, isPulling }) => {
  if (!outcome) return null;

  return (
    <div
      role={outcome.tone === 'success' ? 'status' : 'alert'}
      className={`mt-2 p-2 border rounded-md text-sm flex flex-wrap items-center gap-x-3 gap-y-1 ${TONE_CLASSES[outcome.tone]}`}
    >
      <span className="flex-1 min-w-0">
        {outcome.message} <span className="opacity-80">· {formatTime(outcome.at)}</span>
      </span>
      {outcome.tone !== 'success' && (
        <span className="flex items-center gap-3">
          {onRetry && (
            <button type="button" onClick={onRetry} disabled={isPulling} className="underline hover:no-underline font-medium">
              Try again
            </button>
          )}
          {outcome.suggestConnectionCheck && (
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event('navigateToUserSettings'))}
              className="underline hover:no-underline font-medium"
            >
              Check Kobo connection
            </button>
          )}
        </span>
      )}
    </div>
  );
};

interface PullButtonProps {
  onClick: () => void;
  isPulling: boolean;
  disabled?: boolean;
}

export const PullButton: React.FC<PullButtonProps> = ({ onClick, isPulling, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={isPulling || disabled}
    className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed text-sm font-medium flex items-center gap-2"
  >
    {isPulling ? (
      <>
        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <span>Pulling from Kobo…</span>
      </>
    ) : (
      <>
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        <span>Refresh from Kobo</span>
      </>
    )}
  </button>
);
