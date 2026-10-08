import { FilterState, ReviewTab, Submission } from '../types';

/** The enumerator filter's value for submissions with no enumerator recorded. */
export const NO_ENUMERATOR = '__none__';

/**
 * The query parameters for /api/submissions and /api/submissions/facets.
 * Sort only orders the list, so the counts leave it out.
 */
export function buildFilterParams(filters: FilterState, { withSort = true } = {}): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.review) params.append('review', filters.review);
  if (filters.issues?.length) params.append('issue', filters.issues.join(','));
  if (filters.enumerators?.length) params.append('enumerator', filters.enumerators.join(','));

  // Format: "variable1=value1,value2;variable2=value3"
  const samplingParts = (filters.samplingFilters ?? [])
    .filter((f) => f.values.length > 0)
    .map((f) => `${f.variable}=${f.values.join(',')}`);
  if (samplingParts.length > 0) params.append('sampling_filters', samplingParts.join(';'));

  const search = filters.search?.trim();
  if (search) params.append('q', search);
  if (withSort && filters.sort) params.append('sort', filters.sort);

  if (filters.validationStatuses?.length) params.append('validation_status', filters.validationStatuses.join(','));
  if (filters.aiReview) params.append('ai_review', filters.aiReview);
  if (filters.transcript) params.append('transcript', filters.transcript);

  return params;
}

/** How many filter-menu choices are on (issues, enumerators, groups); not the tab, search or context. */
export function menuFilterCount(filters: FilterState): number {
  return (
    (filters.issues?.length ?? 0) +
    (filters.enumerators?.length ?? 0) +
    (filters.samplingFilters ?? []).reduce((sum, f) => sum + f.values.length, 0)
  );
}

/** Where a submission stands in review; mirrors review_state() in backend/services/review_queue.py. */
export function reviewState(submission: Submission): ReviewTab | 'clean' {
  const status = (submission.kobo_validation_status ?? '').trim();
  if (status.toLowerCase() === 'on hold') return 'on_hold';
  if (status) return 'reviewed';
  return submission.data_quality_issues.length > 0 ? 'needs_review' : 'clean';
}

/**
 * Whether a submission still belongs in the list after its status changed:
 * its tab, and a validation-status filter a link may have set. The other
 * filters look at answers and findings, which a decision doesn't change.
 */
export function stillMatches(submission: Submission, filters: FilterState): boolean {
  const tab = filters.review ?? 'all';
  if (tab !== 'all' && reviewState(submission) !== tab) return false;
  const statuses = filters.validationStatuses;
  if (statuses?.length) {
    const status = submission.kobo_validation_status || 'Not Reviewed';
    if (!statuses.includes(status)) return false;
  }
  return true;
}
