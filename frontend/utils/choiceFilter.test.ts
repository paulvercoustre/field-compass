import { describe, expect, it } from 'vitest';
import { offeredChoices } from './choiceFilter';

const districts = [
  { name: 'kabul_city', province: 'kabul', size: '5' },
  { name: 'paghman', province: 'kabul', size: '2' },
  { name: 'herat_city', province: 'herat', size: '4' },
];
const answers: Record<string, string> = { province: 'kabul', crops: 'maize rice', first: 'rice', min: '3' };
const answer = (name: string) => answers[name];

const offered = (expression: string, choices: Array<{ name: string } & Record<string, unknown>> = districts) => {
  const result = offeredChoices(expression, choices, answer);
  return 'offered' in result ? [...result.offered] : result.unknown;
};

const crops = ['maize', 'rice', 'wheat'].map((name) => ({ name }));

describe('offeredChoices', () => {
  it('filters on a column against an answer', () => {
    expect(offered('province=${province}')).toEqual(['kabul_city', 'paghman']);
    expect(offered("province = 'herat' or province=${province}")).toEqual(['kabul_city', 'paghman', 'herat_city']);
    expect(offered('province=${province} and size >= ${min}')).toEqual(['kabul_city']);
    expect(offered('(province != ${province})')).toEqual(['herat_city']);
  });

  it('follows selected, not and the string functions', () => {
    expect(offered('selected(${crops}, name)', crops)).toEqual(['maize', 'rice']);
    expect(offered('not(selected(${crops}, name))', crops)).toEqual(['wheat']);
    expect(offered('name != ${first}', crops)).toEqual(['maize', 'wheat']);
    expect(offered("starts-with(name, 'kabul')")).toEqual(['kabul_city']);
    expect(offered("contains(name, 'city') and count-selected(${crops}) = 2")).toEqual(['kabul_city', 'herat_city']);
  });

  it('treats an unanswered reference as empty', () => {
    expect(offered('province=${never_asked}')).toEqual([]);
  });

  it('says it can’t tell rather than guess', () => {
    // A form saved before choice columns were kept.
    expect(offered('province=${province}', [{ name: 'kabul_city' }, { name: 'herat_city' }])).toBe('columns-missing');
    expect(offered('position(..) = 1')).toBe('unsupported');
    expect(offered('jr:choice-name(${province}, "x")')).toBe('unsupported');
    expect(offered('province=')).toBe('unsupported');
  });
});
