import React, { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AIUsageHistory, getAIUsageHistory, UsageMetric, UsagePeriod } from '../../services/aiConnectionsApi';
import { axisProps, gridProps, tooltipProps } from '../charts/chartTheme';

// Validated pair (light and dark): indigo for the included usage, teal for
// your own keys. Their tritan separation is in the floor band, so identity
// never rests on colour alone: the legend is always shown and stacked
// segments are separated by a 2px gap.
const INCLUDED = '#6366f1';
const OWN = '#0d9488';
const GAP = 2;
const RADIUS = 4;

interface SurveyOption {
  survey_id: string;
  survey_name: string;
}

interface AIUsageChartProps {
  surveys: SurveyOption[];
  /** Changes when keys or usage change, to read the history again. */
  refreshKey?: number;
}

/** A bar segment whose top corners are rounded only when it is the top of its stack. */
const segment = (layer: 'included' | 'own') => (props: any) => {
  const { x, y, width, payload } = props;
  let { height } = props;
  if (!height || height <= 0 || width <= 0) return <g />;
  const top = layer === 'own' || !payload.own;
  let topY = y;
  // The upper segment gives up 2px at its base: the gap between the two.
  if (layer === 'own' && payload.included) {
    height = Math.max(0, height - GAP);
  }
  if (height <= 0) return <g />;
  const r = top ? Math.min(RADIUS, width / 2, height) : 0;
  const bottom = topY + height;
  const d = `M${x},${bottom} L${x},${topY + r} Q${x},${topY} ${x + r},${topY} L${x + width - r},${topY} Q${x + width},${topY} ${x + width},${topY + r} L${x + width},${bottom} Z`;
  return <path d={d} fill={layer === 'own' ? OWN : INCLUDED} />;
};

/** Four even steps of 1, 2, 2.5 or 5 × 10^n that cover the tallest bar. */
const niceTicks = (max: number, whole: boolean): number[] => {
  if (max <= 0) return [0, 1, 2, 3, 4];
  const rough = max / 4;
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const steps = whole ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10];
  let step = (steps.find((s) => s * power >= rough) ?? 10) * power;
  if (whole) step = Math.max(1, Math.round(step));
  return [0, 1, 2, 3, 4].map((i) => Math.round(i * step * 100) / 100);
};

const label = (start: string, unit: 'day' | 'month') => {
  const date = new Date(`${start}T00:00:00Z`);
  return unit === 'day'
    ? date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })
    : date.toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' });
};

const formatValue = (value: number, metric: UsageMetric) =>
  metric === 'minutes' ? `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} min` : value.toLocaleString();

const segmentButton = (active: boolean) =>
  `px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
    active
      ? 'bg-white text-gray-900 shadow-xs ring-1 ring-gray-200 dark:bg-gray-800 dark:text-white dark:ring-gray-700'
      : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
  }`;

/**
 * AI use over time: AI reviews, translations or transcription minutes, daily for 30 days
 * or monthly for 6 months, stacked by whose key paid for it.
 */
const AIUsageChart: React.FC<AIUsageChartProps> = ({ surveys, refreshKey }) => {
  const [metric, setMetric] = useState<UsageMetric>('reviews');
  const [period, setPeriod] = useState<UsagePeriod>('30d');
  const [surveyId, setSurveyId] = useState<string>('');
  const [history, setHistory] = useState<AIUsageHistory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAIUsageHistory(metric, period, surveyId || undefined)
      .then((result) => {
        if (!cancelled) {
          setHistory(result);
          setError(null);
        }
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Could not load the chart.'));
    return () => {
      cancelled = true;
    };
  }, [metric, period, surveyId, refreshKey]);

  const data = useMemo(
    () =>
      (history?.buckets ?? []).map((bucket) => ({
        ...bucket,
        label: label(bucket.start, history!.unit),
      })),
    [history]
  );
  const empty = history !== null && history.total_included === 0 && history.total_own === 0;
  const ticks = useMemo(
    () => niceTicks(Math.max(0, ...data.map((d) => d.included + d.own)), metric !== 'minutes'),
    [data, metric]
  );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg bg-gray-100 p-0.5 dark:bg-gray-900" role="group" aria-label="What to show">
          <button type="button" className={segmentButton(metric === 'reviews')} onClick={() => setMetric('reviews')} aria-pressed={metric === 'reviews'}>
            AI reviews
          </button>
          <button type="button" className={segmentButton(metric === 'translations')} onClick={() => setMetric('translations')} aria-pressed={metric === 'translations'}>
            Translations
          </button>
          <button type="button" className={segmentButton(metric === 'minutes')} onClick={() => setMetric('minutes')} aria-pressed={metric === 'minutes'}>
            Transcription minutes
          </button>
        </div>
        <div className="flex gap-2">
          <select
            aria-label="Survey"
            value={surveyId}
            onChange={(e) => setSurveyId(e.target.value)}
            className="h-8 rounded-md border border-gray-300 bg-white px-2 text-xs text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
          >
            <option value="">All your surveys</option>
            {surveys.map((survey) => (
              <option key={survey.survey_id} value={survey.survey_id}>
                {survey.survey_name}
              </option>
            ))}
          </select>
          <select
            aria-label="Period"
            value={period}
            onChange={(e) => setPeriod(e.target.value as UsagePeriod)}
            className="h-8 rounded-md border border-gray-300 bg-white px-2 text-xs text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
          >
            <option value="30d">Last 30 days</option>
            <option value="6m">Last 6 months</option>
          </select>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-4 text-xs text-gray-600 dark:text-gray-400" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: INCLUDED }} />
          Included usage
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: OWN }} />
          Your keys
        </span>
        {history && (
          <span className="ml-auto tabular text-gray-500 dark:text-gray-400">
            {formatValue(history.total_included + history.total_own, metric)} in total
          </span>
        )}
      </div>

      <div className="relative mt-2 h-44">
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {!error && history && (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap={period === '30d' ? 2 : '30%'}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="label" {...axisProps} interval={period === '30d' ? 6 : 0} />
              <YAxis
                {...axisProps}
                ticks={ticks}
                domain={[0, ticks[ticks.length - 1]]}
                width={40}
                tickFormatter={(value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 })}
              />
              <Tooltip
                {...tooltipProps}
                formatter={(value, name) => [
                  formatValue(Number(value), metric),
                  name === 'own' ? 'Your keys' : 'Included usage',
                ]}
              />
              <Bar dataKey="included" stackId="usage" shape={segment('included')} isAnimationActive={false} />
              <Bar dataKey="own" stackId="usage" shape={segment('own')} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        )}
        {!error && empty && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400">
            {{ reviews: 'No AI reviews', translations: 'No translations', minutes: 'No transcription' }[metric]} in this period.
          </p>
        )}
      </div>
    </div>
  );
};

export default AIUsageChart;
