import { QAStatus } from '../types';

// The dot carries a status's colour wherever a full pill would be too loud.
const dotClass = {
  green: 'bg-emerald-500',
  red: 'bg-rose-500',
  amber: 'bg-amber-500',
  blue: 'bg-sky-500',
  gray: 'bg-gray-400',
} as const;

type Tone = keyof typeof dotClass;

// QA statuses, and Kobo's validation statuses.
const statusTone: Record<string, Tone> = {
  [QAStatus.PENDING_APPROVAL]: 'blue',
  [QAStatus.FLAGGED]: 'red',
  [QAStatus.APPROVED]: 'green',
  [QAStatus.REJECTED]: 'red',
  Approved: 'green',
  'Not Approved': 'red',
  'On Hold': 'amber',
  'Not Reviewed': 'gray',
};

/** The dot alone, for places where a full pill would be too loud. */
export const statusDotClass = (status: string): string => dotClass[statusTone[status] ?? 'gray'];
