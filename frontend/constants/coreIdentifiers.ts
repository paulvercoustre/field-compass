/**
 * Plain-language help for survey configuration fields.
 *
 * These settings name questions in the user's own form, so the labels alone
 * ("Enumerator ID") do not say what to pick or why it matters. Each entry
 * explains what the question looks like in a form, and what Field Compass
 * does with it — so someone configuring a survey for the first time can
 * answer without already knowing how the app works.
 *
 * Kept in one place because all three configuration screens render the same
 * fields.
 */

export interface FieldHelp {
  title: string;
  text: string;
}

export const KOBO_LINK_HELP: FieldHelp = {
  title: 'Kobo project link',
  text:
    'Open your project in KoboToolbox and copy the address from your browser — it '  +
    'looks like https://kf.kobotoolbox.org/#/forms/aXKq... Field Compass reads your '  +
    'questions straight from the project, so there is nothing to export or upload.',
};

export const CORE_IDENTIFIER_HELP: Record<string, FieldHelp> = {
  uuid: {
    title: 'Submission ID',
    text:
      'The unique identifier Kobo gives every submission. "_uuid" is Kobo\'s standard ' +
      'and is almost always correct, so you should rarely need to change this.',
  },
  enumerator: {
    title: 'Enumerator ID',
    text:
      'The question in your form where the enumerator enters their own ID. It lets Field ' +
      'Compass track submissions by who collected them. Leave it blank if your form does ' +
      'not ask for one.',
  },
  date_interview: {
    title: 'Interview date',
    text:
      'The question recording the date the interview took place — often "today", which ' +
      'Kobo fills in automatically. Used to check that interviews fall inside your data ' +
      'collection period, and to flag any conducted at the weekend.',
  },
  start_time: {
    title: 'Start time',
    text:
      'The timestamp recorded when the enumerator opens the form. Combined with the end ' +
      'time it estimates how long an interview took. Only used when audit logs are ' +
      'unavailable — audit logs give a more accurate measure of active interview time.',
  },
  end_time: {
    title: 'End time',
    text:
      'The timestamp recorded when the enumerator finishes the form. Used together with ' +
      'the start time to estimate interview duration.',
  },
  consent: {
    title: 'Consent',
    text:
      'The question where the respondent agrees to take part in the interview. Field ' +
      'Compass uses it to check that interviews only continued when consent was actually ' +
      'given.',
  },
  dk_value: {
    title: "Don't know — numeric code",
    text:
      'The number your enumerators are trained to enter on numeric questions when a ' +
      'respondent says they don\'t know. -99 is a common convention. Field Compass counts ' +
      'these to measure how often "don\'t know" is recorded, which is a useful signal of ' +
      'interview quality.',
  },
  dk_string_value: {
    title: "Don't know — answer option",
    text:
      'The choice value your form uses for "don\'t know" on select questions, often "dk". ' +
      'Used alongside the numeric code to calculate don\'t-know rates per enumerator.',
  },
};
