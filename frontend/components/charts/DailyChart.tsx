import React, { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { DayPoint } from '../../types';
import { DailyMeasure, byDay, shortDay } from '../../utils/daily';
import { axisProps, gridProps, tooltipProps, CHART_ACCENT } from './chartTheme';

const FORMAT: Record<DailyMeasure, (value: number) => string> = {
  flagged: (value) => `${value}%`,
  issues: (value) => String(value),
};

interface DailyChartProps {
  daily: DayPoint[];
  /** Share flagged, or issues per submission: each a share of the day, never a count. */
  measure: DailyMeasure;
  /** The whole period's figure, in the same unit, drawn dashed to compare each day with. */
  average: number | null;
  /** The legend's words for the bars and for the dashed line. */
  barLabel: string;
  averageLabel: string;
}

/** A quality measure on each day of collection, as bars: is it getting better? */
const DailyChart: React.FC<DailyChartProps> = ({ daily, measure, average, barLabel, averageLabel }) => {
  const format = FORMAT[measure];
  const days = useMemo(() => byDay(daily, measure).map((d) => ({ ...d, label: shortDay(d.day) })), [daily, measure]);
  if (days.length === 0) return <p className="text-sm text-gray-500">No submissions in this period.</p>;
  return (
    <>
      <div style={{ width: '100%', height: 180 }}>
        <ResponsiveContainer>
          <BarChart data={days} margin={{ top: 5, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid {...gridProps} vertical={false} />
            <XAxis dataKey="label" {...axisProps} />
            <YAxis {...axisProps} allowDecimals={measure === 'issues'} tickFormatter={(v: number) => format(v)} />
            <Tooltip
              {...tooltipProps}
              formatter={(value, _name, item) => [`${format(Number(value))} (${item.payload.detail})`, barLabel]}
            />
            <Bar dataKey="value" fill="#d97706" radius={[3, 3, 0, 0]} maxBarSize={28} />
            {average !== null && (
              <ReferenceLine y={average} stroke={CHART_ACCENT} strokeWidth={1.5} strokeDasharray="4 4" />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-300">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-amber-600" aria-hidden="true" />
          {barLabel}
        </span>
        {average !== null && (
          <span className="flex items-center gap-1.5">
            <svg width="18" height="4" aria-hidden="true">
              <line x1="0" y1="2" x2="18" y2="2" stroke={CHART_ACCENT} strokeWidth="1.5" strokeDasharray="4 3" />
            </svg>
            {averageLabel}: {format(average)}
          </span>
        )}
      </div>
    </>
  );
};

export default DailyChart;
