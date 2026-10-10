import React from 'react';
import { ChecksInUse, SubmissionSummary } from '../../types';
import { GLOSSARY, Term, formatPercent, percentOf } from '../../utils/glossary';
import TermInfo from '../ui/TermInfo';

const Tile: React.FC<{
  label: string;
  term?: Term;
  value: string;
  sub: React.ReactNode;
  muted?: boolean;
}> = ({ label, term, value, sub, muted }) => (
  <div
    className={`rounded-xl border border-gray-200 p-4 shadow-card dark:border-gray-800 ${
      muted ? 'bg-gray-50 dark:bg-gray-900/60' : 'bg-white dark:bg-gray-900'
    }`}
  >
    <div className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400">
      {label}
      {term && <TermInfo term={term} />}
    </div>
    <div
      className={`tabular mt-2 text-2xl font-semibold tracking-tight ${
        muted ? 'text-gray-600 dark:text-gray-300' : 'text-gray-900 dark:text-white'
      }`}
    >
      {value}
    </div>
    <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{sub}</div>
  </div>
);

interface SummaryTilesProps {
  summary: SubmissionSummary;
  checks: ChecksInUse;
  onOpenSettings?: () => void;
  /** Field team's last tile; Data quality shows review progress in its own card. */
  showReviewed?: boolean;
}

/**
 * Flagged, Duration, Don't-know rate and Checks on, the same on Data quality
 * and Field team; review progress last and grey where it is shown.
 */
const SummaryTiles: React.FC<SummaryTilesProps> = ({ summary, checks, onOpenSettings, showReviewed }) => {
  const checksOn = checks.checks_on.length + checks.custom_checks;
  const fromStartEnd = summary.duration_from_start_end;
  const settings = onOpenSettings && (
    <button
      type="button"
      onClick={onOpenSettings}
      className="font-medium text-indigo-700 hover:underline dark:text-indigo-300"
    >
      Settings
    </button>
  );

  return (
    <div className={`grid grid-cols-2 gap-3 md:grid-cols-3 ${showReviewed ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
      <Tile
        label={GLOSSARY.flagged.name}
        term={GLOSSARY.flagged}
        value={formatPercent(percentOf(summary.flagged, summary.submissions))}
        sub={`${summary.flagged} of ${summary.submissions} submissions`}
      />
      <Tile
        label={GLOSSARY.duration.name}
        term={GLOSSARY.duration}
        value={summary.duration_minutes === null ? 'Not measured' : `${Math.round(summary.duration_minutes)} min`}
        sub={
          summary.duration_minutes === null
            ? 'No audit log, and no start and end times'
            : fromStartEnd > 0
              ? `median; ${fromStartEnd} of ${summary.duration_measured} from start and end times`
              : 'median'
        }
        muted={summary.duration_minutes === null}
      />
      <Tile
        label={GLOSSARY.dkRate.name}
        term={GLOSSARY.dkRate}
        value={summary.dk_rate === null ? 'Not measured' : `${summary.dk_rate}%`}
        sub={summary.dk_rate === null ? 'No don’t-know codes, or no answers yet' : 'of answers that allow one'}
        muted={summary.dk_rate === null}
      />
      <Tile
        label="Checks on"
        value={String(checksOn)}
        sub={
          <>
            {checks.custom_checks > 0 ? `${checks.custom_checks} of them your own` : 'built-in checks'}
            {settings && <> · {settings}</>}
          </>
        }
      />
      {/* How far review has got, not quality: never coloured. */}
      {showReviewed && (
        <Tile
          label={GLOSSARY.reviewed.name}
          term={GLOSSARY.reviewed}
          value={formatPercent(percentOf(summary.reviewed, summary.submissions))}
          sub={`${summary.reviewed} of ${summary.submissions} · review progress`}
          muted
        />
      )}
    </div>
  );
};

/** With no checks on, nothing is flagged; a page says so rather than look clean. */
export const NoChecksNotice: React.FC<{ checks: ChecksInUse; onOpenSettings?: () => void }> = ({
  checks,
  onOpenSettings,
}) =>
  checks.checks_on.length + checks.custom_checks > 0 ? null : (
    <p className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-gray-800 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-gray-200">
      No checks are on, so nothing has been flagged. That doesn’t mean the submissions are clean.{' '}
      {onOpenSettings && (
        <button
          type="button"
          onClick={onOpenSettings}
          className="font-medium text-indigo-700 hover:underline dark:text-indigo-300"
        >
          Choose checks
        </button>
      )}
    </p>
  );

export default SummaryTiles;
