import React, { useMemo, useState } from 'react';
import { KoboQuestion, QualityIssue } from '../types';
import { SurveyConfig } from '../services/progressApi';
import { AudioAnswer } from '../services/transcriptionApi';
import { SubmissionTranslations, Translation } from '../services/translationApi';
import { getChoices, getQuestionLabel, formatValueForDisplay } from '../utils/koboLabelUtils';
import { Finding, answerAnchor } from '../utils/findings';
import { Player, RecordingDetails, RecordingStatus } from './transcription/AudioAnswers';
import { TranslationBlock } from './translation/TranslationBlock';

/** The submission's recorded answers, shown in place of their file names. */
interface Recordings {
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
  /** The submission's translations, shown under the answers they translate. */
  translations?: SubmissionTranslations | null;
  /** The submission's findings; each shows under the answer it is about. */
  findings?: Finding[];
}

const questionPath = (question: KoboQuestion) =>
  question.group_path ? `${question.group_path.replace(/^\/+|\/+$/g, '')}/${question.name}` : question.name;

// The recorded answer to a question: matched on its group path ("voice/story"),
// then on its name.
const findRecording = (recordings: Recordings | null | undefined, question: KoboQuestion): AudioAnswer | undefined => {
  if (!recordings) return undefined;
  const path = questionPath(question);
  return (
    recordings.answers.find((answer) => answer.question_path === path) ??
    recordings.answers.find((answer) => answer.question_path.split('/').pop() === question.name)
  );
};

// An answer's translation: matched on its path, then on its name.
const findTranslation = (
  translations: SubmissionTranslations | null | undefined,
  question: KoboQuestion | { name: string; group_path?: string }
): Translation | undefined => {
  if (!translations) return undefined;
  const path = questionPath(question as KoboQuestion);
  return (
    translations.answers[path] ??
    Object.entries(translations.answers).find(([key]) => key.split('/').pop() === question.name)?.[1]
  );
};

// Humanize a snake_case or camelCase string into title case
const humanize = (str: string): string =>
  str
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());

// Form rows Kobo fills in itself, or that hold no answer.
const NOT_ANSWERS = new Set([
  'start',
  'end',
  'today',
  'audit',
  'deviceid',
  'subscriberid',
  'simserial',
  'phonenumber',
  'username',
  'note',
]);

// The group a question sits in, by its innermost group's name: "household/income" reads "Income".
const groupTitle = (question: KoboQuestion): string | null => {
  const last = (question.group_path ?? '').split('/').filter(Boolean).pop();
  return last ? humanize(last) : null;
};

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
const displayValue = (value: any, fieldName: string, surveyConfig: SurveyConfig | null): string => {
  if (value === null || value === undefined || value === '') return '—';
  return formatValueForDisplay(value, fieldName, surveyConfig);
};

/** The findings about an answer, as short lines under it. */
const InlineFindings: React.FC<{ findings: Finding[] }> = ({ findings }) =>
  findings.length === 0 ? null : (
    <ul className="col-span-2 space-y-0.5">
      {findings.map((finding) => (
        <li key={finding.key} className="flex gap-2 text-xs leading-snug text-amber-800 dark:text-amber-300">
          <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
          <span>
            <span className="font-medium">
              {finding.source === 'AI review' ? `AI review: ${finding.title}` : finding.title}
            </span>
            {/* The card above has the rest; here the value against what was expected is enough. */}
            {finding.detail && finding.source === 'Outlier' && <span>. {finding.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );

// A choice list longer than this shows the chosen options until asked for the rest.
const OPTIONS_SHOWN = 6;

const OptionMark: React.FC<{ chosen: boolean; multiple: boolean }> = ({ chosen, multiple }) =>
  multiple ? (
    <span
      className={`mt-[3px] flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-[4px] border ${
        chosen ? 'border-gray-900 bg-gray-900 dark:border-white dark:bg-white' : 'border-gray-300 dark:border-gray-600'
      }`}
      aria-hidden="true"
    >
      {chosen && (
        <svg
          className="h-2.5 w-2.5 text-white dark:text-gray-900"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={4}
        >
          <path d="M5 12l5 5 9-10" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  ) : (
    <span
      className={`mt-[3px] flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full border ${
        chosen ? 'border-gray-900 dark:border-white' : 'border-gray-300 dark:border-gray-600'
      }`}
      aria-hidden="true"
    >
      {chosen && <span className="h-1.5 w-1.5 rounded-full bg-gray-900 dark:bg-white" />}
    </span>
  );

/**
 * A select question's answer: every option of its list, the chosen ones
 * marked, so a reviewer sees what else the respondent could have said. A long
 * list shows the chosen options and folds the rest behind "Show all".
 */
const ChoiceAnswer: React.FC<{
  options: Array<{ name: string; label: string }>;
  chosen: string[];
  multiple: boolean;
}> = ({ options, chosen, multiple }) => {
  const [open, setOpen] = useState(false);
  // An answer outside the list (an old form version, say) is still shown.
  const all = [
    ...options,
    ...chosen.filter((value) => !options.some((o) => o.name === value)).map((value) => ({ name: value, label: value })),
  ];
  const long = all.length > OPTIONS_SHOWN;
  const shown = long && !open ? all.filter((o) => chosen.includes(o.name)) : all;
  return (
    <div className="min-w-0">
      <ul
        className="space-y-1"
        aria-label={multiple ? 'Options, chosen ones ticked' : 'Options, the chosen one marked'}
      >
        {shown.map((option) => {
          const isChosen = chosen.includes(option.name);
          return (
            <li key={option.name} className="relative flex items-start gap-2 text-sm leading-snug">
              <OptionMark chosen={isChosen} multiple={multiple} />
              <span
                className={
                  isChosen ? 'font-medium text-gray-900 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500'
                }
              >
                {option.label}
                {isChosen && <span className="sr-only"> (chosen)</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="mt-1 text-xs text-indigo-700 hover:underline dark:text-indigo-300"
        >
          {open ? 'Show chosen only' : `Show all ${all.length} options`}
        </button>
      )}
    </div>
  );
};

const rowClass = (flagged: boolean) =>
  `grid grid-cols-2 gap-x-4 gap-y-1.5 px-4 py-2.5 scroll-mt-24 transition-shadow ${
    flagged ? 'bg-amber-50/70 dark:bg-amber-500/[0.07]' : ''
  }`;

interface QuestionRowProps {
  question: KoboQuestion;
  value: any;
  surveyConfig: SurveyConfig | null;
  translation?: Translation;
  findings?: Finding[];
  anchor?: boolean;
}

const QuestionRow: React.FC<QuestionRowProps> = ({
  question,
  value,
  surveyConfig,
  translation,
  findings = [],
  anchor,
}) => {
  const label = getQuestionLabel(question.name, surveyConfig);
  const formatted = displayValue(value, question.name, surveyConfig);
  const isEmpty = value === null || value === undefined || value === '';
  const multiple = question.type === 'select_multiple';
  const options =
    !isEmpty && (multiple || question.type === 'select_one') ? getChoices(question.list_name, surveyConfig) : [];

  return (
    <div id={anchor ? answerAnchor(question.name) : undefined} className={rowClass(findings.length > 0)}>
      <span className="text-sm text-gray-500 dark:text-gray-400 break-words leading-snug">{label}</span>
      {options.length > 0 ? (
        <ChoiceAnswer
          options={options}
          chosen={multiple ? String(value).split(' ').filter(Boolean) : [String(value)]}
          multiple={multiple}
        />
      ) : (
        <span
          className={`text-sm font-medium break-words leading-snug ${
            isEmpty ? 'text-gray-300 dark:text-gray-600' : 'text-gray-900 dark:text-gray-100'
          }`}
        >
          {formatted}
        </span>
      )}
      {translation && !isEmpty && (
        <div className="col-span-2 empty:hidden">
          <TranslationBlock translation={translation} />
        </div>
      )}
      <InlineFindings findings={findings} />
    </div>
  );
};

interface RecordingRowProps {
  label: string;
  name: string;
  answer: AudioAnswer;
  recordings: Recordings;
  translation?: Translation;
  translationsToKobo?: boolean;
  findings?: Finding[];
}

// An audio question: the player in place of the file name, and its
// transcript across the full width underneath. Its own findings (no speech,
// another language) show with the transcript; others as lines below.
const RecordingRow: React.FC<RecordingRowProps> = ({
  label,
  name,
  answer,
  recordings,
  translation,
  translationsToKobo,
  findings = [],
}) => (
  <div id={answerAnchor(name)} className={rowClass(findings.length > 0)}>
    <span className="flex items-start gap-1.5 text-sm text-gray-500 dark:text-gray-400 break-words leading-snug">
      <svg
        className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-indigo-500 dark:text-indigo-400"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
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
      <RecordingDetails
        answer={answer}
        sendToKobo={recordings.sendToKobo}
        issues={recordings.issues}
        translation={translation}
        translationsToKobo={translationsToKobo}
      />
    </div>
    <InlineFindings findings={findings.filter((f) => f.source !== 'Audio')} />
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
    <div className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden bg-white dark:bg-gray-900">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/70 transition-colors text-left"
      >
        <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{title}</span>
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
      {open && (
        <div className="divide-y divide-gray-100 border-t border-gray-100 dark:divide-gray-800 dark:border-gray-800">
          {children}
        </div>
      )}
    </div>
  );
};

interface RosterSectionProps {
  rosterName: string;
  questions: KoboQuestion[];
  rosterItems: Record<string, any>[];
  surveyConfig: SurveyConfig | null;
}

const RosterSection: React.FC<RosterSectionProps> = ({ rosterName, questions, rosterItems, surveyConfig }) => {
  return (
    <SectionCard title={humanize(rosterName)}>
      {rosterItems.length === 0 ? (
        <div className="px-4 py-3 text-sm text-gray-400 dark:text-gray-500 italic">No entries recorded</div>
      ) : (
        rosterItems.map((item, itemIdx) => (
          <div key={itemIdx} className="divide-y divide-gray-50 dark:divide-gray-800/60">
            {rosterItems.length > 1 && (
              <div className="px-4 py-1.5 bg-gray-50 dark:bg-gray-800/50 text-xs font-medium text-gray-500 dark:text-gray-400">
                Item {itemIdx + 1}
              </div>
            )}
            {questions.map((q) => {
              const value = item[q.name] ?? lookupValue(item, q.name);
              return <QuestionRow key={q.name} question={q} value={value} surveyConfig={surveyConfig} />;
            })}
          </div>
        ))
      )}
    </SectionCard>
  );
};

/** The findings about each question, by question name. */
const byQuestion = (findings: Finding[]): Map<string, Finding[]> => {
  const map = new Map<string, Finding[]>();
  for (const finding of findings) {
    if (!finding.question) continue;
    map.set(finding.question, [...(map.get(finding.question) ?? []), finding]);
  }
  return map;
};

const SubmissionDataViewer: React.FC<SubmissionDataViewerProps> = ({
  data,
  surveyConfig,
  recordings,
  translations,
  findings = [],
}) => {
  const survey: KoboQuestion[] = surveyConfig?.config_data.kobo_tool?.survey ?? [];
  const findingsFor = useMemo(() => byQuestion(findings), [findings]);
  const [flaggedChosen, setOnlyFlagged] = useState(false);

  // Separate top-level and roster questions; the header already says when
  // the interview was, and notes hold no answer.
  const topLevelQuestions = survey.filter((q) => !q.roster_name && !NOT_ANSWERS.has(q.type));
  const rosterNames: string[] = Array.from(
    new Set(survey.filter((q) => q.roster_name).map((q) => q.roster_name as string))
  );
  const flaggedQuestions = topLevelQuestions.filter((q) => findingsFor.has(q.name));
  // The choice outlives the submission; one with no flagged answers shows them all.
  const onlyFlagged = flaggedChosen && flaggedQuestions.length > 0;
  const shownQuestions = onlyFlagged ? flaggedQuestions : topLevelQuestions;

  // Metadata keys (start with '_')
  const metadataEntries = Object.entries(data).filter(([k]) => k.startsWith('_'));

  // Fallback: if no survey config, render raw key/value pairs
  if (!surveyConfig || survey.length === 0) {
    const nonMeta = Object.entries(data).filter(([k]) => !k.startsWith('_'));
    return (
      <div className="space-y-4">
        {nonMeta.length > 0 && (
          <SectionCard title="Answers">
            {nonMeta.map(([key, val]) => {
              const question = { name: key, type: 'text', roster_name: null };
              const recording = findRecording(recordings, question);
              const translation = findTranslation(translations, question);
              return recording && recordings ? (
                <RecordingRow
                  key={key}
                  label={key}
                  name={key}
                  answer={recording}
                  recordings={recordings}
                  translation={translation}
                  translationsToKobo={translations?.send_to_kobo}
                  findings={findingsFor.get(key)}
                />
              ) : (
                <QuestionRow
                  key={key}
                  question={question}
                  value={val}
                  surveyConfig={null}
                  translation={translation}
                  findings={findingsFor.get(key)}
                  anchor
                />
              );
            })}
          </SectionCard>
        )}
        {metadataEntries.length > 0 && <MetadataSection entries={metadataEntries} />}
      </div>
    );
  }

  let lastGroup: string | null = null;
  return (
    <div className="space-y-4">
      {topLevelQuestions.length > 0 && (
        <section
          aria-label="Answers"
          className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5 dark:border-gray-800">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Answers</h3>
            {flaggedQuestions.length > 0 && (
              <div
                className="inline-flex overflow-hidden rounded-lg border border-gray-200 text-xs dark:border-gray-700"
                role="group"
                aria-label="Which answers to show"
              >
                {[
                  { flagged: true, label: `With issues ${flaggedQuestions.length}` },
                  { flagged: false, label: `All ${topLevelQuestions.length}` },
                ].map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    aria-pressed={onlyFlagged === option.flagged}
                    onClick={() => setOnlyFlagged(option.flagged)}
                    className={`px-2.5 py-1 ${
                      onlyFlagged === option.flagged
                        ? 'bg-gray-100 font-medium text-gray-900 dark:bg-gray-800 dark:text-white'
                        : 'text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800/60'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="divide-y divide-gray-50 dark:divide-gray-800/60">
            {shownQuestions.map((q) => {
              const group = groupTitle(q);
              const heading =
                group && group !== lastGroup ? (
                  <h4 className="bg-white px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:bg-gray-900 dark:text-gray-500">
                    {group}
                  </h4>
                ) : null;
              lastGroup = group;
              const recording = q.type === 'audio' ? findRecording(recordings, q) : undefined;
              const row =
                recording && recordings ? (
                  <RecordingRow
                    label={getQuestionLabel(q.name, surveyConfig)}
                    name={q.name}
                    answer={recording}
                    recordings={recordings}
                    translation={findTranslation(translations, q)}
                    translationsToKobo={translations?.send_to_kobo}
                    findings={findingsFor.get(q.name)}
                  />
                ) : (
                  <QuestionRow
                    question={q}
                    value={lookupValue(data, q.name)}
                    surveyConfig={surveyConfig}
                    translation={q.type === 'text' ? findTranslation(translations, q) : undefined}
                    findings={findingsFor.get(q.name)}
                    anchor
                  />
                );
              return (
                <React.Fragment key={q.name}>
                  {heading}
                  {row}
                </React.Fragment>
              );
            })}
          </div>
        </section>
      )}

      {/* Roster / repeat group sections */}
      {!onlyFlagged &&
        rosterNames.map((rosterName) => {
          const rosterQuestions = survey.filter((q) => q.roster_name === rosterName);
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
      {!onlyFlagged && metadataEntries.length > 0 && <MetadataSection entries={metadataEntries} />}
    </div>
  );
};

// Collapsible metadata section for Kobo system fields (_uuid, etc.)
interface MetadataSectionProps {
  entries: [string, any][];
}

const MetadataSection: React.FC<MetadataSectionProps> = ({ entries }) => (
  <SectionCard title="Kobo metadata" defaultOpen={false}>
    {entries.map(([key, val]) => (
      <div key={key} className="grid grid-cols-2 gap-4 px-4 py-2.5">
        <span className="text-sm text-gray-400 dark:text-gray-500 font-mono break-words">{key}</span>
        <span className="text-sm text-gray-600 dark:text-gray-400 break-words">
          {val === null || val === undefined || val === '' ? '—' : String(val)}
        </span>
      </div>
    ))}
  </SectionCard>
);

export default SubmissionDataViewer;
