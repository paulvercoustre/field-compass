import { describe, expect, it } from 'vitest';
import { QuestionRow } from '../types';
import { answerText, dkSpread } from './questions';

const row = (over: Partial<QuestionRow>): QuestionRow =>
  ({ dk: 0, dk_enumerators: 0, answer_enumerators: 0, dk_by_enumerator: [], ...over }) as QuestionRow;

describe('who records don’t-know', () => {
  it('points at the wording when most of the team does', () => {
    expect(dkSpread(row({ dk: 9, dk_enumerators: 5, answer_enumerators: 8 }))).toEqual({ team: true });
  });

  it('points at one enumerator when only they do', () => {
    const one = row({
      dk: 4,
      dk_enumerators: 1,
      answer_enumerators: 6,
      dk_by_enumerator: [
        { id: 'enum_05', dk: 4, answers: 10 },
        { id: 'enum_01', dk: 0, answers: 9 },
      ],
    });
    expect(dkSpread(one)).toEqual({ one: 'enum_05' });
  });

  it('says nothing when there is nothing to tell', () => {
    expect(dkSpread(row({ dk: 0 }))).toBeNull();
    expect(dkSpread(row({ dk: 2, dk_enumerators: 1, answer_enumerators: 4, dk_by_enumerator: [] }))).toBeNull();
  });
});

describe('answers in a correction', () => {
  it('reads a blank as blank', () => {
    expect([answerText(null), answerText(''), answerText('950000'), answerText(['a'])]).toEqual([
      'blank',
      'blank',
      '950000',
      '["a"]',
    ]);
  });
});
