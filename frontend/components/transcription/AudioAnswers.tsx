import React, { useEffect, useState } from 'react';
import { useActivity } from '../../contexts/ActivityContext';
import {
  AudioAnswer,
  getSubmissionTranscripts,
  loadRecording,
  SubmissionTranscripts,
  Transcript,
} from '../../services/transcriptionApi';
import { Translation } from '../../services/translationApi';
import { Spinner } from '../Spinner';
import { QualityIssue } from '../../types';
import { issueName } from '../../utils/issueNames';
import { TranslationBlock } from '../translation/TranslationBlock';
import { koboState, Tone, toneClass } from './koboState';

/**
 * A transcript's state in plain words; `last_error` is "<category>: <message>".
 * Null when there is nothing to say: a question this survey does not transcribe.
 */
const describeTranscript = (
  transcript: Transcript | null,
  transcribed: boolean
): { tone: Tone; text: string } | null => {
  if (!transcript) {
    return transcribed ? { tone: 'muted', text: 'Not transcribed yet: it will be on the next pull.' } : null;
  }
  if (transcript.source === 'kobo') {
    return {
      tone: 'ok',
      text: transcript.kobo_status === 'edited_in_kobo' ? 'Corrected in Kobo' : 'Transcript from Kobo',
    };
  }
  const [category, ...rest] = (transcript.last_error ?? '').split(': ');
  const message = rest.join(': ').replace(/ \(retrying\)$/, '');
  switch (transcript.status) {
    case 'pending':
    case 'running':
      return {
        tone: 'busy',
        text: transcript.last_error ? 'Transcribing… retrying after a temporary error.' : 'Transcribing…',
      };
    case 'success':
      return { tone: 'ok', text: 'Transcribed' };
    case 'not_run_allowance':
      return {
        tone: 'warn',
        text: message || 'Not transcribed: this survey has used its included minutes for this month.',
      };
    case 'cancelled':
      return { tone: 'muted', text: message || 'Stopped before it ran. It runs again on the next pull.' };
    case 'skipped':
      if (transcript.skip_reason === 'too_long')
        return { tone: 'warn', text: 'Not transcribed: the recording is too long.' };
      return { tone: 'warn', text: 'Not transcribed: Kobo has no recording for this answer.' };
    default: {
      const reasons: Record<string, string> = {
        auth: "Couldn't transcribe: ElevenLabs rejected the API key.",
        provider_quota: "Couldn't transcribe: the ElevenLabs account is out of credit.",
        not_configured: "Couldn't transcribe: transcription is not set up on this server.",
        bad_request: "Couldn't transcribe: the recording's format isn't supported, or the file is damaged.",
        kobo_auth: "Couldn't download the recording from Kobo.",
      };
      return {
        tone: 'warn',
        text: reasons[category] ?? "Couldn't transcribe this time. It will be retried on the next pull.",
      };
    }
  }
};

const koboLine = (transcript: Transcript): { tone: Tone; text: string } | null =>
  transcript.source === 'kobo' ? null : koboState(transcript, 'transcript'); // Kobo's own is already there

const duration = (seconds: number | null) => {
  if (seconds == null) return null;
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Loads the recording only when asked: it is streamed from Kobo each time. */
export const Player: React.FC<{ koboId: number; answer: AudioAnswer }> = ({ koboId, answer }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url]
  );

  if (!answer.has_recording) {
    return <p className="text-sm text-gray-400 dark:text-gray-500">No recording in Kobo</p>;
  }
  if (url) {
    // eslint-disable-next-line jsx-a11y/media-has-caption
    return (
      <audio controls autoPlay src={url} className="h-9 w-full max-w-md" aria-label={`Recording: ${answer.label}`} />
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={async () => {
          setLoading(true);
          setError(null);
          try {
            setUrl(await loadRecording(koboId, answer.question_path));
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not load the recording.');
          } finally {
            setLoading(false);
          }
        }}
        disabled={loading}
        className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-800 shadow-xs hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
      >
        {loading ? (
          <Spinner size="sm" />
        ) : (
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M8 5.5v13l11-6.5z" />
          </svg>
        )}
        Listen
      </button>
      {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
    </div>
  );
};

const speakerName = (speaker: string | null, speakers: string[]) =>
  speaker ? `Speaker ${speakers.indexOf(speaker) + 1}` : 'Speaker';

const TranscriptText: React.FC<{ transcript: Transcript }> = ({ transcript }) => {
  if (!transcript.text?.trim()) {
    return <p className="text-sm italic text-gray-500 dark:text-gray-400">No speech in this recording.</p>;
  }
  if (transcript.segments && transcript.segments.length > 0) {
    const speakers = transcript.segments
      .map((segment) => segment.speaker ?? '')
      .filter((speaker, index, all) => all.indexOf(speaker) === index);
    return (
      <dl className="space-y-1.5 text-sm">
        {transcript.segments.map((segment, index) => (
          <div key={index} className="grid grid-cols-[5.5rem,1fr] gap-2">
            <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">
              {speakerName(segment.speaker, speakers)}
            </dt>
            <dd className="text-gray-800 dark:text-gray-200">{segment.text}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return <p className="whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-200">{transcript.text}</p>;
};

/**
 * A submission's audio answers with their transcripts, re-read as background
 * work moves on. Null until loaded, and when it could not be.
 */
export const useSubmissionTranscripts = (koboId: number | null, refreshKey?: string): SubmissionTranscripts | null => {
  const { version } = useActivity();
  const [data, setData] = useState<SubmissionTranscripts | null>(null);
  const [loadedFor, setLoadedFor] = useState<number | null>(null);

  // Another submission: never show the last one's recordings meanwhile.
  useEffect(() => {
    setData(null);
    setLoadedFor(null);
  }, [koboId]);

  useEffect(() => {
    if (koboId == null) return undefined;
    let cancelled = false;
    getSubmissionTranscripts(koboId)
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

  return koboId != null && loadedFor === koboId ? data : null;
};

interface RecordingProps {
  answer: AudioAnswer;
  /** Whether the survey sends transcripts to Kobo. */
  sendToKobo: boolean;
}

/** The transcript's state, e.g. "Transcribed · French · 0:42" or "Transcript from Kobo". */
export const RecordingStatus: React.FC<RecordingProps> = ({ answer }) => {
  const transcript = answer.transcript;
  const state = describeTranscript(transcript, answer.transcribed);
  if (!state) return null;
  const details = [transcript?.language_name, duration(transcript?.audio_seconds ?? null)].filter(Boolean);
  return (
    <p className={`mb-1.5 flex items-center gap-1.5 text-xs ${toneClass[state.tone]}`} role="status">
      {state.tone === 'busy' && <Spinner size="sm" />}
      <span>
        {state.text}
        {transcript?.status === 'success' && details.length > 0 && (
          <span className="text-gray-500 dark:text-gray-400"> · {details.join(' · ')}</span>
        )}
      </span>
    </p>
  );
};

/**
 * What goes under a recorded answer: its transcript and whether it is in
 * Kobo, findings about the recording, then its translation and whether that
 * is in Kobo. Null when there is none.
 */
export const RecordingDetails: React.FC<
  RecordingProps & {
    issues?: QualityIssue[];
    translation?: Translation | null;
    /** Whether the survey sends translated transcripts to Kobo. */
    translationsToKobo?: boolean;
  }
> = ({ answer, sendToKobo, issues = [], translation = null, translationsToKobo = false }) => {
  const transcript = answer.transcript;
  const kobo = transcript && sendToKobo ? koboLine(transcript) : null;
  const findings = issues.filter((issue) => issue.field === answer.question_path && issue.check.startsWith('audio_'));
  const showText = transcript?.status === 'success';
  const earlier = transcript?.status !== 'success' && transcript?.text;
  const shownTranslation = showText ? translation : null;
  if (!showText && !earlier && findings.length === 0 && !kobo && !shownTranslation) return null;
  return (
    <div className="space-y-2">
      {showText && transcript && (
        <div className="space-y-1">
          <div className="rounded-md border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900/60">
            <TranscriptText transcript={transcript} />
          </div>
          {kobo && <p className={`text-xs ${toneClass[kobo.tone]}`}>{kobo.text}</p>}
        </div>
      )}
      {earlier && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Earlier transcript: <span className="text-gray-700 dark:text-gray-300">{transcript?.text}</span>
        </p>
      )}
      {findings.map((issue) => (
        <p
          key={issue.check}
          className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
        >
          <span className="font-medium">{issueName(issue.check)}:</span> {issue.message}
        </p>
      ))}
      {!showText && kobo && <p className={`text-xs ${toneClass[kobo.tone]}`}>{kobo.text}</p>}
      <TranslationBlock translation={shownTranslation} sendToKobo={translationsToKobo} />
    </div>
  );
};
