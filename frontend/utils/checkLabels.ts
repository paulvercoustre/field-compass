/**
 * Human names for check IDs, for screens that list issues by type.
 *
 * Check IDs are the backend's keys (`duration_too_short`,
 * `outlier_livestock_count`, `qual_content_quality`); field staff should not
 * have to decode them. Custom rules carry their own IDs and fall back to a
 * de-snaked version of it.
 */
const CHECK_LABELS: Record<string, string> = {
  missing_uuid: 'Missing submission ID',
  missing_enumerator: 'Missing enumerator',
  date_out_of_range: 'Interview date outside collection period',
  interview_on_weekend: 'Interview on a weekend',
  interview_out_of_office_hours: 'Interview outside office hours',
  dk_percentage_high: "Too many \"Don't know\" answers",
  empty_percentage_high: 'Too many empty answers',
  duration_too_short: 'Interview too short',
  duration_too_long: 'Interview too long',
  sampling_frame_mismatch: 'Not in the targets file',
  strata_value_not_in_form: 'Target group not in the form',
};

const AI_CHECK_LABELS: Record<string, string> = {
  content_quality: 'content quality',
  relevance: 'relevance',
  completeness: 'completeness',
};

const humanize = (id: string): string => {
  const text = id.replace(/[_-]+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export const checkLabel = (checkId: string): string => {
  if (CHECK_LABELS[checkId]) return CHECK_LABELS[checkId];
  if (checkId.startsWith('outlier_')) return `Unusual value: ${checkId.slice('outlier_'.length)}`;
  if (checkId.startsWith('qual_')) {
    const type = checkId.slice('qual_'.length);
    return `AI review: ${AI_CHECK_LABELS[type] ?? type.replace(/_/g, ' ')}`;
  }
  return humanize(checkId);
};
