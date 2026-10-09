import React, { useState, useMemo } from 'react';
import { EnumeratorSummary, PerformanceData, SubmissionSummary } from '../../types';
import { GLOSSARY, Term, formatPercent, percentOf } from '../../utils/glossary';
import { SubTabButton } from '../ui/SubTabButton';
import TermInfo from '../ui/TermInfo';

type PerformanceSubTab = 'review' | 'quality';
type SortDirection = 'asc' | 'desc';

// Enumerators with fewer submissions are not highlighted: a share of 1 in 3
// says little.
const MIN_SUBMISSIONS = 5;

interface Column {
  key: string;
  label: string;
  term: Term;
  value: (row: SubmissionSummary) => number | null;
  format: (row: SubmissionSummary) => string;
  /** A share of the submissions, highlighted at twice the team's. */
  share?: (row: SubmissionSummary) => number | null;
}

const count = (key: keyof SubmissionSummary, term: Term): Column => ({
  key,
  label: term.name,
  term,
  value: (row) => row[key] as number,
  format: (row) => String(row[key]),
});

const shareOf = (key: 'flagged' | 'not_approved', term: Term): Column => {
  const share = (row: SubmissionSummary) => percentOf(row[key], row.submissions);
  return {
    key: `${key}_share`,
    label: term.name,
    term,
    value: share,
    format: (row) => `${formatPercent(share(row))} (${row[key]})`,
    share,
  };
};

const COLUMNS: Record<PerformanceSubTab, Column[]> = {
  // How far review has got. Never coloured.
  review: [
    count('submissions', GLOSSARY.submissions),
    count('flagged', GLOSSARY.flagged),
    count('needs_review', GLOSSARY.needsReview),
    count('on_hold', GLOSSARY.onHold),
    count('approved', GLOSSARY.approved),
    count('not_approved', GLOSSARY.notApproved),
  ],
  quality: [
    shareOf('flagged', GLOSSARY.flagged),
    shareOf('not_approved', GLOSSARY.notApproved),
    {
      key: 'issues_per_submission',
      label: GLOSSARY.issuesPerSubmission.name,
      term: GLOSSARY.issuesPerSubmission,
      value: (row) => row.issues_per_submission,
      format: (row) => (row.issues_per_submission === null ? '—' : row.issues_per_submission.toFixed(2)),
    },
    {
      key: 'duration_minutes',
      label: `${GLOSSARY.duration.name} (min)`,
      term: GLOSSARY.duration,
      value: (row) => row.duration_minutes,
      format: (row) => (row.duration_minutes === null ? 'not measured' : String(Math.round(row.duration_minutes))),
    },
    {
      key: 'dk_rate',
      label: GLOSSARY.dkRate.name,
      term: GLOSSARY.dkRate,
      value: (row) => row.dk_rate,
      format: (row) => (row.dk_rate === null ? 'not measured' : `${row.dk_rate}%`),
    },
  ],
};

const SortIcon: React.FC<{ direction: SortDirection | null }> = ({ direction }) => {
  if (!direction) {
    return <span className="ml-1 text-gray-400">↕</span>;
  }
  return <span className="ml-1 text-indigo-500">{direction === 'asc' ? '↑' : '↓'}</span>;
};

/** A column title that sorts the table, with what the column means behind the info button. */
const SortableHeader: React.FC<{
  label: string;
  sortKey: string;
  currentSort: { key: string; dir: SortDirection };
  onSort: (key: string) => void;
  term?: Term;
}> = ({ label, sortKey, currentSort, onSort, term }) => {
  const direction = currentSort.key === sortKey ? currentSort.dir : null;
  return (
    <th
      aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}
      className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400"
    >
      <div className="flex items-center gap-1">
        {/* A button, so the column sorts from the keyboard too. */}
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          className="-mx-1 flex items-center rounded px-1 py-0.5 text-left hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          {label}
          <SortIcon direction={direction} />
        </button>
        {term && <TermInfo term={term} />}
      </div>
    </th>
  );
};

interface PerformanceDataViewProps {
  data: PerformanceData;
  onEnumeratorClick?: (enumeratorId: string) => void;
}

const PerformanceDataView: React.FC<PerformanceDataViewProps> = ({ data, onEnumeratorClick }) => {
  const [activeSubTab, setActiveSubTab] = useState<PerformanceSubTab>('quality');
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: SortDirection }>({ key: 'flagged_share', dir: 'desc' });

  const columns = COLUMNS[activeSubTab];
  const team = data.team;

  const rows = useMemo(() => {
    const needle = filter.toLowerCase();
    const filtered = needle
      ? data.enumerators.filter((row) => row.id.toLowerCase().includes(needle))
      : data.enumerators;
    const column = columns.find((c) => c.key === sort.key);
    const sign = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (!column) return sign * a.id.localeCompare(b.id);
      const av = column.value(a);
      const bv = column.value(b);
      // Nothing measured goes last, whichever way the column sorts.
      if (av === null || bv === null) return av === bv ? 0 : av === null ? 1 : -1;
      return sign * (av - bv);
    });
  }, [data.enumerators, filter, sort, columns]);

  const handleSort = (key: string) => {
    setSort((prev) => ({ key, dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc' }));
  };

  // The agreed rule: a share at least twice the team's, with enough submissions to mean something.
  const highlighted = (column: Column, row: EnumeratorSummary): boolean => {
    if (!column.share || !team || row.submissions < MIN_SUBMISSIONS) return false;
    const mine = column.share(row);
    const theirs = column.share(team);
    return mine !== null && theirs !== null && theirs > 0 && mine >= 2 * theirs;
  };

  const switchTab = (tab: PerformanceSubTab) => {
    setActiveSubTab(tab);
    setSort((prev) =>
      COLUMNS[tab].some((c) => c.key === prev.key) || prev.key === 'id'
        ? prev
        : { key: COLUMNS[tab][0].key, dir: 'desc' }
    );
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
        <h2 className="text-base font-semibold tracking-tight text-gray-900 dark:text-white">By enumerator</h2>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter by enumerator ID"
          placeholder="Filter by Enumerator ID..."
          className="w-full sm:w-64 px-4 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md shadow-xs placeholder-gray-500 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
        />
      </div>

      <div className="mb-4 inline-flex flex-wrap gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-900">
        <SubTabButton<PerformanceSubTab> tabId="quality" activeTab={activeSubTab} onClick={switchTab}>
          Quality
        </SubTabButton>
        <SubTabButton<PerformanceSubTab> tabId="review" activeTab={activeSubTab} onClick={switchTab}>
          Review
        </SubTabButton>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-card dark:border-gray-800 dark:bg-gray-950">
        <table className="min-w-full">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr>
              <SortableHeader label="Enumerator ID" sortKey="id" currentSort={sort} onSort={handleSort} />
              {columns.map((column) => (
                <SortableHeader
                  key={column.key}
                  label={column.label}
                  sortKey={column.key}
                  currentSort={sort}
                  onSort={handleSort}
                  term={column.term}
                />
              ))}
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-950 divide-y divide-gray-100 dark:divide-gray-800">
            {team && (
              <tr className="bg-gray-50 dark:bg-gray-900">
                <td className="px-4 py-2.5 whitespace-nowrap text-sm font-medium text-gray-600 dark:text-gray-300">
                  Whole team
                </td>
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className="px-4 py-2.5 whitespace-nowrap text-sm tabular text-gray-600 dark:text-gray-300"
                  >
                    {column.format(team)}
                  </td>
                ))}
              </tr>
            )}
            {rows.map((row) => (
              <tr
                key={row.id}
                className={`hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${onEnumeratorClick ? 'cursor-pointer' : ''}`}
                onClick={() => onEnumeratorClick?.(row.id)}
              >
                <td className="px-4 py-2.5 whitespace-nowrap text-sm tabular font-medium text-gray-900 dark:text-white">
                  {onEnumeratorClick ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onEnumeratorClick(row.id);
                      }}
                      className="rounded font-medium text-indigo-700 hover:underline dark:text-indigo-300"
                    >
                      {row.id}
                    </button>
                  ) : (
                    row.id
                  )}
                </td>
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className="px-4 py-2.5 whitespace-nowrap text-sm tabular text-gray-700 dark:text-gray-300"
                  >
                    {highlighted(column, row) ? (
                      <span className="rounded-md bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                        {column.format(row)}
                      </span>
                    ) : (
                      column.format(row)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
        {activeSubTab === 'quality'
          ? `Highlighted: at least twice the team’s share, for enumerators with ${MIN_SUBMISSIONS} or more submissions.`
          : 'How far review has got for each enumerator’s submissions. Not a measure of quality.'}
      </p>
    </div>
  );
};

export default PerformanceDataView;
