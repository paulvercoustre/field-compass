import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuestionRow, QuestionsResponse } from '../../types';
import ByQuestionView from './ByQuestionView';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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
  order: 0,
  time: null,
  ...over,
});

const time = (over: Partial<NonNullable<QuestionRow['time']>> = {}): NonNullable<QuestionRow['time']> => ({
  timed: 90,
  median_seconds: 12,
  rushed: 2,
  rushed_under: 4,
  pace: 1,
  screen_with: 0,
  bin_width: 5,
  bins: [10, 50, 30],
  rushed_bins: [2, 0, 0],
  ...over,
});

// In the backend's order: the ones to look at first on top.
const data = (over: Partial<QuestionsResponse> = {}): QuestionsResponse => ({
  submissions: 100,
  form_findings: 2,
  last_day: '2026-09-28',
  form_missing: false,
  logic_missing: false,
  timed_submissions: 90,
  form_pace: 0.6,
  questions: [
    question('income', {
      order: 3,
      dk: 31,
      dk_enumerators: 7,
      attention: ['many_dk', 'often_flagged', 'often_corrected', 'slow'],
      flagged: 22,
      flagged_by: { outlier_income: 22 },
      outlier_check: true,
      corrected: 6,
      corrections: [{ submission_id: 300246, old: '950000', new: '95000' }],
      numbers: { median: 22000 },
      histogram: { start: 0, width: 10000, counts: [20, 30, 25, 10, 4], outliers: [0, 0, 0, 2, 4], below: 0, above: 1 },
      asked_days: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10, 8],
      flagged_days: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 1],
      time: time({ median_seconds: 41, pace: 2.3, rushed: 5, rushed_under: 13.7 }),
    }),
    question('consent', {
      order: 0,
      type: 'select_one',
      dk_allowed: false,
      attention: ['rushed'],
      time: time({ timed: 100, rushed: 18, rushed_under: 4, pace: 0.8 }),
    }),
    question('water', {
      order: 2,
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
    question('school_fees', {
      order: 5,
      condition: "school_attend = 'maybe'",
      asked: 0,
      answered: 0,
      attention: ['never_shown'],
      form_findings: [{ check_id: 'unreachable_question', message: '“Fees” can never be shown' }],
    }),
    question('hh_size', { order: 1, time: time({ screen_with: 2, pace: null }) }),
    question('water_other', {
      order: 4,
      type: 'text',
      dk_allowed: false,
      condition: "water = 'other'",
      asked: 38,
      answered: 38,
      specifies: 'water',
    }),
  ],
  ...over,
});

const names = (view: ReturnType<typeof render>) =>
  within(view.getAllByRole('rowgroup')[1])
    .getAllByRole('row')
    .map((r) => r.querySelector('button span')?.textContent?.replace('Label of ', ''))
    .filter(Boolean);

const tab = (view: ReturnType<typeof render>, name: RegExp) => view.getByRole('tab', { name });

describe('ByQuestionView', () => {
  it('lists what stands out about each question, the ones to look at first on top', () => {
    const view = render(<ByQuestionView data={data()} config={null} allTime />);
    expect(view.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Question', 'What stands out']);
    expect(names(view)).toEqual(['income', 'consent', 'water', 'school_fees']);
    const income = view.getByRole('button', { name: /Label of income/ }).closest('tr')!;
    expect(income.textContent).toContain('Don’t-know31% don’t know, 7 of 8 enumerators');
    expect(income.textContent).toContain('Checks22% flagged, Outlier');
    expect(income.textContent).toContain('TimeSlow: 41 s, 2.3× the form’s pace');
    expect(view.getByText('Rushed: 18% in under 4 s').closest('span')!.className).toContain('bg-amber-100');
    expect(view.container.textContent).toContain('90 with an audit log');
  });

  it('counts what each lens has worth a look', () => {
    const view = render(<ByQuestionView data={data()} config={null} allTime />);
    expect(view.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Worth a look · 4everything that stands out',
      'Don’t-know & “Other” · 2and answer variety',
      'Checks · 1flags, corrections',
      'Time · 2rushed, slow',
      'Reach · 1asked in, Form check',
      'All questions · 5in the form’s order',
    ]);
  });

  it('compares questions on one kind of signal', () => {
    const view = render(<ByQuestionView data={data()} config={null} allTime />);
    fireEvent.click(tab(view, /^Time/));
    expect(view.getAllByRole('columnheader').map((h) => h.textContent?.replace('ⓘ', ''))).toEqual([
      'Question',
      'Rushed',
      'Pace',
      'Median time',
      'Answers, by time',
    ]);
    // Rushed first; a shared screen after the questions timed alone.
    expect(names(view)).toEqual(['consent', 'income', 'hh_size']);
    const consent = view.getByRole('button', { name: /Label of consent/ }).closest('tr')!;
    expect(within(consent).getByText('18%').className).toContain('bg-amber-100');
    const income = view.getByRole('button', { name: /Label of income/ }).closest('tr')!;
    expect(income.textContent).toContain('2.3×slow for its length41 s');
    const screen = view.getByRole('button', { name: /Label of hh_size/ }).closest('tr')!;
    expect(screen.textContent).toContain('not per question');
    expect(screen.textContent).toContain('for the screen, with 2 others');
    expect(view.container.textContent).toContain('(0.6 s a word)');

    fireEvent.click(tab(view, /^Reach/));
    expect(names(view)).toEqual(['school_fees']);
    expect(view.getByText('Can never be shown')).toBeTruthy();

    fireEvent.click(tab(view, /^All questions/));
    expect(names(view)).toEqual(['consent', 'hh_size', 'water', 'income', 'school_fees']);
  });

  it('opens a question in the side panel: the first, else the one picked', () => {
    const onOpenCheck = vi.fn();
    const onOpenSubmission = vi.fn();
    const view = render(
      <ByQuestionView
        data={data()}
        config={null}
        allTime
        onOpenCheck={onOpenCheck}
        onOpenSubmission={onOpenSubmission}
      />
    );
    const panel = () => view.getByRole('complementary');
    expect(panel().getAttribute('aria-label')).toBe('Label of income');
    const text = panel().textContent;
    // Facts, no advice.
    expect(text).toContain('31% don’t know, recorded by 7 of 8 enumerators.');
    expect(text).not.toContain('likelier cause');
    expect(text).toContain('Median 22,000');
    expect(text).not.toContain('middle half');
    expect(text).toContain('Flagged as outliers');
    expect(text).toContain('41 smedian2.3×the form’s pace6%rushed, under 13.7 s');
    expect(view.getByRole('img', { name: /^3 flagged in the 14 days to / })).toBeTruthy();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Outlier' }));
    expect(onOpenCheck).toHaveBeenCalledWith('outlier_income');
    fireEvent.click(within(panel()).getByRole('button', { name: '#300246' }));
    expect(onOpenSubmission).toHaveBeenCalledWith(300246);

    fireEvent.click(view.getByRole('button', { name: /Label of water/ }));
    expect(panel().getAttribute('aria-label')).toBe('Label of water');
    expect(panel().textContent).toContain('Piped water41% · 41');
    expect(panel().textContent).toContain('Answer variety 86%');
  });

  it('offers the outlier check for a number question it is off for', () => {
    const onOpenSettings = vi.fn();
    const view = render(<ByQuestionView data={data()} config={null} allTime onOpenSettings={onOpenSettings} />);
    fireEvent.click(tab(view, /^All questions/));
    fireEvent.click(view.getByRole('button', { name: /Label of hh_size/ }));
    expect(view.getByRole('complementary').textContent).toContain('On one screen with 2 other questions');
    fireEvent.click(view.getByRole('button', { name: 'Turn it on in Settings' }));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it('opens the question in a sheet on a narrow screen', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const view = render(<ByQuestionView data={data()} config={null} allTime />);
    expect(view.queryByRole('complementary')).toBeNull();
    fireEvent.click(view.getByRole('button', { name: /Label of water/ }));
    const sheet = view.getByRole('dialog', { name: 'Label of water' });
    expect(sheet.textContent).toContain('Piped water41% · 41');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    expect(view.queryByRole('dialog')).toBeNull();
  });

  it('leaves out the questions that specify an “Other” until asked', () => {
    const view = render(<ByQuestionView data={data()} config={null} allTime />);
    fireEvent.click(tab(view, /^All questions/));
    expect(view.queryByText('Label of water_other')).toBeNull();
    expect(view.container.textContent).toContain('1 question that specifies an “Other” answer is left out');
    fireEvent.click(view.getByRole('button', { name: 'Show them' }));
    expect(view.getByRole('button', { name: /Label of water_other/ }).textContent).toContain(
      'specifies water’s “Other”'
    );
  });

  it('finds a question', () => {
    const view = render(<ByQuestionView data={data()} config={null} allTime />);
    fireEvent.change(view.getByRole('searchbox', { name: 'Find a question' }), { target: { value: 'fees' } });
    expect(names(view)).toEqual(['school_fees']);
  });

  it('says how to get time when there are no audit logs', () => {
    const questions = data().questions.map((q) => ({
      ...q,
      time: null,
      attention: q.attention.filter((a) => a !== 'slow' && a !== 'rushed'),
    }));
    const view = render(<ByQuestionView data={data({ timed_submissions: 0, questions })} config={null} allTime />);
    fireEvent.click(tab(view, /^Time/));
    expect(view.container.textContent).toContain('No audit logs, so no time per question');
  });

  it('says when there is no form', () => {
    const view = render(
      <ByQuestionView data={{ ...data(), form_missing: true, questions: [] }} config={null} allTime />
    );
    expect(view.container.textContent).toContain('No form is stored for this survey');
  });
});
