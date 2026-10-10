import React, { useMemo, useState } from 'react';
import { EnumeratorSummary, PerformanceData, SubmissionSummary } from '../../types';
import { SurveyConfig } from '../../services/progressApi';
import { GLOSSARY, Term, formatPercent, percentOf } from '../../utils/glossary';
import {
  MIN_SUBMISSIONS,
  checkName,
  comparable,
  highlightFlagged,
  highlightNotApproved,
  mainIssue,
} from '../../utils/fieldTeam';
import TermInfo from '../ui/TermInfo';
import { ChevronDownIcon, ChevronUpDownIcon } from '../ui/icons';

type SortKey = 'id' | 'submissions' | 'flagged' | 'not_approved' | 'duration' | 'dk';
type SortDirection = 'asc' | 'desc';

const MAIN_ISSUE: Term = {
  name: 'Main issue',
  definition:
    'The check that flagged most of their submissions. One that flags them at least twice as often as the team comes first, highlighted.',
};

const sortValue = (row: EnumeratorSummary, key: SortKey): number | string | null => {
  switch (key) {
    case 'id':
      return row.id.toLowerCase();
    case 'submissions':
      return row.submissions;
    case 'flagged':
      return percentOf(row.flagged, row.submissions);
    case 'not_approved':
      return percentOf(row.not_approved, row.submissions);
    case 'duration':
      return row.duration_minutes;
    case 'dk':
      return row.dk_rate;
  }
};

const Pill: React.FC<{ on: boolean; children: React.ReactNode }> = ({ on, children }) =>
  on ? (
    <span className="rounded-md bg-amber-100 px-2 py-0.5 font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
      {children}
    </span>
  ) : (
    <>{children}</>
  );

const SortHeader: React.FC<{
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: SortDirection };
  onSort: (key: SortKey) => void;
  term?: Term;
}> = ({ label, sortKey, sort, onSort, term }) => {
  const direction = sort.key === sortKey ? sort.dir : null;
  return (
    <th
      aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}
      className="px-2.5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap"
    >
      <span className="flex items-center gap-1">
        {/* A button, so the column sorts from the keyboard too. */}
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          className="-mx-1 flex items-center rounded px-1 py-0.5 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          {label}
          {direction ? (
            <ChevronDownIcon
              className={`ml-1 h-3.5 w-3.5 text-indigo-500 ${direction === 'asc' ? 'rotate-180' : ''}`}
            />
          ) : (
            <ChevronUpDownIcon className="ml-1 h-3.5 w-3.5 text-gray-400" />
          )}
        </button>
        {term && <TermInfo term={term} />}
      </span>
    </th>
  );
};

const PlainHeader: React.FC<{ label: string; term?: Term }> = ({ label, term }) => (
  <th className="px-2.5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
    <span className="flex items-center gap-1">
      {label}
      {term && <TermInfo term={term} />}
    </span>
  </th>
);

interface FollowUpTableProps {
  data: PerformanceData;
  config: SurveyConfig | null;
  /** Opens an enumerator's call sheet. */
  onOpen: (enumeratorId: string) => void;
  /** Opens Needs review: one enumerator's, or everyone's (null). */
  onNeedsReview?: (enumeratorId: string | null) => void;
  onNoEnumerator?: () => void;
}

/**
 * Who to follow up with: one row per enumerator, the team on top, the ones
 * with too few submissions to compare apart, and submissions with no
 * enumerator last. A row opens the call sheet.
 */
const FollowUpTable: React.FC<FollowUpTableProps> = ({ data, config, onOpen, onNeedsReview, onNoEnumerator }) => {
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDirection }>({ key: 'flagged', dir: 'desc' });
  const team = data.team;

  const [compared, tooFew] = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const rows = needle ? data.enumerators.filter((r) => r.id.toLowerCase().includes(needle)) : data.enumerators;
    const sign = sort.dir === 'asc' ? 1 : -1;
    const sorted = [...rows].sort((a, b) => {
      const av = sortValue(a, sort.key);
      const bv = sortValue(b, sort.key);
      // Nothing measured goes last, whichever way the column sorts.
      if (av === null || bv === null) return av === bv ? 0 : av === null ? 1 : -1;
      return sign * (av < bv ? -1 : av > bv ? 1 : 0);
    });
    return [sorted.filter(comparable), sorted.filter((r) => !comparable(r))];
  }, [data.enumerators, filter, sort]);

  if (!team) return null;

  const handleSort = (key: SortKey) =>
    setSort((prev) => ({ key, dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc' }));

  const cells = (row: SubmissionSummary, enumerator: EnumeratorSummary | null) => {
    const issue = enumerator ? mainIssue(enumerator, team) : mainIssue(row, row);
    const flaggedShare = percentOf(row.flagged, row.submissions) ?? 0;
    const hiFlagged = !!enumerator && highlightFlagged(enumerator, team);
    return (
      <>
        <td className="px-2.5 py-2.5 text-sm tabular">{row.submissions}</td>
        <td className="px-2.5 py-2.5 text-sm tabular whitespace-nowrap">
          <span className="flex items-center gap-2">
            <span className="inline-block h-1.5 w-10 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
              <span
                className={`block h-1.5 rounded-full ${hiFlagged ? 'bg-amber-600' : 'bg-gray-400'}`}
                style={{ width: `${flaggedShare}%` }}
              />
            </span>
            <Pill on={hiFlagged}>{formatPercent(percentOf(row.flagged, row.submissions))}</Pill>
            <span className="text-xs text-gray-500 dark:text-gray-400">{row.flagged}</span>
          </span>
        </td>
        <td className="px-2.5 py-2.5 text-sm tabular whitespace-nowrap">
          <Pill on={!!enumerator && highlightNotApproved(enumerator, team)}>
            {formatPercent(percentOf(row.not_approved, row.submissions))}
          </Pill>{' '}
          <span className="text-xs text-gray-500 dark:text-gray-400">{row.not_approved}</span>
        </td>
        <td className="px-2.5 py-2.5 text-sm">
          {issue ? (
            <span
              className={`inline-block max-w-[15rem] rounded-md border px-2 py-0.5 text-xs font-medium ${
                issue.highlighted
                  ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                  : 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'
              }`}
            >
              {checkName(issue.check, config)} ×{issue.count}
            </span>
          ) : (
            <span className="text-gray-400">—</span>
          )}
        </td>
        <td className="px-2.5 py-2.5 text-sm tabular whitespace-nowrap">
          {row.duration_minutes === null ? (
            <span className="text-gray-400">not measured</span>
          ) : (
            `${Math.round(row.duration_minutes)} min`
          )}
        </td>
        <td className="px-2.5 py-2.5 text-sm tabular whitespace-nowrap">
          {row.dk_rate === null ? <span className="text-gray-400">not measured</span> : `${row.dk_rate}%`}
        </td>
        {/* How far review has got: grey, never coloured or ranked. */}
        <td className="px-2.5 py-2.5 text-sm tabular whitespace-nowrap text-gray-500 dark:text-gray-400">
          {row.reviewed} of {row.submissions}
        </td>
      </>
    );
  };

  const needsReviewLink = (count: number, enumeratorId: string | null) =>
    count > 0 && onNeedsReview ? (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onNeedsReview(enumeratorId);
        }}
        aria-label={`Open ${count} in ${GLOSSARY.needsReview.name}${enumeratorId ? ` for ${enumeratorId}` : ''}`}
        className="tabular whitespace-nowrap rounded text-sm font-medium text-indigo-700 hover:underline dark:text-indigo-300"
      >
        {count}
      </button>
    ) : (
      <span className="text-gray-400">—</span>
    );

  const enumeratorRow = (row: EnumeratorSummary) => (
    <tr
      key={row.id}
      onClick={() => onOpen(row.id)}
      className="cursor-pointer text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
    >
      <td className="px-2.5 py-2.5 text-sm font-medium whitespace-nowrap">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpen(row.id);
          }}
          className="rounded text-indigo-700 hover:underline dark:text-indigo-300"
        >
          {row.id}
        </button>
      </td>
      {cells(row, row)}
      <td className="px-2.5 py-2.5">{needsReviewLink(row.needs_review, row.id)}</td>
    </tr>
  );

  return (
    <section
      aria-label="Who to follow up with"
      className="rounded-xl border border-gray-200 bg-white shadow-card dark:border-gray-800 dark:bg-gray-950"
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
        <h2 className="text-base font-semibold tracking-tight text-gray-900 dark:text-white">Who to follow up with</h2>
        <span className="flex-1" />
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Find an enumerator ID"
          placeholder="Find an enumerator ID"
          className="h-8 w-56 max-w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 placeholder-gray-500 shadow-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr>
              <SortHeader label="Enumerator" sortKey="id" sort={sort} onSort={handleSort} />
              <SortHeader
                label={GLOSSARY.submissions.name}
                sortKey="submissions"
                sort={sort}
                onSort={handleSort}
                term={GLOSSARY.submissions}
              />
              <SortHeader
                label={GLOSSARY.flagged.name}
                sortKey="flagged"
                sort={sort}
                onSort={handleSort}
                term={GLOSSARY.flagged}
              />
              <SortHeader
                label={GLOSSARY.notApproved.name}
                sortKey="not_approved"
                sort={sort}
                onSort={handleSort}
                term={GLOSSARY.notApproved}
              />
              <PlainHeader label={MAIN_ISSUE.name} term={MAIN_ISSUE} />
              <SortHeader
                label={GLOSSARY.duration.name}
                sortKey="duration"
                sort={sort}
                onSort={handleSort}
                term={GLOSSARY.duration}
              />
              <SortHeader
                label={GLOSSARY.dkRate.name}
                sortKey="dk"
                sort={sort}
                onSort={handleSort}
                term={GLOSSARY.dkRate}
              />
              <PlainHeader label={GLOSSARY.reviewed.name} term={GLOSSARY.reviewed} />
              <PlainHeader label={GLOSSARY.needsReview.name} term={GLOSSARY.needsReview} />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            <tr className="bg-gray-50 text-gray-600 dark:bg-gray-900 dark:text-gray-300">
              <td className="px-2.5 py-2.5 text-sm font-medium whitespace-nowrap">Whole team</td>
              {cells(team, null)}
              <td className="px-2.5 py-2.5">{needsReviewLink(team.needs_review, null)}</td>
            </tr>
            {compared.map(enumeratorRow)}
            {tooFew.length > 0 && (
              <tr>
                <td colSpan={9} className="px-3 pb-1.5 pt-4 text-xs font-semibold text-gray-500 dark:text-gray-400">
                  Too few submissions to compare (under {MIN_SUBMISSIONS})
                </td>
              </tr>
            )}
            {tooFew.map(enumeratorRow)}
            {data.no_enumerator && !filter && (
              // Part of the team's figures, set apart: not an enumerator, so
              // never sorted among them, compared or highlighted.
              <tr className="border-t-2 border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300">
                <td className="px-2.5 py-2.5 text-sm italic whitespace-nowrap">
                  {onNoEnumerator ? (
                    <button
                      type="button"
                      onClick={onNoEnumerator}
                      className="rounded italic text-indigo-700 hover:underline dark:text-indigo-300"
                    >
                      No enumerator recorded
                    </button>
                  ) : (
                    'No enumerator recorded'
                  )}
                </td>
                {cells(data.no_enumerator, null)}
                <td className="px-2.5 py-2.5">
                  <span className="text-gray-400">—</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="border-t border-gray-100 px-4 py-3 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
        <span className="rounded bg-amber-100 px-1.5 font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          Highlighted
        </span>{' '}
        at least twice the team’s share, for enumerators with {MIN_SUBMISSIONS} or more submissions. A row opens the
        enumerator’s call sheet.
      </p>
    </section>
  );
};

export default FollowUpTable;
