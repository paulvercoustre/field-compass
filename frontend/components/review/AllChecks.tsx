import React from 'react';
import { Submission } from '../../types';
import { SurveyConfig, ValidationRule } from '../../services/progressApi';
import { issueName } from '../../utils/issueNames';
import { questionText } from '../../utils/koboLabelUtils';
import { inferSamplingMode } from '../../utils/samplingMode';
import { describeAiCheck } from '../../utils/aiReviewStatus';
import { isAiReviewIssue } from '../../utils/findings';
import { useNavigation } from '../../contexts/NavigationContext';

type CheckState = 'flagged' | 'passed' | 'not_run' | 'busy';

export interface CheckLine {
  key: string;
  label: string;
  state: CheckState;
  /** Short text on the right: why it didn't run, or how it went. */
  note?: string;
  /** A check that couldn't run, and the settings that would let it. */
  fix?: string;
}

export interface CheckGroup {
  title: string;
  lines: CheckLine[];
}

interface Inputs {
  submission: Submission;
  config: SurveyConfig | null;
  rules: ValidationRule[];
}

/**
 * Every check that applies to a submission, grouped by what it looks at, with
 * whether it flagged, passed, or could not run (and what would let it run).
 */
export function buildCheckList({ submission, config, rules }: Inputs): CheckGroup[] {
  const data = config?.config_data;
  const ids = data?.core_identifiers ?? {};
  const params = data?.global_parameters ?? {};
  const checks = data?.quality_checks ?? {};
  const issues = submission.data_quality_issues;
  const fired = new Set(issues.map((i) => i.check));
  const state = (check: string): CheckState => (fired.has(check) ? 'flagged' : 'passed');
  const line = (check: string, needs?: string | false): CheckLine =>
    needs && !fired.has(check)
      ? { key: check, label: issueName(check), state: 'not_run', note: needs, fix: 'settings' }
      : { key: check, label: issueName(check), state: state(check) };

  const noDate = !ids.date_interview && 'Needs the interview date question';
  const noStart = !ids.start_time && 'Needs the start time question';
  const hasActiveTime = submission.submission_data?.active_interview_time != null;
  const noDuration =
    !hasActiveTime && !(ids.start_time && ids.end_time) && 'Needs an audit log, or the start and end questions';

  const interview: CheckLine[] = [line('missing_uuid')];
  if (ids.enumerator) interview.push(line('missing_enumerator'));
  if (checks.flag_out_of_period && (params.data_collection_start_date || params.data_collection_end_date))
    interview.push(line('date_out_of_range', noDate));
  if (checks.flag_weekend) interview.push(line('interview_on_weekend', noDate));
  if (checks.flag_office_hours) interview.push(line('interview_out_of_office_hours', noStart));
  if (params.min_survey_duration_minutes != null) interview.push(line('duration_too_short', noDuration));
  if (params.max_survey_duration_minutes != null) interview.push(line('duration_too_long', noDuration));

  const answers: CheckLine[] = [];
  if (checks.flag_dk_percentage) answers.push(line('dk_percentage_high'));
  if (checks.flag_empty_percentage) answers.push(line('empty_percentage_high'));
  if (checks.flag_outliers && checks.outlier_variables?.length) {
    const flagged = checks.outlier_variables.filter((v) => fired.has(`outlier_${v}`));
    for (const variable of flagged) {
      answers.push({
        key: `outlier_${variable}`,
        label: `Outlier · ${questionText(variable, config, submission.submission_data)}`,
        state: 'flagged',
      });
    }
    const inRange = checks.outlier_variables.length - flagged.length;
    if (inRange > 0) {
      answers.push({
        key: 'outliers-in-range',
        label: flagged.length ? `Outliers · ${inRange} other questions` : `Outliers · ${inRange} questions`,
        state: 'passed',
        note: 'in range',
      });
    }
  }
  const sampling = data?.sampling_frame;
  if (checks.flag_sampling_frame && sampling?.sampling_cols?.length && inferSamplingMode(sampling) === 'uploaded')
    answers.push(line('sampling_frame_mismatch'));
  if (checks.flag_sampling_frame && inferSamplingMode(sampling) === 'by_variable' && sampling?.variable)
    answers.push(line('strata_value_not_in_form'));

  const custom: CheckLine[] = rules.map((rule) => {
    const check = rule.rule_data.check_id || rule.rule_name;
    return { key: `rule-${rule.rule_id}`, label: rule.rule_name || check, state: state(check) };
  });

  const aiAndAudio: CheckLine[] = [];
  const aiIssues = issues.filter(isAiReviewIssue);
  if (checks.flag_llm_qualitative || aiIssues.length > 0) {
    const status = describeAiCheck(submission.llm_check_status, submission.llm_last_error, aiIssues.length > 0);
    aiAndAudio.push({
      key: 'ai-review',
      label: 'AI review of open answers',
      state:
        aiIssues.length > 0 ? 'flagged' : status.tone === 'busy' ? 'busy' : status.tone === 'ok' ? 'passed' : 'not_run',
      note: aiIssues.length > 0 ? `${aiIssues.length} finding${aiIssues.length === 1 ? '' : 's'}` : status.title,
    });
  }
  const recordings = submission.transcript_summary;
  if (recordings && recordings.count > 0) {
    const audioIssues = issues.filter((i) => i.check.startsWith('audio_'));
    aiAndAudio.push({
      key: 'audio',
      label: `${recordings.count} recording${recordings.count === 1 ? '' : 's'}`,
      state:
        audioIssues.length > 0
          ? 'flagged'
          : recordings.in_progress > 0
            ? 'busy'
            : recordings.failed > 0
              ? 'not_run'
              : 'passed',
      note:
        recordings.in_progress > 0
          ? 'Being transcribed'
          : recordings.failed > 0
            ? `${recordings.failed} couldn't be transcribed`
            : 'Transcribed',
    });
  }

  return [
    { title: 'Interview', lines: interview },
    { title: 'Answers', lines: answers },
    { title: 'Your checks', lines: custom },
    { title: 'AI review and audio', lines: aiAndAudio },
  ].filter((group) => group.lines.length > 0);
}

/** How many lines passed, across the groups. */
export const passedCount = (groups: CheckGroup[]): number =>
  groups.reduce((sum, group) => sum + group.lines.filter((l) => l.state === 'passed').length, 0);

const StateMark: React.FC<{ state: CheckState }> = ({ state }) => {
  if (state === 'flagged')
    return <span className="h-2 w-2 rounded-full bg-amber-500" role="img" aria-label="Flagged" />;
  if (state === 'passed')
    return (
      <svg
        className="h-3.5 w-3.5 text-gray-400"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        role="img"
        aria-label="Passed"
      >
        <path d="M5 12l5 5 9-10" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (state === 'busy')
    return <span className="h-2 w-2 animate-pulse rounded-full bg-sky-500" role="img" aria-label="In progress" />;
  return <span className="h-px w-2.5 bg-gray-400" role="img" aria-label="Not run" />;
};

const AllChecks: React.FC<{ groups: CheckGroup[] }> = ({ groups }) => {
  const { navigate } = useNavigation();
  return (
    <div className="rounded-xl border border-gray-200 bg-white py-2 dark:border-gray-800 dark:bg-gray-900">
      {groups.map((group) => (
        <div key={group.title} className="py-1">
          <h4 className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
            {group.title}
          </h4>
          <ul>
            {group.lines.map((l) => (
              <li
                key={l.key}
                className="grid grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-2.5 px-4 py-1.5 text-sm"
              >
                <span className="flex items-center justify-center">
                  <StateMark state={l.state} />
                </span>
                <span
                  className={
                    l.state === 'flagged'
                      ? 'font-medium text-gray-900 dark:text-white'
                      : 'text-gray-600 dark:text-gray-400'
                  }
                >
                  {l.label}
                </span>
                <span className="text-right text-xs text-gray-500 dark:text-gray-400">
                  {l.fix ? (
                    <button
                      type="button"
                      onClick={() => navigate({ view: 'settings', tab: l.fix })}
                      className="text-indigo-700 hover:text-indigo-900 hover:underline dark:text-indigo-300"
                    >
                      {l.note}
                    </button>
                  ) : (
                    l.note
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
};

export default AllChecks;
