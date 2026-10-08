import React from 'react';
import { Finding, FindingSource } from '../../utils/findings';
import { SparkleIcon } from '../ui/icons';

export type Decision = 'Approved' | 'Not Approved' | 'On Hold';

const DECISIONS: Array<{ status: Decision; label: string; key: string }> = [
  { status: 'Approved', label: 'Approved', key: 'A' },
  { status: 'Not Approved', label: 'Not approved', key: 'N' },
  { status: 'On Hold', label: 'On hold', key: 'H' },
];

// As it reads in "Marked … in Kobo."
// The decision in force is filled in its status colour; the others stay
// neutral, so nothing looks chosen before a decision is made.
const CHOSEN: Record<Decision, string> = {
  Approved: 'border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800',
  'Not Approved': 'border-rose-700 bg-rose-700 text-white hover:bg-rose-800',
  'On Hold': 'border-amber-700 bg-amber-700 text-white hover:bg-amber-800',
};

const DECIDED_LABEL: Record<string, string> = {
  Approved: 'approved',
  'Not Approved': 'not approved',
  'On Hold': 'on hold',
};

const SourceIcon: React.FC<{ source: FindingSource }> = ({ source }) => {
  const common = {
    className: 'mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  switch (source) {
    case 'Outlier':
      return (
        <svg {...common}>
          <path d="M4 19h16M7 15v-4M12 15V7M17 15v-2" />
        </svg>
      );
    case 'AI review':
      return <SparkleIcon className={common.className} />;
    case 'Audio':
      return (
        <svg {...common}>
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
        </svg>
      );
    case 'Custom check':
      return (
        <svg {...common}>
          <path d="M4 6h16M4 12h10M4 18h6" />
        </svg>
      );
    case 'Targets':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5M12 16h.01" />
        </svg>
      );
  }
};

/** Where a value sits against its expected range, on one line. */
const RangeBar: React.FC<{ range: NonNullable<Finding['range']> }> = ({ range }) => {
  const low = Math.min(range.lower, range.value);
  const high = Math.max(range.upper, range.value);
  const span = high - low || 1;
  const at = (x: number) => `${4 + ((x - low) / span) * 92}%`;
  return (
    <div className="relative mt-2 h-1.5 w-full max-w-xs rounded-full bg-gray-100 dark:bg-gray-800" aria-hidden="true">
      <div
        className="absolute inset-y-0 rounded-full bg-gray-300 dark:bg-gray-600"
        style={{ left: at(range.lower), width: `calc(${at(range.upper)} - ${at(range.lower)})` }}
      />
      <div
        className="absolute -top-1 h-3.5 w-[3px] -translate-x-1/2 rounded-full bg-amber-500"
        style={{ left: at(range.value) }}
      />
    </div>
  );
};

const FindingRow: React.FC<{
  finding: Finding;
  onJump?: (question: string) => void;
  onFilterIssue?: (check: string) => void;
}> = ({ finding, onJump, onFilterIssue }) => (
  <li className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-3 border-t border-gray-100 px-4 py-3 first:border-t-0 sm:grid-cols-[16px_minmax(0,1fr)_auto] dark:border-gray-800">
    <SourceIcon source={finding.source} />
    <div className="min-w-0">
      <p className="text-sm font-medium text-gray-900 dark:text-white">{finding.title}</p>
      {finding.quote && (
        <p className="mt-1 rounded-md bg-gray-50 px-2.5 py-1.5 text-sm text-gray-700 dark:bg-gray-800/60 dark:text-gray-300">
          <span className="text-gray-500 dark:text-gray-400">{finding.quote.question} — </span>“{finding.quote.answer}”
        </p>
      )}
      {finding.detail && (
        <p className="mt-0.5 text-[13px] leading-snug text-gray-600 dark:text-gray-400">{finding.detail}</p>
      )}
      {finding.range && <RangeBar range={finding.range} />}
      {finding.stats && <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-500">{finding.stats}</p>}
      {finding.warning && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{finding.warning}</p>}
    </div>
    <div className="col-start-2 mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 sm:col-start-3 sm:mt-0 sm:flex-col sm:items-end">
      <span className="rounded-md border border-gray-200 px-1.5 py-px text-[11px] text-gray-500 dark:border-gray-700 dark:text-gray-400">
        {finding.source}
      </span>
      {finding.question && onJump && (
        <button
          type="button"
          onClick={() => onJump(finding.question!)}
          className="text-xs text-indigo-700 hover:text-indigo-900 hover:underline dark:text-indigo-300"
        >
          Show answer
        </button>
      )}
      {onFilterIssue && (
        <button
          type="button"
          onClick={() => onFilterIssue(finding.check)}
          className="text-xs text-indigo-700 hover:text-indigo-900 hover:underline dark:text-indigo-300"
        >
          All with this issue
        </button>
      )}
    </div>
  </li>
);

interface ReviewCardProps {
  submissionId: number;
  status: string | null | undefined;
  findings: Finding[];
  passed: number;
  allChecksOpen: boolean;
  onToggleAllChecks: () => void;
  /** A line saying a check is still under way and may add findings. */
  pending?: string;
  canEdit: boolean;
  shortcuts: boolean;
  /** The note as typed, and as last saved. */
  note: string;
  onNoteChange: (note: string) => void;
  savedNote: string;
  /** The decision being saved, or 'note' while only the note is. */
  saving: Decision | 'clear' | 'note' | null;
  error: string | null;
  onDecide: (status: Decision | null) => void;
  onSaveNote: () => void;
  onJumpToAnswer?: (question: string) => void;
  /** Whether the answers show this question, so "Show answer" has somewhere to go. */
  hasAnswer?: (question: string) => boolean;
  onFilterIssue?: (check: string) => void;
}

/**
 * What a reviewer decides on: what was found, a note for the team, and the
 * decision, in one card at the top of the submission.
 */
const ReviewCard: React.FC<ReviewCardProps> = ({
  submissionId,
  status,
  findings,
  passed,
  allChecksOpen,
  onToggleAllChecks,
  pending,
  canEdit,
  shortcuts,
  note,
  onNoteChange,
  savedNote,
  saving,
  error,
  onDecide,
  onSaveNote,
  onJumpToAnswer,
  hasAnswer = () => true,
  onFilterIssue,
}) => {
  const noteDirty = note.trim() !== savedNote.trim();
  const decided = status && DECIDED_LABEL[status];

  const heading =
    findings.length === 0
      ? 'Nothing to check'
      : decided
        ? `${findings.length} ${findings.length === 1 ? 'thing was' : 'things were'} flagged`
        : `${findings.length} ${findings.length === 1 ? 'thing' : 'things'} to check`;

  return (
    <section
      aria-label="Review"
      className="rounded-xl border border-gray-200 bg-white shadow-xs dark:border-gray-800 dark:bg-gray-900"
    >
      <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-3.5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
          {findings.length === 0 && (
            <svg
              className="h-4 w-4 text-emerald-600"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M8 12l3 3 5-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          {heading}
        </h3>
        <button
          type="button"
          onClick={onToggleAllChecks}
          aria-expanded={allChecksOpen}
          className="text-xs font-medium text-indigo-700 hover:text-indigo-900 dark:text-indigo-300 dark:hover:text-indigo-200"
        >
          {allChecksOpen ? 'Hide checks' : `${passed} check${passed === 1 ? '' : 's'} passed`}
          <span aria-hidden="true"> {allChecksOpen ? '▴' : '▸'}</span>
        </button>
      </div>

      {findings.length > 0 && (
        <ul>
          {findings.map((finding) => (
            <FindingRow
              key={finding.key}
              finding={finding}
              onJump={finding.question && hasAnswer(finding.question) ? onJumpToAnswer : undefined}
              onFilterIssue={onFilterIssue}
            />
          ))}
        </ul>
      )}

      {pending && (
        <p className="flex items-center gap-2 border-t border-gray-100 px-4 py-2.5 text-xs text-sky-700 dark:border-gray-800 dark:text-sky-300">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500" aria-hidden="true" />
          {pending}
        </p>
      )}

      {/* Stays in view at the bottom while a long list of findings scrolls. */}
      <div className="sticky bottom-0 z-10 flex flex-col gap-2.5 rounded-b-xl border-t border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
        {decided && (
          <p className="text-sm text-gray-700 dark:text-gray-300">
            Marked <span className="font-medium text-gray-900 dark:text-white">{decided}</span> in Kobo.
            {canEdit && (
              <>
                {' '}
                <button
                  type="button"
                  onClick={() => onDecide(null)}
                  disabled={saving !== null}
                  className="text-indigo-700 hover:underline disabled:opacity-50 dark:text-indigo-300"
                >
                  Mark as not reviewed
                </button>
              </>
            )}
          </p>
        )}
        {canEdit ? (
          <>
            <label htmlFor={`note-${submissionId}`} className="sr-only">
              Note for the team
            </label>
            <textarea
              id={`note-${submissionId}`}
              value={note}
              onChange={(event) => onNoteChange(event.target.value)}
              placeholder="Note for the team (optional)"
              rows={note.includes('\n') || note.length > 70 ? 3 : 1}
              className="w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
            />
            <div className="flex flex-wrap items-center gap-2">
              {DECISIONS.map((d) => {
                const current = status === d.status;
                return (
                  <button
                    key={d.status}
                    type="button"
                    onClick={() => onDecide(d.status)}
                    disabled={saving !== null}
                    aria-pressed={current}
                    className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                      current
                        ? CHOSEN[d.status]
                        : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-800'
                    }`}
                  >
                    {current && (
                      <svg
                        className="h-3.5 w-3.5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={3}
                        aria-hidden="true"
                      >
                        <path d="M5 12l5 5 9-10" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                    {saving === d.status ? 'Saving…' : d.label}
                    {shortcuts && (
                      <kbd
                        className={`hidden rounded border px-1 font-sans text-[11px] leading-4 md:inline ${
                          current
                            ? 'border-white/40 text-white/80'
                            : 'border-gray-300 text-gray-500 dark:border-gray-600 dark:text-gray-400'
                        }`}
                      >
                        {d.key}
                      </kbd>
                    )}
                  </button>
                );
              })}
              {noteDirty && (
                <button
                  type="button"
                  onClick={onSaveNote}
                  disabled={saving !== null}
                  className="ml-auto text-xs font-medium text-indigo-700 hover:underline disabled:opacity-50 dark:text-indigo-300"
                >
                  {saving === 'note' ? 'Saving note…' : 'Save note only'}
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            {savedNote && <p className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">{savedNote}</p>}
            <p className="text-xs text-gray-500 dark:text-gray-400">
              You can view this survey. Deciding on submissions needs editor access.
            </p>
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
    </section>
  );
};

export default ReviewCard;
