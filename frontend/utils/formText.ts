/**
 * Form text as Kobo shows it to the enumerator: `${question}` references
 * filled with the submission's answers, and the markdown Enketo understands
 * (bold, italic, headings, links, inline HTML) turned into plain text with
 * bold and italic kept as marks.
 */

export interface TextPart {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

/** An answer by question name, as it should read in a sentence; undefined when there is none. */
export type AnswerText = (question: string) => string | undefined;

const REFERENCE = /\$\{([^}\s]+)\}/g;

// Shown in place of a reference with no answer to put there.
const UNANSWERED = '…';

const fillReferences = (text: string, answer?: AnswerText): string =>
  text.replace(REFERENCE, (_, name: string) => answer?.(name) || UNANSWERED);

// Markup with nothing to show: tags (`<span style=…>`), heading marks, link targets.
const unwrap = (text: string): string =>
  text
    .replace(/<[^>]+>/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

// **bold** or __bold__, *italic*, or _italic_ that is not part of a word (snake_case stays as it is).
const EMPHASIS =
  /(\*\*|__)(?=\S)([\s\S]+?)(?<=\S)\1|(?<![\w*])\*(?=\S)([^*]+?)(?<=\S)\*(?!\*)|(?<![\w])_(?=\S)([^_]+?)(?<=\S)_(?!\w)/g;

/** A label as parts, with references filled and bold and italic marked. */
export function formTextParts(label: string, answer?: AnswerText): TextPart[] {
  const text = unwrap(label);
  const parts: TextPart[] = [];
  let at = 0;
  for (const match of text.matchAll(EMPHASIS)) {
    if (match.index! > at) parts.push({ text: text.slice(at, match.index) });
    if (match[2] !== undefined) parts.push({ text: match[2], bold: true });
    else parts.push({ text: match[3] ?? match[4], italic: true });
    at = match.index! + match[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts.map((part) => ({ ...part, text: fillReferences(part.text, answer) })).filter((part) => part.text !== '');
}

/** A label as plain text, for places that can't show emphasis: titles, tooltips, filter options. */
export const formText = (label: string, answer?: AnswerText): string =>
  formTextParts(label, answer)
    .map((part) => part.text)
    .join('');
