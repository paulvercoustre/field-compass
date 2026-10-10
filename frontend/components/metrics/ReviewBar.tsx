import React from 'react';
import { SubmissionSummary } from '../../types';
import { GLOSSARY, Term } from '../../utils/glossary';

/** The review states a link opens in Submissions. Clean has no tab of its own. */
export type ReviewCount = 'needs_review' | 'on_hold' | 'approved' | 'not_approved';

export interface ReviewPart {
  key: ReviewCount | 'clean';
  term: Term;
  count: number;
  colour: string;
}

/** Where every submission stands in review: the five parts add up to the submissions. */
export const reviewParts = (summary: SubmissionSummary): ReviewPart[] => [
  { key: 'needs_review', term: GLOSSARY.needsReview, count: summary.needs_review, colour: 'bg-amber-600' },
  { key: 'on_hold', term: GLOSSARY.onHold, count: summary.on_hold, colour: 'bg-amber-300' },
  { key: 'clean', term: GLOSSARY.clean, count: summary.clean, colour: 'bg-gray-300 dark:bg-gray-600' },
  { key: 'approved', term: GLOSSARY.approved, count: summary.approved, colour: 'bg-emerald-600' },
  { key: 'not_approved', term: GLOSSARY.notApproved, count: summary.not_approved, colour: 'bg-rose-700' },
];

/** The five parts as one bar, each as wide as its share. */
const ReviewBar: React.FC<{ parts: ReviewPart[]; className?: string }> = ({ parts, className = 'h-3' }) => (
  <div
    className={`flex gap-0.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800 ${className}`}
    role="img"
    aria-label={parts.map((p) => `${p.term.name} ${p.count}`).join(', ')}
  >
    {parts
      .filter((p) => p.count > 0)
      .map((p) => (
        <span key={p.key} className={p.colour} style={{ flex: `${p.count} 1 0` }} />
      ))}
  </div>
);

export default ReviewBar;
