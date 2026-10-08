import { describe, expect, it } from 'vitest';
import { formText, formTextParts } from './formText';

const answers: Record<string, string> = { livelihood_name: 'Gems & Jewelry' };
const answer = (name: string) => answers[name];

describe('form text', () => {
  it('fills references from the answers, and marks the unanswered', () => {
    expect(formText('Which best describes this ${livelihood_name} activity?', answer)).toBe(
      'Which best describes this Gems & Jewelry activity?'
    );
    expect(formText('Living in ${province} since?')).toBe('Living in … since?');
  });

  it('keeps bold and italic as marks', () => {
    expect(formTextParts('How many are **paid** and *not* family?', answer)).toEqual([
      { text: 'How many are ' },
      { text: 'paid', bold: true },
      { text: ' and ' },
      { text: 'not', italic: true },
      { text: ' family?' },
    ]);
    expect(formTextParts('__Note__ _gently_')).toEqual([
      { text: 'Note', bold: true },
      { text: ' ' },
      { text: 'gently', italic: true },
    ]);
  });

  it('leaves names with underscores alone', () => {
    expect(formTextParts('Copy enum_id_2 from the card')).toEqual([{ text: 'Copy enum_id_2 from the card' }]);
  });

  it('drops tags, heading marks and link targets', () => {
    expect(formText('# <span style="color:red">Stop</span> and read [the guide](https://example.org)')).toBe(
      'Stop and read the guide'
    );
  });

  it('fills references inside emphasis', () => {
    expect(formTextParts('**${livelihood_name}** only', answer)[0]).toEqual({ text: 'Gems & Jewelry', bold: true });
  });
});
