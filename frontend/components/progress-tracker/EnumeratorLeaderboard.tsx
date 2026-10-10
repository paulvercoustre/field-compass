import React, { useMemo, useState } from 'react';
import { EnumeratorSummary, PerformanceData } from '../../types';
import { GLOSSARY, formatPercent, percentOf } from '../../utils/glossary';

type RankingMetric = 'flagged' | 'notApproved' | 'issues' | 'submissions' | 'duration';

interface EnumeratorLeaderboardProps {
  data: PerformanceData;
  onEnumeratorClick?: (enumeratorId: string) => void;
}

// Each metric is a fact about the enumerator, ranked without a verdict: no
// medals, no "top performers". The flags come first because they say
// something about the interviews; duration is worth a look at both ends.
// Review progress is not here: it says how far reviewers have got, not how an
// enumerator works, and is never ranked.
const METRICS: Array<{ key: RankingMetric; label: string; highest: string; lowest: string }> = [
  { key: 'flagged', label: GLOSSARY.flagged.name, highest: 'Most often flagged', lowest: 'Least often flagged' },
  {
    key: 'notApproved',
    label: GLOSSARY.notApproved.name,
    highest: 'Most often not approved',
    lowest: 'Least often not approved',
  },
  { key: 'issues', label: 'Issues', highest: 'Most issues per submission', lowest: 'Fewest issues per submission' },
  { key: 'submissions', label: GLOSSARY.submissions.name, highest: 'Most submissions', lowest: 'Fewest submissions' },
  { key: 'duration', label: GLOSSARY.duration.name, highest: 'Longest interviews', lowest: 'Shortest interviews' },
];

const MIN_SUBMISSIONS = 3;

const value = (row: EnumeratorSummary, metric: RankingMetric): number | null => {
  switch (metric) {
    case 'flagged':
      return percentOf(row.flagged, row.submissions);
    case 'notApproved':
      return percentOf(row.not_approved, row.submissions);
    case 'issues':
      return row.issues_per_submission;
    case 'submissions':
      return row.submissions;
    case 'duration':
      return row.duration_minutes;
  }
};

const display = (row: EnumeratorSummary, metric: RankingMetric): { value: string; sublabel: string } => {
  switch (metric) {
    case 'flagged':
      return {
        value: formatPercent(percentOf(row.flagged, row.submissions)),
        sublabel: `${row.flagged} of ${row.submissions} flagged`,
      };
    case 'notApproved':
      return {
        value: formatPercent(percentOf(row.not_approved, row.submissions)),
        sublabel: `${row.not_approved} of ${row.submissions} not approved`,
      };
    case 'issues':
      return {
        value: (row.issues_per_submission ?? 0).toFixed(2),
        sublabel: `per submission, of ${row.submissions}`,
      };
    case 'submissions':
      return { value: row.submissions.toString(), sublabel: 'submissions' };
    case 'duration':
      return { value: `${Math.round(row.duration_minutes ?? 0)} min`, sublabel: 'median duration' };
  }
};

const EnumeratorLeaderboard: React.FC<EnumeratorLeaderboardProps> = ({ data, onEnumeratorClick }) => {
  const [metric, setMetric] = useState<RankingMetric>('flagged');
  const [lowest, setLowest] = useState(false);

  const rankings = useMemo(() => {
    // Too few submissions, or nothing measured, is no place in a ranking.
    const ranked = data.enumerators.filter((row) => row.submissions >= MIN_SUBMISSIONS && value(row, metric) !== null);
    const sorted = [...ranked].sort((a, b) => {
      const diff = (value(a, metric) ?? 0) - (value(b, metric) ?? 0);
      return lowest ? diff : -diff;
    });
    return sorted.slice(0, 5);
  }, [data.enumerators, metric, lowest]);

  const current = METRICS.find((m) => m.key === metric)!;

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl p-5 shadow-card border border-gray-200 dark:border-gray-800 w-full flex flex-col">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
          {lowest ? current.lowest : current.highest}
        </h3>
        <button
          type="button"
          onClick={() => setLowest(!lowest)}
          className="flex-shrink-0 text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        >
          Show {lowest ? 'highest' : 'lowest'}
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4" role="group" aria-label="Rank by">
        {METRICS.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMetric(m.key)}
            aria-pressed={metric === m.key}
            className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
              metric === m.key
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <ol className="space-y-2 flex-1 overflow-y-auto">
        {rankings.length === 0 ? (
          <li className="text-gray-500 dark:text-gray-400 text-sm text-center py-4">
            No enumerator has {MIN_SUBMISSIONS} submissions yet.
          </li>
        ) : (
          rankings.map((item, index) => {
            const shown = display(item, metric);
            const content = (
              <>
                <span className="tabular w-6 flex-shrink-0 text-center text-sm text-gray-500 dark:text-gray-400">
                  {index + 1}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block font-medium text-gray-900 dark:text-white truncate">{item.id}</span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400">{shown.sublabel}</span>
                </span>
                <span className="tabular text-base font-semibold text-gray-900 dark:text-white">{shown.value}</span>
              </>
            );
            return (
              <li key={item.id}>
                {onEnumeratorClick ? (
                  <button
                    type="button"
                    onClick={() => onEnumeratorClick(item.id)}
                    className="flex w-full items-center gap-3 p-2 rounded-lg bg-gray-50 dark:bg-gray-800 text-left hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    title={`See ${item.id}'s submissions`}
                  >
                    {content}
                  </button>
                ) : (
                  <div className="flex items-center gap-3 p-2 rounded-lg bg-gray-50 dark:bg-gray-800">{content}</div>
                )}
              </li>
            );
          })
        )}
      </ol>

      {rankings.length > 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-3 text-center">
          Enumerators with at least {MIN_SUBMISSIONS} submissions
        </p>
      )}
    </div>
  );
};

export default EnumeratorLeaderboard;
