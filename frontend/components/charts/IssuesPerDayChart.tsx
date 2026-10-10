import React, { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { DayPoint } from '../../types';
import { dailyIssuesPerSubmission } from '../../utils/fieldTeam';
import { axisProps, gridProps, tooltipProps, CHART_ACCENT } from './chartTheme';

interface IssuesPerDayChartProps {
  daily: DayPoint[];
  /** The whole period's figure, drawn as a dashed line to compare each day with. */
  average: number | null;
  /** Whose bars these are, for the tooltip. */
  name: string;
}

/** Issues per submission on each day of collection, as bars: is it getting better? */
const IssuesPerDayChart: React.FC<IssuesPerDayChartProps> = ({ daily, average, name }) => {
  const days = useMemo(
    () =>
      dailyIssuesPerSubmission(daily).map((d) => ({
        // A date alone is read as UTC midnight; the day is local.
        label: new Date(`${d.day}T00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
        value: d.value,
      })),
    [daily]
  );
  if (days.length === 0) return <p className="text-sm text-gray-500">No submissions in this period.</p>;
  return (
    <div style={{ width: '100%', height: 180 }}>
      <ResponsiveContainer>
        <BarChart data={days} margin={{ top: 5, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid {...gridProps} vertical={false} />
          <XAxis dataKey="label" {...axisProps} />
          <YAxis {...axisProps} allowDecimals />
          <Tooltip {...tooltipProps} formatter={(value) => [value, name]} />
          <Bar dataKey="value" fill="#d97706" radius={[3, 3, 0, 0]} maxBarSize={28} />
          {average !== null && (
            <ReferenceLine y={average} stroke={CHART_ACCENT} strokeWidth={1.5} strokeDasharray="4 4" />
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default IssuesPerDayChart;
