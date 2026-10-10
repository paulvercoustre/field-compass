import { describe, expect, it } from 'vitest';
import { EnumeratorSummary, SubmissionSummary } from '../types';
import {
  callSummary,
  checkName,
  highlightCheck,
  highlightFlagged,
  highlightNotApproved,
  highlightTopEnumerator,
  mainIssue,
  dailyIssuesPerSubmission,
} from './fieldTeam';

const summary = (over: Partial<SubmissionSummary> = {}): SubmissionSummary => ({
  submissions: 100,
  flagged: 20,
  issues: 30,
  needs_review: 10,
  on_hold: 0,
  clean: 60,
  reviewed: 30,
  approved: 25,
  not_approved: 5,
  issues_per_submission: 0.3,
  duration_minutes: 27,
  duration_measured: 100,
  duration_from_start_end: 0,
  dk_rate: 2.6,
  duration_p25: 21,
  duration_p75: 34,
  checks: { duration_too_short: 10, outlier_income: 4 },
  first_submission: '2026-09-15T08:00:00',
  last_submission: '2026-09-28T15:38:00',
  daily: [],
  ...over,
});

const enumerator = (over: Partial<SubmissionSummary> = {}): EnumeratorSummary => ({
  id: 'enum_07',
  durations: [],
  ...summary({ submissions: 10, flagged: 2, not_approved: 0, checks: {}, ...over }),
});

const team = summary();

describe('highlighting, by the flags against the team', () => {
  it('needs at least twice the team’s share', () => {
    // The team: 20% flagged, 5% not approved.
    expect(highlightFlagged(enumerator({ flagged: 4 }), team)).toBe(true);
    expect(highlightFlagged(enumerator({ flagged: 3 }), team)).toBe(false);
    expect(highlightNotApproved(enumerator({ not_approved: 1 }), team)).toBe(true);
  });

  it('never highlights too few submissions to compare', () => {
    expect(highlightFlagged(enumerator({ submissions: 4, flagged: 4 }), team)).toBe(false);
  });

  it('has nothing to be twice of when the team has none', () => {
    expect(highlightNotApproved(enumerator({ not_approved: 3 }), summary({ not_approved: 0 }))).toBe(false);
  });

  it('works per check', () => {
    // The team: 10% too short, 4% income outliers.
    const row = enumerator({ checks: { duration_too_short: 1, outlier_income: 1 } });
    expect(highlightCheck(row, team, 'duration_too_short')).toBe(false);
    expect(highlightCheck(row, team, 'outlier_income')).toBe(true);
  });

  it('works for the enumerator a check flags most', () => {
    // The check flags 10 of 100 across the team: 10%.
    expect(highlightTopEnumerator({ id: 'e1', flagged: 2, submissions: 10 }, 10, 100)).toBe(true);
    expect(highlightTopEnumerator({ id: 'e1', flagged: 1, submissions: 10 }, 10, 100)).toBe(false);
    expect(highlightTopEnumerator({ id: 'e1', flagged: 4, submissions: 4 }, 10, 100)).toBe(false);
  });
});

describe('the main issue', () => {
  it('prefers a check at twice the team’s share over a more frequent one', () => {
    // Weekends: 30% of theirs, but the team has none to compare with. Income
    // outliers: 10% of theirs against the team's 4%.
    const row = enumerator({ checks: { interview_on_weekend: 3, outlier_income: 1 } });
    expect(mainIssue(row, team)).toEqual({ check: 'outlier_income', count: 1, highlighted: true });
  });

  it('is the most frequent otherwise, and none when nothing flagged them', () => {
    expect(mainIssue(enumerator({ checks: { duration_too_short: 1, interview_on_weekend: 3 } }), team)?.check).toBe(
      'interview_on_weekend'
    );
    expect(mainIssue(enumerator(), team)).toBeNull();
  });
});

describe('words', () => {
  it('names checks for a coordinator', () => {
    expect(checkName('duration_too_short', null)).toBe('Interview too short');
    expect(checkName('outlier_income', null)).toBe('Outlier · income');
    expect(checkName('ai_review', null)).toBe('AI review');
  });

  it('writes a summary of what differs, ready to send', () => {
    const text = callSummary(
      enumerator({
        submissions: 32,
        flagged: 32,
        not_approved: 8,
        needs_review: 20,
        checks: { duration_too_short: 32 },
      }),
      team,
      null
    );
    expect(text).toContain('enum_07, ');
    expect(text).toContain('32 submissions.');
    expect(text).toContain('8 not approved (25%; team 5%).');
    expect(text).toContain('32 flagged (100%; team 20%), most often “Interview too short” (32).');
    expect(text).toContain('Median duration 27 min (team 27 min).');
    expect(text).toContain('20 waiting for review.');
  });

  it('gives issues per submission for each day collected', () => {
    expect(
      dailyIssuesPerSubmission([
        { day: '2026-09-14', submissions: 3, flagged: 1, issues: 2 },
        { day: '2026-09-15', submissions: 2, flagged: 0, issues: 0 },
      ])
    ).toEqual([
      { day: '2026-09-14', value: 0.67 },
      { day: '2026-09-15', value: 0 },
    ]);
  });
});
