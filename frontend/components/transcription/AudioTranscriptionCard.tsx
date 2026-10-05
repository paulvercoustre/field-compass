import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useActivity } from '../../contexts/ActivityContext';
import {
  AudioQuestion,
  estimateTranscription,
  getTranscriptionOverview,
  saveTranscriptionSettings,
  sendTranscriptsToKobo,
  transcribeNow,
  TranscriptionEstimate,
  TranscriptionOverview,
  TranscriptionSettingsInput,
  translateNow,
} from '../../services/transcriptionApi';
import Banner from '../ui/Banner';
import Button from '../ui/Button';
import ConfirmDialog from '../ui/ConfirmDialog';
import FieldLabel from '../ui/FieldLabel';

interface AudioTranscriptionCardProps {
  surveyId: string;
  surveyName: string;
  /** Reloaded when the form is refreshed, so new audio questions appear. */
  formKey?: string | number;
  /** The transcribed questions changed: the AI review list follows them. */
  onSettingsChange?: (questionPaths: string[], enabled: boolean) => void;
}

const MicIcon: React.FC<{ className?: string }> = ({ className = 'h-4 w-4' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8" />
  </svg>
);

const humanize = (name: string) => {
  const text = name.replace(/[_-]+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/**
 * How to name each audio question. Forms often label every recording the
 * same ("Record the respondent's answer"); then the question's own name and
 * its section say which is which.
 */
const questionNames = (questions: AudioQuestion[]) => {
  const counts = new Map<string, number>();
  questions.forEach((q) => counts.set(q.label, (counts.get(q.label) ?? 0) + 1));
  return new Map(
    questions.map((q) => {
      const section = q.path.includes('/') ? humanize(q.path.split('/').slice(-2, -1)[0]) : null;
      return [
        q.path,
        (counts.get(q.label) ?? 0) > 1
          ? { title: humanize(q.name), detail: [section, q.label].filter(Boolean).join(' \u00b7 ') }
          : { title: q.label, detail: q.path },
      ];
    })
  );
};

const checkboxClass =
  'h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-700';

const toInput = (overview: TranscriptionOverview): TranscriptionSettingsInput => ({
  enabled: overview.settings.enabled,
  questions: overview.settings.questions,
  language: overview.settings.language,
  multiple_speakers: overview.settings.multiple_speakers,
  send_to_kobo: overview.settings.send_to_kobo,
  translate_to: overview.settings.translate_to,
});

/**
 * Survey Settings › Audio transcription. Shown only when the form has audio
 * questions, and lists only those. The language list puts the form's own
 * languages first, then every language Scribe v2 can transcribe. Transcripts
 * can also be translated into one language by the survey's AI provider.
 */
const AudioTranscriptionCard: React.FC<AudioTranscriptionCardProps> = ({ surveyId, surveyName, formKey, onSettingsChange }) => {
  const { trackRun, setPanelOpen, navigate, version } = useActivity();
  const [overview, setOverview] = useState<TranscriptionOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<TranscriptionSettingsInput | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmConsent, setConfirmConsent] = useState(false);
  const [estimate, setEstimate] = useState<TranscriptionEstimate | null>(null);
  const [starting, setStarting] = useState(false);
  const [translateAgain, setTranslateAgain] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await getTranscriptionOverview(surveyId);
      setOverview(data);
      setDraft(toInput(data));
      setLoadError(null);
      onSettingsChange?.(data.settings.questions, data.settings.enabled);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load transcription settings.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surveyId]);

  useEffect(() => {
    setEditing(false);
    setOverview(null);
    load();
  }, [load, formKey]);

  // Keep the counts current while transcriptions run (not while editing:
  // a reload would replace the draft).
  useEffect(() => {
    if (!editing && overview) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const suggested = useMemo(
    () => (overview?.form_languages ?? []).filter((lang) => lang.code),
    [overview]
  );
  const unsupported = useMemo(
    () => (overview?.form_languages ?? []).filter((lang) => !lang.code),
    [overview]
  );

  // Nothing to show for a form without audio questions.
  if (loadError) {
    return null;
  }
  if (!overview || !draft) {
    return null;
  }
  if (overview.audio_questions.length === 0) {
    return null;
  }

  const { settings, counts, allowance, translation } = overview;
  const translations = counts.translations;
  const canEdit = overview.can_edit && overview.available;
  const languageName = (code: string | null) =>
    code ? overview.languages.find((lang) => lang.code === code)?.name ?? code : 'Detect automatically';
  const names = questionNames(overview.audio_questions);
  const questionLabel = (path: string) => names.get(path)?.title ?? path;
  const selectable = overview.audio_questions.filter((q) => !q.in_repeat).map((q) => q.path);
  const ownKey = overview.key.source === 'own';
  const toAccountKey = () => navigate({ view: 'userSettings', tab: 'ai' });

  const save = async (acknowledge = false) => {
    setSaving(true);
    setError(null);
    try {
      const saved = await saveTranscriptionSettings(surveyId, { ...draft, acknowledge });
      setOverview(saved);
      setDraft(toInput(saved));
      setEditing(false);
      setConfirmConsent(false);
      onSettingsChange?.(saved.settings.questions, saved.settings.enabled);
      setNotice(
        saved.settings.enabled && !settings.enabled
          ? 'Transcription is on. New recordings are transcribed on each pull; use “Transcribe now” for the ones already pulled.'
          : 'Transcription settings saved.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = () => {
    if (draft.enabled && !settings.acknowledged_at) {
      setConfirmConsent(true);
      return;
    }
    save();
  };

  const openEstimate = async (mode: 'missing' | 'all') => {
    setError(null);
    try {
      setEstimate(await estimateTranscription(surveyId, mode));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not count the recordings.');
    }
  };

  const start = async () => {
    if (!estimate) return;
    setStarting(true);
    try {
      trackRun(await transcribeNow(surveyId, estimate.mode));
      setEstimate(null);
      setPanelOpen(true);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start transcribing.');
      setEstimate(null);
    } finally {
      setStarting(false);
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

  const translationProvider =
    translation.source === 'own'
      ? `your AI provider \u201c${translation.label}\u201d`
      : translation.source === 'operator'
      ? `the included AI usage (each translated submission counts as one of this survey's ${translation.allowance?.limit ?? ''} AI reviews a month)`
      : null;

  const resend = async () => {
    setError(null);
    try {
      trackRun(await sendTranscriptsToKobo(surveyId));
      setPanelOpen(true);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send to Kobo.');
    }
  };

  const toSubmissions = (transcript: string) => () =>
    navigate({ view: 'dashboard', survey_id: surveyId, filters: { transcript } });

  const pause = settings.send_to_kobo ? settings.kobo_pause : null;
  const editable = editing && canEdit;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-card dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight text-gray-900 dark:text-white">
          <MicIcon className="h-4 w-4 text-indigo-500 dark:text-indigo-400" />
          Audio transcription
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
        Recorded answers are transcribed with ElevenLabs Scribe, so you can read them here and AI review can check them.
      </p>

      {!overview.available && (
        <Banner tone="info" className="mb-4">
          {overview.key.viewer_is_owner ? (
            <>
              To transcribe this survey's recordings, add an ElevenLabs key in Account settings ›{' '}
              <button type="button" onClick={toAccountKey} className="font-medium underline underline-offset-2">
                AI integration
              </button>{' '}
              and choose this survey for it.
            </>
          ) : (
            "Transcription isn't set up for this survey: its owner needs to add an ElevenLabs key in their Account settings and choose this survey for it."
          )}
        </Banner>
      )}
      {overview.available && overview.key.paused && (
        <Banner tone="warning" className="mb-4">
          {overview.key.paused}
          {ownKey && overview.key.viewer_is_owner && (
            <>
              {' '}
              <button type="button" onClick={toAccountKey} className="font-medium underline underline-offset-2">
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
            id="transcription-enabled"
            type="checkbox"
            className={`mt-0.5 ${checkboxClass}`}
            disabled={!editable}
            checked={draft.enabled}
            onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
          />
          <div className="ml-3">
            <label htmlFor="transcription-enabled" className="text-sm font-medium text-gray-900 dark:text-white">
              Transcribe audio answers
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Each new recording is transcribed once, in the background, on the next pull.{' '}
              {ownKey
                ? `Runs on the key \u201c${overview.key.label}\u201d, with no Field Compass limit.`
                : overview.key.source === 'operator'
                ? `Runs on the included usage: ${allowance.limit_minutes} minutes a month for this survey.`
                : 'Needs an ElevenLabs key first.'}
            </p>
          </div>
        </div>

        {editing && (
          <div className="ml-7 space-y-5">
            <fieldset>
              <div className="mb-2 flex items-center justify-between gap-3">
                <legend className="text-sm font-medium text-gray-900 dark:text-white">
                  Questions to transcribe
                  <span className="ml-1.5 font-normal text-gray-500 dark:text-gray-400">
                    {draft.questions.length} of {selectable.length}
                  </span>
                </legend>
                {draft.enabled && selectable.length > 1 && (
                  <span className="flex gap-3 text-xs font-medium">
                    <button
                      type="button"
                      onClick={() => setDraft({ ...draft, questions: selectable })}
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
              <div className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
                {overview.audio_questions.map((question) => {
                  const checked = draft.questions.includes(question.path);
                  return (
                    <label key={question.path} className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className={`mt-0.5 ${checkboxClass}`}
                        disabled={!editable || !draft.enabled || question.in_repeat}
                        checked={checked && !question.in_repeat}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            questions: e.target.checked
                              ? [...draft.questions, question.path]
                              : draft.questions.filter((path) => path !== question.path),
                          })
                        }
                      />
                      <span className="min-w-0">
                        <span className="text-gray-900 dark:text-white">{names.get(question.path)?.title}</span>
                        <span className="block text-xs text-gray-500 dark:text-gray-400">{names.get(question.path)?.detail}</span>
                        {question.in_repeat && (
                          <span className="block text-xs text-gray-500 dark:text-gray-400">
                            Inside a repeat group: can't be transcribed yet.
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div className="max-w-sm">
              <FieldLabel
                htmlFor="transcription-language"
                hint="Choosing the language improves accuracy, and flags answers given in another one."
              >
                Language spoken
              </FieldLabel>
              {editable ? (
                <select
                  id="transcription-language"
                  value={draft.language ?? ''}
                  disabled={!draft.enabled}
                  onChange={(e) => setDraft({ ...draft, language: e.target.value || null })}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
                >
                  <option value="">Detect automatically</option>
                  {suggested.length > 0 && (
                    <optgroup label="Languages of this form">
                      {suggested.map((lang) => (
                        <option key={`form-${lang.code}`} value={lang.code!}>
                          {lang.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="All languages Scribe can transcribe">
                    {overview.languages
                      .filter((lang) => !suggested.some((s) => s.code === lang.code))
                      .map((lang) => (
                        <option key={lang.code} value={lang.code}>
                          {lang.name}
                        </option>
                      ))}
                  </optgroup>
                </select>
              ) : (
                <p className="text-sm text-gray-900 dark:text-white">{languageName(settings.language)}</p>
              )}
              {editable && unsupported.length > 0 && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                  Not available for transcription: {unsupported.map((lang) => lang.label).join(', ')}. Recordings in{' '}
                  {unsupported.length === 1 ? 'it' : 'them'} come back empty or in the wrong language.
                </p>
              )}
            </div>

            <div className="flex items-start">
              <input
                id="transcription-speakers"
                type="checkbox"
                className={`mt-0.5 ${checkboxClass}`}
                disabled={!editable || !draft.enabled}
                checked={draft.multiple_speakers}
                onChange={(e) => setDraft({ ...draft, multiple_speakers: e.target.checked })}
              />
              <div className="ml-3">
                <label htmlFor="transcription-speakers" className="text-sm font-medium text-gray-900 dark:text-white">
                  Recordings often have more than one speaker
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400">Shows who said what: Speaker 1, Speaker 2.</p>
              </div>
            </div>

            <div className="flex items-start">
              <input
                id="transcription-kobo"
                type="checkbox"
                className={`mt-0.5 ${checkboxClass}`}
                disabled={!editable || !draft.enabled}
                checked={draft.send_to_kobo}
                onChange={(e) => setDraft({ ...draft, send_to_kobo: e.target.checked })}
              />
              <div className="ml-3">
                <label htmlFor="transcription-kobo" className="text-sm font-medium text-gray-900 dark:text-white">
                  Send transcripts to Kobo
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Adds a transcript column next to the recording in Kobo's data table and exports. The submissions themselves
                  are not changed, and corrections made in Kobo are kept.
                </p>
              </div>
            </div>

            <div className="max-w-sm">
              <FieldLabel
                htmlFor="transcription-translate"
                hint={
                  translationProvider
                    ? `Translated by ${translationProvider}. Answers already in this language are left as they are.`
                    : 'Needs an AI provider: add one in Account settings › AI integration.'
                }
              >
                Translate transcripts into
              </FieldLabel>
              {editable ? (
                <select
                  id="transcription-translate"
                  value={draft.translate_to ?? ''}
                  disabled={!draft.enabled || !translation.available}
                  onChange={(e) => setDraft({ ...draft, translate_to: e.target.value || null })}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
                >
                  <option value="">Don't translate</option>
                  {overview.languages.map((lang) => (
                    <option key={lang.code} value={lang.code}>
                      {lang.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-sm text-gray-900 dark:text-white">
                  {settings.translate_to ? languageName(settings.translate_to) : "Don't translate"}
                </p>
              )}
              {editable && draft.translate_to && draft.send_to_kobo && (
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Translations are sent to Kobo too, next to their transcript.
                </p>
              )}
            </div>
          </div>
        )}

        {editing && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Recordings of the chosen questions are sent to ElevenLabs to be transcribed
            {draft.translate_to ? ', and their transcripts to the AI provider to be translated' : ''}. Nothing else from the
            submission is sent. Make sure respondents' consent covers this.
          </p>
        )}

        {editable && (
          <div className="flex gap-3 pt-1">
            <Button variant="primary" onClick={handleSave} loading={saving}>
              Save changes
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setDraft(toInput(overview));
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
            <dt className="text-gray-500 dark:text-gray-400">Questions</dt>
            <dd className="text-gray-900 dark:text-white">
              {settings.questions.length > 4
                ? `${settings.questions.length} questions: ${settings.questions.slice(0, 3).map(questionLabel).join(', ')} and ${
                    settings.questions.length - 3
                  } more`
                : settings.questions.map(questionLabel).join(', ')}
            </dd>
            <dt className="text-gray-500 dark:text-gray-400">Key</dt>
            <dd className="text-gray-900 dark:text-white">
              {ownKey
                ? `${overview.key.label} \u00b7 no Field Compass limit`
                : `Included usage \u00b7 ${allowance.limit_minutes} minutes a month`}
            </dd>
            <dt className="text-gray-500 dark:text-gray-400">Language</dt>
            <dd className="text-gray-900 dark:text-white">{languageName(settings.language)}</dd>
            <dt className="text-gray-500 dark:text-gray-400">Speakers</dt>
            <dd className="text-gray-900 dark:text-white">{settings.multiple_speakers ? 'Several' : 'One'}</dd>
            <dt className="text-gray-500 dark:text-gray-400">Translation</dt>
            <dd className="text-gray-900 dark:text-white">
              {settings.translate_to ? `Into ${languageName(settings.translate_to)}` : 'Off'}
            </dd>
            <dt className="text-gray-500 dark:text-gray-400">Kobo</dt>
            <dd className="text-gray-900 dark:text-white">
              {settings.send_to_kobo
                ? settings.translate_to
                  ? 'Transcripts and translations are sent to Kobo'
                  : 'Transcripts are sent to Kobo'
                : 'Kept in Field Compass only'}
            </dd>
          </dl>
        )}

        {!editing && settings.enabled && (
          <div className="ml-7 space-y-3 border-t border-gray-100 pt-4 dark:border-gray-800">
            <p className="text-sm text-gray-700 dark:text-gray-300">
              {(() => {
                const transcribed = counts.success - counts.from_kobo;
                return `${transcribed.toLocaleString()} ${transcribed === 1 ? 'recording' : 'recordings'} transcribed`;
              })()}
              {counts.from_kobo > 0 && <> · {counts.from_kobo.toLocaleString()} already transcribed in Kobo</>}
              {counts.in_progress > 0 && <> · {counts.in_progress} in progress</>}
              {counts.failed > 0 && (
                <>
                  {' · '}
                  <button type="button" onClick={toSubmissions('failed')} className="text-amber-700 underline decoration-dotted underline-offset-2 dark:text-amber-300">
                    {counts.failed} failed
                  </button>
                </>
              )}
              {counts.no_speech > 0 && (
                <>
                  {' · '}
                  <button type="button" onClick={toSubmissions('no_speech')} className="underline decoration-dotted underline-offset-2">
                    {counts.no_speech} with no speech
                  </button>
                </>
              )}
              .
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {ownKey
                ? `This month: ${overview.key.own_minutes ?? 0} minutes on \u201c${overview.key.label}\u201d.`
                : `This month: ${allowance.used_minutes} of ${allowance.limit_minutes} included minutes used.`}{' '}
              Recordings longer than {allowance.max_recording_minutes} minutes are skipped, and those
              that already have a transcript in Kobo keep it.
            </p>

            {settings.translate_to && translations && (
              <div className="space-y-1">
                {translation.paused && <Banner tone="warning">Translation paused: {translation.paused}</Banner>}
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  {translations.success.toLocaleString()} translated into {languageName(settings.translate_to)}
                  {translations.in_progress > 0 && <> · {translations.in_progress} in progress</>}
                  {translations.failed > 0 && (
                    <span className="text-amber-700 dark:text-amber-300"> · {translations.failed} failed</span>
                  )}
                  {translations.not_run > 0 && <> · {translations.not_run} not run</>}
                  {translations.missing > 0 && <> · {translations.missing} not translated yet</>}
                  {translations.skipped > 0 && <> · {translations.skipped} already in {languageName(settings.translate_to)} or silent</>}
                  .
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {translation.source === 'own'
                    ? `Translated by \u201c${translation.label}\u201d (${translation.model}).`
                    : translation.source === 'operator' && translation.allowance
                    ? `On the included AI usage: ${translation.allowance.remaining} of ${translation.allowance.limit} AI reviews left this month, shared with AI review.`
                    : 'Needs an AI provider.'}
                </p>
              </div>
            )}

            {settings.send_to_kobo && (
              <div className="space-y-2">
                {pause ? (
                  <Banner tone="warning">{pause.message}</Banner>
                ) : (
                  <>
                    <p className="text-sm text-gray-700 dark:text-gray-300">
                      {counts.kobo.sent.toLocaleString()} sent to Kobo
                      {counts.kobo.edited_in_kobo > 0 && <> · {counts.kobo.edited_in_kobo} corrected in Kobo</>}
                      {counts.kobo.failed > 0 && (
                        <span className="text-amber-700 dark:text-amber-300"> · {counts.kobo.failed} couldn't be sent</span>
                      )}
                      {counts.kobo.pending > 0 && <> · {counts.kobo.pending} on the way</>}.
                    </p>
                    {settings.translate_to && translations && translations.success > 0 && (
                      <p className="text-sm text-gray-700 dark:text-gray-300">
                        {translations.kobo.sent.toLocaleString()}{' '}
                        {translations.kobo.sent === 1 ? 'translation' : 'translations'} in Kobo
                        {translations.kobo.edited_in_kobo > 0 && <> · {translations.kobo.edited_in_kobo} corrected in Kobo</>}
                        {translations.kobo.failed > 0 && (
                          <span className="text-amber-700 dark:text-amber-300"> · {translations.kobo.failed} couldn't be sent</span>
                        )}
                        {translations.kobo.pending > 0 && <> · {translations.kobo.pending} on the way</>}.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {overview.can_edit && overview.available && (
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => openEstimate('missing')}>
                  Transcribe now
                </Button>
                {settings.translate_to && translation.available && translations && translations.missing + translations.failed + translations.not_run > 0 && (
                  <Button size="sm" variant="secondary" onClick={() => translate('missing')} loading={starting && !translateAgain}>
                    Translate {(translations.missing + translations.failed + translations.not_run).toLocaleString()} now
                  </Button>
                )}
                {settings.send_to_kobo && !pause && counts.kobo.unsent + (translations?.kobo.unsent ?? 0) > 0 && (
                  <Button size="sm" variant="secondary" onClick={resend}>
                    Send {(counts.kobo.unsent + (translations?.kobo.unsent ?? 0)).toLocaleString()} to Kobo
                  </Button>
                )}
                <button
                  type="button"
                  onClick={() => openEstimate('all')}
                  className="text-xs font-medium text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                >
                  Transcribe all again
                </button>
                {settings.translate_to && translation.available && translations && translations.success > 0 && (
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

        {!editing && !settings.enabled && settings.questions.length === 0 && overview.audio_questions.length > 0 && (
          <p className="ml-7 text-xs text-gray-500 dark:text-gray-400">
            This form has {overview.audio_questions.length} audio{' '}
            {overview.audio_questions.length === 1 ? 'question' : 'questions'}:{' '}
            {overview.audio_questions.map((q) => q.label).join(', ')}.
          </p>
        )}
      </div>

      <ConfirmDialog
        open={confirmConsent}
        title="Send recordings to ElevenLabs?"
        confirmLabel="Turn on transcription"
        tone="primary"
        busy={saving}
        onConfirm={() => save(true)}
        onCancel={() => setConfirmConsent(false)}
      >
        <p>
          Respondents' recordings for the chosen questions in <strong className="text-gray-900 dark:text-white">{surveyName}</strong>{' '}
          will be sent to ElevenLabs, a third party, to be transcribed.
        </p>
        <p>Only turn this on if respondents' consent and your organisation's data agreements allow it.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={estimate !== null}
        title={estimate?.mode === 'all' ? 'Transcribe every recording again?' : 'Transcribe recordings now?'}
        confirmLabel={estimate?.mode === 'all' ? 'Transcribe all again' : 'Transcribe now'}
        tone="primary"
        busy={starting}
        confirmDisabled={!estimate || estimate.recordings === 0}
        onConfirm={start}
        onCancel={() => setEstimate(null)}
      >
        {estimate && (
          <>
            <p>
              {estimate.recordings === 0
                ? 'Every recording already pulled has a transcript.'
                : `About ${estimate.recordings.toLocaleString()} ${estimate.recordings === 1 ? 'recording' : 'recordings'}${
                    estimate.known_minutes
                      ? estimate.known_minutes < 1.5
                        ? ', about a minute of audio'
                        : `, roughly ${Math.round(estimate.known_minutes)} minutes of audio`
                      : ''
                  }.`}
            </p>
            <p>
              This survey has {estimate.remaining_minutes} included minutes left this month; recordings beyond that wait until
              next month.
            </p>
            {estimate.mode === 'all' && <p>Transcripts already sent to Kobo are only replaced where nobody corrected them in Kobo.</p>}
          </>
        )}
      </ConfirmDialog>
      <ConfirmDialog
        open={translateAgain}
        title="Translate every transcript again?"
        confirmLabel="Translate all again"
        tone="primary"
        busy={starting}
        onConfirm={() => translate('all')}
        onCancel={() => setTranslateAgain(false)}
      >
        <p>
          About {((translations?.success ?? 0) + (translations?.missing ?? 0)).toLocaleString()} transcripts are sent to{' '}
          {translationProvider ?? 'the AI provider'} again.
        </p>
        <p>Translations already sent to Kobo are only replaced where nobody corrected them in Kobo.</p>
      </ConfirmDialog>
    </section>
  );
};

export default AudioTranscriptionCard;
