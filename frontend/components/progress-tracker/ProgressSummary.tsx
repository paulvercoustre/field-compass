import React from 'react';
import { ProgressData, ReviewSplit } from '../../types';
import { GLOSSARY } from '../../utils/glossary';
import { shortDay } from '../../utils/daily';
import { daysAtPace, pacePerDay, toGo } from '../../utils/progress';
import { ReviewPart, reviewParts } from '../metrics/ReviewBar';
import { Card } from '../ui/Card';
import TermInfo from '../ui/TermInfo';

/**
 * What is done, by where it stands in review, in the words and colours the
 * review bar uses everywhere else: the most settled first, as they fill a
 * target. Not approved never counts, so it has no part here.
 */
export const progressParts = (split: ReviewSplit): ReviewPart[] =>
  reviewParts({ ...split, not_approved: 0 })
    .filter((p) => p.key !== 'not_approved')
    .reverse();

/** Done against the target, part by part; the rest of the track is what is left. */
export const PlanBar: React.FC<{ parts: ReviewPart[]; target: number | null; className?: string }> = ({
  parts,
  target,
  className = 'h-3',
}) => {
  const done = parts.reduce((n, p) => n + p.count, 0);
  const whole = Math.max(target ?? done, done, 1);
  return (
    <div
      className={`flex gap-0.5 overflow-hidden rounded-full bg-white ring-1 ring-inset ring-gray-200 dark:bg-gray-950 dark:ring-gray-700 ${className}`}
      aria-hidden="true"
    >
      {parts
        .filter((p) => p.count > 0)
        .map((p) => (
          <span key={p.key} className={p.colour} style={{ width: `${(p.count / whole) * 100}%` }} />
        ))}
    </div>
  );
};

const Swatch: React.FC<{ fill: string; children: React.ReactNode }> = ({ fill, children }) => (
  <span className="flex items-center gap-1.5">
    <span className={`h-2.5 w-2.5 rounded-sm ${fill}`} aria-hidden="true" />
    {children}
  </span>
);

const Stat: React.FC<{ value: string; label: string }> = ({ value, label }) => (
  <div className="min-w-0 py-3 pr-4 sm:px-4 sm:first:pl-0">
    <div className="text-lg font-semibold text-gray-900 dark:text-white">{value}</div>
    <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
  </div>
);

interface ProgressSummaryProps {
  data: ProgressData;
  onOpenSettings?: () => void;
}

/**
 * Will we reach the sample? Done toward the targets as the sampling plan
 * counts it, each group up to its own target; where it stands in review;
 * what is left out; and the pace over the last 7 days.
 */
const ProgressSummary: React.FC<ProgressSummaryProps> = ({ data, onOpenSettings }) => {
  const { overall } = data;
  const target = overall.target;
  const done = overall.toward_target ?? overall.conducted;
  const left = toGo(target, done);
  const perDay = pacePerDay(overall.last_7_days);
  const days = left ? daysAtPace(left, perDay) : null;
  const first = data.daily[0]?.day;
  const parts = progressParts(overall);
  const group = data.samplingColumns.length === 1 ? data.samplingColumns[0] : 'group';
  const beyond = overall.over_target + overall.no_target;

  const atPace =
    left === 0
      ? { value: 'Target reached', label: 'nothing left to go' }
      : perDay === 0
        ? { value: '—', label: 'no recent pace to go by' }
        : days === null
          ? { value: 'Over 2 months', label: 'at this pace' }
          : { value: `About ${days} day${days === 1 ? '' : 's'}`, label: 'at this pace' };

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-2xl font-semibold tracking-tight text-gray-900 dark:text-white">
            {target === null ? `${done} done` : `${done} of ${target} done`}
            <TermInfo term={GLOSSARY.done} />
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-1 text-sm text-gray-600 dark:text-gray-300">
            {overall.approved} of them {GLOSSARY.approved.name.toLowerCase()}
            {data.not_approved > 0 && (
              <>
                <span aria-hidden="true">·</span>
                {data.not_approved} {GLOSSARY.notApproved.name}, not counted
                <TermInfo term={GLOSSARY.notApproved} />
              </>
            )}
          </p>
          {target !== null && beyond > 0 && (
            <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-300">
              {beyond} more {beyond === 1 ? 'doesn’t' : 'don’t'} count toward a target:{' '}
              {[
                overall.no_target > 0 && `${overall.no_target} in a ${group} with no target`,
                overall.over_target > 0 &&
                  `${overall.over_target} beyond ${group === 'group' ? 'their group' : `their ${group}`}’s target`,
              ]
                .filter(Boolean)
                .join(', ')}
              .
            </p>
          )}
        </div>
        {overall.progress !== null && (
          <p className="text-4xl font-semibold tracking-tight text-gray-900 dark:text-white">
            {Math.round(overall.progress)}%
          </p>
        )}
      </div>

      <PlanBar parts={parts} target={target} className="mt-4 h-3" />
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-300">
        {parts.map((p) => (
          <Swatch key={p.key} fill={p.colour}>
            {p.term.name} {p.count}
          </Swatch>
        ))}
        {left !== null && left > 0 && (
          <Swatch fill="bg-white ring-1 ring-inset ring-gray-300 dark:bg-gray-950 dark:ring-gray-600">
            To go {left}
          </Swatch>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 divide-gray-100 border-t border-gray-100 sm:grid-cols-4 sm:divide-x dark:divide-gray-800 dark:border-gray-800">
        {left !== null && <Stat value={String(left)} label="to go" />}
        <Stat
          value={perDay > 0 ? `${perDay} a day` : 'None'}
          label={
            perDay > 0
              ? target === null
                ? 'over the last 7 days'
                : 'toward the targets, last 7 days'
              : 'in the last 7 days'
          }
        />
        {left !== null ? (
          <Stat value={atPace.value} label={atPace.label} />
        ) : (
          <Stat value={`${overall.submissions_per_day ?? 0} a day`} label="on average, since the start" />
        )}
        <Stat
          value={`${overall.days_active} day${overall.days_active === 1 ? '' : 's'}`}
          label={first ? `collecting so far, since ${shortDay(first)}` : 'collecting so far'}
        />
      </div>

      {target === null && (
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
          No collection targets set, so this shows what has been collected.{' '}
          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="font-medium text-indigo-700 hover:underline dark:text-indigo-300"
            >
              Add targets
            </button>
          )}
        </p>
      )}
    </Card>
  );
};

export default ProgressSummary;
