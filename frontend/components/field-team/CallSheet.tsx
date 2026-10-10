import React, { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { EnumeratorSummary, SubmissionSummary } from '../../types';
import { SurveyConfig } from '../../services/progressApi';
import { GLOSSARY, Term, formatPercent, percentOf } from '../../utils/glossary';
import {
  callSummary,
  checkName,
  comparable,
  dateSpan,
  highlightCheck,
  highlightFlagged,
  highlightNotApproved,
  MIN_SUBMISSIONS,
  dailyIssuesPerSubmission,
} from '../../utils/fieldTeam';
import { axisProps, gridProps, tooltipProps, CHART_ACCENT } from '../charts/chartTheme';
import Button from '../ui/Button';
import TermInfo from '../ui/TermInfo';
import { ChevronDownIcon } from '../ui/icons';

/** What a link from the call sheet opens: their submissions, in a tab, maybe for one check. */
export interface CallSheetLink {
  review: 'all' | 'needs_review';
  issue?: string;
}

const Card: React.FC<{ title: string; term?: Term; children: React.ReactNode; className?: string }> = ({
  title,
  term,
  children,
  className = '',
}) => (
  <section
    aria-label={title}
    className={`rounded-xl border border-gray-200 bg-white p-4 shadow-card dark:border-gray-800 dark:bg-gray-950 ${className}`}
  >
    <h3 className="mb-2 flex items-center gap-1 text-sm font-medium text-gray-500 dark:text-gray-400">
      {title}
      {term && <TermInfo term={term} />}
    </h3>
    {children}
  </section>
);

/** Their value against the team's, as two bars on one scale. */
const Compare: React.FC<{ id: string; mine: number; team: number; format: (v: number) => string; hi: boolean }> = ({
  id,
  mine,
  team,
  format,
  hi,
}) => {
  const scale = Math.max(mine, team, 1);
  const bar = (value: number, colour: string) => (
    <span className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
      <span className={`block h-2 rounded-full ${colour}`} style={{ width: `${(value / scale) * 100}%` }} />
    </span>
  );
  return (
    <div className="mt-2 grid grid-cols-[4.5rem_minmax(0,1fr)_3rem] items-center gap-x-2 gap-y-1.5 text-xs text-gray-600 dark:text-gray-300">
      <span className="truncate">{id}</span>
      {bar(mine, hi ? 'bg-amber-600' : 'bg-indigo-500')}
      <span className="tabular text-right">{format(mine)}</span>
      <span>Team</span>
      {bar(team, 'bg-gray-400')}
      <span className="tabular text-right">{format(team)}</span>
    </div>
  );
};

/** Their interviews as dots, over the team's middle half and median. */
const DurationStrip: React.FC<{ enumerator: EnumeratorSummary; team: SubmissionSummary }> = ({ enumerator, team }) => {
  const top = Math.max(15, ...enumerator.durations, team.duration_p75 ?? 0);
  // Ticks on round minutes: every 15 up to an hour and a half, then every 30, 60…
  const step = [15, 30, 60, 120, 240].find((s) => top / s <= 6) ?? 480;
  const max = Math.ceil(top / step) * step;
  const at = (minutes: number) => `${Math.min(100, Math.max(0, (minutes / max) * 100))}%`;
  const ticks = Array.from({ length: max / step + 1 }, (_, i) => i * step);
  return (
    <div className="mt-3" role="img" aria-label={`${enumerator.id}’s interviews against the team’s middle half`}>
      <div className="relative h-7">
        <span className="absolute inset-x-0 top-3 h-0.5 bg-gray-200 dark:bg-gray-700" />
        {team.duration_p25 !== null && team.duration_p75 !== null && (
          <span
            className="absolute top-1.5 h-4 rounded bg-gray-200 dark:bg-gray-700"
            style={{ left: at(team.duration_p25), width: `calc(${at(team.duration_p75)} - ${at(team.duration_p25)})` }}
          />
        )}
        {team.duration_minutes !== null && (
          <span
            className="absolute top-0.5 h-6 w-0.5 bg-gray-600 dark:bg-gray-300"
            style={{ left: at(team.duration_minutes) }}
          />
        )}
        {enumerator.durations.map((minutes, index) => (
          <span
            key={index}
            className="absolute top-2 h-3 w-3 -translate-x-1/2 rounded-full bg-amber-600/70"
            style={{ left: at(minutes) }}
          />
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-gray-500 dark:text-gray-400">
        {ticks.map((t, i) => (
          <span key={i}>{i === ticks.length - 1 ? `${t} min` : t}</span>
        ))}
      </div>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        Dots: their interviews. Grey: the team’s middle half; the line, its median.
      </p>
    </div>
  );
};

interface CallSheetProps {
  enumerator: EnumeratorSummary;
  team: SubmissionSummary;
  config: SurveyConfig | null;
  onClose: () => void;
  onOpenSubmissions?: (link: CallSheetLink) => void;
}

/**
 * One enumerator, for the call: what differs from the team, the checks that
 * flagged them, how far review of their work has got, the trend, and a
 * summary to read out or send. Not approved comes first: a reviewer turned
 * those down.
 */
const CallSheet: React.FC<CallSheetProps> = ({ enumerator: row, team, config, onClose, onOpenSubmissions }) => {
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);
  const summary = useMemo(() => callSummary(row, team, config), [row, team, config]);
  const days = useMemo(
    () =>
      dailyIssuesPerSubmission(row.daily).map((d) => ({
        label: new Date(d.day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
        value: d.value,
      })),
    [row]
  );
  const checks = Object.entries(row.checks).sort((a, b) => b[1] - a[1]);
  const span = dateSpan(row);
  const last = row.last_submission
    ? new Date(row.last_submission).toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summary);
      setCopied('yes');
    } catch {
      setCopied('failed');
    }
  };

  const reviewParts: { term: Term; count: number; colour: string }[] = [
    { term: GLOSSARY.needsReview, count: row.needs_review, colour: 'bg-amber-600' },
    { term: GLOSSARY.onHold, count: row.on_hold, colour: 'bg-amber-300' },
    { term: GLOSSARY.clean, count: row.clean, colour: 'bg-gray-300 dark:bg-gray-600' },
    { term: GLOSSARY.approved, count: row.approved, colour: 'bg-emerald-600' },
    { term: GLOSSARY.notApproved, count: row.not_approved, colour: 'bg-rose-700' },
  ];

  return (
    <article aria-label={`Call sheet: ${row.id}`} className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1 rounded text-sm font-medium text-indigo-700 hover:underline dark:text-indigo-300"
        >
          <ChevronDownIcon className="h-4 w-4 rotate-90" />
          Field team
        </button>
        <h2 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-white">{row.id}</h2>
        <span className="text-sm text-gray-600 dark:text-gray-400">
          {row.submissions} submissions{span ? `, ${span}` : ''}
          {last ? ` · last on ${last}` : ''}
        </span>
        <span className="flex-1" />
        {onOpenSubmissions && row.needs_review > 0 && (
          <Button variant="primary" onClick={() => onOpenSubmissions({ review: 'needs_review' })}>
            Open {GLOSSARY.needsReview.name} {row.needs_review}
          </Button>
        )}
        {onOpenSubmissions && (
          <Button variant="secondary" onClick={() => onOpenSubmissions({ review: 'all' })}>
            All {row.submissions} submissions
          </Button>
        )}
      </header>

      {!comparable(row) && (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Under {MIN_SUBMISSIONS} submissions: too few to compare with the team, so nothing is highlighted.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
        <Card title={GLOSSARY.notApproved.name} term={GLOSSARY.notApproved}>
          <p className="tabular text-2xl font-semibold text-gray-900 dark:text-white">
            {row.not_approved} <span className="text-sm font-normal text-gray-500">of {row.submissions}</span>
          </p>
          <Compare
            id={row.id}
            mine={percentOf(row.not_approved, row.submissions) ?? 0}
            team={percentOf(team.not_approved, team.submissions) ?? 0}
            format={(v) => `${v}%`}
            hi={highlightNotApproved(row, team)}
          />
        </Card>
        <Card title={GLOSSARY.flagged.name} term={GLOSSARY.flagged}>
          <p className="tabular text-2xl font-semibold text-gray-900 dark:text-white">
            {row.flagged} <span className="text-sm font-normal text-gray-500">of {row.submissions}</span>
          </p>
          <Compare
            id={row.id}
            mine={percentOf(row.flagged, row.submissions) ?? 0}
            team={percentOf(team.flagged, team.submissions) ?? 0}
            format={(v) => `${v}%`}
            hi={highlightFlagged(row, team)}
          />
        </Card>
        <Card title={GLOSSARY.duration.name} term={GLOSSARY.duration}>
          {row.duration_minutes === null ? (
            <p className="text-sm text-gray-500">Not measured: no audit log, and no start and end times.</p>
          ) : (
            <>
              <p className="tabular text-2xl font-semibold text-gray-900 dark:text-white">
                {Math.round(row.duration_minutes)} min{' '}
                <span className="text-sm font-normal text-gray-500">
                  median{team.duration_minutes !== null ? ` · team ${Math.round(team.duration_minutes)} min` : ''}
                </span>
              </p>
              <DurationStrip enumerator={row} team={team} />
            </>
          )}
        </Card>
        <Card title={GLOSSARY.dkRate.name} term={GLOSSARY.dkRate}>
          {row.dk_rate === null ? (
            <p className="text-sm text-gray-500">Not measured: no don’t-know codes, or no answers yet.</p>
          ) : (
            <>
              <p className="tabular text-2xl font-semibold text-gray-900 dark:text-white">{row.dk_rate}%</p>
              <Compare id={row.id} mine={row.dk_rate} team={team.dk_rate ?? 0} format={(v) => `${v}%`} hi={false} />
            </>
          )}
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Checks that flagged them">
          {checks.length === 0 ? (
            <p className="text-sm text-gray-500">No check flagged any of their submissions.</p>
          ) : (
            // Their share against the team's, under headings that say whose is whose.
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 dark:text-gray-400">
                  <th scope="col" className="pb-1.5 font-medium">
                    Check
                  </th>
                  <th scope="col" className="pb-1.5 pl-3 text-right font-medium">
                    {row.id}
                  </th>
                  <th scope="col" className="pb-1.5 pl-3 text-right font-medium">
                    Team
                  </th>
                  <th scope="col" className="pb-1.5 pl-3">
                    <span className="sr-only">Their submissions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {checks.map(([check, count]) => {
                  const hi = highlightCheck(row, team, check);
                  return (
                    <tr key={check}>
                      <td
                        className={`py-2 ${hi ? 'font-semibold text-amber-800 dark:text-amber-300' : 'text-gray-700 dark:text-gray-300'}`}
                      >
                        {checkName(check, config)}
                      </td>
                      <td className="tabular whitespace-nowrap py-2 pl-3 text-right text-gray-900 dark:text-white">
                        {formatPercent(percentOf(count, row.submissions))}{' '}
                        <span className="text-xs text-gray-500 dark:text-gray-400">({count})</span>
                      </td>
                      <td className="tabular whitespace-nowrap py-2 pl-3 text-right text-gray-600 dark:text-gray-400">
                        {formatPercent(percentOf(team.checks[check] ?? 0, team.submissions))}
                      </td>
                      <td className="whitespace-nowrap py-2 pl-3 text-right">
                        {onOpenSubmissions && (
                          <button
                            type="button"
                            onClick={() => onOpenSubmissions({ review: 'all', issue: check })}
                            className="rounded text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-300"
                          >
                            See them
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>

        <div className="flex flex-col gap-3">
          <Card title="Their submissions in review" term={GLOSSARY.reviewed}>
            <div
              className="flex h-3 gap-0.5 overflow-hidden rounded-full"
              role="img"
              aria-label={reviewParts.map((p) => `${p.term.name} ${p.count}`).join(', ')}
            >
              {reviewParts
                .filter((p) => p.count > 0)
                .map((p) => (
                  <span key={p.term.name} className={p.colour} style={{ flex: `${p.count} 1 0` }} />
                ))}
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-700 dark:text-gray-300">
              {reviewParts.map((p) => (
                <li key={p.term.name} className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-sm ${p.colour}`} aria-hidden="true" />
                  {p.term.name} {p.count}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">How far review has got, not quality.</p>
          </Card>

          <Card title={`${GLOSSARY.issuesPerSubmission.name}, by day`} term={GLOSSARY.issuesPerSubmission}>
            {days.length === 0 ? (
              <p className="text-sm text-gray-500">No submissions in this period.</p>
            ) : (
              <>
                <div style={{ width: '100%', height: 180 }}>
                  <ResponsiveContainer>
                    <BarChart data={days} margin={{ top: 5, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid {...gridProps} vertical={false} />
                      <XAxis dataKey="label" {...axisProps} />
                      <YAxis {...axisProps} allowDecimals />
                      <Tooltip {...tooltipProps} formatter={(value) => [value, row.id]} />
                      <Bar dataKey="value" fill="#d97706" radius={[3, 3, 0, 0]} maxBarSize={28} />
                      {team.issues_per_submission !== null && (
                        <ReferenceLine
                          y={team.issues_per_submission}
                          stroke={CHART_ACCENT}
                          strokeWidth={1.5}
                          strokeDasharray="4 4"
                        />
                      )}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Each day they collected. Dashed: the team’s {team.issues_per_submission ?? 0} for the whole period.
                </p>
              </>
            )}
          </Card>
        </div>
      </div>

      <Card title="Summary to read on the call or send">
        <p className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm leading-relaxed text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
          {summary}
        </p>
        <div className="mt-2 flex items-center gap-3">
          <Button variant="secondary" onClick={copy}>
            Copy
          </Button>
          <span role="status" className="text-xs text-gray-600 dark:text-gray-400">
            {copied === 'yes' ? 'Copied' : copied === 'failed' ? 'Couldn’t copy: select the text instead' : ''}
          </span>
        </div>
      </Card>
    </article>
  );
};

export default CallSheet;
