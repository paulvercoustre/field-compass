/**
 * Data quality by question: what stands out about each question, and the
 * lenses that compare questions on one kind of signal
 * (docs/ui-ux-review/wireframes/W6-field-team-data-quality-progress.md, E2 and E3).
 * The thresholds themselves are the backend's (services/questions.py).
 */
import { QuestionAttention, QuestionRow } from '../types';
import { SurveyConfig } from '../services/progressApi';
import { checkName } from './fieldTeam';
import { formatPercent, percentOf } from './glossary';

/** A number as people write it: 22,000, 2.5, no more than two decimals. */
export const plainNumber = (n: number): string => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

/** A share as shown, never over 100%: a flag can name a question its condition hid. */
export const shareText = (part: number, whole: number): string =>
  formatPercent(Math.min(100, percentOf(part, whole) ?? 0));

/** A check's name on a question's row, where the outlier check needs no question. */
export const flagName = (check: string, config: SurveyConfig | null): string =>
  check.startsWith('outlier_') ? 'Outlier' : checkName(check, config);

const topCheck = (q: QuestionRow): string | undefined =>
  Object.entries(q.flagged_by).sort((a, b) => b[1] - a[1])[0]?.[0];

export type Lens = 'look' | 'dk' | 'checks' | 'time' | 'reach' | 'all';

/** The lenses, in the order shown: everything that stands out first, then one per kind of signal. */
export const LENSES: { id: Lens; label: string; hint: string; reasons?: QuestionAttention[] }[] = [
  { id: 'look', label: 'Worth a look', hint: 'everything that stands out' },
  { id: 'dk', label: 'Don’t-know & “Other”', hint: 'and answer variety', reasons: ['many_dk', 'often_other'] },
  { id: 'checks', label: 'Checks', hint: 'flags, corrections', reasons: ['often_flagged', 'often_corrected'] },
  { id: 'time', label: 'Time', hint: 'rushed, slow', reasons: ['rushed', 'slow'] },
  { id: 'reach', label: 'Reach', hint: 'asked in, Form check', reasons: ['never_shown', 'rarely_asked'] },
  { id: 'all', label: 'All questions', hint: 'in the form’s order' },
];

export interface Signal {
  /** The kind, said in the chip: Don't-know, "Other", Checks, Time, Reach. */
  kind: string;
  text: string;
  /** Over the line: highlighted. A flag under it still shows, plainly. */
  strong: boolean;
}

/**
 * What stands out about a question, in words: one per reason to look, and its
 * flags. `total`: the submissions in view, which Asked in is a share of.
 */
export const signals = (q: QuestionRow, total: number, config: SurveyConfig | null): Signal[] => {
  const has = (reason: QuestionAttention) => q.attention.includes(reason);
  const out: Signal[] = [];
  if (has('many_dk'))
    out.push({
      kind: 'Don’t-know',
      text: `${shareText(q.dk, q.answered)} don’t know, ${q.dk_enumerators} of ${q.answer_enumerators} enumerators`,
      strong: true,
    });
  if (has('often_other') && q.other !== null)
    out.push({ kind: '“Other”', text: `${shareText(q.other, q.answered)} “Other”`, strong: true });
  const check = topCheck(q);
  if (q.flagged > 0 && check)
    out.push({
      kind: 'Checks',
      text: `${shareText(q.flagged, q.asked)} flagged, ${flagName(check, config)}`,
      strong: has('often_flagged'),
    });
  if (has('often_corrected')) out.push({ kind: 'Checks', text: `Corrected in ${q.corrected}`, strong: true });
  const time = q.time;
  if (time && has('rushed'))
    out.push({
      kind: 'Time',
      text: `Rushed: ${shareText(time.rushed, time.timed)} in under ${plainNumber(time.rushed_under)} s`,
      strong: true,
    });
  if (time && has('slow') && time.pace !== null)
    out.push({
      kind: 'Time',
      text: `Slow: ${plainNumber(time.median_seconds)} s, ${plainNumber(time.pace)}× the form’s pace`,
      strong: true,
    });
  if (has('never_shown'))
    out.push({ kind: 'Reach', text: 'Can never be shown: Form check found its condition can’t hold', strong: true });
  if (has('rarely_asked'))
    out.push({
      kind: 'Reach',
      text: `Asked in ${shareText(q.asked, total)}${q.condition ? `: if ${q.condition}` : ''}`,
      strong: true,
    });
  return out;
};

const share = (part: number, whole: number) => (whole > 0 ? part / whole : 0);

/**
 * The questions a lens shows, in its order. Worth a look keeps the backend's
 * order, the ones to look at first on top; the others sort by their own
 * signal; All questions follows the form.
 */
export const lensRows = (
  lens: Lens,
  questions: QuestionRow[],
  total: number,
  config: SurveyConfig | null
): QuestionRow[] => {
  const by = (rows: QuestionRow[], key: (q: QuestionRow) => number) =>
    [...rows].sort((a, b) => key(b) - key(a) || a.order - b.order);
  switch (lens) {
    case 'look':
      return questions.filter((q) => signals(q, total, config).length > 0);
    case 'dk':
      return by(
        questions.filter((q) => q.dk_allowed || q.other !== null),
        (q) => Math.max(share(q.dk, q.answered), share(q.other ?? 0, q.answered))
      );
    case 'checks':
      return by(
        questions.filter((q) => q.flagged > 0 || q.corrected > 0),
        (q) => share(q.flagged, Math.max(q.asked, q.answered)) * 1000 + q.corrected
      );
    case 'time':
      // Rushed first, then slow; a shared screen after the questions timed alone.
      return by(
        questions.filter((q) => q.time),
        (q) => (q.time!.screen_with ? 0 : 1000) + share(q.time!.rushed, q.time!.timed) * 100 + (q.time!.pace ?? 0) / 100
      );
    case 'reach':
      return by(
        questions.filter((q) => q.condition || q.attention.includes('never_shown')),
        (q) => (q.attention.includes('never_shown') ? 2 : 1 - share(q.asked, total))
      );
    case 'all':
      return [...questions].sort((a, b) => a.order - b.order);
  }
};

/** How many a lens has worth a look: its reasons; for Worth a look and All, its rows. */
export const lensCount = (lens: Lens, questions: QuestionRow[], total: number, config: SurveyConfig | null): number => {
  const reasons = LENSES.find((l) => l.id === lens)?.reasons;
  if (!reasons) return lensRows(lens, questions, total, config).length;
  return questions.filter((q) => q.attention.some((a) => reasons.includes(a))).length;
};

/** An answer as it was or became in a correction. */
export const answerText = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return 'blank';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

/** "41 s", "2 min 5 s". */
export const secondsText = (seconds: number): string =>
  seconds < 60
    ? `${plainNumber(Math.round(seconds * 10) / 10)} s`
    : `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
