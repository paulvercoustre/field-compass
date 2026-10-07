/**
 * One-line hints for survey configuration fields, shown in lighter text under
 * the field's label.
 *
 * These settings name questions in the user's own form, so a label alone
 * ("Enumerator ID") does not always say what to pick. Each hint says what to
 * choose in as few words as will do; anything longer belongs in docs.
 *
 * Kept in one place because the create and settings screens render the same
 * fields.
 */

export const KOBO_LINK_HINT = 'Open the project in KoboToolbox and copy the address from your browser.';

export const CORE_IDENTIFIER_HINTS: Record<string, string> = {
  uuid: 'Kobo’s ID for each submission. “_uuid” is almost always right.',
  enumerator: 'The question where enumerators enter their ID. Leave blank if there is none.',
  date_interview: 'Used for the collection-period and weekend checks.',
  start_time: 'Used with the end time to estimate duration when there is no audit log.',
  end_time: 'Used with the start time to estimate duration.',
  consent: 'Used to check that interviews only continued with consent.',
  dk_value:
    'The numbers entered when the respondent doesn’t know, e.g. -99. Add every one your form uses, or none. Leave out refusal codes such as -98: they are not don’t-knows.',
  dk_string_value: 'The answer options that mean “don’t know”, e.g. dk. Add every one your form uses.',
};
