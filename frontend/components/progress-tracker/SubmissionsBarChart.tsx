import React, { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from 'recharts';
import { EnumeratorCollectionStats } from '../../types';

interface SubmissionsBarChartProps {
  data: EnumeratorCollectionStats[];
  onEnumeratorClick?: (enumeratorId: string) => void;
}

const SubmissionsBarChart: React.FC<SubmissionsBarChartProps> = ({ data, onEnumeratorClick }) => {
  const chartData = useMemo(() => {
    return [...data]
      .sort((a, b) => b.total - a.total)
      .map(e => ({
        id: e.id,
        total: e.total,
        validated: e.validated,
        needsReview: e.needsReview,
        percentValidated: parseFloat(e.percentValidated),
      }));
  }, [data]);

  const avgSubmissions = useMemo(() => {
    if (data.length === 0) return 0;
    return data.reduce((sum, e) => sum + e.total, 0) / data.length;
  }, [data]);

  // One colour for every bar. Bars used to be coloured by the share a
  // reviewer had approved, which turned every bar red while most of the
  // survey was still unreviewed -- a judgement on enumerators that was really
  // about review progress.
  const barColor = '#6366f1'; // indigo-500

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const d = payload[0].payload;
      return (
        <div className="bg-white dark:bg-gray-800 p-3 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
          <p className="font-semibold text-gray-900 dark:text-white">{d.id}</p>
          <div className="text-sm mt-1 space-y-1">
            <p className="text-gray-600 dark:text-gray-300">
              Total: <span className="font-medium">{d.total}</span>
            </p>
            <p className="text-gray-600 dark:text-gray-300">
              Approved by reviewer: <span className="font-medium">{d.validated}</span> ({d.percentValidated}%)
            </p>
            <p className="text-gray-600 dark:text-gray-300">
              Flagged, not yet approved: <span className="font-medium">{d.needsReview}</span>
            </p>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700 w-full flex flex-col">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
        Submissions by Enumerator
      </h3>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{ top: 10, right: 10, left: 0, bottom: 40 }}
          >
            <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
            <XAxis 
              dataKey="id" 
              angle={-45}
              textAnchor="end"
              height={60}
              tick={{ fontSize: 10, fill: 'currentColor' }}
              className="text-gray-600 dark:text-gray-400"
            />
            <YAxis 
              tick={{ fontSize: 12, fill: 'currentColor' }}
              className="text-gray-600 dark:text-gray-400"
            />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine 
              y={avgSubmissions} 
              stroke="#6366f1" 
              strokeDasharray="5 5" 
              label={{ 
                value: `Avg: ${avgSubmissions.toFixed(1)}`, 
                position: 'right',
                fontSize: 10,
                fill: '#6366f1'
              }} 
            />
            <Bar 
              dataKey="total" 
              radius={[4, 4, 0, 0]}
              cursor={onEnumeratorClick ? 'pointer' : 'default'}
              onClick={(d) => onEnumeratorClick?.(d.id)}
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={barColor} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-4 text-xs text-gray-500 dark:text-gray-400 text-center">
        Dashed line: team average. Click a bar to see that enumerator's submissions.
      </p>
    </div>
  );
};

export default SubmissionsBarChart;
