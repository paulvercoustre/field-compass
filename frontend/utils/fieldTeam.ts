/**
 * Field team's rules, in one place for the follow-up table and the call sheet
 * (docs/ui-ux-review/wireframes/W6-field-team-data-quality-progress.md).
 *
 * An enumerator is highlighted by the flags, against the team: a share at
 * least twice the team's, for their Flagged, their Not approved, or one check.
 * Duration and the don't-know rate are shown plain; their checks carry the
 * verdict. Too few submissions to compare are never highlighted.
 */
import { EnumeratorSummary, SubmissionSummary, WeekPoint } from '../types';
import { SurveyConfig } from '../services/progressApi';
import { issueName } from './issueNames';
import { questionText } from './koboLabelUtils';
import { GLOSSARY, percentOf } from './glossary';

export const MIN_SUBMISSIONS = 5;

/** Enough submissions to compare with the team. */
export const comparable = (row: SubmissionSummary): boolean => row.submissions >= MIN_SUBMISSIONS;

/** At least twice the team's share, when the team has any. */
const twiceTheTeams = (mine: number, mineOf: number, team: number, teamOf: number): boolean => {
  const own = percentOf(mine, mineOf);
  const theirs = percentOf(team, teamOf);
  return own !== null && theirs !== null && theirs > 0 && own >= 2 * theirs;
};

export const highlightFlagged = (row: SubmissionSummary, team: SubmissionSummary): boolean =>
  comparable(row) && twiceTheTeams(row.flagged, row.submissions, team.flagged, team.submissions);

export const highlightNotApproved = (row: SubmissionSummary, team: SubmissionSummary): boolean =>
  comparable(row) && twiceTheTeams(row.not_approved, row.submissions, team.not_approved, team.submissions);

export const highlightCheck = (row: SubmissionSummary, team: SubmissionSummary, check: string): boolean =>
  comparable(row) && twiceTheTeams(row.checks[check] ?? 0, row.submissions, team.checks[check] ?? 0, team.submissions);

/**
 * The check to talk about: the one that flagged most of their submissions,
 * with any at twice the team's share first. Null when nothing flagged them.
 */
export const mainIssue = (
  row: SubmissionSummary,
  team: SubmissionSummary
): { check: string; count: number; highlighted: boolean } | null => {
  const ranked = Object.entries(row.checks)
    .map(([check, count]) => ({ check, count, highlighted: highlightCheck(row, team, check) }))
    .sort((a, b) => Number(b.highlighted) - Number(a.highlighted) || b.count - a.count);
  return ranked[0] ?? null;
};

// Built-in checks that write several issues have a key of their own.
const BUILT_IN_NAMES: Record<string, string> = {
  outliers: 'Outliers',
  sampling: 'Sampling frame',
  ai_review: 'AI review',
};

/** A check as a coordinator reads it; an outlier is named by its question. */
export const checkName = (check: string, config: SurveyConfig | null): string =>
  BUILT_IN_NAMES[check] ?? issueName(check, (name) => questionText(name, config));

/** Issues per submission for each week, or null for a week with none. */
export const weeklyIssuesPerSubmission = (weekly: WeekPoint[]): { week: string; value: number | null }[] =>
  weekly.map((w) => ({
    week: w.week,
    value: w.submissions ? Math.round((w.issues / w.submissions) * 100) / 100 : null,
  }));

const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/** "15–28 Sep", or one day. */
export const dateSpan = (row: SubmissionSummary): string | null => {
  if (!row.first_submission || !row.last_submission) return null;
  const first = shortDate(row.first_submission);
  const last = shortDate(row.last_submission);
  return first === last ? first : `${first} – ${last}`;
};

const percent = (part: number, whole: number) => `${percentOf(part, whole) ?? 0}%`;

/**
 * What to say on the call, or send: the figures that differ from the team's,
 * in plain words, ready to paste into a message.
 */
export const callSummary = (row: EnumeratorSummary, team: SubmissionSummary, config: SurveyConfig | null): string => {
  const parts: string[] = [];
  const span = dateSpan(row);
  parts.push(`${row.id}${span ? `, ${span}` : ''}: ${row.submissions} submissions.`);
  if (row.not_approved > 0)
    parts.push(
      `${row.not_approved} ${GLOSSARY.notApproved.name.toLowerCase()} (${percent(row.not_approved, row.submissions)}; team ${percent(team.not_approved, team.submissions)}).`
    );
  const main = mainIssue(row, team);
  parts.push(
    `${row.flagged} flagged (${percent(row.flagged, row.submissions)}; team ${percent(team.flagged, team.submissions)})` +
      (main ? `, most often “${checkName(main.check, config)}” (${main.count}).` : '.')
  );
  if (row.duration_minutes !== null)
    parts.push(
      `Median duration ${Math.round(row.duration_minutes)} min` +
        (team.duration_minutes !== null ? ` (team ${Math.round(team.duration_minutes)} min).` : '.')
    );
  if (row.dk_rate !== null)
    parts.push(`Don’t-know answers ${row.dk_rate}%` + (team.dk_rate !== null ? ` (team ${team.dk_rate}%).` : '.'));
  if (row.needs_review > 0) parts.push(`${row.needs_review} waiting for review.`);
  return parts.join(' ');
};
