import React from 'react';
import { EnumeratorSummary, SubmissionSummary } from '../../types';
import { SurveyConfig } from '../../services/progressApi';
import { formatPercent, percentOf } from '../../utils/glossary';
import { checkName, comparable, highlightFlagged, highlightNotApproved, mainIssue } from '../../utils/fieldTeam';

const Chip: React.FC<{ on: boolean; children: React.ReactNode }> = ({ on, children }) => (
  <span
    className={`rounded-md px-1.5 py-0.5 text-xs ${
      on
        ? 'bg-amber-100 font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
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

/** The team beside a call sheet: each enumerator's highlights, most flagged first. */
const EnumeratorList: React.FC<EnumeratorListProps> = ({ enumerators, team, config, openId, onOpen }) => {
  const share = (row: EnumeratorSummary) => percentOf(row.flagged, row.submissions) ?? 0;
  const ordered = [...enumerators].sort(
    (a, b) => Number(comparable(b)) - Number(comparable(a)) || share(b) - share(a) || a.id.localeCompare(b.id)
  );
  return (
    <nav aria-label="Enumerators" className="flex flex-col gap-1">
      {ordered.map((row) => {
        const issue = mainIssue(row, team);
        const open = row.id === openId;
        return (
          <button
            key={row.id}
            type="button"
            onClick={() => onOpen(row.id)}
            aria-current={open ? 'true' : undefined}
            className={`flex flex-col gap-1 rounded-lg px-3 py-2 text-left transition-colors ${
              open
                ? 'bg-indigo-50 ring-1 ring-indigo-200 dark:bg-indigo-950/40 dark:ring-indigo-900'
                : 'hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
          >
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-gray-900 dark:text-white">{row.id}</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">{row.submissions} submissions</span>
            </span>
            <span className="flex flex-wrap gap-1">
              <Chip on={highlightFlagged(row, team)}>
                {formatPercent(percentOf(row.flagged, row.submissions))} flagged
              </Chip>
              {row.not_approved > 0 && (
                <Chip on={highlightNotApproved(row, team)}>{row.not_approved} not approved</Chip>
              )}
              {issue && issue.highlighted && <Chip on>{checkName(issue.check, config)}</Chip>}
            </span>
          </button>
        );
      })}
    </nav>
  );
};

export default EnumeratorList;
