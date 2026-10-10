import React from 'react';
import { CheckRow } from '../../types';
import { SurveyConfig } from '../../services/progressApi';
import { GLOSSARY, Term, formatPercent, percentOf } from '../../utils/glossary';
import { MIN_SUBMISSIONS, checkName, highlightTopEnumerator } from '../../utils/fieldTeam';
import Sparkline from '../charts/Sparkline';
import TermInfo from '../ui/TermInfo';

const MOST_FROM: Term = {
  name: 'Most from',
  definition:
    'The enumerator this check flagged most often, with how many of their submissions it flagged. Highlighted when that is at least twice the team’s share.',
};

const LAST_14_DAYS: Term = {
  name: 'Last 14 days',
  definition:
    'Submissions the check flagged on each of the 14 days up to the latest submission in the period. A grey stub is a day with none.',
};

const Header: React.FC<{ label: string; term?: Term }> = ({ label, term }) => (
  <th className="px-2.5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
    <span className="flex items-center gap-1">
      {label}
      {term && <TermInfo term={term} />}
    </span>
  </th>
);

const link = 'rounded text-indigo-700 hover:underline dark:text-indigo-300';

interface ByCheckTableProps {
  rows: CheckRow[];
  /** Every submission in the period: each check's share is of these. */
  submissions: number;
  /** The latest day in the period, where the 14 days end. */
  lastDay: string;
  config: SurveyConfig | null;
  /** Opens every submission a check flagged. */
  onOpenCheck?: (check: string) => void;
  /** Opens Needs review for a check. */
  onNeedsReview?: (check: string) => void;
  onOpenEnumerator?: (enumeratorId: string) => void;
  onOpenSettings?: () => void;
}

/**
 * Data quality by check: each check that flagged something, most first, how
 * often, whether it is getting better, who it flags most, and what still needs
 * review. Checks that are on and flagged nothing follow, then those that are off,
 * so a quiet check is never read as a clean one.
 */
const ByCheckTable: React.FC<ByCheckTableProps> = ({
  rows,
  submissions,
  lastDay,
  config,
  onOpenCheck,
  onNeedsReview,
  onOpenEnumerator,
  onOpenSettings,
}) => {
  const end = lastDay
    ? new Date(`${lastDay}T00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    : '';
  const off = rows.filter((r) => r.on === false && r.flagged === 0);
  const shown = rows.filter((r) => !(r.on === false && r.flagged === 0));

  const row = (r: CheckRow) => {
    const name = checkName(r.check, config);
    const top = r.top_enumerator;
    const hiTop = !!top && highlightTopEnumerator(top, r.flagged, submissions);
    return (
      <tr key={r.check} className="text-gray-700 dark:text-gray-300">
        <td className="min-w-[11rem] px-2.5 py-2.5 text-sm font-medium">
          {r.flagged > 0 && onOpenCheck ? (
            <button
              type="button"
              onClick={() => onOpenCheck(r.check)}
              aria-label={`Open the ${r.flagged} submissions ${name} flagged`}
              className={`${link} text-left`}
            >
              {name}
            </button>
          ) : (
            name
          )}
          {r.on === false && (
            <span className="ml-2 rounded bg-gray-100 px-1.5 py-px text-xs font-normal text-gray-600 dark:bg-gray-800 dark:text-gray-400">
              Off now
            </span>
          )}
        </td>
        <td className="px-2.5 py-2.5 text-sm tabular">{r.flagged}</td>
        <td className="px-2.5 py-2.5 text-sm tabular whitespace-nowrap">
          <span className="flex items-center gap-2">
            <span className="inline-block h-1.5 w-10 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
              <span
                className="block h-1.5 rounded-full bg-gray-400"
                style={{ width: `${percentOf(r.flagged, submissions) ?? 0}%` }}
              />
            </span>
            {formatPercent(percentOf(r.flagged, submissions))}
          </span>
        </td>
        <td className="px-2.5 py-2.5">
          {r.last_14_days.length > 0 && (
            <Sparkline
              values={r.last_14_days}
              label={`${r.last_14_days.reduce((a, b) => a + b, 0)} flagged in the 14 days to ${end}`}
            />
          )}
        </td>
        <td className="px-2.5 py-2.5 text-sm whitespace-nowrap">
          {top ? (
            <span
              className={`inline-flex items-baseline gap-1.5 rounded-md px-1.5 py-0.5 ${
                hiTop ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' : ''
              }`}
            >
              {onOpenEnumerator ? (
                <button
                  type="button"
                  onClick={() => onOpenEnumerator(top.id)}
                  aria-label={`Open ${top.id}’s call sheet`}
                  className={hiTop ? 'rounded font-semibold hover:underline' : link}
                >
                  {top.id}
                </button>
              ) : (
                <span className={hiTop ? 'font-semibold' : ''}>{top.id}</span>
              )}
              <span className="tabular text-xs">
                {top.flagged} of {top.submissions}
              </span>
            </span>
          ) : (
            <span className="text-gray-400">—</span>
          )}
        </td>
        <td className="px-2.5 py-2.5 text-sm">
          {r.needs_review > 0 && onNeedsReview ? (
            <button
              type="button"
              onClick={() => onNeedsReview(r.check)}
              aria-label={`Open ${r.needs_review} in ${GLOSSARY.needsReview.name} for ${name}`}
              className={`${link} tabular font-medium`}
            >
              {r.needs_review}
            </button>
          ) : (
            <span className="tabular text-gray-400">{r.needs_review || '—'}</span>
          )}
        </td>
      </tr>
    );
  };

  return (
    <section
      aria-label="Issues by check"
      className="rounded-xl border border-gray-200 bg-white shadow-card dark:border-gray-800 dark:bg-gray-950"
    >
      <div className="border-b border-gray-100 px-4 py-3 dark:border-gray-800">
        <h2 className="text-base font-semibold tracking-tight text-gray-900 dark:text-white">Issues by check</h2>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          A check’s name opens every submission it flagged; its Needs review count opens those still waiting.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr>
              <Header label="Check" />
              <Header label="Flagged submissions" term={GLOSSARY.flagged} />
              <Header label="Share of submissions" />
              <Header label={LAST_14_DAYS.name} term={LAST_14_DAYS} />
              <Header label={MOST_FROM.name} term={MOST_FROM} />
              <Header label={GLOSSARY.needsReview.name} term={GLOSSARY.needsReview} />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {shown.map(row)}
            {off.length > 0 && (
              <tr>
                <td colSpan={6} className="px-3 pb-1.5 pt-4 text-xs font-semibold text-gray-500 dark:text-gray-400">
                  Off: these checks did not run
                </td>
              </tr>
            )}
            {off.map((r) => (
              <tr key={r.check} className="text-gray-500 dark:text-gray-400">
                <td className="px-2.5 py-2 text-sm">{checkName(r.check, config)}</td>
                <td colSpan={5} className="px-2.5 py-2 text-sm">
                  Off
                  {onOpenSettings && (
                    <>
                      {' · '}
                      <button type="button" onClick={onOpenSettings} className={`${link} font-medium`}>
                        Turn on in Settings
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-gray-100 px-4 py-3 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
        <span className="rounded bg-amber-100 px-1.5 font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          Highlighted
        </span>{' '}
        the check flags this enumerator at least twice as often as the team, and they have {MIN_SUBMISSIONS} or more
        submissions.
      </p>
    </section>
  );
};

export default ByCheckTable;
