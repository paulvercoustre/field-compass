import React, { useMemo } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { QuestionAttention, QuestionRow } from '../../types';
import { SurveyConfig } from '../../services/progressApi';
import { Term, formatPercent, percentOf } from '../../utils/glossary';
import { daysBefore, shortDay } from '../../utils/daily';
import { answerText, flagName, plainNumber as plain, secondsText, shareText } from '../../utils/questions';
import { axisProps, tooltipProps, CHART_ACCENT } from '../charts/chartTheme';
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

/** One part of the panel, under a small heading with a note on its right. */
const Section: React.FC<{ title: string; note?: string; children: React.ReactNode }> = ({ title, note, children }) => (
  <section className="space-y-2.5 px-4 py-3.5">
    <h4 className="flex items-baseline justify-between gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
      {title}
      {note && <span className="font-normal normal-case tracking-normal">{note}</span>}
    </h4>
    {children}
  </section>
);

/**
 * One labelled bar of a breakdown: its share as the bar, its count and share
 * as text. Labels get the room, on up to two lines; the bar shows a share
 * just as well shorter.
 */
const ShareBar: React.FC<{ label: string; count: number; of: number; fill: string; onOpen?: () => void }> = ({
  label,
  count,
  of,
  fill,
  onOpen,
}) => (
  <li className="grid grid-cols-[minmax(7rem,3fr)_minmax(3rem,2fr)_5.5rem] items-center gap-2 text-xs">
    {onOpen ? (
      <button type="button" onClick={onOpen} className={`${link} line-clamp-2 text-left`} title="See these submissions">
        {label}
      </button>
    ) : (
      <span className="line-clamp-2" title={label}>
        {label}
      </span>
    )}
    <span className="h-2.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
      <span
        className={`block h-2.5 rounded-full ${fill}`}
        style={{ width: `${Math.min(100, percentOf(count, of) ?? 0)}%` }}
      />
    </span>
    <span className="tabular text-right text-gray-600 dark:text-gray-300">
      {shareText(count, of)} · {count}
    </span>
  </li>
);

/**
 * A number question's answers as bars over equal bins, those the outlier
 * check flagged in amber on top; the far-out ones said, not drawn. No grid:
 * the bars' heights against each other are the point.
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
    <div>
      <div style={{ width: '100%', height: 140 }}>
        <ResponsiveContainer>
          <BarChart data={bins} margin={{ top: 4, right: 4, left: -24, bottom: 0 }} barCategoryGap={2}>
            <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={16} />
            <YAxis {...axisProps} allowDecimals={false} />
            <Tooltip
              {...tooltipProps}
              labelFormatter={(_, payload) => payload?.[0]?.payload.range ?? ''}
              formatter={(value, name) => [value, name === 'outlying' ? 'flagged as outliers' : 'answers']}
            />
            <Bar dataKey="inside" stackId="answers" fill={CHART_ACCENT} isAnimationActive={false} />
            <Bar dataKey="outlying" stackId="answers" fill={OUTLIER} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {drawnOutliers && (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: OUTLIER }} aria-hidden="true" />
          Flagged as outliers
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
    </div>
  );
};

/** A figure over its caption, amber when it is why the question stands out. */
const Stat: React.FC<{ value: string; caption: string; strong?: boolean }> = ({ value, caption, strong }) => (
  <div className="flex flex-col gap-0.5 text-[11px] text-gray-500 dark:text-gray-400">
    <span
      className={`tabular text-base font-semibold ${strong ? 'text-amber-700 dark:text-amber-400' : 'text-gray-900 dark:text-white'}`}
    >
      {value}
    </span>
    {caption}
  </div>
);

interface QuestionDetailProps {
  question: QuestionRow;
  /** The submissions in view: Asked in is a share of them. */
  total: number;
  /** Of those, the ones with an audit log. */
  timedSubmissions: number;
  config: SurveyConfig | null;
  /** The day the 14 days end on. */
  lastDay: string;
  onOpenFormCheck?: () => void;
  onOpenSubmission?: (submissionId: number) => void;
  onOpenSettings?: () => void;
  onOpenCheck?: (check: string) => void;
}

/**
 * The side panel: what is behind one question's numbers. How its answers
 * spread; what the checks find on it, each opening its submissions; how long
 * it takes; and Form check. Facts only: what to make of them is the reader's.
 */
const QuestionDetail: React.FC<QuestionDetailProps> = ({
  question: q,
  total,
  timedSubmissions,
  config,
  lastDay,
  onOpenFormCheck,
  onOpenSubmission,
  onOpenSettings,
  onOpenCheck,
}) => {
  const multiple = q.type === 'select_multiple';
  const checks = Object.entries(q.flagged_by).sort((a, b) => b[1] - a[1]);
  const days = q.asked_days.length;
  const dayName = (i: number) => shortDay(daysBefore(lastDay, days - 1 - i));
  const flagDays: SparkBar[] = q.asked_days.map((asked, i) => ({
    share: asked ? Math.min(100, percentOf(q.flagged_days[i], asked) ?? 0) : null,
    title: asked ? `${dayName(i)}: ${q.flagged_days[i]} of ${asked} flagged` : `${dayName(i)}: not asked`,
  }));
  const time = q.time;
  const has = (reason: QuestionAttention) => q.attention.includes(reason);

  return (
    <div className="divide-y divide-gray-100 text-gray-700 dark:divide-gray-800 dark:text-gray-300">
      <header className="space-y-1 px-4 py-3.5">
        <h3 className="text-[15px] font-semibold leading-snug text-gray-900 dark:text-white">{q.label}</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {q.name}
          {q.group && ` · ${q.group}`}
        </p>
        <p className="text-xs text-gray-600 dark:text-gray-300">
          {has('never_shown')
            ? 'Can never be shown, Form check says'
            : `Asked in ${shareText(q.asked, total)} of submissions`}
          {q.asked_from_answers
            ? ': answered in; its condition can’t be worked out'
            : q.condition
              ? `, if ${q.condition}`
              : ', of everyone'}
        </p>
      </header>

      <Section
        title={multiple ? 'Answers: several can be chosen' : 'Answers'}
        note={`${q.answered} answer${q.answered === 1 ? '' : 's'}`}
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
          <p className="text-xs text-gray-500">{q.type === 'text' ? 'Written answers, not charted.' : 'No chart.'}</p>
        )}
        {q.variety !== null && (
          <p className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300">
            {VARIETY.name} <span className="tabular font-medium">{Math.round(q.variety * 100)}%</span>
            <TermInfo term={VARIETY} />
          </p>
        )}
        {q.numbers && (
          <p className="tabular text-xs text-gray-600 dark:text-gray-300">
            Median {plain(q.numbers.median)}
            {q.dk > 0 && ` · ${q.dk} don’t know, not counted`}
          </p>
        )}
        {q.dk > 0 && (
          <p className="text-xs text-gray-600 dark:text-gray-300">
            {formatPercent(percentOf(q.dk, q.answered))} don’t know, recorded by {q.dk_enumerators} of{' '}
            {q.answer_enumerators} enumerators.
          </p>
        )}
      </Section>

      <Section title="Checks" note={`of the ${q.asked} it was asked in`}>
        {checks.length > 0 ? (
          <ul className="space-y-1.5">
            {checks.map(([check, count]) => (
              <ShareBar
                key={check}
                label={flagName(check, config)}
                count={count}
                of={q.asked}
                fill="bg-amber-600"
                onOpen={onOpenCheck && (() => onOpenCheck(check))}
              />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-gray-500">No check has flagged it.</p>
        )}
        {(q.type === 'integer' || q.type === 'decimal') && !q.outlier_check && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            The outlier check is off for this question.
            {onOpenSettings && (
              <>
                {' '}
                <button type="button" onClick={onOpenSettings} className={link}>
                  Turn it on in Settings
                </button>
              </>
            )}
          </p>
        )}
        {days > 0 && q.flagged > 0 && (
          <div>
            <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">
              Share of the submissions it was asked in that were flagged, last 14 days
            </p>
            <Sparkline
              bars={flagDays}
              label={`${q.flagged_days.reduce((a, b) => a + b, 0)} flagged in the 14 days to ${shortDay(lastDay)}`}
            />
          </div>
        )}
        {q.corrected > 0 && (
          <div className="text-xs">
            <p className="mb-1 text-gray-500 dark:text-gray-400">
              Corrected in Kobo, {q.corrected} submission{q.corrected === 1 ? '' : 's'}
            </p>
            <ul className="space-y-1">
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
          </div>
        )}
      </Section>

      <Section title="Time" note={time ? `from ${time.timed} audit log${time.timed === 1 ? '' : 's'}` : undefined}>
        {time ? (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Stat
                value={secondsText(time.median_seconds)}
                caption={time.screen_with ? 'median, the screen' : 'median'}
              />
              <Stat
                value={time.pace !== null ? `${plain(time.pace)}×` : '—'}
                caption={
                  time.screen_with
                    ? 'pace: shared screen'
                    : time.pace === null
                      ? 'pace: too little to judge'
                      : 'the form’s pace'
                }
                strong={has('slow')}
              />
              <Stat
                value={shareText(time.rushed, time.timed)}
                caption={`rushed, under ${plain(time.rushed_under)} s`}
                strong={has('rushed')}
              />
            </div>
            {time.screen_with > 0 && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                On one screen with {time.screen_with} other question{time.screen_with === 1 ? '' : 's'}: these are the
                screen’s times.
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {timedSubmissions === 0
              ? 'Not measured: no audit logs. Time comes from the Kobo audit log.'
              : 'No time recorded for it.'}
          </p>
        )}
      </Section>

      {q.form_findings.length > 0 && (
        <Section title="Form check">
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
            <button type="button" onClick={onOpenFormCheck} className={`${link} text-xs`}>
              Open Form check
            </button>
          )}
        </Section>
      )}
    </div>
  );
};

export default QuestionDetail;
