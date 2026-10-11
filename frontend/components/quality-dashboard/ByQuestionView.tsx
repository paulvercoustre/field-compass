import React, { useMemo, useState } from 'react';
import { QuestionAttention, QuestionRow, QuestionsResponse } from '../../types';
import { SurveyConfig } from '../../services/progressApi';
import { formatPercent, percentOf } from '../../utils/glossary';
import { checkName } from '../../utils/fieldTeam';
import { ATTENTION, answerText, dkSpread } from '../../utils/questions';
import { ChevronDownIcon } from '../ui/icons';

const link = 'rounded font-medium text-indigo-700 hover:underline dark:text-indigo-300';

/** A figure, highlighted when it is why the question is worth a look. */
const Figure: React.FC<{ on: boolean; children: React.ReactNode }> = ({ on, children }) =>
  on ? (
    <span className="rounded-md bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
      {children}
    </span>
  ) : (
    <>{children}</>
  );

const Sub: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{children}</div>
);

const Panel: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="min-w-0 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-950">
    <h4 className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">{title}</h4>
    {children}
  </div>
);

interface ByQuestionViewProps {
  data: QuestionsResponse;
  config: SurveyConfig | null;
  /** All time, or a shorter period: how the opening line reads. */
  allTime: boolean;
  onOpenFormCheck?: () => void;
  onOpenSubmission?: (submissionId: number) => void;
  onOpenEnumerator?: (enumeratorId: string) => void;
}

/**
 * Data quality by question: every question of the form, the ones to look at
 * first on top. A row opens what is behind its numbers: who records "don't
 * know", the answers, the corrections and what Form check found.
 */
const ByQuestionView: React.FC<ByQuestionViewProps> = ({
  data,
  config,
  allTime,
  onOpenFormCheck,
  onOpenSubmission,
  onOpenEnumerator,
}) => {
  const [show, setShow] = useState<QuestionAttention | 'all'>('all');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const counts = useMemo(
    () =>
      Object.fromEntries(ATTENTION.map((a) => [a.id, data.questions.filter((q) => q.attention.includes(a.id)).length])),
    [data.questions]
  );
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return data.questions.filter(
      (q) =>
        (show === 'all' || q.attention.includes(show)) &&
        (!needle || `${q.label} ${q.name} ${q.group}`.toLowerCase().includes(needle))
    );
  }, [data.questions, show, search]);

  if (data.form_missing) {
    return (
      <p className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300">
        No form is stored for this survey, so there are no questions to show. Link its Kobo form in Settings.
      </p>
    );
  }

  const chip = (id: QuestionAttention | 'all', label: string, count: number) => (
    <button
      key={id}
      type="button"
      onClick={() => setShow(id)}
      aria-pressed={show === id}
      className={`flex h-7 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors ${
        show === id
          ? 'border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900'
          : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'
      }`}
    >
      {label}
      <span className="tabular text-xs opacity-75">{count}</span>
    </button>
  );

  const pct = (part: number, whole: number) => formatPercent(percentOf(part, whole));

  const detail = (q: QuestionRow) => {
    const spread = dkSpread(q);
    const outliers = Object.entries(q.flagged_by)
      .filter(([check]) => check.startsWith('outlier_'))
      .reduce((n, [, count]) => n + count, 0);
    const recording = [...q.dk_by_enumerator].sort((a, b) => b.dk / b.answers - a.dk / a.answers);
    return (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {q.dk_allowed && q.dk > 0 && (
          <Panel title="Don’t-know, by enumerator">
            <ul className="space-y-1">
              {recording.map((e) => (
                <li key={e.id} className="grid grid-cols-[5.5rem_minmax(0,1fr)_3.5rem] items-center gap-2 text-xs">
                  <span className="truncate">{e.id}</span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                    <span
                      className="block h-1.5 rounded-full bg-amber-600"
                      style={{ width: `${percentOf(e.dk, e.answers) ?? 0}%` }}
                    />
                  </span>
                  <span className="tabular text-right">{pct(e.dk, e.answers)}</span>
                </li>
              ))}
            </ul>
            {spread && 'team' in spread && (
              <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                Most of the team records “don’t know” here, so the wording or the translation is a likelier cause than
                any one enumerator.
              </p>
            )}
            {spread && 'one' in spread && (
              <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                Only {spread.one} records “don’t know” here: worth a word with them.{' '}
                {onOpenEnumerator && (
                  <button type="button" onClick={() => onOpenEnumerator(spread.one)} className={link}>
                    Their call sheet
                  </button>
                )}
              </p>
            )}
          </Panel>
        )}
        {(q.numbers || q.choices.length > 0) && (
          <Panel title="Answers">
            {q.numbers ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-gray-500">Median</dt>
                <dd className="tabular">{q.numbers.median.toLocaleString()}</dd>
                <dt className="text-gray-500">Middle half</dt>
                <dd className="tabular">
                  {q.numbers.p25.toLocaleString()} – {q.numbers.p75.toLocaleString()}
                </dd>
                {outliers > 0 && (
                  <>
                    <dt className="text-gray-500">Outliers</dt>
                    <dd className="tabular">{outliers} submissions</dd>
                  </>
                )}
              </dl>
            ) : (
              <ul className="space-y-1 text-xs">
                {q.choices.map((c) => (
                  <li key={c.name} className="flex justify-between gap-3">
                    <span className="truncate">{c.label}</span>
                    <span className="tabular text-gray-500">
                      {c.count} ({pct(c.count, q.answered)})
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
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
                <li key={f.check_id}>{f.message}</li>
              ))}
            </ul>
            {onOpenFormCheck && (
              <button type="button" onClick={onOpenFormCheck} className={`${link} mt-2 text-xs`}>
                Open Form check
              </button>
            )}
          </Panel>
        )}
        {!(q.dk_allowed && q.dk > 0) && !q.numbers && !q.choices.length && !q.corrected && !q.form_findings.length && (
          <p className="text-xs text-gray-500">Nothing more to show for this question.</p>
        )}
      </div>
    );
  };

  return (
    <section aria-label="Questions" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          From the {data.submissions} submissions {allTime ? 'so far' : 'in this period'}:
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
        {chip('all', 'All, most to look at first', data.questions.length)}
        {ATTENTION.filter((a) => counts[a.id] > 0).map((a) => chip(a.id, a.label, counts[a.id]))}
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

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-card dark:border-gray-800 dark:bg-gray-950">
        <table className="min-w-full">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr>
              {['Question', 'Asked in', 'Don’t-know', '“Other”', 'Flagged', 'Corrected'].map((h) => (
                <th
                  key={h}
                  className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-sm text-gray-700 dark:divide-gray-800 dark:text-gray-300">
            {rows.map((q) => {
              const isOpen = open === q.name;
              const has = (a: QuestionAttention) => q.attention.includes(a);
              const topCheck = Object.entries(q.flagged_by).sort((a, b) => b[1] - a[1])[0]?.[0];
              return (
                <React.Fragment key={q.name}>
                  <tr className={isOpen ? 'bg-gray-50 dark:bg-gray-900' : ''}>
                    <td className="min-w-[16rem] max-w-md px-3 py-2.5 align-top">
                      <button
                        type="button"
                        onClick={() => setOpen(isOpen ? null : q.name)}
                        aria-expanded={isOpen}
                        className="flex items-start gap-1.5 text-left"
                      >
                        <ChevronDownIcon
                          className={`mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${isOpen ? '' : '-rotate-90'}`}
                        />
                        <span>
                          <span className="font-medium text-gray-900 dark:text-white">{q.label}</span>
                          <Sub>
                            {q.name}
                            {q.group && ` · ${q.group}`}
                          </Sub>
                        </span>
                      </button>
                    </td>
                    <td className="min-w-[11rem] px-3 py-2.5 align-top">
                      {has('never_shown') ? (
                        <Figure on>Can never be shown</Figure>
                      ) : (
                        <Figure on={has('rarely_asked')}>{pct(q.asked, data.submissions)}</Figure>
                      )}
                      <Sub>
                        {q.asked_from_answers
                          ? 'answered in; its condition can’t be worked out'
                          : q.condition
                            ? `Asked if ${q.condition}`
                            : 'asked of everyone'}
                      </Sub>
                    </td>
                    <td className="px-3 py-2.5 align-top whitespace-nowrap">
                      {q.dk_allowed ? (
                        <>
                          <Figure on={has('many_dk')}>{pct(q.dk, q.answered)}</Figure>
                          {q.dk > 0 && (
                            <Sub>
                              {q.dk_enumerators} of {q.answer_enumerators} enumerators
                            </Sub>
                          )}
                        </>
                      ) : (
                        <span className="text-gray-400" title="No don’t-know option">
                          —
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      {q.other === null ? (
                        <span className="text-gray-400">—</span>
                      ) : (
                        <>
                          <Figure on={has('often_other')}>{pct(q.other, q.answered)}</Figure>
                          {q.other_top && q.other_top_count >= 2 && <Sub>mostly “{q.other_top}”</Sub>}
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2.5 align-top whitespace-nowrap">
                      {q.flagged > 0 ? (
                        <>
                          <span className="tabular">{q.flagged}</span>
                          {/* An outlier is named by its question elsewhere; here the row is the question. */}
                          {topCheck && (
                            <Sub>{topCheck.startsWith('outlier_') ? 'Outlier' : checkName(topCheck, config)}</Sub>
                          )}
                        </>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="tabular px-3 py-2.5 align-top">
                      {q.corrected > 0 ? (
                        <Figure on={has('often_corrected')}>{q.corrected}</Figure>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-gray-50 dark:bg-gray-900">
                      <td colSpan={6} className="px-3 pb-3 pt-0">
                        {detail(q)}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="px-4 py-6 text-center text-sm text-gray-500">No question matches.</p>}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Asked in: the share of submissions it was shown in, from its condition and its groups’. Don’t-know and “Other”:
        shares of its answers.{' '}
        <span className="rounded bg-amber-100 px-1.5 font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          Highlighted
        </span>{' '}
        when worth a look: asked in under 10% of submissions, 20% or more don’t-know or “Other” (from 5 answers), or
        corrected in 3 submissions or more.
      </p>
    </section>
  );
};

export default ByQuestionView;
