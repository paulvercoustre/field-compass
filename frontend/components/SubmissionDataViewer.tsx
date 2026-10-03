
import React, { useState } from 'react';
import { KoboQuestion, QualityIssue } from '../types';
import { SurveyConfig } from '../services/progressApi';
import { AudioAnswer } from '../services/transcriptionApi';
import { getQuestionLabel, formatValueForDisplay } from '../utils/koboLabelUtils';
import { Player, RecordingDetails, RecordingStatus } from './transcription/AudioAnswers';

/** The submission's recorded answers, shown in place of their file names. */
export interface Recordings {
  koboId: number;
  answers: AudioAnswer[];
  sendToKobo: boolean;
  /** The submission's findings; those about a recording show under it. */
  issues: QualityIssue[];
}

interface SubmissionDataViewerProps {
  data: Record<string, any>;
  surveyConfig: SurveyConfig | null;
  recordings?: Recordings | null;
}

// The recorded answer to a question: matched on its group path ("voice/story"),
// then on its name.
const findRecording = (recordings: Recordings | null | undefined, question: KoboQuestion): AudioAnswer | undefined => {
  if (!recordings) return undefined;
  const path = question.group_path ? `${question.group_path.replace(/^\/+|\/+$/g, '')}/${question.name}` : question.name;
  return (
    recordings.answers.find((answer) => answer.question_path === path) ??
    recordings.answers.find((answer) => answer.question_path.split('/').pop() === question.name)
  );
};

// Humanize a snake_case or camelCase string into title case
const humanize = (str: string): string =>
  str
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, c => c.toUpperCase());

// Look up a value from submission_data using path-based matching
const lookupValue = (data: Record<string, any>, fieldName: string): any => {
  if (!data || !fieldName) return undefined;
  if (fieldName in data) return data[fieldName];
  for (const key in data) {
    if (key.endsWith(`/${fieldName}`) || key === fieldName) return data[key];
  }
  return undefined;
};

// Format a raw value for display: empty → em dash
const displayValue = (
  value: any,
  fieldName: string,
  surveyConfig: SurveyConfig | null
): string => {
  if (value === null || value === undefined || value === '') return '—';
  return formatValueForDisplay(value, fieldName, surveyConfig);
};

interface QuestionRowProps {
  question: KoboQuestion;
  value: any;
  surveyConfig: SurveyConfig | null;
  isEven: boolean;
}

const QuestionRow: React.FC<QuestionRowProps> = ({ question, value, surveyConfig, isEven }) => {
  const label = getQuestionLabel(question.name, surveyConfig);
  const formatted = displayValue(value, question.name, surveyConfig);
  const isEmpty = value === null || value === undefined || value === '';

  return (
    <div
      className={`grid grid-cols-2 gap-4 px-4 py-2.5 ${
        isEven
          ? 'bg-gray-50 dark:bg-gray-800/50'
          : 'bg-white dark:bg-gray-900/20'
      }`}
    >
      <span className="text-sm text-gray-500 dark:text-gray-400 break-words leading-snug">
        {label}
      </span>
      <span
        className={`text-sm font-medium break-words leading-snug ${
          isEmpty
            ? 'text-gray-300 dark:text-gray-600'
            : 'text-gray-900 dark:text-gray-100'
        }`}
      >
        {formatted}
      </span>
    </div>
  );
};

interface RecordingRowProps {
  label: string;
  answer: AudioAnswer;
  recordings: Recordings;
  isEven: boolean;
}

// An audio question: the player in place of the file name, and its
// transcript across the full width underneath.
const RecordingRow: React.FC<RecordingRowProps> = ({ label, answer, recordings, isEven }) => (
  <div
    className={`grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-2.5 ${
      isEven ? 'bg-gray-50 dark:bg-gray-800/50' : 'bg-white dark:bg-gray-900/20'
    }`}
  >
    <span className="flex items-start gap-1.5 text-sm text-gray-500 dark:text-gray-400 break-words leading-snug">
      <svg className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-indigo-500 dark:text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8" />
      </svg>
      {label}
    </span>
    <div className="min-w-0">
      <RecordingStatus answer={answer} sendToKobo={recordings.sendToKobo} />
      <Player koboId={recordings.koboId} answer={answer} />
    </div>
    <div className="col-span-2 empty:hidden">
      <RecordingDetails answer={answer} sendToKobo={recordings.sendToKobo} issues={recordings.issues} />
    </div>
  </div>
);

interface SectionCardProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

const SectionCard: React.FC<SectionCardProps> = ({ title, children, defaultOpen = true }) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800/70 transition-colors text-left"
      >
        <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
          {title}
        </span>
        <svg
          className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="divide-y divide-gray-100 dark:divide-gray-800">{children}</div>}
    </div>
  );
};

// Column header row for question/answer grid
const GridHeader: React.FC = () => (
  <div className="grid grid-cols-2 gap-4 px-4 py-2 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-950">
    <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
      Question
    </span>
    <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
      Answer
    </span>
  </div>
);

interface RosterSectionProps {
  rosterName: string;
  questions: KoboQuestion[];
  rosterItems: Record<string, any>[];
  surveyConfig: SurveyConfig | null;
}

const RosterSection: React.FC<RosterSectionProps> = ({
  rosterName,
  questions,
  rosterItems,
  surveyConfig,
}) => {
  return (
    <SectionCard title={humanize(rosterName)}>
      {rosterItems.length === 0 ? (
        <div className="px-4 py-3 text-sm text-gray-400 dark:text-gray-500 italic">
          No entries recorded
        </div>
      ) : (
        rosterItems.map((item, itemIdx) => (
          <div key={itemIdx} className="border-b last:border-b-0 border-gray-100 dark:border-gray-700/50">
            {rosterItems.length > 1 && (
              <div className="px-4 py-2 bg-blue-50 dark:bg-blue-900/20 text-xs font-medium text-blue-600 dark:text-blue-400">
                Item {itemIdx + 1}
              </div>
            )}
            <GridHeader />
            {questions.map((q, qIdx) => {
              const value = item[q.name] ?? lookupValue(item, q.name);
              return (
                <QuestionRow
                  key={q.name}
                  question={q}
                  value={value}
                  surveyConfig={surveyConfig}
                  isEven={qIdx % 2 === 0}
                />
              );
            })}
          </div>
        ))
      )}
    </SectionCard>
  );
};

const SubmissionDataViewer: React.FC<SubmissionDataViewerProps> = ({ data, surveyConfig, recordings }) => {
  const survey = surveyConfig?.config_data.kobo_tool?.survey ?? [];

  // Separate top-level and roster questions
  const topLevelQuestions = survey.filter((q: KoboQuestion) => !q.roster_name);
  const rosterNames: string[] = Array.from(
    new Set(
      survey
        .filter((q: KoboQuestion) => q.roster_name)
        .map((q: KoboQuestion) => q.roster_name as string)
    )
  );

  // Metadata keys (start with '_')
  const metadataEntries = Object.entries(data).filter(([k]) => k.startsWith('_'));

  // Fallback: if no survey config, render raw key/value pairs
  if (!surveyConfig || survey.length === 0) {
    const nonMeta = Object.entries(data).filter(([k]) => !k.startsWith('_'));
    return (
      <div className="space-y-4">
        {nonMeta.length > 0 && (
          <SectionCard title="Submission Data">
            <GridHeader />
            {nonMeta.map(([key, val], idx) => {
              const question = { name: key, type: 'text', roster_name: null };
              const recording = findRecording(recordings, question);
              return recording && recordings ? (
                <RecordingRow key={key} label={key} answer={recording} recordings={recordings} isEven={idx % 2 === 0} />
              ) : (
                <QuestionRow key={key} question={question} value={val} surveyConfig={null} isEven={idx % 2 === 0} />
              );
            })}
          </SectionCard>
        )}
        {metadataEntries.length > 0 && (
          <MetadataSection entries={metadataEntries} />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Top-level questions */}
      {topLevelQuestions.length > 0 && (
        <SectionCard title="Survey Responses">
          <GridHeader />
          {topLevelQuestions.map((q: KoboQuestion, idx: number) => {
            const recording = q.type === 'audio' ? findRecording(recordings, q) : undefined;
            if (recording && recordings) {
              return (
                <RecordingRow
                  key={q.name}
                  label={getQuestionLabel(q.name, surveyConfig)}
                  answer={recording}
                  recordings={recordings}
                  isEven={idx % 2 === 0}
                />
              );
            }
            const value = lookupValue(data, q.name);
            return (
              <QuestionRow
                key={q.name}
                question={q}
                value={value}
                surveyConfig={surveyConfig}
                isEven={idx % 2 === 0}
              />
            );
          })}
        </SectionCard>
      )}

      {/* Roster / repeat group sections */}
      {rosterNames.map(rosterName => {
        const rosterQuestions = survey.filter(
          (q: KoboQuestion) => q.roster_name === rosterName
        );
        // Kobo stores repeat items as an array under the roster name key
        const rawRosterValue = data[rosterName];
        const rosterItems: Record<string, any>[] = Array.isArray(rawRosterValue)
          ? rawRosterValue
          : rawRosterValue != null
          ? [rawRosterValue]
          : [];

        return (
          <RosterSection
            key={rosterName}
            rosterName={rosterName}
            questions={rosterQuestions}
            rosterItems={rosterItems}
            surveyConfig={surveyConfig}
          />
        );
      })}

      {/* Metadata section */}
      {metadataEntries.length > 0 && (
        <MetadataSection entries={metadataEntries} />
      )}
    </div>
  );
};

// Collapsible metadata section for Kobo system fields (_uuid, etc.)
interface MetadataSectionProps {
  entries: [string, any][];
}

const MetadataSection: React.FC<MetadataSectionProps> = ({ entries }) => (
  <SectionCard title="Metadata" defaultOpen={false}>
    <GridHeader />
    {entries.map(([key, val], idx) => (
      <div
        key={key}
        className={`grid grid-cols-2 gap-4 px-4 py-2.5 ${
          idx % 2 === 0
            ? 'bg-gray-50 dark:bg-gray-800/50'
            : 'bg-white dark:bg-gray-900/20'
        }`}
      >
        <span className="text-sm text-gray-400 dark:text-gray-500 font-mono break-words">
          {key}
        </span>
        <span className="text-sm text-gray-600 dark:text-gray-400 break-words">
          {val === null || val === undefined || val === '' ? '—' : String(val)}
        </span>
      </div>
    ))}
  </SectionCard>
);

export default SubmissionDataViewer;
