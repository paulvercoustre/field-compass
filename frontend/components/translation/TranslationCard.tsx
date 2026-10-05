import React, { useCallback, useEffect, useState } from 'react';
import { useActivity } from '../../contexts/ActivityContext';
import {
  getTranslationOverview,
  saveTranslationSettings,
  sendTranslationsToKobo,
  TranslatableQuestion,
  translateNow,
  TranslationOverview,
  TranslationSettingsInput,
} from '../../services/translationApi';
import Banner from '../ui/Banner';
import Button from '../ui/Button';
import ConfirmDialog from '../ui/ConfirmDialog';
import FieldLabel from '../ui/FieldLabel';
import { TranslateIcon } from '../ui/icons';
import SurveyKeyPicker from '../ai/SurveyKeyPicker';

interface TranslationCardProps {
  surveyId: string;
  /** Reloaded when the form is refreshed, so new questions appear. */
  formKey?: string | number;
}

const checkboxClass =
  'h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-700';

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/**
 * Survey Settings › Translation. Answers to the questions the owner picks --
 * typed answers, and the transcripts of recorded ones -- are translated into
 * one language by AI: the owner's own key for translation, or the included
 * translations. Translations Kobo already has are kept, never redone.
 */
interface QuestionListProps {
  title: string;
  questions: TranslatableQuestion[];
  /** Paths of the questions chosen for translation. */
  chosen: string[];
  disabled: boolean;
  onToggle: (path: string, on: boolean) => void;
  onTurnOnTranscription: () => void;
}

/** One kind of question (text or audio), each with its box to tick. */
const QuestionList: React.FC<QuestionListProps> = ({ title, questions, chosen, disabled, onToggle, onTurnOnTranscription }) =>
  questions.length === 0 ? null : (
    <div>
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{title}</p>
      <div className="space-y-1.5">
        {questions.map((question) => (
          <label key={question.path} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className={`mt-0.5 ${checkboxClass}`}
              disabled={disabled || question.in_repeat}
              checked={chosen.includes(question.path) && !question.in_repeat}
              onChange={(e) => onToggle(question.path, e.target.checked)}
            />
            <span className="min-w-0">
              <span className="text-gray-900 dark:text-white">{question.label}</span>
              <span className="block text-xs text-gray-500 dark:text-gray-400">{question.path}</span>
              {question.in_repeat && (
                <span className="block text-xs text-gray-500 dark:text-gray-400">Inside a repeat group: can't be translated yet.</span>
              )}
              {!question.in_repeat && question.kind === 'audio' && !question.transcribed && (
                <span className="block text-xs text-amber-700 dark:text-amber-300">
                  Field Compass doesn't transcribe this question, so only recordings that already have a transcript in
                  Kobo will be translated.{' '}
                  <button
                    type="button"
                    onClick={onTurnOnTranscription}
                    className="font-medium underline underline-offset-2"
                  >
                    Turn on its transcription
                  </button>
                </span>
              )}
            </span>
          </label>
        ))}
      </div>
    </div>
  );

const TranslationCard: React.FC<TranslationCardProps> = ({ surveyId, formKey }) => {
  const { trackRun, setPanelOpen, navigate, version } = useActivity();
  const [overview, setOverview] = useState<TranslationOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<TranslationSettingsInput | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [translateAgain, setTranslateAgain] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await getTranslationOverview(surveyId);
      setOverview(data);
      setDraft({ ...data.settings });
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load translation settings.');
    }
  }, [surveyId]);

  useEffect(() => {
    setEditing(false);
    setOverview(null);
    load();
  }, [load, formKey]);

  // Keep the counts current while translations run (not while editing).
  useEffect(() => {
    if (!editing && overview) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  if (loadError) {
    return <Banner tone="error">{loadError}</Banner>;
  }
  if (!overview || !draft) {
    return null;
  }

  const { settings, counts, allowance, key } = overview;
  const canEdit = overview.can_edit;
  const editable = editing && canEdit;

  const languageName = (code: string | null) =>
    code ? overview.languages.find((lang) => lang.code === code)?.name ?? code : 'Not chosen';
  const selectable = overview.questions.filter((q) => !q.in_repeat);
  const text = overview.questions.filter((q) => q.kind === 'text');
  const audio = overview.questions.filter((q) => q.kind === 'audio');
  const labelOf = (path: string) => overview.questions.find((q) => q.path === path)?.label ?? path;
  const chosenAudio = draft.questions.some((path) => audio.some((q) => q.path === path));
  const toAccountKeys = () => navigate({ view: 'userSettings', tab: 'ai' });
  const ownKey = key.source === 'own';
  const whoTranslates = ownKey
    ? `your key “${key.label}”`
    : key.source === 'operator'
    ? 'Field Compass’s AI, within the included translations'
    : null;
  const toRetry = counts.missing + counts.failed + counts.not_run;
  const pause = settings.send_to_kobo ? overview.kobo_pause : null;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await saveTranslationSettings(surveyId, draft);
      setOverview(saved);
      setDraft({ ...saved.settings });
      setEditing(false);
      setNotice(
        saved.settings.enabled && !settings.enabled
          ? 'Translation is on. New answers are translated on each pull; use “Translate now” for the ones already pulled.'
          : 'Translation settings saved.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const translate = async (mode: 'missing' | 'all') => {
    setError(null);
    setStarting(true);
    try {
      trackRun(await translateNow(surveyId, mode));
      setTranslateAgain(false);
      setPanelOpen(true);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start translating.');
      setTranslateAgain(false);
    } finally {
      setStarting(false);
    }
  };

  const resend = async () => {
    setError(null);
    try {
      trackRun(await sendTranslationsToKobo(surveyId));
      setPanelOpen(true);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send to Kobo.');
    }
  };

  const toggleQuestion = (path: string, on: boolean) =>
    setDraft({
      ...draft,
      questions: on ? [...draft.questions, path] : draft.questions.filter((p) => p !== path),
    });

  const questionListProps = {
    chosen: draft.questions,
    disabled: !editable || !draft.enabled,
    onToggle: toggleQuestion,
    onTurnOnTranscription: () => navigate({ view: 'settings', survey_id: surveyId, tab: 'transcription' }),
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-card dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight text-gray-900 dark:text-white">
          <TranslateIcon className="h-4 w-4 text-indigo-500 dark:text-indigo-400" />
          Translation
        </h2>
        {canEdit && !editing && (
          <button
            onClick={() => {
              setEditing(true);
              setNotice(null);
            }}
            className="rounded-md px-3 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-900/20"
          >
            Edit
          </button>
        )}
      </div>
      <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
        Answers to the questions you choose are translated into one language by AI, so everyone can read them: typed
        answers, and the transcripts of recorded ones. Translations already made in Kobo are kept, not redone.
      </p>
      {key.viewer_is_owner && (
        <div className="mb-4">
          <SurveyKeyPicker
            surveyId={surveyId}
            use="translation"
            included={overview.included_per_month ? plural(overview.included_per_month, 'translation') + ' a month' : null}
            onChange={load}
          />
        </div>
      )}

      {!overview.available && (
        <Banner tone="info" className="mb-4">
          {key.viewer_is_owner ? (
            <>
              Translation needs an API key: add one in Account settings ›{' '}
              <button type="button" onClick={toAccountKeys} className="font-medium underline underline-offset-2">
                AI integration
              </button>
              , then choose it above.
            </>
          ) : (
            "Translation isn't set up for this survey: its owner needs to add an AI key in their Account settings and choose this survey for translation."
          )}
        </Banner>
      )}
      {key.paused && (
        <Banner tone="warning" className="mb-4">
          Translation paused: {key.paused}
          {key.viewer_is_owner && (
            <>
              {' '}
              <button type="button" onClick={toAccountKeys} className="font-medium underline underline-offset-2">
                Open AI integration
              </button>
            </>
          )}
        </Banner>
      )}
      {error && (
        <Banner tone="error" className="mb-4" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}
      {notice && (
        <Banner tone="success" className="mb-4" onDismiss={() => setNotice(null)}>
          {notice}
        </Banner>
      )}

      <div className="space-y-5">
        <div className="flex items-start">
          <input
            id="translation-enabled"
            type="checkbox"
            className={`mt-0.5 ${checkboxClass}`}
            disabled={!editable}
            checked={draft.enabled}
            onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
          />
          <div className="ml-3">
            <label htmlFor="translation-enabled" className="text-sm font-medium text-gray-900 dark:text-white">
              Translate answers
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Each answer is translated once, in the background, on the next pull, and again if it changes.{' '}
              {ownKey
                ? `Runs on your key “${key.label}”, with no Field Compass limit.`
                : key.source === 'operator' && allowance
                ? `Runs on the included usage: ${plural(allowance.limit, 'translation')} a month for this survey, on top of AI review.`
                : 'Needs an AI key first.'}
            </p>
          </div>
        </div>

        {editing && (
          <div className="ml-7 space-y-5">
            <div className="max-w-sm">
              <FieldLabel htmlFor="translation-language" hint="Answers already in this language are left as they are.">
                Translate into
              </FieldLabel>
              <select
                id="translation-language"
                value={draft.language ?? ''}
                disabled={!editable || !draft.enabled}
                onChange={(e) => setDraft({ ...draft, language: e.target.value || null })}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
              >
                <option value="">Choose a language</option>
                {overview.languages.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.name}
                  </option>
                ))}
              </select>
            </div>

            <fieldset>
              <div className="mb-2 flex items-center justify-between gap-3">
                <legend className="text-sm font-medium text-gray-900 dark:text-white">
                  Questions to translate
                  <span className="ml-1.5 font-normal text-gray-500 dark:text-gray-400">
                    {draft.questions.length} of {selectable.length}
                  </span>
                </legend>
                {draft.enabled && selectable.length > 1 && (
                  <span className="flex gap-3 text-xs font-medium">
                    <button
                      type="button"
                      onClick={() => setDraft({ ...draft, questions: selectable.map((q) => q.path) })}
                      className="text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      onClick={() => setDraft({ ...draft, questions: [] })}
                      className="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                    >
                      Clear
                    </button>
                  </span>
                )}
              </div>
              {overview.questions.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">This form has no text or audio questions.</p>
              ) : (
                <div className="max-h-96 space-y-4 overflow-y-auto pr-1">
                  <QuestionList title="Text questions" questions={text} {...questionListProps} />
                  <QuestionList title="Audio questions (their transcript)" questions={audio} {...questionListProps} />
                </div>
              )}
            </fieldset>

            {chosenAudio && (
              <div className="flex items-start">
                <input
                  id="translation-kobo"
                  type="checkbox"
                  className={`mt-0.5 ${checkboxClass}`}
                  disabled={!editable || !draft.enabled}
                  checked={draft.send_to_kobo}
                  onChange={(e) => setDraft({ ...draft, send_to_kobo: e.target.checked })}
                />
                <div className="ml-3">
                  <label htmlFor="translation-kobo" className="text-sm font-medium text-gray-900 dark:text-white">
                    Send translations of recordings to Kobo
                  </label>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Adds them next to the transcript in Kobo's data table and exports, once Kobo has the transcript.
                    Kobo has no place for translations of typed answers: those stay in Field Compass. Corrections made in
                    Kobo are kept.
                  </p>
                </div>
              </div>
            )}

            <p className="text-xs text-gray-500 dark:text-gray-400">
              Answers to the chosen questions are sent to {whoTranslates ?? 'the AI provider'} to be translated, with
              their question labels. Nothing else from the submission is sent. Make sure respondents' consent covers this.
            </p>
          </div>
        )}

        {editable && (
          <div className="flex gap-3 pt-1">
            <Button variant="primary" onClick={save} loading={saving}>
              Save changes
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setDraft({ ...settings });
                setEditing(false);
                setError(null);
              }}
              disabled={saving}
            >
              Cancel
            </Button>
          </div>
        )}

        {!editing && settings.enabled && (
          <dl className="ml-7 grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-gray-500 dark:text-gray-400">Into</dt>
            <dd className="text-gray-900 dark:text-white">{languageName(settings.language)}</dd>
            <dt className="text-gray-500 dark:text-gray-400">Questions</dt>
            <dd className="text-gray-900 dark:text-white">
              {settings.questions.length > 4
                ? `${settings.questions.length} questions: ${settings.questions.slice(0, 3).map(labelOf).join(', ')} and ${
                    settings.questions.length - 3
                  } more`
                : settings.questions.map(labelOf).join(', ')}
            </dd>
            <dt className="text-gray-500 dark:text-gray-400">Key</dt>
            <dd className="text-gray-900 dark:text-white">
              {ownKey
                ? `${key.label} · no Field Compass limit`
                : allowance
                ? `Included usage · ${plural(allowance.limit, 'translation')} a month`
                : 'None yet'}
            </dd>
            <dt className="text-gray-500 dark:text-gray-400">Kobo</dt>
            <dd className="text-gray-900 dark:text-white">
              {settings.send_to_kobo ? 'Translations of recordings are sent to Kobo' : 'Kept in Field Compass only'}
            </dd>
          </dl>
        )}

        {!editing && settings.enabled && (
          <div className="ml-7 space-y-3 border-t border-gray-100 pt-4 dark:border-gray-800">
            <p className="text-sm text-gray-700 dark:text-gray-300">
              {plural(counts.success, 'answer')} translated
              {counts.from_kobo > 0 && <> · {counts.from_kobo.toLocaleString()} already translated in Kobo</>}
              {counts.in_progress > 0 && <> · {counts.in_progress} in progress</>}
              {counts.failed > 0 && <span className="text-amber-700 dark:text-amber-300"> · {counts.failed} failed</span>}
              {counts.not_run > 0 && <> · {counts.not_run} not run</>}
              {counts.missing > 0 && <> · {counts.missing.toLocaleString()} not translated yet</>}
              {counts.skipped > 0 && <> · {counts.skipped} already in {languageName(settings.language)} or nothing to translate</>}.
            </p>
            {allowance && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                This month: {allowance.used + allowance.in_flight} of {plural(allowance.limit, 'included translation')} used
                {allowance.in_flight > 0 && ` (${allowance.in_flight} in progress)`}. They don't count against AI review.
              </p>
            )}

            {settings.send_to_kobo && (counts.kobo.sent + counts.kobo.edited_in_kobo + counts.kobo.failed + counts.kobo.pending > 0 || pause) && (
              <div className="space-y-2">
                {pause ? (
                  <Banner tone="warning">{pause.message}</Banner>
                ) : (
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    {plural(counts.kobo.sent, 'translation')} in Kobo
                    {counts.kobo.edited_in_kobo > 0 && <> · {counts.kobo.edited_in_kobo} corrected in Kobo</>}
                    {counts.kobo.failed > 0 && (
                      <span className="text-amber-700 dark:text-amber-300"> · {counts.kobo.failed} couldn't be sent</span>
                    )}
                    {counts.kobo.pending > 0 && <> · {counts.kobo.pending} on the way</>}.
                  </p>
                )}
              </div>
            )}

            {canEdit && overview.available && (
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => translate('missing')} loading={starting && !translateAgain} disabled={toRetry === 0}>
                  {toRetry > 0 ? `Translate ${toRetry.toLocaleString()} now` : 'Everything is translated'}
                </Button>
                {settings.send_to_kobo && !pause && counts.kobo.unsent > 0 && (
                  <Button size="sm" variant="secondary" onClick={resend}>
                    Send {counts.kobo.unsent.toLocaleString()} to Kobo
                  </Button>
                )}
                {counts.success > 0 && (
                  <button
                    type="button"
                    onClick={() => setTranslateAgain(true)}
                    className="text-xs font-medium text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                  >
                    Translate all again
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={translateAgain}
        title="Translate every answer again?"
        confirmLabel="Translate all again"
        tone="primary"
        busy={starting}
        onConfirm={() => translate('all')}
        onCancel={() => setTranslateAgain(false)}
      >
        <p>
          About {plural(counts.success + counts.missing, 'answer')} are sent to {whoTranslates ?? 'the AI provider'} again.
          {allowance && ` This survey has ${allowance.remaining.toLocaleString()} included translations left this month; the rest wait until next month.`}
        </p>
        <p>Translations made in Kobo are kept. Ours already sent to Kobo are only replaced where nobody corrected them there.</p>
      </ConfirmDialog>
    </section>
  );
};

export default TranslationCard;
