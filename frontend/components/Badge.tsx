import React from 'react';
import { QAStatus } from '../types';

interface BadgeProps {
  status: QAStatus | string;  // Allow string for backward compatibility with old status values
  size?: 'sm' | 'lg';
}

type Tone = 'green' | 'red' | 'amber' | 'blue' | 'gray';

// One soft tint per status, with a dot in the full hue. The dot carries the
// colour, so the text can stay dark enough to read.
const tones: Record<Tone, { pill: string; dot: string }> = {
  green: { pill: 'bg-emerald-50 text-emerald-800 ring-emerald-600/15 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20', dot: 'bg-emerald-500' },
  red: { pill: 'bg-rose-50 text-rose-800 ring-rose-600/15 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/20', dot: 'bg-rose-500' },
  amber: { pill: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20', dot: 'bg-amber-500' },
  blue: { pill: 'bg-sky-50 text-sky-800 ring-sky-600/15 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/20', dot: 'bg-sky-500' },
  gray: { pill: 'bg-gray-50 text-gray-700 ring-gray-500/15 dark:bg-gray-500/10 dark:text-gray-300 dark:ring-gray-400/20', dot: 'bg-gray-400' },
};

// Extended status map to handle both new and old status values
const statusTone: Record<string, Tone> = {
  [QAStatus.PENDING_APPROVAL]: 'blue',
  [QAStatus.FLAGGED]: 'red',
  [QAStatus.APPROVED]: 'green',
  [QAStatus.REJECTED]: 'red',
  // Kobo validation status values
  'Approved': 'green',
  'Not Approved': 'red',
  'On Hold': 'amber',
  'Not Reviewed': 'gray',
  // Backward compatibility with old status values
  'HFC_FLAGGED': 'red',
  'PENDING_QA': 'blue',
  'PENDING_RE_QA': 'amber',
};

const statusText: Record<string, string> = {
  [QAStatus.PENDING_APPROVAL]: 'Pending Approval',
  [QAStatus.FLAGGED]: 'Flagged',
  [QAStatus.APPROVED]: 'Approved',
  [QAStatus.REJECTED]: 'Rejected',
  // Kobo validation status values (keep as-is, they're already user-friendly)
  'Approved': 'Approved',
  'Not Approved': 'Not Approved',
  'On Hold': 'On Hold',
  'Not Reviewed': 'Not Reviewed',
  // Backward compatibility with old status values
  'HFC_FLAGGED': 'Flagged',
  'PENDING_QA': 'Pending Approval',
  'PENDING_RE_QA': 'Re-QA Pending',
};

/** The dot alone, for places where a full pill would be too loud. */
export const statusDotClass = (status: string): string => tones[statusTone[status] ?? 'gray'].dot;

export const Badge: React.FC<BadgeProps> = ({ status, size = 'sm' }) => {
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs gap-1.5' : 'px-2.5 py-1 text-sm gap-2';
  const tone = tones[statusTone[status] ?? 'gray'];
  const text = statusText[status] || status;
  return (
    <span className={`inline-flex flex-shrink-0 items-center whitespace-nowrap font-medium rounded-full ring-1 ring-inset ${sizeClasses} ${tone.pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden="true" />
      {text}
    </span>
  );
};

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
