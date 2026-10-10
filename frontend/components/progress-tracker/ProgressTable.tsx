import React, { useMemo, useState } from 'react';
import { ProgressData, SamplingFilter } from '../../types';
import { SurveyConfig } from '../../services/progressApi';
import { getChoiceLabel, getQuestionInfo } from '../../utils/koboLabelUtils';
import { GLOSSARY, Term } from '../../utils/glossary';
import { toGo } from '../../utils/progress';
import { SubTabButton } from '../ui/SubTabButton';
import TermInfo from '../ui/TermInfo';
import { TwoPartBar } from './ProgressSummary';

interface Row {
  key: string;
  values: Record<string, string>;
  target: number | null;
  conducted: number;
  progress: number | null;
  share: number | null;
  approved: number;
  last_7_days: number;
  not_approved: number;
}

const Header: React.FC<{ label: string; term?: Term }> = ({ label, term }) => (
  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
    <span className="flex items-center gap-1">
      {label}
      {term && <TermInfo term={term} />}
    </span>
  </th>
);

const muted = (n: number) => (n === 0 ? 'text-gray-400 dark:text-gray-500' : '');

interface ProgressTableProps {
  data: ProgressData;
  surveyConfig: SurveyConfig | null;
  /** Opens the submissions of one group. */
  onOpen?: (filters: SamplingFilter[]) => void;
}

/**
 * Where are we behind? Each group of the sampling frame against its target,
 * the most behind first, with the Approved part, the last 7 days, what is
 * left, and what was left out. A group's name opens its submissions.
 */
const ProgressTable: React.FC<ProgressTableProps> = ({ data, surveyConfig, onOpen }) => {
  const columns = data.samplingColumns;
  const tabs = [
    ...columns.filter((c) => data.byColumn[c]?.length).map((c) => ({ id: `by-${c}`, label: `By ${c}`, cols: [c] })),
    ...(columns.length > 1 && data.detailed.length
      ? [{ id: 'detailed', label: `By ${columns.join(' and ')}`, cols: columns }]
      : []),
  ];
  const [tabId, setTabId] = useState(tabs[0]?.id ?? '');
  const [filter, setFilter] = useState('');
  const tab = tabs.find((t) => t.id === tabId) ?? tabs[0];
  const hasTargets = data.mode !== 'none';

  const label = (column: string, value: string): string => {
    const info = surveyConfig ? getQuestionInfo(column, surveyConfig) : null;
    return info?.listName ? getChoiceLabel(value, info.listName, surveyConfig!) : value;
  };

  const rows: Row[] = useMemo(() => {
    if (!tab) return [];
    const raw: Row[] =
      tab.id === 'detailed'
        ? data.detailed.map((r) => ({ ...r, key: Object.values(r.values).join('|'), share: null }))
        : data.byColumn[tab.cols[0]].map((r) => ({ ...r, key: r.value, values: { [tab.cols[0]]: r.value } }));
    const needle = filter.trim().toLowerCase();
    const shown = needle
      ? raw.filter((r) =>
          Object.entries(r.values).some(([c, v]) => `${v} ${label(c, v)}`.toLowerCase().includes(needle))
        )
      : raw;
    // The most behind first; groups without a target after, the largest first.
    return [...shown].sort((a, b) =>
      a.target !== null && b.target !== null
        ? (a.progress ?? 0) - (b.progress ?? 0)
        : a.target !== null
          ? -1
          : b.target !== null
            ? 1
            : b.conducted - a.conducted
    );
    // `label` reads the config, which `surveyConfig` stands for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab?.id, data, filter, surveyConfig]);

  if (!tab) return null;

  const noun = tab.id === 'detailed' ? 'group' : tab.cols[0];
  const name = (r: Row) => tab.cols.map((c) => label(c, r.values[c])).join(' · ');

  // When the groups' To go doesn't add up to what is left overall, say why.
  const left = toGo(data.overall.target, data.overall.conducted);
  const groupsLeft = rows.reduce((n, r) => n + (toGo(r.target, r.conducted) ?? 0), 0);
  const untargeted = rows.filter((r) => r.target === null && r.conducted > 0);
  const over = rows.filter((r) => r.target !== null && r.conducted > r.target);
  const reasons = [
    ...(untargeted.length
      ? [
          `${untargeted.reduce((n, r) => n + r.conducted, 0)} submissions are in ${
            untargeted.length === 1 ? name(untargeted[0]) : `${untargeted.length} ${noun}s`
          }, which ${untargeted.length === 1 ? 'has' : 'have'} no target`,
        ]
      : []),
    ...(over.length
      ? [
          over.length === 1
            ? `${name(over[0])} is ${over[0].conducted - over[0].target!} over its target`
            : `${over.length} ${noun}s are over their target`,
        ]
      : []),
  ];
  const mismatch = hasTargets && !filter && left !== null && groupsLeft !== left && reasons.length > 0;

  return (
    <section aria-label="Progress by group">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {tabs.length > 1 && (
          <div
            role="group"
            aria-label="Group by"
            className="inline-flex flex-wrap gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-900"
          >
            {tabs.map((t) => (
              <SubTabButton key={t.id} tabId={t.id} activeTab={tab.id} onClick={setTabId}>
                {t.label}
              </SubTabButton>
            ))}
          </div>
        )}
        {tab.id === 'detailed' && data.detailed.length > 10 && (
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label={`Find a ${columns.join(' or ')}`}
            placeholder={`Find a ${columns.join(' or ')}`}
            className="h-8 w-64 max-w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 placeholder-gray-500 shadow-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
          />
        )}
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-card dark:border-gray-800 dark:bg-gray-950">
        <table className="min-w-full">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr>
              {tab.cols.map((c) => (
                <Header key={c} label={c.charAt(0).toUpperCase() + c.slice(1)} />
              ))}
              {hasTargets && <Header label="Target" />}
              <Header label={GLOSSARY.done.name} term={GLOSSARY.done} />
              {!hasTargets && <Header label="Share" />}
              <Header label={GLOSSARY.approved.name} term={GLOSSARY.approved} />
              {hasTargets && <Header label="Progress" />}
              <Header label="Last 7 days" />
              {hasTargets && <Header label="To go" />}
              <Header label={GLOSSARY.notApproved.name} term={GLOSSARY.notApproved} />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-sm text-gray-700 dark:divide-gray-800 dark:text-gray-300">
            {rows.map((r) => {
              const openable = onOpen && tab.cols.every((c) => r.values[c] && r.values[c] !== 'Unknown');
              const left = toGo(r.target, r.conducted);
              return (
                <tr key={r.key}>
                  {tab.cols.map((c, i) => (
                    <td key={c} className="px-3 py-2.5 font-medium whitespace-nowrap text-gray-900 dark:text-white">
                      {openable && i === 0 ? (
                        <button
                          type="button"
                          onClick={() => onOpen!(tab.cols.map((col) => ({ variable: col, values: [r.values[col]] })))}
                          aria-label={`Open the submissions for ${name(r)}`}
                          className="rounded text-left text-indigo-700 hover:underline dark:text-indigo-300"
                        >
                          {label(c, r.values[c])}
                        </button>
                      ) : (
                        label(c, r.values[c])
                      )}
                      {i === tab.cols.length - 1 && hasTargets && r.target === null && (
                        <span className="ml-2 rounded bg-gray-100 px-1.5 py-px text-xs font-normal text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                          no target
                        </span>
                      )}
                    </td>
                  ))}
                  {hasTargets && <td className="tabular px-3 py-2.5">{r.target ?? '—'}</td>}
                  <td className="tabular px-3 py-2.5">{r.conducted}</td>
                  {!hasTargets && <td className="tabular px-3 py-2.5">{r.share === null ? '—' : `${r.share}%`}</td>}
                  <td className={`tabular px-3 py-2.5 ${muted(r.approved)}`}>{r.approved}</td>
                  {hasTargets && (
                    <td className="px-3 py-2.5">
                      {r.progress === null ? (
                        <span className="text-gray-400">—</span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <TwoPartBar
                            approved={r.approved}
                            done={r.conducted}
                            target={r.target}
                            className="h-1.5 w-24"
                          />
                          <span className="tabular w-11 text-right text-xs font-medium">{Math.round(r.progress)}%</span>
                        </span>
                      )}
                    </td>
                  )}
                  <td className={`tabular px-3 py-2.5 ${muted(r.last_7_days)}`}>{r.last_7_days}</td>
                  {hasTargets && <td className="tabular px-3 py-2.5">{left ?? '—'}</td>}
                  <td className={`tabular px-3 py-2.5 ${muted(r.not_approved)}`}>{r.not_approved}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {mismatch && (
        <p className="mt-2 max-w-3xl text-xs text-gray-500 dark:text-gray-400">
          The {noun}s are {groupsLeft} short in all, not {left}: {reasons.join(', and ')}. Those count toward the total,
          not toward a {noun}’s target.
        </p>
      )}
    </section>
  );
};

export default ProgressTable;
