import React, { useMemo } from 'react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ProgressData } from '../../types';
import { shortDay } from '../../utils/daily';
import { CollectionDay, collectionDays, niceScale } from '../../utils/progress';
import { axisProps, gridProps, tooltipProps, CHART_ACCENT } from '../charts/chartTheme';

// Hovering either chart shows the same day in both.
const SYNC = 'collection';
// The same y-axis width and right margin in both, so their days line up.
const Y_WIDTH = 40;
const MARGIN = { top: 8, right: 16, left: 0, bottom: 0 };
const SURFACE = 'var(--fc-chart-tooltip-bg)';
const MUTED = 'var(--fc-chart-tick)';

const DayTooltip: React.FC<{ active?: boolean; payload?: { payload: CollectionDay }[]; plannedEnd: string | null }> = ({
  active,
  payload,
  plannedEnd,
}) => {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div style={tooltipProps.contentStyle}>
      <div style={tooltipProps.labelStyle}>{shortDay(row.day)}</div>
      {row.total !== undefined ? (
        <>
          <div>{row.counted} that day</div>
          <div>{row.total} done so far</div>
        </>
      ) : row.projected !== undefined ? (
        <div>About {row.projected} at the recent pace</div>
      ) : null}
      {row.day === plannedEnd && <div>Planned end</div>}
    </div>
  );
};

/** A line's look in the legend: solid, dotted or dashed; across, or upright for a day. */
const Key: React.FC<{ dash: string; colour?: string; vertical?: boolean; children: React.ReactNode }> = ({
  dash,
  colour = CHART_ACCENT,
  vertical,
  children,
}) => (
  <span className="flex items-center gap-1.5">
    {vertical ? (
      <svg width="8" height="12" aria-hidden="true">
        <line x1="4" y1="0" x2="4" y2="12" stroke={colour} strokeWidth="1.5" strokeDasharray={dash} />
      </svg>
    ) : (
      <svg width="18" height="4" aria-hidden="true">
        <line
          x1="1"
          y1="2"
          x2="17"
          y2="2"
          stroke={colour}
          strokeWidth="2"
          strokeDasharray={dash}
          strokeLinecap="round"
        />
      </svg>
    )}
    {children}
  </span>
);

/**
 * Collection over time, as two charts on the same days rather than one chart
 * with two scales: what is done so far against the target, with where the
 * recent pace would take it, and how many came in each day.
 */
const CollectionChart: React.FC<{ data: ProgressData }> = ({ data }) => {
  const target = data.overall.target;
  const days = useMemo(
    () => collectionDays(data.daily, data.today, target, data.planned_end),
    [data.daily, data.today, target, data.planned_end]
  );
  if (days.length === 0) return <p className="text-sm text-gray-500">No submissions yet.</p>;

  const last = [...days].reverse().find((d) => d.total !== undefined)!;
  const projectedEnd = [...days].reverse().find((d) => d.projected !== undefined && d.day !== last.day);
  const scale = niceScale(1.04 * Math.max(target ?? 0, ...days.map((d) => d.total ?? d.projected ?? 0)));
  const plannedEnd = data.planned_end && days.some((d) => d.day === data.planned_end) ? data.planned_end : null;
  const summary =
    `${last.total} done by ${shortDay(last.day)}` +
    (target !== null ? ` of a target of ${target}` : '') +
    (projectedEnd ? `; at the recent pace, the target by ${shortDay(projectedEnd.day)}` : '') +
    '.';

  return (
    <div role="img" aria-label={summary}>
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Done so far</p>
      <div style={{ width: '100%', height: 210 }}>
        <ResponsiveContainer>
          <ComposedChart data={days} syncId={SYNC} margin={MARGIN}>
            <CartesianGrid {...gridProps} vertical={false} />
            <XAxis dataKey="day" hide />
            {/* Round steps, with a little air above the target line. */}
            <YAxis {...axisProps} width={Y_WIDTH} domain={[0, scale.max]} ticks={scale.ticks} />
            <Tooltip content={<DayTooltip plannedEnd={plannedEnd} />} cursor={{ stroke: MUTED, strokeWidth: 1 }} />
            {target !== null && (
              <ReferenceLine y={target} ifOverflow="extendDomain" stroke={MUTED} strokeDasharray="4 4" />
            )}
            {plannedEnd && <ReferenceLine x={plannedEnd} stroke={MUTED} strokeDasharray="4 4" />}
            <Area
              dataKey="total"
              type="linear"
              stroke={CHART_ACCENT}
              strokeWidth={2}
              fill={CHART_ACCENT}
              fillOpacity={0.1}
              dot={false}
              activeDot={{ r: 4, stroke: SURFACE, strokeWidth: 2 }}
              isAnimationActive={false}
            />
            <Line
              dataKey="projected"
              stroke={CHART_ACCENT}
              strokeWidth={2}
              strokeDasharray="2 5"
              strokeLinecap="round"
              dot={false}
              activeDot={false}
              isAnimationActive={false}
            />
            <ReferenceDot x={last.day} y={last.total} r={4} fill={CHART_ACCENT} stroke={SURFACE} strokeWidth={2} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {/* The lines named here, not on the chart, where they would collide near the target. */}
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-300">
        <Key dash="">Done so far: {last.total}</Key>
        {projectedEnd && <Key dash="2 4">At the recent pace: the target by {shortDay(projectedEnd.day)}</Key>}
        {target !== null && (
          <Key dash="4 3" colour={MUTED}>
            Target: {target}
          </Key>
        )}
        {plannedEnd && (
          <Key dash="3 2" colour={MUTED} vertical>
            Planned end: {shortDay(plannedEnd)}
          </Key>
        )}
      </div>
      <p className="mt-4 text-xs font-medium text-gray-500 dark:text-gray-400">Each day</p>
      <div style={{ width: '100%', height: 110 }}>
        <ResponsiveContainer>
          <BarChart data={days} syncId={SYNC} margin={{ ...MARGIN, top: 6 }}>
            <CartesianGrid {...gridProps} vertical={false} />
            <XAxis
              dataKey="day"
              {...axisProps}
              tickFormatter={(day: string) => shortDay(day)}
              interval="preserveStartEnd"
              minTickGap={28}
            />
            <YAxis {...axisProps} width={Y_WIDTH} allowDecimals={false} />
            {/* The day's numbers show in the chart above; here, just the band. */}
            <Tooltip content={() => null} cursor={{ fill: 'var(--fc-chart-cursor)' }} />
            <Bar
              dataKey="counted"
              fill={CHART_ACCENT}
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default CollectionChart;
