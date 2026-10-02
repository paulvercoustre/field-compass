// One look for every Recharts chart. Colours are CSS variables (defined in
// index.css, with dark-mode values) so tooltips and axes follow the theme
// instead of staying dark in light mode.

export const CHART_ACCENT = '#6366f1'; // indigo-500

// Status hues match the badges: emerald / rose / amber / zinc.
export const STATUS_COLORS = {
  total: CHART_ACCENT,
  approved: '#10b981',
  notApproved: '#f43f5e',
  onHold: '#f59e0b',
  notReviewed: '#a1a1aa',
} as const;

// For series with no inherent meaning (issue types). Ordered so neighbours
// contrast, and avoids the status hues where it can.
export const SERIES_COLORS = [
  '#6366f1', // indigo
  '#14b8a6', // teal
  '#ec4899', // pink
  '#0ea5e9', // sky
  '#8b5cf6', // violet
  '#84cc16', // lime
  '#f97316', // orange
  '#06b6d4', // cyan
  '#d946ef', // fuchsia
  '#64748b', // slate
];

export const axisProps = {
  stroke: 'var(--fc-chart-axis)',
  tick: { fill: 'var(--fc-chart-tick)', fontSize: 12 },
  tickLine: false,
  axisLine: false,
  fontSize: 12,
};

export const gridProps = {
  stroke: 'var(--fc-chart-grid)',
  vertical: false,
};

export const tooltipProps = {
  contentStyle: {
    backgroundColor: 'var(--fc-chart-tooltip-bg)',
    border: '1px solid var(--fc-chart-tooltip-border)',
    borderRadius: '0.5rem',
    boxShadow: '0 8px 24px -8px rgb(0 0 0 / 0.18)',
    color: 'var(--fc-chart-tooltip-text)',
    fontSize: 12,
    padding: '8px 10px',
  },
  labelStyle: { color: 'var(--fc-chart-tooltip-text)', fontWeight: 600, marginBottom: 4 },
  itemStyle: { padding: 0 },
  cursor: { fill: 'var(--fc-chart-cursor)', stroke: 'var(--fc-chart-grid)' },
};
