import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Submission } from '../types';
import SubmissionDataViewer from './SubmissionDataViewer';
import { statusDotClass } from './Badge';
import Button from './ui/Button';
import { ExternalLinkIcon, SidebarIcon } from './ui/icons';
import ReviewCard, { Decision } from './review/ReviewCard';
import AllChecks, { buildCheckList, passedCount } from './review/AllChecks';
import { useSurvey } from '../contexts/SurveyContext';
import { SurveyConfig, getValidationRules, ValidationRule } from '../services/progressApi';
import { formatValueForDisplay } from '../utils/koboLabelUtils';
import { api } from '../services/api';
import { useSubmissionTranscripts } from './transcription/AudioAnswers';
import { useSubmissionTranslations } from './translation/TranslationBlock';
import { findAnswer } from '../utils/answers';
import { answerAnchor, describeFindings } from '../utils/findings';

interface SubmissionDetailProps {
  submission: Submission | null;
  /** The survey's settings, as the dashboard loaded them; null until then. */
  surveyConfig: SurveyConfig | null;
  /** Where the submission sits in the list; index -1 once it has left it. */
  position: { index: number; total: number };
  onPrevious: () => void;
  onNext: () => void;
  /** Phone width: back to the list. */
  onBack: () => void;
  canEdit: boolean;
  shortcuts: boolean;
  note: string;
  onNoteChange: (note: string) => void;
  saving: Decision | 'clear' | 'note' | null;
  error: string | null;
  onDecide: (status: Decision | null) => void;
  onSaveNote: () => void;
  onFilterIssue: (check: string) => void;
  /** The list is hidden and the submission has the page. */
  focus: boolean;
  onToggleFocus: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  Approved: 'Approved',
  'Not Approved': 'Not approved',
  'On Hold': 'On hold',
};

const time = (value: unknown): string | null => {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

const day = (value: unknown): string | null => {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

/** Who, where and when, in one line under the submission's number. */
function describeInterview(submission: Submission, config: SurveyConfig | null): React.ReactNode[] {
  const data = submission.submission_data ?? {};
  const ids = config?.config_data?.core_identifiers ?? {};
  const parts: React.ReactNode[] = [];

  if (ids.enumerator) {
    const code = findAnswer(data, ids.enumerator);
    if (code === undefined || code === null || code === '') {
      parts.push(<span className="text-gray-400 dark:text-gray-500">No enumerator recorded</span>);
    } else {
      const name = formatValueForDisplay(code, ids.enumerator, config);
      parts.push(
        <span>
          {name}
          {name !== String(code) && (
            <span className="ml-1.5 text-xs text-gray-400 dark:text-gray-500">{String(code)}</span>
          )}
        </span>
      );
    }
  }

  const groups = (config?.config_data?.sampling_frame?.sampling_cols ?? [])
    .map((col) => {
      const value = findAnswer(data, col);
      return value === undefined || value === null || value === '' ? null : formatValueForDisplay(value, col, config);
    })
    .filter((v): v is string => !!v);
  if (groups.length) parts.push(<span>{groups.join(' › ')}</span>);

  const start = ids.start_time ? findAnswer(data, ids.start_time) : undefined;
  const end = ids.end_time ? findAnswer(data, ids.end_time) : undefined;
  const date =
    day(ids.date_interview ? findAnswer(data, ids.date_interview) : null) ??
    day(start) ??
    day(submission._submission_time);
  const range = [time(start), time(end)].filter(Boolean).join('–');
  parts.push(<span>{range ? `${date}, ${range}` : date}</span>);

  const active = data.active_interview_time;
  if (typeof active === 'number' && Number.isFinite(active)) {
    parts.push(<span>{Math.round(active)} min active</span>);
  } else if (start && end) {
    const minutes = (new Date(String(end)).getTime() - new Date(String(start)).getTime()) / 60000;
    if (Number.isFinite(minutes) && minutes >= 0) parts.push(<span>{Math.round(minutes)} min</span>);
  }

  if (submission.has_edit_history)
    parts.push(<span className="text-amber-700 dark:text-amber-400">Edited in Kobo</span>);
  return parts;
}

const SubmissionDetail: React.FC<SubmissionDetailProps> = ({
  submission,
  surveyConfig,
  position,
  onPrevious,
  onNext,
  onBack,
  canEdit,
  shortcuts,
  note,
  onNoteChange,
  saving,
  error,
  onDecide,
  onSaveNote,
  onFilterIssue,
  focus,
  onToggleFocus,
}) => {
  const { selectedSurvey } = useSurvey();
  const [rules, setRules] = useState<ValidationRule[]>([]);
  const [allChecksOpen, setAllChecksOpen] = useState(false);
  const [openingKobo, setOpeningKobo] = useState(false);
  const [koboError, setKoboError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Custom checks name their own findings; read once per survey.
  const surveyId = selectedSurvey?.survey_id;
  useEffect(() => {
    if (!surveyId) return;
    let cancelled = false;
    getValidationRules(surveyId)
      .then((all) => !cancelled && setRules(all.filter((r) => r.is_active)))
      .catch((err) => console.error('Failed to load validation rules:', err));
    return () => {
      cancelled = true;
    };
  }, [surveyId]);

  // A new submission starts at the top, with its checks folded.
  useEffect(() => {
    setAllChecksOpen(false);
    setKoboError(null);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [submission?._id]);

  // Recorded answers, shown in their place among the survey responses; re-read
  // when a transcript or an AI review moves on.
  const transcripts = useSubmissionTranscripts(
    submission?._id ?? null,
    submission ? `${submission.llm_check_status}:${submission.data_quality_issues.length}` : undefined
  );
  // Translations, shown under the answers they translate.
  const translations = useSubmissionTranslations(submission?._id ?? null);

  const findings = useMemo(
    () =>
      submission
        ? describeFindings(submission.data_quality_issues, {
            config: surveyConfig,
            data: submission.submission_data ?? {},
            rules,
          })
        : [],
    [submission, surveyConfig, rules]
  );
  const checkGroups = useMemo(
    () => (submission ? buildCheckList({ submission, config: surveyConfig, rules }) : []),
    [submission, surveyConfig, rules]
  );

  if (!submission) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
        <p className="text-sm font-medium text-gray-900 dark:text-white">No submission selected</p>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Choose one from the list{shortcuts ? ', or press J to start with the first' : ''}.
        </p>
      </div>
    );
  }

  const status = submission.kobo_validation_status || 'Not Reviewed';
  const pending =
    submission.llm_check_status === 'pending' ||
    submission.llm_check_status === 'running' ||
    submission.llm_check_status === 'waiting'
      ? 'AI review is still running and may add findings.'
      : (submission.transcript_summary?.in_progress ?? 0) > 0
        ? 'Recordings are still being transcribed.'
        : undefined;
  // Findings point at answers by name; only those the form shows can be scrolled to.
  const formQuestions = new Set(
    (surveyConfig?.config_data?.kobo_tool?.survey ?? []).map((q: { name: string }) => q.name)
  );

  const jumpToAnswer = (question: string) => {
    const row = document.getElementById(answerAnchor(question));
    if (!row) return;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.add('ring-2', 'ring-inset', 'ring-amber-400');
    window.setTimeout(() => row.classList.remove('ring-2', 'ring-inset', 'ring-amber-400'), 1600);
  };

  // The edit link costs a call to Kobo, so it is asked for on click. The tab
  // opens first, so the browser doesn't treat it as an unrequested pop-up.
  const openInKobo = async () => {
    if (!selectedSurvey) return;
    const tab = window.open('', '_blank');
    setOpeningKobo(true);
    setKoboError(null);
    try {
      const url = await api.getKoboEditUrl(submission._id, selectedSurvey.survey_id);
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else {
        window.open(url, '_blank', 'noopener');
      }
    } catch {
      tab?.close();
      setKoboError("Kobo didn't give an edit link. Try again in a moment.");
    } finally {
      setOpeningKobo(false);
    }
  };

  const meta = describeInterview(submission, surveyConfig);

  return (
    <div className="flex h-full min-w-0 flex-col bg-gray-50/60 dark:bg-gray-950">
      <header className="border-b border-gray-200 bg-white px-4 pb-3 pt-3.5 dark:border-gray-800 dark:bg-gray-950 md:px-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            type="button"
            onClick={onBack}
            className="-ml-1 inline-flex h-9 items-center gap-1 rounded-md px-1.5 text-sm text-gray-600 hover:bg-gray-100 md:hidden dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <span aria-hidden="true">←</span> List
          </button>
          <h2 className="tabular text-lg font-semibold tracking-tight text-gray-900 dark:text-white">
            <span className="font-normal text-gray-400 dark:text-gray-500">#</span>
            {submission._id}
          </h2>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300">
            <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass(status)}`} aria-hidden="true" />
            {STATUS_LABEL[status] ?? 'Not reviewed'}
          </span>
          <span className="flex-1" />
          <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
            <Button
              variant="ghost"
              size="sm"
              onClick={onPrevious}
              disabled={position.index <= 0}
              aria-label="Previous submission"
            >
              ‹
            </Button>
            <span className="tabular min-w-[4.5rem] text-center">
              {position.index >= 0 ? `${position.index + 1} of ${position.total}` : `${position.total} left`}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={onNext}
              disabled={position.total === 0 || position.index >= position.total - 1}
              aria-label="Next submission"
            >
              ›
            </Button>
          </div>
          {canEdit && (
            <Button
              size="sm"
              onClick={openInKobo}
              loading={openingKobo}
              icon={<ExternalLinkIcon className="h-3.5 w-3.5" />}
            >
              Open in Kobo
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleFocus}
            aria-pressed={focus}
            className="hidden md:inline-flex"
            icon={<SidebarIcon className="h-4 w-4" />}
          >
            {focus ? 'Show list' : 'Hide list'}
          </Button>
        </div>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-1 gap-y-1 text-[13px] text-gray-600 dark:text-gray-400">
          {meta.map((part, index) => (
            <React.Fragment key={index}>
              {index > 0 && (
                <span className="px-1 text-gray-300 dark:text-gray-600" aria-hidden="true">
                  ·
                </span>
              )}
              {part}
            </React.Fragment>
          ))}
        </p>
        {koboError && (
          <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">
            {koboError}
          </p>
        )}
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div
          className={`mx-auto flex w-full flex-col gap-4 px-4 py-5 md:px-6 ${
            focus
              ? 'max-w-7xl xl:grid xl:grid-cols-[minmax(0,28rem)_minmax(0,1fr)] xl:items-start xl:gap-6'
              : 'max-w-4xl'
          }`}
        >
          <div
            className={`flex flex-col gap-4 ${focus ? 'xl:sticky xl:top-0 xl:max-h-[calc(100vh-11rem)] xl:overflow-y-auto' : ''}`}
          >
            <ReviewCard
              submissionId={submission._id}
              status={submission.kobo_validation_status}
              findings={findings}
              passed={passedCount(checkGroups)}
              allChecksOpen={allChecksOpen}
              onToggleAllChecks={() => setAllChecksOpen((open) => !open)}
              pending={pending}
              canEdit={canEdit}
              shortcuts={shortcuts}
              note={note}
              onNoteChange={onNoteChange}
              savedNote={submission.reviewer_notes ?? ''}
              saving={saving}
              error={error}
              onDecide={onDecide}
              onSaveNote={onSaveNote}
              onJumpToAnswer={jumpToAnswer}
              hasAnswer={(question) => formQuestions.size === 0 || formQuestions.has(question)}
              onFilterIssue={onFilterIssue}
            />
            {allChecksOpen && <AllChecks groups={checkGroups} />}
          </div>
          <SubmissionDataViewer
            data={submission.submission_data}
            surveyConfig={surveyConfig}
            recordings={
              transcripts && {
                koboId: submission._id,
                answers: transcripts.answers,
                sendToKobo: transcripts.send_to_kobo,
                issues: submission.data_quality_issues,
              }
            }
            translations={translations}
            findings={findings}
          />
        </div>
      </div>
    </div>
  );
};

export default SubmissionDetail;
