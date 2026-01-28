import { Submission, FilterState } from '../types';
import { SurveyConfig } from '../services/progressApi';

/**
 * Get field value from submission data, handling Kobo path-based field names.
 *
 * Kobo stores fields with full paths like 'module/variable', but config may only
 * specify 'variable'. This function searches for the field by:
 * 1. Direct lookup (exact match)
 * 2. Path-based search (field name at end of path)
 *
 * @param submissionData Submission data dictionary
 * @param fieldName Field name from config (may be just the variable name)
 * @returns Field value or null if not found
 */
export function getFieldValueFromSubmission(submissionData: Record<string, any>, fieldName: string): any {
  // First try direct lookup
  if (fieldName in submissionData) {
    return submissionData[fieldName];
  }

  // Search for fields that end with the field name (path-based)
  // e.g., 'enumerator_id' should match 'sampling_information/enumerator_id'
  for (const key of Object.keys(submissionData)) {
    if (key.endsWith(`/${fieldName}`) || key === fieldName) {
      return submissionData[key];
    }
  }

  // Not found
  return null;
}

/**
 * Extract unique enumerator values from submissions based on survey config.
 *
 * @param submissions All submissions to extract from
 * @param config Survey configuration
 * @returns Array of unique enumerator values (strings)
 */
export function extractUniqueEnumerators(submissions: Submission[], config: SurveyConfig | null): string[] {
  if (!config?.config_data?.core_identifiers?.enumerator) {
    return [];
  }

  const enumeratorField = config.config_data.core_identifiers.enumerator;
  const uniqueValues = new Set<string>();

  for (const submission of submissions) {
    const value = getFieldValueFromSubmission(submission.submission_data, enumeratorField);
    if (value !== null && value !== undefined && value !== '') {
      uniqueValues.add(String(value));
    }
  }

  return Array.from(uniqueValues).sort();
}

/**
 * Extract unique sampling values for a specific variable from submissions.
 *
 * @param submissions All submissions to extract from
 * @param variable Sampling variable name (e.g., 'district')
 * @param config Survey configuration
 * @returns Array of unique values for the sampling variable
 */
export function extractUniqueSamplingValues(
  submissions: Submission[],
  variable: string,
  config: SurveyConfig | null
): string[] {
  if (!config?.config_data?.sampling_frame?.sampling_cols?.includes(variable)) {
    return [];
  }

  const uniqueValues = new Set<string>();

  for (const submission of submissions) {
    const value = getFieldValueFromSubmission(submission.submission_data, variable);
    if (value !== null && value !== undefined && value !== '') {
      uniqueValues.add(String(value));
    }
  }

  return Array.from(uniqueValues).sort();
}

/**
 * Build URL search parameters from filter state for API calls.
 *
 * @param filters Current filter state
 * @returns URLSearchParams object with filter parameters
 */
export function buildFilterParams(filters: FilterState): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.qaStatuses && filters.qaStatuses.length > 0) {
    // Convert triage to FLAGGED for API
    const apiStatuses = filters.qaStatuses.map(status =>
      status === 'triage' ? 'FLAGGED' : status
    );
    params.append('qa_status', apiStatuses.join(','));
  }

  if (filters.validationStatuses && filters.validationStatuses.length > 0) {
    params.append('validation_status', filters.validationStatuses.join(','));
  }

  if (filters.enumerators && filters.enumerators.length > 0) {
    params.append('enumerator', filters.enumerators.join(','));
  }

  if (filters.samplingFilters && filters.samplingFilters.length > 0) {
    // Format: "variable1=value1,value2;variable2=value3"
    const samplingParts = filters.samplingFilters
      .filter(f => f.values.length > 0)
      .map(f => `${f.variable}=${f.values.join(',')}`);
    if (samplingParts.length > 0) {
      params.append('sampling_filters', samplingParts.join(';'));
    }
  }

  return params;
}

/**
 * Check if any filters are currently active.
 *
 * @param filters Current filter state
 * @returns True if any filter is active, false otherwise
 */
export function hasActiveFilters(filters: FilterState): boolean {
  return !!(
    (filters.qaStatuses && filters.qaStatuses.length > 0) ||
    (filters.validationStatuses && filters.validationStatuses.length > 0) ||
    (filters.enumerators && filters.enumerators.length > 0) ||
    (filters.samplingFilters && filters.samplingFilters.length > 0)
  );
}

/**
 * Check if the survey configuration supports enumerator filtering.
 *
 * @param config Survey configuration
 * @returns True if enumerator filtering is supported
 */
export function supportsEnumeratorFiltering(config: SurveyConfig | null): boolean {
  return !!config?.config_data?.core_identifiers?.enumerator;
}

/**
 * Check if the survey configuration supports sampling variable filtering.
 *
 * @param config Survey configuration
 * @returns True if sampling variable filtering is supported
 */
export function supportsSamplingFiltering(config: SurveyConfig | null): boolean {
  return !!(config?.config_data?.sampling_frame?.sampling_cols?.length);
}

/**
 * Get available sampling variables from survey config.
 *
 * @param config Survey configuration
 * @returns Array of sampling variable names
 */
export function getSamplingVariables(config: SurveyConfig | null): string[] {
  return config?.config_data?.sampling_frame?.sampling_cols || [];
}
