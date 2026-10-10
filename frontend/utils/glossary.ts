/**
 * The named counts and measurements, in the words every screen uses for them.
 *
 * The backend computes each one once (backend/services/metrics.py), so
 * Submissions, Data quality, Field team and Progress agree to the submission.
 * Show these names word for word, and these definitions behind the ⓘ; the
 * reasoning is in docs/ui-ux-review/wireframes/W6-field-team-data-quality-progress.md.
 *
 * Submissions = Needs review + On hold + Clean + Approved + Not approved.
 */
export interface Term {
  name: string;
  definition: string;
}

export const GLOSSARY = {
  submissions: {
    name: 'Submissions',
    definition: 'Every submission pulled from Kobo, except deleted ones.',
  },
  flagged: {
    name: 'Flagged',
    definition: 'At least one check found an issue, whatever a reviewer decided.',
  },
  needsReview: {
    name: 'Needs review',
    definition: 'Flagged, and no decision in Kobo yet.',
  },
  onHold: {
    name: 'On hold',
    definition: 'A reviewer marked it On hold in Kobo.',
  },
  clean: {
    name: 'Clean',
    definition: 'Not flagged, and no decision in Kobo yet.',
  },
  reviewed: {
    name: 'Reviewed',
    definition:
      'A reviewer marked it Approved or Not approved in Kobo. This says how far review has got, not how good the interviews were.',
  },
  approved: {
    name: 'Approved',
    definition: 'A reviewer marked it Approved in Kobo.',
  },
  notApproved: {
    name: 'Not approved',
    definition: 'A reviewer marked it Not approved in Kobo. Never counted toward the target.',
  },
  done: {
    name: 'Done',
    definition:
      'Every submission except Not approved: what counts toward the target, whether or not a reviewer has approved it yet.',
  },
  duration: {
    name: 'Duration',
    definition:
      'The median length of an interview: its active time from the audit log or, without one, the time from its start question to its end question, pauses included. The duration check measures it the same way.',
  },
  dkRate: {
    name: 'Don’t-know rate',
    definition: 'Don’t-know answers out of the answers to questions that allow one.',
  },
  issuesPerSubmission: {
    name: 'Issues per submission',
    definition:
      'Everything the checks found, divided by the submissions. A flagged submission can have several issues.',
  },
} satisfies Record<string, Term>;

/** `part` as a whole-number percent of `whole`, or null when there is no whole. */
export const percentOf = (part: number, whole: number): number | null =>
  whole > 0 ? Math.round((part / whole) * 100) : null;

/** A percent for display, or an em dash when there is nothing to divide by. */
export const formatPercent = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : `${value}%`;

/** "1 needs review", "3 need review": the Submissions tab's own words, for pull summaries. */
export const needReview = (n: number): string => `${n} ${n === 1 ? 'needs' : 'need'} review`;
