import { describe, expect, it } from 'vitest';
import { QuestionRow } from '../types';
import { answerText, lensCount, lensRows, secondsText, signals } from './questions';

const row = (name: string, over: Partial<QuestionRow> = {}): QuestionRow =>
  ({
    name,
    label: name,
    group: '',
    order: 0,
    asked: 100,
    answered: 100,
    dk_allowed: true,
    dk: 0,
    dk_enumerators: 0,
    answer_enumerators: 8,
    other: null,
    flagged: 0,
    flagged_by: {},
    corrected: 0,
    condition: null,
    attention: [],
    form_findings: [],
    time: null,
    ...over,
  }) as QuestionRow;

const time = (over: Partial<NonNullable<QuestionRow['time']>> = {}): NonNullable<QuestionRow['time']> => ({
  timed: 100,
  median_seconds: 12,
  rushed: 0,
  rushed_under: 4,
  pace: 1,
  screen_with: 0,
  bin_width: 5,
  bins: [10, 60, 30],
  rushed_bins: [10, 0, 0],
  ...over,
});

describe('what stands out', () => {
  it('says each reason in words, a flag under the line plainly', () => {
    const income = row('income', {
      dk: 31,
      dk_enumerators: 7,
      flagged: 6,
      flagged_by: { outlier_income: 6 },
      attention: ['many_dk', 'slow'],
      time: time({ median_seconds: 41, pace: 2.3 }),
    });
    expect(signals(income, 100, null)).toEqual([
      { kind: 'Don’t-know', text: '31% don’t know, 7 of 8 enumerators', strong: true },
      { kind: 'Checks', text: '6% flagged, Outlier', strong: false },
      { kind: 'Time', text: 'Slow: 41 s, 2.3× the form’s pace', strong: true },
    ]);
  });

  it('says how rarely, and when, a question is asked', () => {
    const remit = row('remit', { asked: 4, condition: 'remit = yes', attention: ['rarely_asked'] });
    expect(signals(remit, 147, null)).toEqual([{ kind: 'Reach', text: 'Asked in 3%: if remit = yes', strong: true }]);
  });
});

describe('lenses', () => {
  const questions = [
    row('income', { order: 2, dk: 31, attention: ['many_dk'] }),
    row('consent', { order: 0, dk_allowed: false, attention: ['rushed'], time: time({ rushed: 18 }) }),
    row('water', { order: 1, dk_allowed: false, other: 38, attention: ['often_other'] }),
    row('hh_size', { order: 3, dk: 2, time: time({ pace: 0.9 }) }),
  ];

  it('keeps the backend’s order for Worth a look, and the form’s for All', () => {
    expect(lensRows('look', questions, 100, null).map((q) => q.name)).toEqual(['income', 'consent', 'water']);
    expect(lensRows('all', questions, 100, null).map((q) => q.name)).toEqual(['consent', 'water', 'income', 'hh_size']);
  });

  it('sorts a lens by its own signal, and counts the ones worth a look in it', () => {
    expect(lensRows('dk', questions, 100, null).map((q) => q.name)).toEqual(['water', 'income', 'hh_size']);
    expect(lensRows('time', questions, 100, null).map((q) => q.name)).toEqual(['consent', 'hh_size']);
    expect([lensCount('dk', questions, 100, null), lensCount('time', questions, 100, null)]).toEqual([2, 1]);
  });
});

describe('words for numbers', () => {
  it('reads a blank as blank', () => {
    expect([answerText(null), answerText(''), answerText('950000'), answerText(['a'])]).toEqual([
      'blank',
      'blank',
      '950000',
      '["a"]',
    ]);
  });

  it('says seconds as people do', () => {
    expect([secondsText(41), secondsText(3.25), secondsText(125)]).toEqual(['41 s', '3.3 s', '2 min 5 s']);
  });
});
