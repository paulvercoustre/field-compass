/**
 * Readable names for issue check IDs, so charts and submissions never show
 * `duration_too_short` or `qual_relevance` to a reviewer.
 *
 * AI findings are named for what is wrong with the answer, and grouped under
 * "AI review" so the source of a flag is always visible.
 */

const AI_REVIEW = 'AI review';

/** What each AI review finding type means (see ai_service.py for the definitions given to the model). */
const AI_FINDING_NAMES: Record<string, string> = {
  content_quality: 'Unreadable answer',
  relevance: 'Off-topic answer',
  completeness: 'Too vague to use',
};

const GENERAL_CHECK_NAMES: Record<string, string> = {
  missing_uuid: 'Missing submission ID',
  missing_enumerator: 'Missing enumerator',
  date_out_of_range: 'Interview date outside collection period',
  interview_on_weekend: 'Interview on a weekend',
  interview_out_of_office_hours: 'Interview outside office hours',
  dk_percentage_high: 'Many “don’t know” answers',
  empty_percentage_high: 'Many empty answers',
  duration_too_short: 'Interview too short',
  duration_too_long: 'Interview too long',
  sampling_frame_mismatch: 'Group not in targets file',
  strata_value_not_in_form: 'Answer not among the question’s options',
  audio_no_speech: 'Recording has no speech',
  audio_language_mismatch: 'Answer in another language',
};

const humanize = (id: string): string => {
  const text = id.replace(/_/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const isAiReviewCheck = (check: string): boolean => check.startsWith('qual_');

/** The finding's own name, without the "AI review" source, for use inside the AI review section. */
export const aiFindingName = (check: string): string => {
  const type = check.replace(/^qual_/, '');
  return AI_FINDING_NAMES[type] ?? humanize(type);
};

/** A check ID as a reviewer should read it, with its source where that is not obvious. */
export const issueName = (check: string): string => {
  if (isAiReviewCheck(check)) return `${AI_REVIEW} · ${aiFindingName(check)}`;
  if (check.startsWith('outlier_')) return `Outlier · ${check.replace(/^outlier_/, '')}`;
  return GENERAL_CHECK_NAMES[check] ?? humanize(check);
};
