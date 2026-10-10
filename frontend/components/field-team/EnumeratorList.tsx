import React from 'react';
import { EnumeratorSummary, SubmissionSummary } from '../../types';
import { SurveyConfig } from '../../services/progressApi';
import { formatPercent, percentOf } from '../../utils/glossary';
import { checkName, comparable, highlightFlagged, highlightNotApproved, mainIssue } from '../../utils/fieldTeam';

const Tag: React.FC<{ on: boolean; children: React.ReactNode }> = ({ on, children }) => (
  <span
    className={`flex-shrink-0 rounded px-1.5 py-px ${
      on ? 'bg-amber-100 font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' : ''
    }`}
  >
    {children}
  </span>
);

interface EnumeratorListProps {
  enumerators: EnumeratorSummary[];
  team: SubmissionSummary;
  config: SurveyConfig | null;
  openId: string;
  onOpen: (enumeratorId: string) => void;
}

/**
 * The team beside a call sheet, in the Submissions list's own form: one row
 * each, the open one marked, most flagged first, too few to compare last.
 */
const EnumeratorList: React.FC<EnumeratorListProps> = ({ enumerators, team, config, openId, onOpen }) => {
  const share = (row: EnumeratorSummary) => percentOf(row.flagged, row.submissions) ?? 0;
  const ordered = [...enumerators].sort(
    (a, b) => Number(comparable(b)) - Number(comparable(a)) || share(b) - share(a) || a.id.localeCompare(b.id)
  );
  return (
    <nav aria-label="Enumerators">
      <p className="border-b border-gray-200 px-4 py-2.5 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
        {enumerators.length} enumerators, most flagged first
      </p>
      <ul>
        {ordered.map((row) => {
          const issue = mainIssue(row, team);
          const open = row.id === openId;
          return (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => onOpen(row.id)}
                aria-current={open ? 'true' : undefined}
                className={`relative block w-full border-b border-gray-100 px-4 py-2.5 text-left transition-colors duration-100 focus-visible:ring-inset focus-visible:ring-offset-0 dark:border-gray-800/80 ${
                  open ? 'bg-indigo-50/70 dark:bg-indigo-500/10' : 'hover:bg-gray-50 dark:hover:bg-gray-900'
                }`}
              >
                {open && (
                  <span
                    className="absolute inset-y-0 left-0 w-0.5 bg-indigo-600 dark:bg-indigo-400"
                    aria-hidden="true"
                  />
                )}
                <span className="flex items-baseline gap-2">
                  <span className="tabular text-sm font-semibold text-gray-900 dark:text-white">{row.id}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-gray-300">
                    {row.submissions} submissions
                  </span>
                </span>
                <span className="mt-1 flex h-5 items-center gap-1 overflow-hidden text-xs text-gray-500 dark:text-gray-400">
                  <Tag on={highlightFlagged(row, team)}>
                    {formatPercent(percentOf(row.flagged, row.submissions))} flagged
                  </Tag>
                  {row.not_approved > 0 && (
                    <Tag on={highlightNotApproved(row, team)}>{row.not_approved} not approved</Tag>
                  )}
                  {issue?.highlighted && (
                    <span className="min-w-0 truncate rounded bg-amber-100 px-1.5 py-px font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                      {checkName(issue.check, config)}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

export default EnumeratorList;
