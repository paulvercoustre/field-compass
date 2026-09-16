/**
 * Which of a form's answer options mean "don't know".
 *
 * Sibling of identifierSuggestions, with one important difference in what
 * several matches mean. For an identifier, two candidates are an ambiguity:
 * only one question can be *the* consent question, so the app picks neither.
 * Here two candidates are simply two codings of the same answer -- a form
 * assembled from more than one module may carry both `dk` and `dont_know`, and
 * both should be counted. So every match is offered, and on the create screen
 * every match is selected.
 *
 * Candidates are found two ways, because real forms need both:
 *
 * - by **name**, matched exactly against conventional codings;
 * - by **label**, because names drift where labels do not. One form we tested
 *   against codes the same answer as `dont_know` in fifteen lists and
 *   `dont_know_dont_want_to_answer` in a sixteenth, under an identical label.
 *   Name matching alone finds the first and silently misses the second --
 *   exactly the undercount this feature exists to prevent.
 *
 * What is *selected* is always the name. Kobo stores the name in submissions,
 * so the name is what the backend compares against; the label is only ever a
 * way of finding it, and a way of showing the user what they are choosing.
 */

/**
 * Conventional names, most conventional first.
 *
 * Refusals (`refused`, `prefer_not_to_say`) and not-applicable (`na`,
 * `not_applicable`) are deliberately absent. A refusal is the respondent
 * declining and a not-applicable is skip logic; neither is the knowledge gap
 * the DK rate is read as measuring, and folding them in would make a high rate
 * impossible to act on -- a probing problem, a sensitive question, and a
 * normal skip pattern would all look the same. They stay selectable by hand.
 */
const DK_NAMES = [
  'dont_know',
  'dk',
  'do_not_know',
  'don_t_know',
  'dnk',
  'dont_know_answer',
  'doesnt_know',
];

/**
 * Label openings that mean "don't know".
 *
 * Matched against the *start* of the normalised label, not anywhere inside it.
 * A label reading "Does the farmer know the price?" contains "know" and is a
 * question, not a don't-know option; requiring the phrase to open the label
 * keeps those out while still catching "Don't know / Don't want to answer".
 */
const DK_LABEL_PHRASES = [
  'dont know',
  'do not know',
  'doesnt know',
  'does not know',
  'dk',
  'no sabe',
  'ne sais pas',
  'je ne sais pas',
];

/** Lowercase, strip apostrophes, reduce punctuation to single spaces. */
const normalizeLabel = (value: string): string =>
  value
    .toLowerCase()
    .replace(/['''`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const labelKeysOf = (choice: Record<string, any>): string[] =>
  Object.keys(choice).filter((key) => key === 'label' || key.startsWith('label::'));

/**
 * The label to show for a choice: English when present, otherwise the first
 * translation the form carries, otherwise nothing.
 */
export const choiceLabel = (choice: Record<string, any>): string => {
  const keys = labelKeysOf(choice);
  const english = keys.find((key) => /english/i.test(key));
  const chosen = english || keys[0];
  const value = chosen ? choice[chosen] : '';
  return typeof value === 'string' ? value : '';
};

const labelLooksLikeDk = (choice: Record<string, any>): boolean =>
  labelKeysOf(choice).some((key) => {
    const value = choice[key];
    if (typeof value !== 'string') {
      return false;
    }
    const normalized = normalizeLabel(value);
    return DK_LABEL_PHRASES.some(
      (phrase) => normalized === phrase || normalized.startsWith(`${phrase} `)
    );
  });

/**
 * Every don't-know coding this form contains, by name.
 *
 * Conventional names come first, in candidate order, so the most standard
 * coding leads; anything found only by its label follows.
 */
export const suggestDkValues = (choices: Array<Record<string, any>>): string[] => {
  const names = new Map<string, Record<string, any>>();
  for (const choice of choices || []) {
    const name = choice?.name === undefined || choice?.name === null ? '' : String(choice.name);
    if (name && !names.has(name.toLowerCase())) {
      names.set(name.toLowerCase(), choice);
    }
  }

  const byName = DK_NAMES.filter((candidate) => names.has(candidate));
  const found = new Set(byName);

  const byLabel: string[] = [];
  for (const [key, choice] of names) {
    if (found.has(key) || !labelLooksLikeDk(choice)) {
      continue;
    }
    byLabel.push(String(choice.name));
    found.add(key);
  }

  return [...byName, ...byLabel];
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
