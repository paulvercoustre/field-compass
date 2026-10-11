import { describe, expect, it } from 'vitest';
import { formLabelColumns, labelColumnOf, labelIn } from './koboLabelUtils';

const fr = { name: 'hh_size', 'label::French (fr)': 'Taille du ménage', 'label::English (en)': 'Household size' };
const frDari = { name: 'hh_size', 'label::French (fr)': 'Taille du ménage', 'label::Dari (prs)': 'اندازه خانوار' };

describe('the label language every screen shows', () => {
  it('is the one chosen in Settings › Form', () => {
    expect(labelColumnOf({ survey: [fr], choices: [], label_column_survey: 'label::French (fr)' })).toBe(
      'label::French (fr)'
    );
  });

  it('is English until one is saved, else the form’s first language', () => {
    expect(labelColumnOf({ survey: [fr], choices: [] })).toBe('label::English (en)');
    expect(labelColumnOf({ survey: [frDari], choices: [] })).toBe('label::French (fr)');
    expect(labelColumnOf(null)).toBe('label::English (en)');
  });

  it('lists the form’s languages in the order they first appear', () => {
    expect(formLabelColumns([frDari, fr])).toEqual(['label::French (fr)', 'label::Dari (prs)', 'label::English (en)']);
  });

  it('falls back to any language a row has, then its name', () => {
    expect(labelIn(fr, 'label::French (fr)', 'hh_size')).toBe('Taille du ménage');
    expect(labelIn(frDari, 'label::English (en)', 'hh_size')).toBe('Taille du ménage');
    expect(labelIn({ name: 'x' }, 'label::English (en)', 'x')).toBe('x');
  });
});
