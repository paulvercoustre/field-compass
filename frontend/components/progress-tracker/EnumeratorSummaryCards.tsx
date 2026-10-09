import React from 'react';
import { PerformanceData } from '../../types';
import { GLOSSARY, Term, formatPercent, percentOf } from '../../utils/glossary';
import TermInfo from '../ui/TermInfo';

interface EnumeratorSummaryCardsProps {
  data: PerformanceData;
}

const SummaryCard: React.FC<{ label: string; term?: Term; value: string; sub: string; muted?: boolean }> = ({
  label,
  term,
  value,
  sub,
  muted,
}) => (
  <div className="bg-white dark:bg-gray-900 rounded-xl p-4 shadow-card border border-gray-200 dark:border-gray-800">
    <div className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400">
      {label}
      {term && <TermInfo term={term} />}
    </div>
    <div
      className={`tabular text-2xl font-semibold tracking-tight mt-2 ${
        muted ? 'text-gray-600 dark:text-gray-300' : 'text-gray-900 dark:text-white'
      }`}
    >
      {value}
    </div>
    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{sub}</div>
  </div>
);

/** The whole team's figures: the same definitions as Data quality, over the team's submissions. */
const EnumeratorSummaryCards: React.FC<EnumeratorSummaryCardsProps> = ({ data }) => {
  const team = data.team;
  if (!team) return null;
  const enumerators = data.enumerators.length;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
      <SummaryCard
        label="Enumerators"
        value={String(enumerators)}
        sub={`${team.submissions} ${GLOSSARY.submissions.name.toLowerCase()}`}
      />
      <SummaryCard
        label={GLOSSARY.flagged.name}
        term={GLOSSARY.flagged}
        value={formatPercent(percentOf(team.flagged, team.submissions))}
        sub={`${team.flagged} of ${team.submissions} submissions`}
      />
      <SummaryCard
        label={GLOSSARY.issuesPerSubmission.name}
        term={GLOSSARY.issuesPerSubmission}
        value={team.issues_per_submission === null ? '—' : team.issues_per_submission.toFixed(2)}
        sub={`${team.issues} issues`}
      />
      <SummaryCard
        label={GLOSSARY.notApproved.name}
        term={GLOSSARY.notApproved}
        value={formatPercent(percentOf(team.not_approved, team.submissions))}
        sub={`${team.not_approved} of ${team.submissions} submissions`}
      />
      {/* How far review has got, not quality: never coloured. */}
      <SummaryCard
        label={GLOSSARY.reviewed.name}
        term={GLOSSARY.reviewed}
        value={formatPercent(percentOf(team.reviewed, team.submissions))}
        sub={`${team.reviewed} of ${team.submissions} · review progress`}
        muted
      />
    </div>
  );
};

export default EnumeratorSummaryCards;
