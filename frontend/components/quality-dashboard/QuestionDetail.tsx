import React, { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { QuestionRow } from '../../types';
import { SurveyConfig } from '../../services/progressApi';
import { Term, formatPercent, percentOf } from '../../utils/glossary';
import { checkName } from '../../utils/fieldTeam';
import { daysBefore, shortDay } from '../../utils/daily';
import { answerText, dkSpread, outlierRule, plainNumber as plain } from '../../utils/questions';
import { axisProps, gridProps, tooltipProps, CHART_ACCENT } from '../charts/chartTheme';
import Sparkline, { SparkBar } from '../charts/Sparkline';
import TermInfo from '../ui/TermInfo';

const link = 'rounded font-medium text-indigo-700 hover:underline dark:text-indigo-300';

const VARIETY: Term = {
  name: 'Answer variety',
  definition:
    'How evenly the answers spread over the options: 0% when everyone gives the same answer, 100% when every option is chosen as often (normalised entropy). Very low variety on a question whose answers should differ can mean it is assumed rather than asked.',
};

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
// Amber, as don't-know and "Other": the answers a reader looks for.
const OUTLIER = '#d97706';

const Panel: React.FC<{ title: React.ReactNode; className?: string; children: React.ReactNode }> = ({
  title,
  className = '',
  children,
}) => (
  <div
    className={`min-w-0 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-950 ${className}`}
  >
    <h4 className="mb-2 flex items-center justify-between gap-2 text-xs font-medium text-gray-500 dark:text-gray-400">
      {title}
    </h4>
    {children}
  </div>
);

/**
 * One labelled bar of a breakdown: its share as the bar, its count and share
 * as text. Labels get the room, on up to two lines; the bar shows a share
 * just as well shorter.
 */
const ShareBar: React.FC<{ label: string; count: number; of: number; fill: string }> = ({ label, count, of, fill }) => (
  <li className="grid grid-cols-[minmax(7rem,3fr)_minmax(3rem,2fr)_5.5rem] items-center gap-2 text-xs">
    <span className="line-clamp-2" title={label}>
      {label}
    </span>
    <span className="h-2.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
      <span
        className={`block h-2.5 rounded-full ${fill}`}
        style={{ width: `${Math.min(100, percentOf(count, of) ?? 0)}%` }}
      />
    </span>
    <span className="tabular text-right text-gray-600 dark:text-gray-300">
      {formatPercent(percentOf(count, of))} · {count}
    </span>
  </li>
);

/**
 * A number question's answers as bars over equal bins, the outliers in each
 * in amber on top; the far-out ones said, not drawn.
 */
const NumberHistogram: React.FC<{ histogram: NonNullable<QuestionRow['histogram']> }> = ({ histogram }) => {
  const { start, width, counts, outliers, below, above } = histogram;
  const bins = useMemo(
    () =>
      counts.map((count, i) => {
        const from = start + i * width;
        const outlying = outliers[i] ?? 0;
        return {
          label: compact.format(from),
          range: width === 1 ? plain(from) : `${plain(from)} – ${plain(from + width)}`,
          inside: count - outlying,
          outlying,
        };
      }),
    [start, width, counts, outliers]
  );
  const drawnOutliers = outliers.some((n) => n > 0);
  return (
    <>
      <div style={{ width: '100%', height: 150 }}>
        <ResponsiveContainer>
          <BarChart data={bins} margin={{ top: 4, right: 4, left: -24, bottom: 0 }} barCategoryGap={2}>
            <CartesianGrid {...gridProps} vertical={false} />
            <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={16} />
            <YAxis {...axisProps} allowDecimals={false} />
            <Tooltip
              {...tooltipProps}
              labelFormatter={(_, payload) => payload?.[0]?.payload.range ?? ''}
              formatter={(value, name) => [value, name === 'outlying' ? 'outliers' : 'answers']}
            />
            <Bar dataKey="inside" stackId="answers" fill={CHART_ACCENT} isAnimationActive={false} />
            <Bar dataKey="outlying" stackId="answers" fill={OUTLIER} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {drawnOutliers && (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: OUTLIER }} aria-hidden="true" />
          Outliers
        </p>
      )}
      {(below > 0 || above > 0) && (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Not drawn, too far from the rest to share the scale:{' '}
          {[
            above > 0 && `${above} above ${plain(start + width * counts.length)}`,
            below > 0 && `${below} below ${plain(start)}`,
          ]
            .filter(Boolean)
            .join(', ')}
          .
        </p>
      )}
    </>
  );
};

interface QuestionDetailProps {
  question: QuestionRow;
  config: SurveyConfig | null;
  /** The day the 14 days end on. */
  lastDay: string;
  onOpenFormCheck?: () => void;
  onOpenSubmission?: (submissionId: number) => void;
  onOpenEnumerator?: (enumeratorId: string) => void;
  onOpenSettings?: () => void;
}

/** How many outliers, and by what: the outlier check, or the survey's rule applied here. */
const OutlierCount: React.FC<{ outliers: NonNullable<QuestionRow['outliers']>; answered: number }> = ({
  outliers: o,
  answered,
}) => {
  const share = formatPercent(percentOf(o.count, answered));
  if (o.from_check)
    return o.count === 0 ? (
      <>The outlier check flagged none of its answers.</>
    ) : (
      <>
        The outlier check flagged {o.count} of its answers, {share}.
      </>
    );
  if (o.low === null || o.high === null) return <>No outliers: the answers are too alike to tell.</>;
  const range = `outside ${plain(o.low)} – ${plain(o.high)} (${outlierRule(o.method, o.threshold)})`;
  return o.count === 0 ? (
    <>No outliers by the survey’s rule: none {range}.</>
  ) : (
    <>
      {o.count} outlier{o.count === 1 ? '' : 's'}, {share} of its answers: {range}.
    </>
  );
};

/** Each outlying answer listed, opening its submission. */
const Furthest: React.FC<{
  values: NonNullable<QuestionRow['outliers']>['furthest'];
  onOpenSubmission?: (submissionId: number) => void;
}> = ({ values, onOpenSubmission }) => (
  <>
    {values.map((o, i) => (
      <React.Fragment key={o.submission_id}>
        {i > 0 && ' · '}
        <span className="tabular">{plain(o.value)}</span>{' '}
        {onOpenSubmission ? (
          <button type="button" onClick={() => onOpenSubmission(o.submission_id)} className={link}>
            #{o.submission_id}
          </button>
        ) : (
          `#${o.submission_id}`
        )}
      </React.Fragment>
    ))}
  </>
);

/**
 * What is behind one question's numbers: how its answers spread and, for a
 * number, its outliers; what the checks find on it and when; the latest
 * corrections; and Form check.
 */
const QuestionDetail: React.FC<QuestionDetailProps> = ({
  question: q,
  config,
  lastDay,
  onOpenFormCheck,
  onOpenSubmission,
  onOpenEnumerator,
  onOpenSettings,
}) => {
  const spread = dkSpread(q);
  const multiple = q.type === 'select_multiple';
  const checks = Object.entries(q.flagged_by).sort((a, b) => b[1] - a[1]);
  const days = q.asked_days.length;
  const dayName = (i: number) => shortDay(daysBefore(lastDay, days - 1 - i));
  const flagDays: SparkBar[] = q.asked_days.map((asked, i) => ({
    share: asked ? Math.min(100, percentOf(q.flagged_days[i], asked) ?? 0) : null,
    title: asked ? `${dayName(i)}: ${q.flagged_days[i]} of ${asked} flagged` : `${dayName(i)}: not asked`,
  }));
  const outliers = q.outliers;

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Panel
        className="lg:col-span-2"
        title={
          <>
            <span>Answers{multiple ? ': several can be chosen, so the shares add up to more' : ''}</span>
            {q.variety !== null && (
              <span className="flex items-center gap-1 font-normal">
                {VARIETY.name} <span className="tabular font-medium">{Math.round(q.variety * 100)}%</span>
                <TermInfo term={VARIETY} />
              </span>
            )}
          </>
        }
      >
        {q.choices.length > 0 ? (
          <ul className="space-y-1.5">
            {q.choices.map((c) => (
              <ShareBar
                key={c.name}
                label={c.label}
                count={c.count}
                of={q.answered}
                // Don't-know and "Other" are the options a reader looks for.
                fill={c.kind ? 'bg-amber-600' : 'bg-indigo-500'}
              />
            ))}
          </ul>
        ) : q.histogram ? (
          <NumberHistogram histogram={q.histogram} />
        ) : (
          <p className="text-xs text-gray-500">
            {q.answered} {q.type === 'text' ? 'written answers, not charted' : 'answers'}.
          </p>
        )}
        {q.numbers && (
          <p className="tabular mt-2 text-xs text-gray-600 dark:text-gray-300">
            Median {plain(q.numbers.median)} · middle half {plain(q.numbers.p25)} – {plain(q.numbers.p75)}
            {q.dk > 0 && ` · ${q.dk} don’t know, not counted`}
          </p>
        )}
        {outliers && (
          <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
            <OutlierCount outliers={outliers} answered={q.answered} />
            {outliers.furthest.length > 0 && (
              <>
                {' '}
                Furthest: <Furthest values={outliers.furthest} onOpenSubmission={onOpenSubmission} />.
              </>
            )}
            {!outliers.from_check && outliers.count > 0 && (
              <>
                {' '}
                The outlier check doesn’t flag this question for review
                {onOpenSettings ? (
                  <>
                    :{' '}
                    <button type="button" onClick={onOpenSettings} className={link}>
                      add it in Settings
                    </button>
                    .
                  </>
                ) : (
                  '.'
                )}
              </>
            )}
          </p>
        )}
        {q.dk > 0 && (
          <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
            {formatPercent(percentOf(q.dk, q.answered))} don’t know, recorded by {q.dk_enumerators} of{' '}
            {q.answer_enumerators} enumerators.{' '}
            {spread && 'team' in spread && 'Most of the team, so the wording or the translation is a likelier cause.'}
            {spread && 'one' in spread && (
              <>
                Only {spread.one}: worth a word with them.{' '}
                {onOpenEnumerator && (
                  <button type="button" onClick={() => onOpenEnumerator(spread.one)} className={link}>
                    Their call sheet
                  </button>
                )}
              </>
            )}
          </p>
        )}
      </Panel>

      <Panel title="Flags on this question">
        {checks.length > 0 ? (
          <ul className="space-y-1.5">
            {checks.map(([check, count]) => (
              <ShareBar
                key={check}
                label={check.startsWith('outlier_') ? 'Outlier' : checkName(check, config)}
                count={count}
                of={q.asked}
                fill="bg-amber-600"
              />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-gray-500">No check has flagged it.</p>
        )}
        {days > 0 && q.flagged > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">
              Share of the submissions it was asked in that were flagged, last 14 days
            </p>
            <Sparkline
              bars={flagDays}
              label={`${q.flagged_days.reduce((a, b) => a + b, 0)} flagged in the 14 days to ${shortDay(lastDay)}`}
            />
          </div>
        )}
      </Panel>

      {q.corrected > 0 && (
        <Panel title={`Corrected in Kobo, ${q.corrected} submission${q.corrected === 1 ? '' : 's'}`}>
          <ul className="space-y-1 text-xs">
            {q.corrections.map((c, i) => (
              <li key={`${c.submission_id}-${i}`} className="truncate">
                {onOpenSubmission ? (
                  <button type="button" onClick={() => onOpenSubmission(c.submission_id)} className={link}>
                    #{c.submission_id}
                  </button>
                ) : (
                  `#${c.submission_id}`
                )}{' '}
                · {answerText(c.old)} → {answerText(c.new)}
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {q.form_findings.length > 0 && (
        <Panel title="Form check, before collection">
          <ul className="space-y-1 text-xs">
            {q.form_findings.map((f) => (
              <li key={f.check_id}>
                {f.message}
                {f.check_id === 'unreachable_question' && q.answered > 0 && (
                  <span className="text-gray-500 dark:text-gray-400">
                    {' '}
                    — yet it was answered {q.answered} time{q.answered === 1 ? '' : 's'}: the form changed since, or the
                    stored form differs from the one used.
                  </span>
                )}
              </li>
            ))}
          </ul>
          {onOpenFormCheck && (
            <button type="button" onClick={onOpenFormCheck} className={`${link} mt-2 text-xs`}>
              Open Form check
            </button>
          )}
        </Panel>
      )}
    </div>
  );
};

export default QuestionDetail;
