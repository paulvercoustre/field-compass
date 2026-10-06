import React from 'react';
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
  'Approved': 'green',
  'Not Approved': 'red',
  'On Hold': 'amber',
  'Not Reviewed': 'gray',
};

/** The dot alone, for places where a full pill would be too loud. */
export const statusDotClass = (status: string): string => dotClass[statusTone[status] ?? 'gray'];

export const EditIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4 mr-1' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
);

export const AlertIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4 mr-1' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
        <path d="M12 9v4M12 17h.01" />
    </svg>
);
