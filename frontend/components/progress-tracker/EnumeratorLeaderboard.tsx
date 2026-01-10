import React, { useMemo, useState } from 'react';
import { PerformanceData } from '../../types';

type LeaderboardMetric = 'validated' | 'submissions' | 'avgIssues' | 'avgTime';

interface EnumeratorLeaderboardProps {
  data: PerformanceData;
  onEnumeratorClick?: (enumeratorId: string) => void;
}

const EnumeratorLeaderboard: React.FC<EnumeratorLeaderboardProps> = ({ data, onEnumeratorClick }) => {
  const { collection, quality } = data;
  const [metric, setMetric] = useState<LeaderboardMetric>('validated');
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
          // Context-dependent, but moderate is usually best
          // For simplicity, sort by time descending for "top" (most thorough)
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
          sublabel: `${item.validated} of ${item.total}`,
          color: item.validatedPercent >= 80 ? 'text-emerald-600 dark:text-emerald-400' : 
                 item.validatedPercent >= 60 ? 'text-amber-600 dark:text-amber-400' : 
                 'text-red-600 dark:text-red-400'
        };
      case 'submissions':
        return {
          value: item.total.toString(),
          sublabel: `${item.validatedPercent}% validated`,
          color: 'text-indigo-600 dark:text-indigo-400'
        };
      case 'avgIssues':
        return {
          value: item.avgIssues.toFixed(2),
          sublabel: `per submission`,
          color: item.avgIssues < 1 ? 'text-emerald-600 dark:text-emerald-400' : 
                 item.avgIssues < 2 ? 'text-amber-600 dark:text-amber-400' : 
                 'text-red-600 dark:text-red-400'
        };
      case 'avgTime':
        return {
          value: `${item.avgActiveTime} min`,
          sublabel: `active time`,
          color: 'text-blue-600 dark:text-blue-400'
        };
    }
  };

  const getMedalColor = (rank: number): string => {
    if (showBottom) return 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300';
    
    switch (rank) {
      case 0: return 'bg-amber-400 text-amber-900';
      case 1: return 'bg-gray-300 text-gray-700';
      case 2: return 'bg-amber-600 text-amber-100';
      default: return 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300';
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          {showBottom ? 'Bottom 5' : 'Top 5'} Performers
        </h3>
        <button
          onClick={() => setShowBottom(!showBottom)}
          className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
        >
          Show {showBottom ? 'Top' : 'Bottom'}
        </button>
      </div>

      {/* Metric Selector */}
      <div className="flex flex-wrap gap-2 mb-4">
        {[
          { key: 'validated', label: 'Validation Rate' },
          { key: 'submissions', label: 'Volume' },
          { key: 'avgIssues', label: 'Fewest Issues' },
          { key: 'avgTime', label: 'Active Time' },
        ].map(m => (
          <button
            key={m.key}
            onClick={() => setMetric(m.key as LeaderboardMetric)}
            className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
              metric === m.key
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Rankings List */}
      <div className="space-y-2">
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
                className={`flex items-center gap-3 p-2 rounded-lg bg-gray-50 dark:bg-gray-750 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                  onEnumeratorClick ? 'cursor-pointer' : ''
                }`}
              >
                {/* Rank Badge */}
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${getMedalColor(index)}`}>
                  {index + 1}
                </div>
                
                {/* Enumerator Info */}
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900 dark:text-white truncate">
                    {item.id}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
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
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-3 text-center">
          Based on enumerators with ≥3 submissions
        </p>
      )}
    </div>
  );
};

export default EnumeratorLeaderboard;
