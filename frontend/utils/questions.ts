/**
 * Data quality by question: when a question is worth a look, and how to say
 * what its numbers mean (docs/ui-ux-review/wireframes/W6-field-team-data-quality-progress.md, E1).
 * The thresholds themselves are the backend's (services/questions.py).
 */
import { QuestionAttention, QuestionRow } from '../types';

/** Why a question is worth a look, in the order the filters show them. */
export const ATTENTION: { id: QuestionAttention; label: string }[] = [
  { id: 'never_shown', label: 'Can never be shown' },
  { id: 'rarely_asked', label: 'Rarely asked' },
  { id: 'many_dk', label: 'Many don’t-know' },
  { id: 'often_other', label: 'Often “Other”' },
  { id: 'often_corrected', label: 'Often corrected' },
];

/**
 * Who records "don't know" on a question: most of the team, which points at
 * the wording or the translation; one enumerator, which points at them; or
 * neither, when there is nothing to tell.
 */
export const dkSpread = (row: QuestionRow): { team: true } | { one: string } | null => {
  if (row.dk === 0) return null;
  if (row.answer_enumerators >= 3 && row.dk_enumerators / row.answer_enumerators >= 0.5) return { team: true };
  const recording = row.dk_by_enumerator.filter((e) => e.dk > 0);
  return recording.length === 1 && row.answer_enumerators >= 2 ? { one: recording[0].id } : null;
};

/** An answer as it was or became in a correction. */
export const answerText = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return 'blank';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};
