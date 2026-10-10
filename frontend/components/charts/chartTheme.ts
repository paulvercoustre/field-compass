// One look for every Recharts chart. Colours are CSS variables (defined in
// index.css, with dark-mode values) so tooltips and axes follow the theme
// instead of staying dark in light mode.

export const CHART_ACCENT = '#6366f1'; // indigo-500

// The review states (utils/glossary.ts), the same hues as the review bar
// (components/metrics/ReviewBar.tsx). Needs review and On hold share a hue
// and differ in lightness, so they stay apart without colour vision.
export const STATUS_COLORS = {
  needsReview: '#d97706', // amber-600
  onHold: '#fcd34d', // amber-300
  clean: '#d1d5db', // gray-300
  approved: '#059669', // emerald-600
  notApproved: '#be123c', // rose-700
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
