import React, { useMemo, useState } from 'react';
import { PerformanceData } from '../../types';

type RankingMetric = 'avgIssues' | 'submissions' | 'avgTime' | 'approved';

interface EnumeratorLeaderboardProps {
  data: PerformanceData;
  onEnumeratorClick?: (enumeratorId: string) => void;
}

// Each metric is a fact about the enumerator, ranked without a verdict: no
// medals, no "top performers". Issues come first because they are the only
// one here that says something about the interviews; approval only says how
// far review has got, and active time is worth a look at both ends.
const METRICS: Array<{ key: RankingMetric; label: string; highest: string; lowest: string }> = [
  { key: 'avgIssues', label: 'Issues', highest: 'Most issues per submission', lowest: 'Fewest issues per submission' },
  { key: 'submissions', label: 'Submissions', highest: 'Most submissions', lowest: 'Fewest submissions' },
  { key: 'avgTime', label: 'Active time', highest: 'Longest active time', lowest: 'Shortest active time' },
  { key: 'approved', label: 'Approved', highest: 'Most approved by reviewer', lowest: 'Least approved by reviewer' },
];

const MIN_SUBMISSIONS = 3;

const EnumeratorLeaderboard: React.FC<EnumeratorLeaderboardProps> = ({ data, onEnumeratorClick }) => {
  const { collection, quality } = data;
  const [metric, setMetric] = useState<RankingMetric>('avgIssues');
  const [lowest, setLowest] = useState(false);

  const value = (item: { avgIssues: number; total: number; avgActiveTime: number; approvedPercent: number }) =>
    ({ avgIssues: item.avgIssues, submissions: item.total, avgTime: item.avgActiveTime, approved: item.approvedPercent })[metric];

  const rankings = useMemo(() => {
    const combined = collection
      .filter((c) => c.total >= MIN_SUBMISSIONS)
      .map((c) => {
        const q = quality.find((qs) => qs.id === c.id);
        return {
          id: c.id,
          total: c.total,
          approved: c.validated,
          approvedPercent: parseFloat(c.percentValidated),
          avgIssues: q?.avgIssuesPerSurvey || 0,
          avgActiveTime: q?.avgActiveTime || 0,
        };
      });
    const sorted = [...combined].sort((a, b) => (lowest ? value(a) - value(b) : value(b) - value(a)));
    return sorted.slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection, quality, metric, lowest]);

  const display = (item: (typeof rankings)[0]): { value: string; sublabel: string } => {
    switch (metric) {
      case 'avgIssues':
        return { value: item.avgIssues.toFixed(2), sublabel: `per submission, of ${item.total}` };
      case 'submissions':
        return { value: item.total.toString(), sublabel: 'submissions' };
      case 'avgTime':
        return { value: `${item.avgActiveTime} min`, sublabel: 'average active time' };
      case 'approved':
        return { value: `${item.approvedPercent}%`, sublabel: `${item.approved} of ${item.total} approved` };
    }
  };

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
            const shown = display(item);
            const content = (
              <>
                <span className="tabular w-6 flex-shrink-0 text-center text-sm text-gray-500 dark:text-gray-400">{index + 1}</span>
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
