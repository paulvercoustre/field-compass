import React from 'react';
import { PerformanceData } from '../../types';
import { SurveyConfig } from '../../services/progressApi';
import { GLOSSARY, Term, formatPercent, percentOf } from '../../utils/glossary';
import { checkName } from '../../utils/fieldTeam';
import TermInfo from '../ui/TermInfo';

const Tile: React.FC<{
  label: string;
  term?: Term;
  value: string;
  sub: React.ReactNode;
  muted?: boolean;
}> = ({ label, term, value, sub, muted }) => (
  <div
    className={`rounded-xl border border-gray-200 p-4 shadow-card dark:border-gray-800 ${
      muted ? 'bg-gray-50 dark:bg-gray-900/60' : 'bg-white dark:bg-gray-900'
    }`}
  >
    <div className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400">
      {label}
      {term && <TermInfo term={term} />}
    </div>
    <div
      className={`tabular mt-2 text-2xl font-semibold tracking-tight ${
        muted ? 'text-gray-600 dark:text-gray-300' : 'text-gray-900 dark:text-white'
      }`}
    >
      {value}
    </div>
    <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{sub}</div>
  </div>
);

interface FieldTeamTilesProps {
  data: PerformanceData;
  config: SurveyConfig | null;
  onOpenSettings?: () => void;
}

/** The whole team, with Data quality's figures; review progress last and grey. */
const FieldTeamTiles: React.FC<FieldTeamTilesProps> = ({ data, config, onOpenSettings }) => {
  const team = data.team;
  if (!team) return null;
  const available = data.checks_on.length + data.checks_off.length;
  const off = data.checks_off.map((check) => checkName(check, config));
  const settings = onOpenSettings && (
    <button
      type="button"
      onClick={onOpenSettings}
      className="font-medium text-indigo-700 hover:underline dark:text-indigo-300"
    >
      Settings
    </button>
  );

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
      <Tile
        label={GLOSSARY.flagged.name}
        term={GLOSSARY.flagged}
        value={formatPercent(percentOf(team.flagged, team.submissions))}
        sub={`${team.flagged} of ${team.submissions} submissions`}
      />
      <Tile
        label={GLOSSARY.duration.name}
        term={GLOSSARY.duration}
        value={team.duration_minutes === null ? 'Not measured' : `${Math.round(team.duration_minutes)} min`}
        sub={team.duration_minutes === null ? 'No audit log, and no start and end times' : 'median, whole team'}
        muted={team.duration_minutes === null}
      />
      <Tile
        label={GLOSSARY.dkRate.name}
        term={GLOSSARY.dkRate}
        value={team.dk_rate === null ? 'Not measured' : `${team.dk_rate}%`}
        sub={team.dk_rate === null ? 'No don’t-know codes, or no answers yet' : 'of answers that allow one'}
        muted={team.dk_rate === null}
      />
      <Tile
        label="Checks on"
        value={`${data.checks_on.length} of ${available}`}
        sub={
          <>
            {off.length === 0
              ? 'All built-in checks are on'
              : off.length <= 2
                ? `${off.join(' and ')} ${off.length === 1 ? 'is' : 'are'} off`
                : `${off.length} are off`}
            {data.custom_checks > 0 && `, plus ${data.custom_checks} of your own`}
            {settings && <> · {settings}</>}
          </>
        }
      />
      {/* How far review has got, not quality: never coloured. */}
      <Tile
        label={GLOSSARY.reviewed.name}
        term={GLOSSARY.reviewed}
        value={formatPercent(percentOf(team.reviewed, team.submissions))}
        sub={`${team.reviewed} of ${team.submissions} · review progress`}
        muted
      />
    </div>
  );
};

export default FieldTeamTiles;
