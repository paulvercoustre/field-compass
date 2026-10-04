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

  const avgIssues = useMemo(() => {
    const total = chartData.reduce((sum, d) => sum + d.submissions, 0);
    if (total === 0) return 0;
    return chartData.reduce((sum, d) => sum + d.avgIssues * d.submissions, 0) / total;
  }, [chartData]);

  // One colour: the position says it all, and a verdict per dot ("top
  // performer", "priority concern") is more than these numbers can carry.
  // Fewer than 3 submissions are drawn lighter, as too few to read much into.
  const getPointColor = (submissions: number): string => (submissions < 3 ? '#94a3b8' : '#6366f1');

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const d = payload[0].payload;
      return (
        <div className="bg-white dark:bg-gray-900 px-3 py-2 text-xs rounded-lg shadow-popover border border-gray-200 dark:border-gray-700">
          <p className="font-semibold text-gray-900 dark:text-white">{d.id}</p>
          <div className="text-sm mt-2 space-y-1">
            <p className="text-gray-600 dark:text-gray-300">
              Submissions: <span className="font-medium">{d.submissions}</span>
            </p>
            <p className="text-gray-600 dark:text-gray-300">
              Issues per submission: <span className="font-medium">{d.avgIssues.toFixed(2)}</span>
            </p>
            <p className="text-gray-600 dark:text-gray-300">
              Flagged, not yet approved: <span className="font-medium">{d.needsReview}</span>
            </p>
            <p className="text-gray-600 dark:text-gray-300">
              Approved by reviewer: <span className="font-medium">{d.validated}</span> ({d.validatedPercent}%)
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
    <div className="bg-white dark:bg-gray-900 rounded-xl p-5 shadow-card border border-gray-200 dark:border-gray-800">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
        Issues against submissions
      </h3>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        Each circle is an enumerator, sized by submissions. Dashed lines are the team average. Click one to see their submissions.
      </p>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 30, left: 0, bottom: 10 }}>
            <CartesianGrid stroke="var(--fc-chart-grid)" />
            <XAxis 
              type="number"
              dataKey="submissions"
              name="Submissions"
              tick={{ fontSize: 12, fill: 'var(--fc-chart-tick)' }}
              tickLine={false}
              stroke="var(--fc-chart-axis)"
              label={{ 
                value: 'Submissions', 
                position: 'bottom', 
                offset: -5,
                fontSize: 11,
                fill: 'currentColor'
              }}
            />
            <YAxis 
              type="number"
              dataKey="avgIssues"
              name="Issues per submission"
              domain={[0, 'auto']}
              tick={{ fontSize: 12, fill: 'var(--fc-chart-tick)' }}
              tickLine={false}
              stroke="var(--fc-chart-axis)"
              label={{ 
                value: 'Issues per submission', 
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
              y={avgIssues} 
              stroke="#6366f1" 
              strokeDasharray="5 5"
            />
            
            <Scatter
              data={chartData}
              shape={<CustomDot />}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      
    </div>
  );
};

export default QualityScatterPlot;
