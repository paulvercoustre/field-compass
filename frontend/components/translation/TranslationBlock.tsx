import React, { useEffect, useState } from 'react';
import { useActivity } from '../../contexts/ActivityContext';
import { getSubmissionTranslations, SubmissionTranslations, Translation } from '../../services/translationApi';
import { Spinner } from '../Spinner';
import { koboState, Tone, toneClass } from '../transcription/koboState';

/**
 * A translation's state in plain words. Null when there is nothing to say:
 * an answer already in the language, or with nothing to translate, has none.
 */
export const describeTranslation = (translation: Translation): { tone: Tone; text: string } | null => {
  const language = translation.language_name ?? translation.language;
  const [category, ...rest] = (translation.last_error ?? '').split(': ');
  const message = rest.join(': ').replace(/ \(retrying\)$/, '');
  switch (translation.status) {
    case 'pending':
    case 'running':
      return {
        tone: 'busy',
        text: translation.last_error ? `Translating into ${language}… retrying after a temporary error.` : `Translating into ${language}…`,
      };
    case 'success':
      return { tone: 'ok', text: translation.origin === 'kobo' ? `${language} translation from Kobo` : `${language} translation` };
    case 'skipped':
      return null;
    case 'not_run_allowance':
      return { tone: 'warn', text: message || 'Not translated: this survey has used its included translations for this month.' };
    case 'cancelled':
      return { tone: 'muted', text: 'Translation stopped before it ran. It runs again on the next pull.' };
    default: {
      const reasons: Record<string, string> = {
        auth: "Couldn't translate: the AI provider rejected the key.",
        provider_quota: "Couldn't translate: the AI provider account is out of credit.",
        not_configured: "Couldn't translate: no AI key is set up for translation.",
        bad_request: `Couldn't translate${message ? `: ${message}` : '.'}`,
      };
      return { tone: 'warn', text: reasons[category] ?? "Couldn't translate this time. It will be retried on the next pull." };
    }
  }
};

interface TranslationBlockProps {
  translation: Translation | null | undefined;
  /** Whether the survey sends translated transcripts to Kobo. */
  sendToKobo?: boolean;
}

/** An answer's translation, or where it stands while there is none. Null when there is nothing to show. */
export const TranslationBlock: React.FC<TranslationBlockProps> = ({ translation, sendToKobo = false }) => {
  if (!translation) return null;
  const state = describeTranslation(translation);
  if (!state) return null;
  // Kobo keeps translations of transcripts only; Kobo's own is already there.
  const kobo =
    sendToKobo && translation.source === 'transcript' && translation.origin === 'ai' && translation.status === 'success'
      ? koboState(translation, 'translation')
      : null;
  return (
    <div className="space-y-1">
      <p className={`flex items-center gap-1.5 text-xs ${toneClass[state.tone]}`} role="status">
        {state.tone === 'busy' && <Spinner size="sm" />}
        <span>{state.text}</span>
      </p>
      {translation.status === 'success' && translation.text && (
        <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800/40">
          <p className="whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-200">{translation.text}</p>
        </div>
      )}
      {kobo && <p className={`text-xs ${toneClass[kobo.tone]}`}>{kobo.text}</p>}
    </div>
  );
};

/**
 * A submission's translations, re-read as background work moves on. Null
 * until loaded, when it could not be, and when the survey doesn't translate.
 */
export const useSubmissionTranslations = (koboId: number | null, refreshKey?: string): SubmissionTranslations | null => {
  const { version } = useActivity();
  const [data, setData] = useState<SubmissionTranslations | null>(null);
  const [loadedFor, setLoadedFor] = useState<number | null>(null);

  useEffect(() => {
    setData(null);
    setLoadedFor(null);
  }, [koboId]);

  useEffect(() => {
    if (koboId == null) return undefined;
    let cancelled = false;
    getSubmissionTranslations(koboId)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setLoadedFor(koboId);
      })
      .catch(() => !cancelled && setData(null));
    return () => {
      cancelled = true;
    };
    // `version` changes as background work moves on.
  }, [koboId, refreshKey, version]);

  return koboId != null && loadedFor === koboId && data?.enabled ? data : null;
};
