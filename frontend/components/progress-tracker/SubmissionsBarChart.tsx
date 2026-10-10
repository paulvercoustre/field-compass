import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { EnumeratorSummary } from '../../types';
import { GLOSSARY } from '../../utils/glossary';

interface SubmissionsBarChartProps {
  data: EnumeratorSummary[];
  onEnumeratorClick?: (enumeratorId: string) => void;
}

const EnumeratorTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const d = payload[0].payload;
    return (
      <div className="bg-white dark:bg-gray-900 px-3 py-2 text-xs rounded-lg shadow-popover border border-gray-200 dark:border-gray-700">
        <p className="font-semibold text-gray-900 dark:text-white">{d.id}</p>
        <div className="text-sm mt-1 space-y-1">
          <p className="text-gray-600 dark:text-gray-300">
            {GLOSSARY.submissions.name}: <span className="font-medium">{d.total}</span>
          </p>
          <p className="text-gray-600 dark:text-gray-300">
            {GLOSSARY.flagged.name}: <span className="font-medium">{d.flagged}</span>
          </p>
          <p className="text-gray-600 dark:text-gray-300">
            {GLOSSARY.needsReview.name}: <span className="font-medium">{d.needsReview}</span>
          </p>
        </div>
      </div>
    );
  }
  return null;
};

const SubmissionsBarChart: React.FC<SubmissionsBarChartProps> = ({ data, onEnumeratorClick }) => {
  const chartData = useMemo(() => {
    return [...data]
      .sort((a, b) => b.submissions - a.submissions)
      .map((e) => ({
        id: e.id,
        total: e.submissions,
        flagged: e.flagged,
        needsReview: e.needs_review,
      }));
  }, [data]);

  const avgSubmissions = useMemo(() => {
    if (data.length === 0) return 0;
    return data.reduce((sum, e) => sum + e.submissions, 0) / data.length;
  }, [data]);

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl p-5 shadow-card border border-gray-200 dark:border-gray-800 w-full flex flex-col">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Submissions by enumerator</h3>
      <div className="flex-1 min-h-[16rem]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 40 }}>
            <CartesianGrid stroke="var(--fc-chart-grid)" />
            <XAxis
              dataKey="id"
              angle={-45}
              textAnchor="end"
              height={60}
              tick={{ fontSize: 11, fill: 'var(--fc-chart-tick)' }}
              tickLine={false}
              stroke="var(--fc-chart-axis)"
              className="text-gray-600 dark:text-gray-400"
            />
            <YAxis
              tick={{ fontSize: 12, fill: 'var(--fc-chart-tick)' }}
              tickLine={false}
              stroke="var(--fc-chart-axis)"
              className="text-gray-600 dark:text-gray-400"
            />
            <Tooltip content={<EnumeratorTooltip />} />
            <ReferenceLine
              y={avgSubmissions}
              stroke="#6366f1"
              strokeDasharray="5 5"
              label={{
                value: `Avg: ${avgSubmissions.toFixed(1)}`,
                position: 'right',
                fontSize: 10,
                fill: '#6366f1',
              }}
            />
            <Bar
              dataKey="total"
              radius={[4, 4, 0, 0]}
              fill="#6366f1"
              cursor={onEnumeratorClick ? 'pointer' : 'default'}
              onClick={(d) => {
                if (d.id !== undefined) onEnumeratorClick?.(d.id);
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default SubmissionsBarChart;
