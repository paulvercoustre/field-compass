import React, { useMemo, useState } from 'react';
import { QuestionAttention, QuestionsResponse } from '../../types';
import { SurveyConfig } from '../../services/progressApi';
import { formatPercent, percentOf } from '../../utils/glossary';
import { checkName } from '../../utils/fieldTeam';
import { ATTENTION } from '../../utils/questions';
import QuestionDetail from './QuestionDetail';
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
 * first on top. A row opens what is behind its numbers: how its answers
 * spread, what the checks find on it, the corrections and Form check.
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
                        <QuestionDetail
                          question={q}
                          config={config}
                          lastDay={data.last_day}
                          onOpenFormCheck={onOpenFormCheck}
                          onOpenSubmission={onOpenSubmission}
                          onOpenEnumerator={onOpenEnumerator}
                        />
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
