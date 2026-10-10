import React from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TemporalDataPoint } from '../../types';
import { axisProps, gridProps, tooltipProps, STATUS_COLORS } from '../charts/chartTheme';
import { GLOSSARY } from '../../utils/glossary';

const STATES = [
  { key: 'needs_review', label: GLOSSARY.needsReview.name, color: STATUS_COLORS.needsReview },
  { key: 'on_hold', label: GLOSSARY.onHold.name, color: STATUS_COLORS.onHold },
  { key: 'clean', label: GLOSSARY.clean.name, color: STATUS_COLORS.clean },
  { key: 'approved', label: GLOSSARY.approved.name, color: STATUS_COLORS.approved },
  { key: 'not_approved', label: GLOSSARY.notApproved.name, color: STATUS_COLORS.notApproved },
] as const;

/** Each day's submissions, stacked by where each one stands now: a bar is that day's total. */
const SubmissionStatusChart: React.FC<{ data: TemporalDataPoint[] }> = ({ data }) => {
  const chartData = data.map((point) => ({
    ...point,
    // A date alone is read as UTC midnight; the day is local.
    label: new Date(`${point.date}T00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
  }));
  if (data.length === 0) return <p className="text-sm text-gray-500">No submissions in this period.</p>;
  return (
    <div style={{ width: '100%', height: 220 }}>
      <ResponsiveContainer>
        <BarChart data={chartData} margin={{ top: 5, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid {...gridProps} vertical={false} />
          <XAxis dataKey="label" {...axisProps} />
          <YAxis {...axisProps} allowDecimals={false} />
          <Tooltip {...tooltipProps} />
          {/* In review order, as on the review bar, not alphabetical. */}
          <Legend
            itemSorter={null}
            iconType="square"
            iconSize={8}
            wrapperStyle={{ paddingTop: '8px' }}
            formatter={(value) => <span className="text-xs text-gray-600 dark:text-gray-300">{value}</span>}
          />
          {STATES.map((state, i) => (
            <Bar
              key={state.key}
              dataKey={state.key}
              name={state.label}
              stackId="day"
              fill={state.color}
              maxBarSize={28}
              radius={i === STATES.length - 1 ? [3, 3, 0, 0] : undefined}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default SubmissionStatusChart;
