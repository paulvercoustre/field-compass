import { KoboStatus } from '../../services/transcriptionApi';

export type Tone = 'busy' | 'ok' | 'warn' | 'muted';

export const toneClass: Record<Tone, string> = {
  busy: 'text-indigo-700 dark:text-indigo-300',
  ok: 'text-gray-600 dark:text-gray-400',
  warn: 'text-amber-700 dark:text-amber-300',
  muted: 'text-gray-500 dark:text-gray-400',
};

/**
 * Where a transcript or a translation stands in Kobo, in words that say
 * which of the two it is: both can show under one recording.
 */
export const koboState = (
  item: { status: string; text: string | null; kobo_status: KoboStatus; kobo_last_error: string | null },
  what: 'transcript' | 'translation'
): { tone: Tone; text: string } | null => {
  const What = what === 'transcript' ? 'Transcript' : 'Translation';
  switch (item.kobo_status) {
    case 'sent':
      return { tone: 'ok', text: `${What} in Kobo` };
    case 'pending':
      return { tone: 'busy', text: `Sending the ${what} to Kobo…` };
    case 'edited_in_kobo':
      return { tone: 'muted', text: `${What} corrected in Kobo — the correction is kept` };
    case 'unsupported':
      return { tone: 'warn', text: `This Kobo server doesn't support adding ${what}s` };
    case 'failed': {
      const [category, ...rest] = (item.kobo_last_error ?? '').split(': ');
      if (category === 'kobo_permission') {
        return {
          tone: 'warn',
          text: `Couldn't send the ${what} to Kobo: your Kobo account can't edit this project's submissions`,
        };
      }
      return { tone: 'warn', text: `Couldn't send the ${what} to Kobo${rest.length ? `: ${rest.join(': ')}` : ''}` };
    }
    default:
      if (item.status !== 'success') return null;
      return {
        tone: 'muted',
        text: item.text?.trim() ? `${What} not sent to Kobo` : 'Nothing to send to Kobo',
      };
  }
};
