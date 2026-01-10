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

  const getPointColor = (validatedPercent: number, submissions: number): string => {
    // High volume, high quality = green
    // High volume, low quality = red (priority concern)
    // Low volume = gray/blue
    if (submissions < 3) return '#94a3b8'; // slate-400 (too few to judge)
    if (validatedPercent >= 80) return '#10b981'; // emerald-500
    if (validatedPercent >= 60) return '#f59e0b'; // amber-500
    return '#ef4444'; // red-500
  };

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
            <p className="text-emerald-600 dark:text-emerald-400">
              Validated: <span className="font-medium">{d.validatedPercent}%</span> ({d.validated})
            </p>
            <p className="text-amber-600 dark:text-amber-400">
              Needs Review: <span className="font-medium">{d.needsReviewPercent}%</span> ({d.needsReview})
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
    const color = getPointColor(payload.validatedPercent, payload.submissions);
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
        Quality vs. Quantity
      </h3>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        Circle size = submission count. Click to filter.
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
              name="Validated %"
              domain={[0, 100]}
              tick={{ fontSize: 12, fill: 'currentColor' }}
              label={{ 
                value: 'Validated %', 
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
      
      {/* Quadrant Legend */}
      <div className="grid grid-cols-2 gap-2 mt-4 text-xs">
        <div className="p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded text-center">
          <span className="text-emerald-700 dark:text-emerald-300 font-medium">↗ High Vol, High Quality</span>
          <br /><span className="text-emerald-600 dark:text-emerald-400">Top performers</span>
        </div>
        <div className="p-2 bg-red-50 dark:bg-red-900/20 rounded text-center">
          <span className="text-red-700 dark:text-red-300 font-medium">↘ High Vol, Low Quality</span>
          <br /><span className="text-red-600 dark:text-red-400">Priority concern</span>
        </div>
        <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded text-center">
          <span className="text-blue-700 dark:text-blue-300 font-medium">↖ Low Vol, High Quality</span>
          <br /><span className="text-blue-600 dark:text-blue-400">Good but slow</span>
        </div>
        <div className="p-2 bg-amber-50 dark:bg-amber-900/20 rounded text-center">
          <span className="text-amber-700 dark:text-amber-300 font-medium">↙ Low Vol, Low Quality</span>
          <br /><span className="text-amber-600 dark:text-amber-400">Needs training</span>
        </div>
      </div>
    </div>
  );
};

export default QualityScatterPlot;
