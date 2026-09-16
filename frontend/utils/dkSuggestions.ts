/**
 * Which of a form's answer options mean "don't know".
 *
 * Sibling of identifierSuggestions, and matched the same way -- exact names
 * only, and only names the form actually contains. What differs is what
 * several matches mean.
 *
 * For an identifier, two candidates are an ambiguity: only one question can be
 * *the* consent question, so the app picks neither. Here two candidates are
 * simply two codings of the same answer -- a form assembled from more than one
 * module may carry both `dk` and `dont_know`, and both should be counted. So
 * every match is offered, and on the create screen every match is selected.
 */

/**
 * True don't-know codings only.
 *
 * Refusals (`refused`, `prefer_not_to_say`) and not-applicable (`na`,
 * `not_applicable`) are deliberately absent. A refusal is the respondent
 * declining and a not-applicable is skip logic; neither is the knowledge gap
 * the DK rate is read as measuring, and folding them in would make a high rate
 * impossible to act on -- a probing problem, a sensitive question, and a
 * normal skip pattern would all look the same. They stay selectable by hand.
 */
const DK_CANDIDATES = [
  'dont_know',
  'dk',
  'do_not_know',
  'don_t_know',
  'dnk',
  'dont_know_answer',
  'doesnt_know',
];

/** Every don't-know coding this form actually contains, in candidate order. */
export const suggestDkValues = (answerOptions: string[]): string[] => {
  const present = new Set(answerOptions.map((option) => option.trim().toLowerCase()));
  return DK_CANDIDATES.filter((candidate) => present.has(candidate));
};

/**
 * Read `dk_string_value` in either shape.
 *
 * Stored configs hold a single string; new ones hold a list. Old configs are
 * never rewritten, so both shapes stay live and every reader has to cope --
 * mirroring `dk_string_tokens()` in backend/etl/dk_utils.py.
 */
export const readDkValues = (stored: string | string[] | null | undefined): string[] => {
  if (stored === null || stored === undefined) {
    return [];
  }
  const values = Array.isArray(stored) ? stored : [stored];
  const seen = new Set<string>();
  return values
    .filter((value) => typeof value === 'string' && value.trim() !== '')
    .map((value) => value.trim())
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
};

/** Same values in the same order, ignoring case -- for dirty checks. */
export const sameDkValues = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((value, i) => value.toLowerCase() === b[i].toLowerCase());
