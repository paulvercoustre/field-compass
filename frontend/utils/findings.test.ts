import { describe, expect, it } from 'vitest';
import { QualityIssue } from '../types';
import { SurveyConfig, ValidationRule } from '../services/progressApi';
import { describeFindings } from './findings';

const config = {
  survey_id: 's',
  survey_name: 'S',
  kobo_asset_id: null,
  config_data: {
    global_parameters: { min_survey_duration_minutes: 15, max_survey_duration_minutes: 90 },
    kobo_tool: {
      survey: [
        { name: 'income', type: 'integer', roster_name: null, 'label::English (en)': 'Monthly income' },
        { name: 'challenges', type: 'text', roster_name: null, 'label::English (en)': 'Main challenges' },
        { name: 'adults', type: 'integer', roster_name: null, 'label::English (en)': 'Adults' },
        { name: 'working', type: 'integer', roster_name: null, 'label::English (en)': 'Adults working' },
      ],
      choices: [],
    },
  },
} as SurveyConfig;

const issue = (check: string, extra: Partial<QualityIssue> = {}): QualityIssue => ({
  check,
  field: 'submission',
  value: null,
  message: '',
  ...extra,
});

const describe1 = (i: QualityIssue, rules: ValidationRule[] = [], data: Record<string, unknown> = {}) =>
  describeFindings([i], { config, data, rules })[0];

describe('describeFindings', () => {
  it('states a duration against its limit', () => {
    const f = describe1(issue('duration_too_short', { field: 'active_interview_time', value: 6.4 }));
    expect(f).toMatchObject({ title: 'Interview too short', detail: '6 min of active time. Your minimum is 15 min.' });
    expect(f.source).toBe('Check');
    expect(f.question).toBeUndefined();
  });

  it('counts don’t-know answers', () => {
    const f = describe1(
      issue('dk_percentage_high', {
        metadata: {
          dk_count: 9,
          dk_eligible_count: 40,
          dk_percentage: 22.5,
          threshold: 15,
        } as QualityIssue['metadata'],
      })
    );
    expect(f.detail).toBe('9 of 40 answers (23 %). Your limit is 15 %.');
  });

  it('puts an outlier against the expected range, by its question', () => {
    const f = describe1(
      issue('outlier_income', {
        field: 'household/income',
        value: 950000,
        metadata: {
          bounds: { lower_bound: 4000, upper_bound: 85000 },
          statistics: { mean: 32000, median: 21000, count: 147 },
          method: 'iqr',
        },
      })
    );
    expect(f.title).toBe('Monthly income is far above the rest');
    expect(f.range).toEqual({ lower: 4000, upper: 85000, value: 950000 });
    expect(f.question).toBe('income');
    expect(f.source).toBe('Outlier');
    expect(f.stats).toContain('147 answers');
  });

  it('quotes the answer an AI finding is about', () => {
    const f = describe1(
      issue('qual_completeness', {
        field: 'challenges',
        value: 'many problems',
        metadata: { llm_reasoning: 'It names no challenge.' } as QualityIssue['metadata'],
      })
    );
    expect(f).toMatchObject({
      title: 'Too vague to use',
      detail: 'It names no challenge.',
      quote: { question: 'Main challenges', answer: 'many problems' },
      source: 'AI review',
      question: 'challenges',
    });
  });

  it('names a custom check and shows the answers it compared', () => {
    const rule = {
      rule_id: 'r1',
      survey_id: 's',
      rule_name: 'More adults working than adults',
      rule_data: {
        check_id: 'working_gt_adults',
        issue: 'Check the household roster',
        check_expression: 'working > adults',
        variables_involved: ['working', 'adults'],
      },
      is_active: true,
    } as ValidationRule;
    const f = describe1(
      issue('working_gt_adults', { field: 'working', value: 5, message: 'Check the household roster' }),
      [rule],
      {
        working: 5,
        adults: 3,
      }
    );
    expect(f).toMatchObject({
      title: 'More adults working than adults',
      detail: 'Check the household roster Adults working: 5 · Adults: 3',
      source: 'Custom check',
      question: 'working',
    });
  });

  it('reads the weekday out of the weekend message', () => {
    expect(
      describe1(issue('interview_on_weekend', { message: 'Interview conducted on weekend: Saturday' })).detail
    ).toBe('Interviewed on a Saturday.');
  });
});
