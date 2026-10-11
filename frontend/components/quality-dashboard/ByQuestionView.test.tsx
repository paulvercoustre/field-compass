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
  specifies: null,
  outlier_check: false,
  flagged: 0,
  flagged_by: {},
  corrected: 0,
  form_findings: [],
  attention: [],
  dk_by_enumerator: [],
  numbers: null,
  histogram: null,
  choices: [],
  variety: null,
  flagged_days: [],
  asked_days: [],
  corrections: [],
  ...over,
});

const data = (): QuestionsResponse => ({
  submissions: 100,
  form_findings: 2,
  last_day: '2026-09-28',
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
      numbers: { median: 22000 },
      histogram: { start: 0, width: 10000, counts: [20, 30, 25, 10, 4], outliers: [0, 0, 0, 2, 4], below: 0, above: 1 },
      outlier_check: true,
      asked_days: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10, 8],
      flagged_days: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 1],
    }),
    question('water', {
      type: 'select_one',
      dk_allowed: false,
      variety: 0.86,
      choices: [
        { name: 'piped', label: 'Piped water', count: 41, kind: null },
        { name: 'well', label: 'Protected well', count: 21, kind: null },
        { name: 'other', label: 'Other', count: 38, kind: 'other' },
      ],
      other: 38,
      attention: ['often_other'],
    }),
    question('water_other', {
      type: 'text',
      dk_allowed: false,
      condition: "water = 'other'",
      asked: 38,
      answered: 38,
      specifies: 'water',
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
    // Flagged: of the submissions it was asked in, the outlier check's among them.
    expect(row('income').textContent).toContain('9%Outlier');
    expect(row('water').textContent).not.toContain('mostly');
    expect(within(row('school_fees')).getByText('Can never be shown')).toBeTruthy();
    expect(row('school_fees').textContent).toContain("Asked if school_attend = 'maybe'");
    expect(row('hh_size').textContent).toContain('asked of everyone');
  });

  it('puts don’t-know and flagged first', () => {
    const view = render(<ByQuestionView data={data()} config={null} allTime />);
    const headings = view.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headings).toEqual(['Question', 'Don’t-know', 'Flagged', 'Asked in', '“Other”', 'Corrected']);
  });

  it('leaves out the questions that specify an “Other” until asked', () => {
    const view = render(<ByQuestionView data={data()} config={null} allTime />);
    expect(view.queryByText('Label of water_other')).toBeNull();
    expect(view.getByRole('button', { name: /^All, most to look at first/ }).textContent).toContain('4');
    expect(view.container.textContent).toContain('1 question that specifies an “Other” answer is left out');
    fireEvent.click(view.getByRole('button', { name: 'Show them' }));
    const row = view.getByText('Label of water_other').closest('tr')!;
    expect(row.textContent).toContain('specifies water’s “Other”');
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
    const onOpenCheck = vi.fn();
    const view = render(
      <ByQuestionView
        data={data()}
        config={null}
        allTime
        onOpenSubmission={onOpenSubmission}
        onOpenCheck={onOpenCheck}
      />
    );
    fireEvent.click(view.getByRole('button', { name: /Label of income/ }));
    const text = view.container.textContent;
    expect(text).toContain('31% don’t know, recorded by 7 of 8 enumerators. Most of the team');
    expect(text).toContain('Median 22,000');
    expect(text).toContain('1 above 50,000');
    expect(text).toContain('Outlier9% · 9');
    expect(text).toContain('Flagged as outliers');
    expect(text).not.toContain('Furthest');
    // A flag opens the submissions it flagged.
    fireEvent.click(view.getByRole('button', { name: 'Outlier' }));
    expect(onOpenCheck).toHaveBeenCalledWith('outlier_income');
    expect(view.getByRole('img', { name: /^3 flagged in the 14 days to / })).toBeTruthy();
    expect(text).toContain('950000 → 95000');
    fireEvent.click(view.getByRole('button', { name: '#300246' }));
    expect(onOpenSubmission).toHaveBeenCalledWith(300246);
  });

  it('offers the outlier check for a number question it is off for, without working outliers out', () => {
    const onOpenSettings = vi.fn();
    const view = render(<ByQuestionView data={data()} config={null} allTime onOpenSettings={onOpenSettings} />);
    fireEvent.click(view.getByRole('button', { name: /Label of hh_size/ }));
    expect(view.container.textContent).toContain('The outlier check is off for this question.');
    fireEvent.click(view.getByRole('button', { name: 'Turn it on in Settings' }));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it('charts a choice question’s answers, Other picked out, with its variety', () => {
    const view = render(<ByQuestionView data={data()} config={null} allTime />);
    fireEvent.click(view.getByRole('button', { name: /Label of water/ }));
    const text = view.container.textContent;
    expect(text).toContain('Piped water41% · 41');
    expect(text).toContain('Answer variety 86%');
    const otherBar = view.getByTitle('Other').parentElement!.querySelector('.bg-amber-600');
    expect(otherBar).toBeTruthy();
  });

  it('says when there is no form', () => {
    const view = render(
      <ByQuestionView data={{ ...data(), form_missing: true, questions: [] }} config={null} allTime />
    );
    expect(view.container.textContent).toContain('No form is stored for this survey');
  });
});
