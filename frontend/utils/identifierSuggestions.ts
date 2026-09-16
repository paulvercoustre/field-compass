/**
 * Which question in a form is likely to be the consent question, the
 * enumerator ID, the interview date.
 *
 * The app cannot know what a form calls these -- a form may name them
 * anything, or not ask them at all. What it can do is recognise the
 * conventional names when they are present, which covers most forms built
 * from a template or by someone who has built one before.
 *
 * Two rules keep a suggestion from becoming a wrong answer:
 *
 * 1. **Only names the form actually contains.** A candidate is offered only
 *    after being found among the form's questions, so a suggestion can never
 *    point the config at a question that does not exist.
 * 2. **Exact matches only.** Substring matching would offer
 *    `consent_witness_signature` for `consent`, and a signature field is not a
 *    consent field -- the checks built on it would read the wrong column for
 *    the life of the survey.
 */

/**
 * Conventional names per identifier, most conventional first.
 *
 * Order is the whole value of the list: it decides which single candidate an
 * unambiguous form auto-fills, and the order suggestions are shown in when
 * several match.
 */
const CANDIDATES: Record<string, string[]> = {
  enumerator: [
    'enumerator_id',
    'enumerator',
    'enumerator_name',
    'enumerator_code',
    'enum_id',
    'enum_name',
    'interviewer_id',
    'interviewer',
    'interviewer_name',
  ],
  consent: ['consent', 'consent_given', 'respondent_consent', 'informed_consent'],
  date_interview: ['today', 'date', 'interview_date', 'date_interview'],
  start_time: ['start', 'start_time'],
  end_time: ['end', 'end_time'],
};

/**
 * Every conventional name for `field` that this form actually contains, in
 * candidate order. Empty when the form uses its own naming, which is fine --
 * the user picks from the full list instead.
 */
export const suggestIdentifiers = (availableVariables: string[], field: string): string[] => {
  const candidates = CANDIDATES[field];
  if (!candidates) {
    return [];
  }
  const present = new Set(availableVariables);
  return candidates.filter((candidate) => present.has(candidate));
};

/**
 * The one name safe to fill in on the user's behalf, or null.
 *
 * Null when nothing matched, and -- deliberately -- also when several did. A
 * form carrying both `consent_hh` and `consent_gps` gives no basis for
 * choosing between them, and choosing anyway is the worst available outcome:
 * a field that already looks answered is a field nobody re-reads, so the wrong
 * question would be checked for the life of the survey. Better to leave it
 * blank and show both at the top of the list.
 */
export const autoFillIdentifier = (availableVariables: string[], field: string): string | null => {
  const matches = suggestIdentifiers(availableVariables, field);
  return matches.length === 1 ? matches[0] : null;
};
