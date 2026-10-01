import React, { useMemo, useState } from 'react';
import { PerformanceData } from '../../types';

type LeaderboardMetric = 'validated' | 'submissions' | 'avgIssues' | 'avgTime';

interface EnumeratorLeaderboardProps {
  data: PerformanceData;
  onEnumeratorClick?: (enumeratorId: string) => void;
}

// What each list is, in each direction. These replace "Top 5 / Bottom 5
// Performers": the metrics here are a list to look at, not a verdict on
// people -- approval share is review progress, and interview length is
// neither good nor bad on its own.
const METRICS: Array<{ key: LeaderboardMetric; label: string; first: string; reversed: string }> = [
  { key: 'avgIssues', label: 'Issues per submission', first: 'Fewest issues per submission', reversed: 'Most issues per submission' },
  { key: 'submissions', label: 'Volume', first: 'Most submissions', reversed: 'Fewest submissions' },
  { key: 'validated', label: 'Approved by reviewer', first: 'Highest share approved by a reviewer', reversed: 'Lowest share approved by a reviewer' },
  { key: 'avgTime', label: 'Active time', first: 'Longest active interview time', reversed: 'Shortest active interview time' },
];

const EnumeratorLeaderboard: React.FC<EnumeratorLeaderboardProps> = ({ data, onEnumeratorClick }) => {
  const { collection, quality } = data;
  const [metric, setMetric] = useState<LeaderboardMetric>('avgIssues');
  const [showBottom, setShowBottom] = useState(false);

  const rankings = useMemo(() => {
    const combined = collection.map(c => {
      const q = quality.find(qs => qs.id === c.id);
      return {
        id: c.id,
        total: c.total,
        validated: c.validated,
        validatedPercent: parseFloat(c.percentValidated),
        needsReviewPercent: parseFloat(c.percentNeedsReview),
        avgIssues: q?.avgIssuesPerSurvey || 0,
        avgActiveTime: q?.avgActiveTime || 0,
        avgTotalTime: q?.avgTotalTime || 0,
      };
    });

    // Sort based on selected metric
    const sorted = [...combined].sort((a, b) => {
      switch (metric) {
        case 'validated':
          // Higher is better
          return showBottom 
            ? a.validatedPercent - b.validatedPercent 
            : b.validatedPercent - a.validatedPercent;
        case 'submissions':
          // Higher is better
          return showBottom 
            ? a.total - b.total 
            : b.total - a.total;
        case 'avgIssues':
          // Lower is better
          return showBottom 
            ? b.avgIssues - a.avgIssues 
            : a.avgIssues - b.avgIssues;
        case 'avgTime':
          // Longest first. Not "most thorough": a long interview can be as
          // much a problem as a short one, so this list has no winner.
          return showBottom 
            ? a.avgActiveTime - b.avgActiveTime 
            : b.avgActiveTime - a.avgActiveTime;
        default:
          return 0;
      }
    });

    // Filter out enumerators with less than 3 submissions for fair comparison
    const eligible = sorted.filter(e => e.total >= 3);
    return eligible.slice(0, 5);
  }, [collection, quality, metric, showBottom]);

  const getMetricDisplay = (item: typeof rankings[0]) => {
    switch (metric) {
      case 'validated':
        return {
          value: `${item.validatedPercent}%`,
          sublabel: `${item.validated} of ${item.total} approved`,
          color: 'text-gray-900 dark:text-white'
        };
      case 'submissions':
        return {
          value: item.total.toString(),
          sublabel: `${item.validatedPercent}% approved by reviewer`,
          color: 'text-indigo-600 dark:text-indigo-400'
        };
      case 'avgIssues':
        return {
          value: item.avgIssues.toFixed(2),
          sublabel: `per submission`,
          color: item.avgIssues < 1 ? 'text-emerald-700 dark:text-emerald-400' : 
                 item.avgIssues < 2 ? 'text-amber-700 dark:text-amber-400' : 
                 'text-red-700 dark:text-red-400'
        };
      case 'avgTime':
        return {
          value: `${item.avgActiveTime} min`,
          sublabel: `active time`,
          color: 'text-gray-900 dark:text-white'
        };
    }
  };

  const current = METRICS.find(m => m.key === metric) ?? METRICS[0];
  // Active time has no better end, so its list is not numbered as a ranking.
  const isRanking = metric !== 'avgTime';

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700 w-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          {showBottom ? current.reversed : current.first}
        </h3>
        <button
          onClick={() => setShowBottom(!showBottom)}
          className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
        >
          Reverse order
        </button>
      </div>

      {/* Metric Selector */}
      <div className="flex flex-wrap gap-2 mb-4">
        {METRICS.map(m => (
          <button
            key={m.key}
            onClick={() => setMetric(m.key)}
            aria-pressed={metric === m.key}
            className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
              metric === m.key
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Rankings List */}
      <div className="space-y-2 flex-1 overflow-y-auto">
        {rankings.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 text-sm text-center py-4">
            Need at least 3 submissions to rank
          </p>
        ) : (
          rankings.map((item, index) => {
            const display = getMetricDisplay(item);
            return (
              <div
                key={item.id}
                onClick={() => onEnumeratorClick?.(item.id)}
                className={`flex items-center gap-3 p-2 rounded-lg bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors ${
                  onEnumeratorClick ? 'cursor-pointer' : ''
                }`}
              >
                {/* Position in the list -- plain, no medals */}
                {isRanking && (
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300">
                    {index + 1}
                  </div>
                )}
                
                {/* Enumerator Info */}
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900 dark:text-white truncate">
                    {item.id}
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">
                    {display.sublabel}
                  </div>
                </div>
                
                {/* Metric Value */}
                <div className={`text-lg font-bold ${display.color}`}>
                  {display.value}
                </div>
              </div>
            );
          })
        )}
      </div>
      
      {rankings.length > 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-3 text-center">
          {metric === 'avgTime'
            ? 'Neither long nor short is better on its own: check interviews at both ends. '
            : metric === 'validated'
              ? 'Shows how far review has got, not interview quality. '
              : ''}
          Enumerators with at least 3 submissions.
        </p>
      )}
    </div>
  );
};

export default EnumeratorLeaderboard;
