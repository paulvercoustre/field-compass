import { describe, expect, it } from 'vitest';
import { QAStatus, Submission } from '../../types';
import { SurveyConfig, ValidationRule } from '../../services/progressApi';
import { buildCheckList, passedCount } from './AllChecks';

const submission = (checks: string[], data: Record<string, unknown> = {}): Submission => ({
  _id: 1,
  _uuid: 'u',
  _submission_time: '2026-09-28T10:00:00Z',
  end: '2026-09-28T10:30:00Z',
  submission_data: data,
  is_edited: false,
  has_edit_history: false,
  data_quality_issues: checks.map((check) => ({ check, field: 'f', value: null, message: '' })),
  qa_status: QAStatus.PENDING_APPROVAL,
});

const config = (configData: SurveyConfig['config_data']): SurveyConfig =>
  ({ survey_id: 's', survey_name: 'S', kobo_asset_id: null, config_data: configData }) as SurveyConfig;

const lines = (groups: ReturnType<typeof buildCheckList>) =>
  Object.fromEntries(groups.flatMap((g) => g.lines.map((l) => [l.key, l])));

describe('buildCheckList', () => {
  it('says a check could not run, and what it needs', () => {
    const groups = buildCheckList({
      submission: submission([]),
      config: config({ core_identifiers: {}, quality_checks: { flag_weekend: true } }),
      rules: [],
    });
    expect(lines(groups).interview_on_weekend).toMatchObject({
      state: 'not_run',
      note: 'Needs the interview date question',
      fix: 'settings',
    });
  });

  it('lists flagged outliers by question and sums up the rest', () => {
    const groups = buildCheckList({
      submission: submission(['outlier_income']),
      config: config({
        quality_checks: { flag_outliers: true, outlier_variables: ['income', 'age', 'size'] },
      }),
      rules: [],
    });
    const byKey = lines(groups);
    expect(byKey.outlier_income.state).toBe('flagged');
    expect(byKey['outliers-in-range']).toMatchObject({ label: 'Outliers · 2 other questions', state: 'passed' });
  });

  it('marks custom checks that fired and counts what passed', () => {
    const rule = (id: string) =>
      ({
        rule_id: id,
        survey_id: 's',
        rule_name: id,
        rule_data: { check_id: id, issue: '', check_expression: '' },
        is_active: true,
      }) as ValidationRule;
    const groups = buildCheckList({
      submission: submission(['r1']),
      config: config({ global_parameters: { min_survey_duration_minutes: 10 } }),
      rules: [rule('r1'), rule('r2')],
    });
    expect(groups.map((g) => g.title)).toEqual(['Interview', 'Your checks']);
    expect(lines(groups)['rule-r1'].state).toBe('flagged');
    // missing_uuid and r2 passed; the duration check has nothing to measure.
    expect(passedCount(groups)).toBe(2);
    expect(lines(groups).duration_too_short.state).toBe('not_run');
  });
});
