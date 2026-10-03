import React, { useEffect, useState } from 'react';
import { useActivity } from '../../contexts/ActivityContext';
import {
  AudioAnswer,
  getSubmissionTranscripts,
  loadRecording,
  SubmissionTranscripts,
  Transcript,
} from '../../services/transcriptionApi';
import { Spinner } from '../Spinner';
import { QualityIssue } from '../../types';
import { issueName } from '../../utils/issueNames';

type Tone = 'busy' | 'ok' | 'warn' | 'muted';

/** A transcript's state in plain words; `last_error` is "<category>: <message>". */
export const describeTranscript = (transcript: Transcript | null, transcribed: boolean): { tone: Tone; text: string } => {
  if (!transcript) {
    return transcribed
      ? { tone: 'muted', text: 'Not transcribed yet: it will be on the next pull.' }
      : { tone: 'muted', text: 'This question is not transcribed.' };
  }
  const [category, ...rest] = (transcript.last_error ?? '').split(': ');
  const message = rest.join(': ').replace(/ \(retrying\)$/, '');
  switch (transcript.status) {
    case 'pending':
    case 'running':
      return { tone: 'busy', text: transcript.last_error ? 'Transcribing… retrying after a temporary error.' : 'Transcribing…' };
    case 'success':
      return { tone: 'ok', text: 'Transcribed' };
    case 'not_run_allowance':
      return { tone: 'warn', text: message || 'Not transcribed: this survey has used its included minutes for this month.' };
    case 'cancelled':
      return { tone: 'muted', text: message || 'Stopped before it ran. It runs again on the next pull.' };
    case 'skipped':
      if (transcript.skip_reason === 'too_long') return { tone: 'warn', text: 'Not transcribed: the recording is too long.' };
      return { tone: 'warn', text: 'Not transcribed: Kobo has no recording for this answer.' };
    default: {
      const reasons: Record<string, string> = {
        auth: "Couldn't transcribe: ElevenLabs rejected the API key.",
        provider_quota: "Couldn't transcribe: the ElevenLabs account is out of credit.",
        not_configured: "Couldn't transcribe: transcription is not set up on this server.",
        bad_request: "Couldn't transcribe: the recording's format isn't supported, or the file is damaged.",
        kobo_auth: "Couldn't download the recording from Kobo.",
      };
      return { tone: 'warn', text: reasons[category] ?? "Couldn't transcribe this time. It will be retried on the next pull." };
    }
  }
};

const koboLine = (transcript: Transcript): { tone: Tone; text: string } | null => {
  switch (transcript.kobo_status) {
    case 'sent':
      return { tone: 'ok', text: 'In Kobo' };
    case 'pending':
      return { tone: 'busy', text: 'Sending to Kobo…' };
    case 'edited_in_kobo':
      return { tone: 'muted', text: 'Corrected in Kobo — the correction is kept' };
    case 'unsupported':
      return { tone: 'warn', text: "This Kobo server doesn't support adding transcripts" };
    case 'failed': {
      const [category, ...rest] = (transcript.kobo_last_error ?? '').split(': ');
      if (category === 'kobo_permission') return { tone: 'warn', text: "Couldn't send to Kobo: your Kobo account can't edit this project's submissions" };
      return { tone: 'warn', text: `Couldn't send to Kobo${rest.length ? `: ${rest.join(': ')}` : ''}` };
    }
    default:
      if (transcript.status !== 'success') return null;
      return {
        tone: 'muted',
        text: transcript.text?.trim() ? 'Not sent to Kobo' : 'Nothing to send to Kobo',
      };
  }
};

const toneClass: Record<Tone, string> = {
  busy: 'text-indigo-700 dark:text-indigo-300',
  ok: 'text-gray-600 dark:text-gray-400',
  warn: 'text-amber-700 dark:text-amber-300',
  muted: 'text-gray-500 dark:text-gray-400',
};

const duration = (seconds: number | null) => {
  if (seconds == null) return null;
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Loads the recording only when asked: it is streamed from Kobo each time. */
const Player: React.FC<{ koboId: number; answer: AudioAnswer }> = ({ koboId, answer }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  if (!answer.has_recording) return null;
  if (url) {
    // eslint-disable-next-line jsx-a11y/media-has-caption
    return <audio controls autoPlay src={url} className="mt-2 h-9 w-full max-w-md" aria-label={`Recording: ${answer.label}`} />;
  }
  return (
    <div className="mt-2 flex items-center gap-2">
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
    return <p className="mt-2 text-sm italic text-gray-500 dark:text-gray-400">No speech in this recording.</p>;
  }
  if (transcript.segments && transcript.segments.length > 0) {
    const speakers = transcript.segments
      .map((segment) => segment.speaker ?? '')
      .filter((speaker, index, all) => all.indexOf(speaker) === index);
    return (
      <dl className="mt-2 space-y-1.5 text-sm">
        {transcript.segments.map((segment, index) => (
          <div key={index} className="grid grid-cols-[5.5rem,1fr] gap-2">
            <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">{speakerName(segment.speaker, speakers)}</dt>
            <dd className="text-gray-800 dark:text-gray-200">{segment.text}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return <p className="mt-2 whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-200">{transcript.text}</p>;
};

interface AudioAnswersProps {
  koboId: number;
  /** Re-read when the submission changes (a poll, a transcript finished). */
  refreshKey?: string;
  /** The submission's findings; those about a recording show under it. */
  issues?: QualityIssue[];
}

/**
 * Submission detail › Recordings: each answered audio question with a
 * player, its transcript, and whether it is in Kobo. Hidden when the
 * submission has no audio answers.
 */
const AudioAnswers: React.FC<AudioAnswersProps> = ({ koboId, refreshKey, issues = [] }) => {
  const { version } = useActivity();
  const [data, setData] = useState<SubmissionTranscripts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<number | null>(null);

  // Another submission: never show the last one's recordings meanwhile.
  useEffect(() => {
    setData(null);
    setLoadedFor(null);
  }, [koboId]);

  useEffect(() => {
    let cancelled = false;
    getSubmissionTranscripts(koboId)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setLoadedFor(koboId);
        setError(null);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Could not load transcripts.'));
    return () => {
      cancelled = true;
    };
    // `version` changes as background work moves on.
  }, [koboId, refreshKey, version]);

  if (error) return null;
  if (!data || loadedFor !== koboId || data.answers.length === 0) return null;

  return (
    <div className="mb-6">
      <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-white">
        <svg className="h-4 w-4 text-indigo-500 dark:text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8" />
        </svg>
        Recordings
      </h3>
      <div className="space-y-3">
        {data.answers.map((answer) => {
          const transcript = answer.transcript;
          const state = describeTranscript(transcript, answer.transcribed);
          const kobo = transcript && data.send_to_kobo ? koboLine(transcript) : null;
          const details = [
            transcript?.language_name,
            duration(transcript?.audio_seconds ?? null),
          ].filter(Boolean);
          return (
            <div key={answer.question_path} className="rounded-lg border border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900/60">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="text-sm font-medium text-gray-900 dark:text-white">{answer.label}</p>
                <p className={`flex items-center gap-1.5 text-xs ${toneClass[state.tone]}`} role="status">
                  {state.tone === 'busy' && <Spinner size="sm" />}
                  {state.text}
                  {transcript?.status === 'success' && details.length > 0 && (
                    <span className="text-gray-500 dark:text-gray-400"> · {details.join(' · ')}</span>
                  )}
                </p>
              </div>
              <Player koboId={koboId} answer={answer} />
              {transcript?.status === 'success' && <TranscriptText transcript={transcript} />}
              {transcript?.status !== 'success' && transcript?.text && (
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  Earlier transcript: <span className="text-gray-700 dark:text-gray-300">{transcript.text}</span>
                </p>
              )}
              {issues
                .filter((issue) => issue.field === answer.question_path && issue.check.startsWith('audio_'))
                .map((issue) => (
                  <p
                    key={issue.check}
                    className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
                  >
                    <span className="font-medium">{issueName(issue.check)}:</span> {issue.message}
                  </p>
                ))}
              {kobo && <p className={`mt-2 text-xs ${toneClass[kobo.tone]}`}>{kobo.text}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AudioAnswers;
