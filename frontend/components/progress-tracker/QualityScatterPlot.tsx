import React, { useMemo } from 'react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ZAxis,
} from 'recharts';
import { PerformanceData } from '../../types';

interface QualityScatterPlotProps {
  data: PerformanceData;
  onEnumeratorClick?: (enumeratorId: string) => void;
}

const QualityScatterPlot: React.FC<QualityScatterPlotProps> = ({ data, onEnumeratorClick }) => {
  const { collection, quality } = data;

  const chartData = useMemo(() => {
    return collection.map(c => {
      const q = quality.find(qs => qs.id === c.id);
      return {
        id: c.id,
        submissions: c.total,
        validatedPercent: parseFloat(c.percentValidated),
        needsReviewPercent: parseFloat(c.percentNeedsReview),
        avgIssues: q?.avgIssuesPerSurvey || 0,
        validated: c.validated,
        needsReview: c.needsReview,
      };
    });
  }, [collection, quality]);

  const avgSubmissions = useMemo(() => {
    if (chartData.length === 0) return 0;
    return chartData.reduce((sum, d) => sum + d.submissions, 0) / chartData.length;
  }, [chartData]);

  const avgValidated = useMemo(() => {
    if (chartData.length === 0) return 0;
    return chartData.reduce((sum, d) => sum + d.validatedPercent, 0) / chartData.length;
  }, [chartData]);

  // One colour: the Y axis is the share a reviewer has approved, which says
  // how far the review has got rather than how good the interviews were, so
  // it does not earn a green/red judgement.
  const getPointColor = (submissions: number): string =>
    submissions < 3 ? '#94a3b8' /* slate-400: too few to compare */ : '#6366f1'; /* indigo-500 */

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const d = payload[0].payload;
      return (
        <div className="bg-white dark:bg-gray-800 p-3 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
          <p className="font-semibold text-gray-900 dark:text-white">{d.id}</p>
          <div className="text-sm mt-2 space-y-1">
            <p className="text-gray-600 dark:text-gray-300">
              Submissions: <span className="font-medium">{d.submissions}</span>
            </p>
            <p className="text-gray-600 dark:text-gray-300">
              Approved by reviewer: <span className="font-medium">{d.validatedPercent}%</span> ({d.validated})
            </p>
            <p className="text-gray-600 dark:text-gray-300">
              Flagged, not yet approved: <span className="font-medium">{d.needsReviewPercent}%</span> ({d.needsReview})
            </p>
            <p className="text-gray-500 dark:text-gray-400">
              Avg Issues: <span className="font-medium">{d.avgIssues.toFixed(2)}</span>
            </p>
          </div>
        </div>
      );
    }
    return null;
  };

  const CustomDot = (props: any) => {
    const { cx, cy, payload } = props;
    const color = getPointColor(payload.submissions);
    const size = Math.max(6, Math.min(14, 6 + payload.submissions / 5));
    
    return (
      <circle
        cx={cx}
        cy={cy}
        r={size}
        fill={color}
        stroke="white"
        strokeWidth={1}
        style={{ cursor: onEnumeratorClick ? 'pointer' : 'default' }}
        onClick={() => onEnumeratorClick?.(payload.id)}
      />
    );
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
        Review progress vs. volume
      </h3>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        Circle size = submission count. Click a circle to see that enumerator's submissions.
      </p>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 30, left: 0, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
            <XAxis 
              type="number"
              dataKey="submissions"
              name="Submissions"
              tick={{ fontSize: 12, fill: 'currentColor' }}
              label={{ 
                value: 'Total Submissions', 
                position: 'bottom', 
                offset: -5,
                fontSize: 11,
                fill: 'currentColor'
              }}
            />
            <YAxis 
              type="number"
              dataKey="validatedPercent"
              name="Approved by reviewer %"
              domain={[0, 100]}
              tick={{ fontSize: 12, fill: 'currentColor' }}
              label={{ 
                value: 'Approved by reviewer %', 
                angle: -90, 
                position: 'insideLeft',
                fontSize: 11,
                fill: 'currentColor'
              }}
            />
            <ZAxis range={[60, 400]} />
            <Tooltip content={<CustomTooltip />} />
            
            {/* Reference lines for averages */}
            <ReferenceLine 
              x={avgSubmissions} 
              stroke="#6366f1" 
              strokeDasharray="5 5"
            />
            <ReferenceLine 
              y={avgValidated} 
              stroke="#6366f1" 
              strokeDasharray="5 5"
            />
            
            {/* Quadrant labels */}
            <Scatter
              data={chartData}
              shape={<CustomDot />}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      
      {/* No quadrant verdicts ("Top performers", "Needs training"): the
          vertical axis measures review progress, which cannot tell a weak
          enumerator from one whose work nobody has reviewed yet. */}
      <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
        Dashed lines show team averages. A low approval share often means a reviewer has not reached that enumerator's submissions yet; for interview quality, use the issue rates under Survey Quality below.
      </p>
    </div>
  );
};

export default QualityScatterPlot;
