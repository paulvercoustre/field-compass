import { describe, expect, it } from 'vitest';
import { QAStatus, Submission } from '../types';
import { buildFilterParams, menuFilterCount, reviewState, stillMatches } from './filterUtils';

const submission = (status: string | null, issues = 0): Submission => ({
  _id: 1,
  _uuid: 'u',
  _submission_time: '2026-09-28T10:00:00Z',
  end: '2026-09-28T10:30:00Z',
  submission_data: {},
  is_edited: false,
  has_edit_history: false,
  data_quality_issues: Array.from({ length: issues }, () => ({ check: 'x', field: 'f', value: null, message: 'm' })),
  qa_status: QAStatus.PENDING_APPROVAL,
  kobo_validation_status: status,
});

describe('buildFilterParams', () => {
  it('names every filter the way the API reads it', () => {
    const params = buildFilterParams({
      review: 'needs_review',
      issues: ['duration_too_short', 'outlier_income'],
      enumerators: ['e1'],
      samplingFilters: [
        { variable: 'district', values: ['north', 'south'] },
        { variable: 'empty', values: [] },
      ],
      search: '  many  ',
      sort: 'oldest',
      validationStatuses: ['Approved'],
      aiReview: 'failed',
    });
    expect(Object.fromEntries(params)).toEqual({
      review: 'needs_review',
      issue: 'duration_too_short,outlier_income',
      enumerator: 'e1',
      sampling_filters: 'district=north,south',
      q: 'many',
      sort: 'oldest',
      validation_status: 'Approved',
      ai_review: 'failed',
    });
  });

  it('leaves the sort out of the counts', () => {
    expect(buildFilterParams({ sort: 'oldest' }, { withSort: false }).has('sort')).toBe(false);
  });
});

describe('menuFilterCount', () => {
  it('counts each choice in the filter menu, not the tab or search', () => {
    expect(
      menuFilterCount({
        review: 'all',
        search: 'x',
        issues: ['a', 'b'],
        samplingFilters: [{ variable: 'district', values: ['north'] }],
      })
    ).toBe(3);
  });
});

describe('review state', () => {
  it('follows the backend definition', () => {
    expect(reviewState(submission(null, 2))).toBe('needs_review');
    expect(reviewState(submission(null))).toBe('clean');
    expect(reviewState(submission('On Hold', 1))).toBe('on_hold');
    expect(reviewState(submission('Approved', 1))).toBe('reviewed');
    expect(reviewState(submission('Not Approved'))).toBe('reviewed');
  });

  it('says when a decision takes a submission out of the list', () => {
    expect(stillMatches(submission('Approved', 1), { review: 'needs_review' })).toBe(false);
    expect(stillMatches(submission('Approved', 1), { review: 'all' })).toBe(true);
    expect(stillMatches(submission('On Hold', 1), { review: 'on_hold' })).toBe(true);
    expect(stillMatches(submission(null, 1), { review: 'all', validationStatuses: ['Not Reviewed'] })).toBe(true);
    expect(stillMatches(submission('Approved'), { review: 'all', validationStatuses: ['Not Reviewed'] })).toBe(false);
  });
});
