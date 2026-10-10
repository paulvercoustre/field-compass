import React from 'react';
import { SubmissionSummary } from '../../types';
import { GLOSSARY, formatPercent, percentOf } from '../../utils/glossary';
import ReviewBar, { ReviewCount, ReviewPart, reviewParts } from '../metrics/ReviewBar';
import Button from '../ui/Button';
import { Card } from '../ui/Card';
import TermInfo from '../ui/TermInfo';

const DAY_MS = 24 * 60 * 60 * 1000;

/** "sent 15 Sep, 25 days ago". */
const waitedSince = (iso: string, now = new Date()): string => {
  const sent = new Date(iso);
  const days = Math.floor((now.getTime() - sent.getTime()) / DAY_MS);
  const date = sent.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `sent ${date}, ${days <= 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`}`;
};

const State: React.FC<{ part: ReviewPart; total: number; onOpen?: () => void }> = ({ part, total, onOpen }) => {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        <span className={`h-2 w-2 rounded-sm ${part.colour}`} aria-hidden="true" />
        {part.term.name}
      </span>
      <span className="mt-1 flex items-baseline gap-1.5">
        <span className="tabular text-lg font-semibold text-gray-900 dark:text-white">{part.count}</span>
        <span className="tabular text-xs text-gray-500 dark:text-gray-400">
          {formatPercent(percentOf(part.count, total))}
        </span>
      </span>
    </>
  );
  const box =
    'flex h-full w-full flex-col items-start rounded-lg border border-gray-200 px-3 py-2 pr-8 text-left dark:border-gray-800';
  // The ⓘ sits over the corner, beside the button rather than inside it; the
  // button is the whole box, so every part of it opens the tab.
  return (
    <div className="relative">
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className={`${box} transition-colors hover:border-gray-300 hover:bg-gray-50 dark:hover:border-gray-700 dark:hover:bg-gray-900`}
        >
          {body}
        </button>
      ) : (
        <div className={box}>{body}</div>
      )}
      <span className="absolute right-2 top-2">
        <TermInfo term={part.term} />
      </span>
    </div>
  );
};

interface ReviewCardProps {
  summary: SubmissionSummary;
  /** When the oldest submission still in Needs review was sent. */
  oldestNeedsReview: string | null;
  onOpen?: (state: ReviewCount) => void;
}

/**
 * How far review has got: one bar of the five states, each opening its tab
 * in Submissions, and how long the oldest submission has waited.
 */
const ReviewCard: React.FC<ReviewCardProps> = ({ summary, oldestNeedsReview, onOpen }) => {
  const parts = reviewParts(summary);
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Review</h3>
          <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-300">
            {summary.submissions} submissions · {GLOSSARY.reviewed.name} {summary.reviewed} (
            {formatPercent(percentOf(summary.reviewed, summary.submissions))})
          </p>
          {oldestNeedsReview && (
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              Oldest still waiting: {waitedSince(oldestNeedsReview)}
            </p>
          )}
        </div>
        {onOpen && summary.needs_review > 0 && (
          <Button variant="primary" onClick={() => onOpen('needs_review')}>
            Open {GLOSSARY.needsReview.name} {summary.needs_review}
          </Button>
        )}
      </div>
      <ReviewBar parts={parts} className="mt-3 h-3" />
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {parts.map((part) => (
          <State
            key={part.key}
            part={part}
            total={summary.submissions}
            onOpen={onOpen && part.key !== 'clean' ? () => onOpen(part.key as ReviewCount) : undefined}
          />
        ))}
      </div>
    </Card>
  );
};

export default ReviewCard;
