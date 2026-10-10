import React from 'react';
import { ProgressData } from '../../types';
import { GLOSSARY } from '../../utils/glossary';
import { shortDay } from '../../utils/daily';
import { daysAtPace, pacePerDay, toGo } from '../../utils/progress';
import { Card } from '../ui/Card';
import TermInfo from '../ui/TermInfo';

// Approved keeps its colour from the review bar; the rest of what is done is
// the chart's indigo. The pair passes the dataviz palette checks in both modes.
const APPROVED_FILL = 'bg-emerald-600';
const NOT_DECIDED_FILL = 'bg-indigo-500';
const TO_GO_FILL = 'bg-gray-100 dark:bg-gray-800';

const NOT_DECIDED = 'Not decided yet';

/** Done against the target: the Approved part, the rest not decided yet, and what is left. */
export const TwoPartBar: React.FC<{
  approved: number;
  done: number;
  target: number | null;
  className?: string;
}> = ({ approved, done, target, className = 'h-3' }) => {
  const whole = Math.max(target ?? done, done, 1);
  const parts = [
    { key: 'approved', width: approved, fill: APPROVED_FILL },
    { key: 'not-decided', width: done - approved, fill: NOT_DECIDED_FILL },
  ].filter((p) => p.width > 0);
  return (
    <div className={`flex gap-0.5 overflow-hidden rounded-full ${TO_GO_FILL} ${className}`} aria-hidden="true">
      {parts.map((p) => (
        <span key={p.key} className={p.fill} style={{ width: `${(p.width / whole) * 100}%` }} />
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
 * Will we reach the sample? Done against the target, the Approved part of it,
 * what is left out, and the pace over the last 7 days.
 */
const ProgressSummary: React.FC<ProgressSummaryProps> = ({ data, onOpenSettings }) => {
  const { overall } = data;
  const done = overall.conducted;
  const target = overall.target;
  const left = toGo(target, done);
  const perDay = pacePerDay(overall.last_7_days);
  const days = left ? daysAtPace(left, perDay) : null;
  const first = data.daily[0]?.day;

  const atPace =
    left === 0
      ? { value: 'Target reached', label: done > target! ? `${done - target!} over the target` : 'every one done' }
      : perDay === 0
        ? { value: '—', label: 'no recent pace to go by' }
        : days === null
          ? { value: 'Over 2 months', label: 'at this pace' }
          : { value: `About ${days} day${days === 1 ? '' : 's'}`, label: 'at this pace' };

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <p className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-white">
            {target === null ? `${done} done` : `${done} of ${target} done`}
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
        </div>
        {overall.progress !== null && (
          <p className="text-4xl font-semibold tracking-tight text-gray-900 dark:text-white">
            {Math.round(overall.progress)}%
          </p>
        )}
      </div>

      <TwoPartBar approved={overall.approved} done={done} target={target} className="mt-4 h-3" />
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-300">
        <Swatch fill={APPROVED_FILL}>
          {GLOSSARY.approved.name} {overall.approved}
        </Swatch>
        <Swatch fill={NOT_DECIDED_FILL}>
          {NOT_DECIDED} {done - overall.approved}
        </Swatch>
        {left !== null && left > 0 && (
          <Swatch fill={`${TO_GO_FILL} ring-1 ring-inset ring-gray-300`}>To go {left}</Swatch>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 divide-gray-100 border-t border-gray-100 sm:grid-cols-4 sm:divide-x dark:divide-gray-800 dark:border-gray-800">
        {left !== null && <Stat value={String(left)} label="to go" />}
        <Stat
          value={perDay > 0 ? `${perDay} a day` : 'None'}
          label={perDay > 0 ? 'over the last 7 days' : 'in the last 7 days'}
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
