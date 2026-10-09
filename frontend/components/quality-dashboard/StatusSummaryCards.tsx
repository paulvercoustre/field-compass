import React from 'react';
import { SubmissionSummary } from '../../types';
import { GLOSSARY, Term, percentOf } from '../../utils/glossary';
import { statusDotClass } from '../Badge';
import { SectionLabel } from '../ui/Card';
import TermInfo from '../ui/TermInfo';

/** The review states a card opens in Submissions. Clean has no tab of its own. */
export type ReviewCount = 'needs_review' | 'on_hold' | 'approved' | 'not_approved';

interface StatusCardProps {
  term: Term;
  count: number;
  percentage?: number | null;
  /** Tailwind background class for the status dot; none for the total. */
  dotClass?: string;
  onClick?: () => void;
}

const StatusCard: React.FC<StatusCardProps> = ({ term, count, percentage, dotClass, onClick }) => {
  const figures = (
    <span className="mt-2 flex items-baseline gap-2">
      <span className="tabular text-2xl font-semibold tracking-tight text-gray-900 dark:text-white">
        {count.toLocaleString()}
      </span>
      {percentage !== undefined && percentage !== null && (
        <span className="tabular text-sm text-gray-500 dark:text-gray-400">{percentage}%</span>
      )}
    </span>
  );
  const label = (
    <span className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
      {dotClass && <span className={`h-2 w-2 rounded-full ${dotClass}`} aria-hidden="true" />}
      {term.name}
    </span>
  );
  const cardClass =
    'relative flex flex-col items-start rounded-xl border border-gray-200 bg-white p-4 text-left shadow-card dark:border-gray-800 dark:bg-gray-900';
  return (
    <div
      className={`${cardClass} ${onClick ? 'transition-colors hover:border-gray-300 dark:hover:border-gray-700' : ''}`}
    >
      {/* The ⓘ sits apart from the card's own button: one control inside another is not allowed. */}
      <span className="absolute right-3 top-3">
        <TermInfo term={term} />
      </span>
      {onClick ? (
        <button type="button" onClick={onClick} className="flex flex-col items-start rounded text-left">
          {label}
          {figures}
        </button>
      ) : (
        <>
          {label}
          {figures}
        </>
      )}
    </div>
  );
};

interface StatusSummaryCardsProps {
  summary: SubmissionSummary;
  onStatusClick?: (state: ReviewCount) => void;
}

/** Where every submission stands in review: the five parts add up to the total. */
const StatusSummaryCards: React.FC<StatusSummaryCardsProps> = ({ summary, onStatusClick }) => {
  const share = (n: number) => percentOf(n, summary.submissions);
  const open = (state: ReviewCount) => (onStatusClick ? () => onStatusClick(state) : undefined);
  return (
    <div>
      <SectionLabel>Review</SectionLabel>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatusCard term={GLOSSARY.submissions} count={summary.submissions} />
        <StatusCard
          term={GLOSSARY.needsReview}
          count={summary.needs_review}
          percentage={share(summary.needs_review)}
          dotClass="bg-amber-600"
          onClick={open('needs_review')}
        />
        <StatusCard
          term={GLOSSARY.onHold}
          count={summary.on_hold}
          percentage={share(summary.on_hold)}
          dotClass="bg-amber-300"
          onClick={open('on_hold')}
        />
        <StatusCard
          term={GLOSSARY.clean}
          count={summary.clean}
          percentage={share(summary.clean)}
          dotClass="bg-gray-300 dark:bg-gray-600"
        />
        <StatusCard
          term={GLOSSARY.approved}
          count={summary.approved}
          percentage={share(summary.approved)}
          dotClass={statusDotClass('Approved')}
          onClick={open('approved')}
        />
        <StatusCard
          term={GLOSSARY.notApproved}
          count={summary.not_approved}
          percentage={share(summary.not_approved)}
          dotClass={statusDotClass('Not Approved')}
          onClick={open('not_approved')}
        />
      </div>
    </div>
  );
};

export default StatusSummaryCards;
