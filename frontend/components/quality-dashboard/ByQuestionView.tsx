import React, { useEffect, useMemo, useState } from 'react';
import { QuestionAttention, QuestionRow, QuestionsResponse } from '../../types';
import { SurveyConfig } from '../../services/progressApi';
import { Term } from '../../utils/glossary';
import {
  LENSES,
  Lens,
  flagName,
  lensCount,
  lensRows,
  plainNumber,
  secondsText,
  shareText,
  signals,
} from '../../utils/questions';
import QuestionDetail from './QuestionDetail';
import Dialog from '../ui/Dialog';
import TableFrame, { STICKY_HEAD } from '../ui/TableFrame';
import TermInfo from '../ui/TermInfo';

const link = 'rounded font-medium text-indigo-700 hover:underline dark:text-indigo-300';

const PACE: Term = {
  name: 'Pace',
  definition:
    'Seconds per word of the question as written in the survey’s language, against the form’s usual: 2× is twice as slow, so likely hard to ask; under 0.5× is fast for its length.',
};

/** A figure, highlighted when it is why the question is worth a look. */
const Figure: React.FC<{ on: boolean; children: React.ReactNode }> = ({ on, children }) =>
  on ? (
    <span className="rounded-md bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
      {children}
    </span>
  ) : (
    <span className="tabular">{children}</span>
  );

const Sub: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{children}</div>
);

const None: React.FC<{ title: string }> = ({ title }) => (
  <span className="text-gray-400" title={title}>
    —
  </span>
);

const Highlighted = () => (
  <span className="rounded bg-amber-100 px-1.5 font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
    Highlighted
  </span>
);

/** Answers by time as tiny bars, the rushed part of each in amber. */
const TimeStrip: React.FC<{ time: NonNullable<QuestionRow['time']> }> = ({ time }) => {
  const max = Math.max(1, ...time.bins);
  const bar = 90 / time.bins.length;
  return (
    <svg width={90} height={22} role="img" aria-label={`${time.timed} answers by time, ${time.rushed} rushed`}>
      {time.bins.map((count, i) => {
        const height = (count / max) * 22;
        const rushed = (time.rushed_bins[i] / max) * 22;
        return (
          <g key={i}>
            <rect
              x={i * bar}
              y={22 - height}
              width={bar - 1}
              height={height}
              className="fill-indigo-200 dark:fill-indigo-800"
            />
            <rect x={i * bar} y={22 - rushed} width={bar - 1} height={rushed} fill="#d97706" />
          </g>
        );
      })}
    </svg>
  );
};

/** Wide enough for the panel beside the list; else a question opens in a sheet. */
const useWide = (): boolean => {
  const query = '(min-width: 1024px)';
  const [wide, setWide] = useState(() => !window.matchMedia || window.matchMedia(query).matches);
  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia(query);
    const update = () => setWide(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return wide;
};

const HEADINGS: Record<Lens, string[]> = {
  look: ['Question', 'What stands out'],
  all: ['Question', 'What stands out'],
  dk: ['Question', 'Don’t-know', '“Other”', 'Answer variety'],
  checks: ['Question', 'Flagged', 'Corrected'],
  time: ['Question', 'Rushed', 'Pace', 'Median time', 'Answers, by time'],
  reach: ['Question', 'Asked in', 'When'],
};

interface ByQuestionViewProps {
  data: QuestionsResponse;
  config: SurveyConfig | null;
  /** All time, or a shorter period: how the opening line reads. */
  allTime: boolean;
  onOpenFormCheck?: () => void;
  onOpenSubmission?: (submissionId: number) => void;
  /** Settings › Quality checks, where the outlier check is set. */
  onOpenSettings?: () => void;
  /** Submissions, filtered to those a check flagged. */
  onOpenCheck?: (check: string) => void;
}

/**
 * Data quality by question (W6 E2 and E3). Worth a look says in words what
 * stands out about each question, those with the most don't-know, flagged or
 * rushed answers first; a lens per kind of signal compares questions on it.
 * A question opens in the side panel, or a sheet on a phone. The questions that specify an "Other"
 * are left out until asked for: rarely asked by design, and their choice
 * question's "Other" share covers them.
 */
const ByQuestionView: React.FC<ByQuestionViewProps> = ({
  data,
  config,
  allTime,
  onOpenFormCheck,
  onOpenSubmission,
  onOpenSettings,
  onOpenCheck,
}) => {
  const wide = useWide();
  const [lens, setLens] = useState<Lens>('look');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [withSpecify, setWithSpecify] = useState(false);
  const total = data.submissions;
  const specifying = data.questions.filter((q) => q.specifies).length;
  const listed = useMemo(
    () => (withSpecify ? data.questions : data.questions.filter((q) => !q.specifies)),
    [data.questions, withSpecify]
  );
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return lensRows(lens, listed, total, config).filter(
      (q) => !needle || `${q.label} ${q.name} ${q.group}`.toLowerCase().includes(needle)
    );
  }, [lens, listed, total, config, search]);
  // Beside the list, a question is always open: the one picked, else the first.
  const open = wide ? (rows.find((q) => q.name === picked) ?? rows[0])?.name : picked;
  const openRow = rows.find((q) => q.name === open);

  if (data.form_missing) {
    return (
      <p className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300">
        No form is stored for this survey, so there are no questions to show. Link its Kobo form in Settings.
      </p>
    );
  }

  const detail = (q: QuestionRow) => (
    <QuestionDetail
      question={q}
      total={total}
      timedSubmissions={data.timed_submissions}
      config={config}
      lastDay={data.last_day}
      onOpenFormCheck={onOpenFormCheck}
      onOpenSubmission={onOpenSubmission}
      onOpenSettings={onOpenSettings}
      onOpenCheck={onOpenCheck}
    />
  );

  const cells = (q: QuestionRow) => {
    const has = (reason: QuestionAttention) => q.attention.includes(reason);
    const time = q.time;
    switch (lens) {
      case 'look':
      case 'all': {
        const found = signals(q, total, config);
        return (
          <td className="px-3 py-2.5 align-top">
            {found.length ? (
              <div className="flex flex-wrap gap-1.5">
                {found.map((s, i) => (
                  <span
                    key={i}
                    className={`inline-flex items-baseline gap-1.5 rounded-md px-2 py-0.5 text-xs ${
                      s.strong
                        ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200'
                        : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                    }`}
                  >
                    <span className="text-[10px] font-semibold uppercase tracking-wide opacity-75">{s.kind}</span>
                    {s.text}
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-xs text-gray-400">Nothing stands out</span>
            )}
          </td>
        );
      }
      case 'dk':
        return (
          <>
            <td className="px-3 py-2.5 align-top whitespace-nowrap">
              {q.dk_allowed ? (
                <>
                  <Figure on={has('many_dk')}>{shareText(q.dk, q.answered)}</Figure>
                  {q.dk > 0 && (
                    <Sub>
                      {q.dk_enumerators} of {q.answer_enumerators} enumerators
                    </Sub>
                  )}
                </>
              ) : (
                <None title="No don’t-know option" />
              )}
            </td>
            <td className="px-3 py-2.5 align-top">
              {q.other === null ? (
                <None title="No “Other” option" />
              ) : (
                <Figure on={has('often_other')}>{shareText(q.other, q.answered)}</Figure>
              )}
            </td>
            <td className="px-3 py-2.5 align-top">
              {q.variety === null ? (
                <None title="For a single choice, from 5 answers" />
              ) : (
                <span className="tabular">{Math.round(q.variety * 100)}%</span>
              )}
            </td>
          </>
        );
      case 'checks': {
        const top = Object.entries(q.flagged_by).sort((a, b) => b[1] - a[1])[0]?.[0];
        return (
          <>
            <td className="px-3 py-2.5 align-top whitespace-nowrap">
              {q.flagged > 0 ? (
                <>
                  <Figure on={has('often_flagged')}>{shareText(q.flagged, q.asked)}</Figure>
                  {top && <Sub>{flagName(top, config)}</Sub>}
                </>
              ) : (
                <None title="No check flagged it" />
              )}
            </td>
            <td className="px-3 py-2.5 align-top">
              {q.corrected > 0 ? (
                <Figure on={has('often_corrected')}>{q.corrected}</Figure>
              ) : (
                <None title="Not corrected in Kobo" />
              )}
            </td>
          </>
        );
      }
      case 'time':
        if (!time) return null;
        return (
          <>
            <td className="px-3 py-2.5 align-top whitespace-nowrap">
              <Figure on={has('rushed')}>{shareText(time.rushed, time.timed)}</Figure>
              <Sub>
                {time.screen_with ? 'screens' : 'answers'} in under {plainNumber(time.rushed_under)} s
              </Sub>
            </td>
            <td className="px-3 py-2.5 align-top whitespace-nowrap">
              {time.pace !== null ? (
                <>
                  <Figure on={has('slow')}>{plainNumber(time.pace)}×</Figure>
                  {(time.pace >= 2 || time.pace <= 0.5) && <Sub>{time.pace >= 2 ? 'slow' : 'fast'} for its length</Sub>}
                </>
              ) : (
                <span className="text-xs text-gray-400">
                  {time.screen_with
                    ? 'not per question'
                    : time.timed < 5
                      ? 'too few answers'
                      : 'label too short to judge'}
                </span>
              )}
            </td>
            <td className="px-3 py-2.5 align-top whitespace-nowrap">
              <span className="tabular">{secondsText(time.median_seconds)}</span>
              {time.screen_with > 0 && (
                <Sub>
                  for the screen, with {time.screen_with} other{time.screen_with === 1 ? '' : 's'}
                </Sub>
              )}
            </td>
            <td className="px-3 py-2.5 align-top">
              <TimeStrip time={time} />
            </td>
          </>
        );
      case 'reach':
        return (
          <>
            <td className="px-3 py-2.5 align-top whitespace-nowrap">
              {has('never_shown') ? (
                <Figure on>Can never be shown</Figure>
              ) : (
                <Figure on={has('rarely_asked')}>{shareText(q.asked, total)}</Figure>
              )}
            </td>
            <td className="min-w-[14rem] px-3 py-2.5 align-top text-xs text-gray-600 dark:text-gray-300">
              {q.asked_from_answers
                ? 'Answered in; its condition can’t be worked out'
                : q.condition
                  ? `Asked if ${q.condition}`
                  : 'Asked of everyone'}
              {q.form_findings.map((f) => (
                <Sub key={f.check_id}>Form check: {f.message}</Sub>
              ))}
            </td>
          </>
        );
    }
  };

  const headings = HEADINGS[lens];
  const timeMissing = lens === 'time' && data.timed_submissions === 0;

  return (
    <section aria-label="Questions" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          From the {total} submissions {allTime ? 'so far' : 'in this period'}
          {data.timed_submissions > 0 && `, ${data.timed_submissions} with an audit log`}:
        </p>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Form check, before collection: {data.form_findings} finding{data.form_findings === 1 ? '' : 's'}
          {onOpenFormCheck && (
            <>
              {' · '}
              <button type="button" onClick={onOpenFormCheck} className={link}>
                Open Form check
              </button>
            </>
          )}
        </p>
      </div>
      {data.logic_missing && (
        <p className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm text-gray-800 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-gray-200">
          The stored form has no skip logic, so Asked in shows how many answered. Refresh the form in Settings to read
          its conditions.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Look at" className="flex flex-wrap gap-2">
          {LENSES.map((l) => {
            const on = lens === l.id;
            return (
              <button
                key={l.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setLens(l.id)}
                className={`flex min-h-[2.75rem] flex-col items-start justify-center rounded-lg border px-3 py-1 text-left transition-colors ${
                  on
                    ? 'border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900'
                    : 'border-gray-200 bg-white text-gray-800 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200'
                }`}
              >
                <span className="text-sm font-medium">
                  {l.label} · {lensCount(l.id, listed, total, config)}
                </span>
                <span className={`text-[11px] ${on ? 'opacity-75' : 'text-gray-500 dark:text-gray-400'}`}>
                  {l.hint}
                </span>
              </button>
            );
          })}
        </div>
        <span className="flex-1" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Find a question"
          placeholder="Find a question"
          className="h-8 w-56 max-w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 placeholder-gray-500 shadow-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
        />
      </div>

      {lens === 'time' && !timeMissing && (
        <p className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm text-gray-800 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-gray-200">
          Time on each question, from the Kobo audit log: from when it shows to when the enumerator moves on, coming
          back to it included. Questions on one screen together share the screen’s time.
        </p>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,26rem)]">
        <div className="min-w-0 space-y-3">
          {timeMissing ? (
            <p className="rounded-xl border border-gray-200 bg-white px-4 py-6 text-sm text-gray-600 shadow-card dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300">
              No audit logs, so no time per question. It comes from the Kobo audit log: the form needs an{' '}
              <code>audit</code> question (Form check says when it has none), and a refresh from Kobo reads the logs.
            </p>
          ) : (
            <TableFrame className="rounded-xl border border-gray-200 bg-white shadow-card dark:border-gray-800 dark:bg-gray-950">
              <table className="min-w-full">
                <thead className={STICKY_HEAD}>
                  <tr>
                    {headings.map((h) => (
                      <th
                        key={h}
                        className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap"
                      >
                        <span className="flex items-center gap-1">
                          {h}
                          {h === 'Pace' && <TermInfo term={PACE} />}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-sm text-gray-700 dark:divide-gray-800 dark:text-gray-300">
                  {rows.map((q) => {
                    const isOpen = q.name === open;
                    return (
                      <tr
                        key={q.name}
                        onClick={() => setPicked(q.name)}
                        className={`cursor-pointer ${isOpen ? 'bg-indigo-50 dark:bg-indigo-950/40' : 'hover:bg-gray-50 dark:hover:bg-gray-900'}`}
                      >
                        <td className="min-w-[9rem] max-w-md px-3 py-2.5 align-top sm:min-w-[14rem]">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPicked(q.name);
                            }}
                            aria-current={wide && isOpen ? 'true' : undefined}
                            aria-haspopup={wide ? undefined : 'dialog'}
                            className="text-left"
                          >
                            <span className="font-medium text-gray-900 dark:text-white">{q.label}</span>
                            <Sub>
                              {q.name}
                              {q.group && ` · ${q.group}`}
                              {q.specifies && ` · specifies ${q.specifies}’s “Other”`}
                            </Sub>
                          </button>
                        </td>
                        {cells(q)}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {rows.length === 0 && (
                <p className="px-4 py-6 text-center text-sm text-gray-500">
                  {search ? 'No question matches.' : 'Nothing stands out here.'}
                </p>
              )}
            </TableFrame>
          )}

          {specifying > 0 && (
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {withSpecify
                ? `With the ${specifying} question${specifying === 1 ? '' : 's'} that specify an “Other” answer.`
                : `${specifying} question${specifying === 1 ? ' that specifies' : 's that specify'} an “Other” answer ${specifying === 1 ? 'is' : 'are'} left out: each is its choice question’s “Other”.`}{' '}
              <button type="button" onClick={() => setWithSpecify(!withSpecify)} className={link}>
                {withSpecify ? 'Leave them out' : 'Show them'}
              </button>
            </p>
          )}

          <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
            {lens === 'look' && (
              <p>
                Most to look at first: the largest share of the submissions it was asked in with a don’t-know, a flag or
                a rushed answer (from 5 submissions).
              </p>
            )}
            {lens === 'dk' && (
              <p>
                Shares of its answers. Answer variety: how evenly a single choice’s answers spread over its options.
              </p>
            )}
            {lens === 'checks' && (
              <p>
                Flagged: of the submissions it was asked in, the outlier check’s flags among them. Corrected:
                submissions where it was edited in Kobo.
              </p>
            )}
            {lens === 'time' && !timeMissing && (
              <p>
                Rushed: answered in under a third of the question’s median time (2 s at least), too quick to have been
                read out. Pace: seconds per word of the question as written, against the form’s usual
                {data.form_pace !== null && ` (${plainNumber(data.form_pace)} s a word)`}.
              </p>
            )}
            {lens === 'reach' && <p>Asked in: of all submissions, from its condition and its groups’.</p>}
            <p>
              <Highlighted /> when worth a look: 20% or more don’t-know, “Other”, flagged or rushed (from 5 answers);
              corrected in 3 submissions or more; asked in under 10% of submissions; twice the form’s pace or more.
            </p>
          </div>
        </div>

        {!wide && (
          <Dialog
            open={Boolean(openRow)}
            title={openRow?.label ?? ''}
            onClose={() => setPicked(null)}
            sheet
            actions={
              <button
                type="button"
                onClick={() => setPicked(null)}
                className="h-9 rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-800 dark:border-gray-700 dark:text-gray-200"
              >
                Close
              </button>
            }
          >
            {openRow && detail(openRow)}
          </Dialog>
        )}
        {wide && openRow && (
          <aside
            aria-label={openRow.label}
            className="rounded-xl border border-gray-200 bg-white shadow-card lg:sticky lg:top-0 lg:max-h-[calc(100dvh-8rem)] lg:overflow-y-auto dark:border-gray-800 dark:bg-gray-950"
          >
            {detail(openRow)}
          </aside>
        )}
      </div>
    </section>
  );
};

export default ByQuestionView;
