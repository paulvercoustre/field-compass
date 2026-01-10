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

  const getBarColor = (percentValidated: number): string => {
    if (percentValidated >= 80) return '#10b981'; // emerald-500
    if (percentValidated >= 60) return '#f59e0b'; // amber-500
    return '#ef4444'; // red-500
  };

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
            <p className="text-emerald-600 dark:text-emerald-400">
              Validated: <span className="font-medium">{d.validated}</span>
            </p>
            <p className="text-amber-600 dark:text-amber-400">
              Needs Review: <span className="font-medium">{d.needsReview}</span>
            </p>
            <p className="text-gray-500 dark:text-gray-400">
              Validation Rate: <span className="font-medium">{d.percentValidated}%</span>
            </p>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
        Submissions by Enumerator
      </h3>
      <div className="h-64">
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
                <Cell 
                  key={`cell-${index}`} 
                  fill={getBarColor(entry.percentValidated)}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center justify-center gap-6 mt-4 text-xs text-gray-500 dark:text-gray-400">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-emerald-500"></div>
          <span>≥80% validated</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-amber-500"></div>
          <span>60-79% validated</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-red-500"></div>
          <span>&lt;60% validated</span>
        </div>
      </div>
    </div>
  );
};

export default SubmissionsBarChart;
