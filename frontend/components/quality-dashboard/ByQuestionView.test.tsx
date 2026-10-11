import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuestionRow, QuestionsResponse } from '../../types';
import ByQuestionView from './ByQuestionView';

afterEach(cleanup);

const question = (name: string, over: Partial<QuestionRow> = {}): QuestionRow => ({
  name,
  path: `hh/${name}`,
  label: `Label of ${name}`,
  group: 'Household',
  type: 'integer',
  condition: null,
  asked: 100,
  asked_from_answers: false,
  answered: 100,
  dk_allowed: true,
  dk: 0,
  dk_enumerators: 0,
  answer_enumerators: 8,
  other: null,
  other_top: null,
  other_top_count: 0,
  flagged: 0,
  flagged_by: {},
  corrected: 0,
  form_findings: [],
  attention: [],
  dk_by_enumerator: [],
  numbers: null,
  choices: [],
  corrections: [],
  ...over,
});

const data = (): QuestionsResponse => ({
  submissions: 100,
  form_findings: 2,
  form_missing: false,
  logic_missing: false,
  questions: [
    question('income', {
      dk: 31,
      dk_enumerators: 7,
      attention: ['many_dk', 'often_corrected'],
      flagged: 9,
      flagged_by: { outlier_income: 9 },
      corrected: 6,
      corrections: [{ submission_id: 300246, old: '950000', new: '95000' }],
      dk_by_enumerator: [
        { id: 'enum_03', dk: 9, answers: 22 },
        { id: 'enum_08', dk: 0, answers: 4 },
        { id: 'enum_01', dk: 8, answers: 20 },
      ],
      numbers: { median: 22000, p25: 9000, p75: 41000 },
    }),
    question('water', {
      type: 'select_one',
      dk_allowed: false,
      other: 38,
      other_top: 'tanker truck',
      other_top_count: 20,
      attention: ['often_other'],
    }),
    question('school_fees', {
      condition: "school_attend = 'maybe'",
      asked: 0,
      attention: ['never_shown'],
      form_findings: [{ check_id: 'unreachable_question', message: '“Fees” can never be shown' }],
    }),
    question('hh_size'),
  ],
});

describe('ByQuestionView', () => {
  it('shows the figures, highlighted where worth a look', () => {
    const view = render(<ByQuestionView data={data()} config={null} allTime />);
    const row = (name: string) => view.getByText(`Label of ${name}`).closest('tr')!;
    expect(within(row('income')).getByText('31%').className).toContain('bg-amber-100');
    expect(row('income').textContent).toContain('7 of 8 enumerators');
    expect(row('income').textContent).toContain('9Outlier');
    expect(row('water').textContent).toContain('mostly “tanker truck”');
    expect(within(row('school_fees')).getByText('Can never be shown')).toBeTruthy();
    expect(row('school_fees').textContent).toContain("Asked if school_attend = 'maybe'");
    expect(row('hh_size').textContent).toContain('asked of everyone');
  });

  it('filters to the ones worth a look, and finds a question', () => {
    const view = render(<ByQuestionView data={data()} config={null} allTime />);
    fireEvent.click(view.getByRole('button', { name: /^Often “Other”/ }));
    expect(view.queryByText('Label of income')).toBeNull();
    expect(view.getByText('Label of water')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: /^All, most to look at first/ }));
    fireEvent.change(view.getByRole('searchbox', { name: 'Find a question' }), { target: { value: 'fees' } });
    expect(view.getAllByRole('row')).toHaveLength(2);
  });

  it('opens what is behind a question', () => {
    const onOpenSubmission = vi.fn();
    const view = render(<ByQuestionView data={data()} config={null} allTime onOpenSubmission={onOpenSubmission} />);
    fireEvent.click(view.getByRole('button', { name: /Label of income/ }));
    expect(view.container.textContent).toContain('Most of the team records “don’t know” here');
    expect(view.container.textContent).toContain('22,000');
    expect(view.container.textContent).toContain('950000 → 95000');
    fireEvent.click(view.getByRole('button', { name: '#300246' }));
    expect(onOpenSubmission).toHaveBeenCalledWith(300246);
  });

  it('says when there is no form', () => {
    const view = render(
      <ByQuestionView data={{ ...data(), form_missing: true, questions: [] }} config={null} allTime />
    );
    expect(view.container.textContent).toContain('No form is stored for this survey');
  });
});
