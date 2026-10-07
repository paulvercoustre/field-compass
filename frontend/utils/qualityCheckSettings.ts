/**
 * The quality checks a survey's settings page edits: what a new survey starts
 * with, and which keys each section of the page saves.
 */

export const GENERAL_FLAG_KEYS = [
  'flag_out_of_period',
  'flag_weekend',
  'weekend_days',
  'flag_office_hours',
  'office_hours_start',
  'office_hours_end',
  'flag_sampling_frame',
  'flag_dk_percentage',
  'dk_percentage_threshold',
  'flag_empty_percentage',
  'empty_percentage_threshold',
] as const;
/** Whether a setting is unchanged; lists compare as sets, so the order days were ticked in doesn't count. */
export const sameSetting = (a: unknown, b: unknown) =>
  Array.isArray(a) && Array.isArray(b) ? JSON.stringify([...a].sort()) === JSON.stringify([...b].sort()) : a === b;
export const OUTLIER_KEYS = [
  'flag_outliers',
  'outlier_variables',
  'outlier_log_transform_variables',
  'outlier_method',
  'outlier_threshold',
] as const;
export const LLM_KEYS = ['flag_llm_qualitative', 'llm_qualitative_fields', 'llm_check_types'] as const;

/** A new survey's quality checks; also what an unsaved key falls back to. */
export const DEFAULT_QUALITY_CHECKS = {
  flag_out_of_period: false,
  flag_weekend: false,
  weekend_days: [5, 6], // Default to Sat, Sun
  flag_office_hours: false,
  office_hours_start: '08:00',
  office_hours_end: '17:00',
  flag_sampling_frame: false,
  flag_outliers: false,
  outlier_variables: [] as string[],
  outlier_log_transform_variables: [] as string[],
  outlier_method: 'iqr' as 'iqr' | 'mad' | 'zscore',
  outlier_threshold: 1.5,
  flag_dk_percentage: false,
  dk_percentage_threshold: 50,
  flag_empty_percentage: false,
  empty_percentage_threshold: 50,
  flag_llm_qualitative: false,
  llm_qualitative_fields: [] as string[],
  llm_check_types: ['content_quality', 'relevance', 'completeness'] as Array<
    'content_quality' | 'relevance' | 'completeness'
  >,
};

export const pick = <T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Pick<T, K> =>
  Object.fromEntries(keys.map((key) => [key, obj[key]])) as Pick<T, K>;

export type QualityChecksForm = typeof DEFAULT_QUALITY_CHECKS;
