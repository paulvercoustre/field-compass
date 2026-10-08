import { QualityIssue } from '../types';
import { SurveyConfig, ValidationRule } from '../services/progressApi';
import { aiFindingName, issueName } from './issueNames';
import { formatValueForDisplay, getQuestionLabel } from './koboLabelUtils';
import { findAnswer } from './answers';

/**
 * A submission's findings, each written the same way for the reviewer: what
 * is wrong, the value against what was expected, and where it came from. The
 * review card lists them; the answers show each under the answer it is about.
 */

export type FindingSource = 'Check' | 'Outlier' | 'Custom check' | 'AI review' | 'Audio' | 'Targets';

export interface Finding {
  key: string;
  check: string;
  title: string;
  detail?: string;
  /** An open-text answer, quoted with its question. */
  quote?: { question: string; answer: string };
  /** Where an outlier sits against the expected range. */
  range?: { lower: number; upper: number; value: number };
  /** Outlier statistics, in a line. */
  stats?: string;
  warning?: string;
  source: FindingSource;
  /** The question the finding is about, by name; none for findings about the whole interview. */
  question?: string;
}

interface Context {
  config: SurveyConfig | null;
  data: Record<string, unknown>;
  rules: ValidationRule[];
}

// Checks Field Compass runs itself, by what they are about.
const INTERVIEW_CHECKS = new Set([
  'missing_uuid',
  'missing_enumerator',
  'date_out_of_range',
  'interview_on_weekend',
  'interview_out_of_office_hours',
  'duration_too_short',
  'duration_too_long',
  'dk_percentage_high',
  'empty_percentage_high',
]);
const TARGET_CHECKS = new Set(['sampling_frame_mismatch', 'strata_value_not_in_form']);

export const isAiReviewIssue = (issue: { check: string; metadata?: unknown }): boolean =>
  issue.check.startsWith('qual_') ||
  (issue.metadata as Record<string, unknown> | undefined)?.source === 'llm_qualitative_v1';

/** A question name from a field that may carry its group path ("household/income"). */
const questionName = (field: string | null | undefined): string | undefined => {
  if (!field || field === 'submission' || field === 'unknown') return undefined;
  return field.split('/').filter(Boolean).pop();
};

const sourceOf = (issue: QualityIssue): FindingSource => {
  if (issue.check.startsWith('outlier_')) return 'Outlier';
  if (isAiReviewIssue(issue)) return 'AI review';
  if (issue.check.startsWith('audio_')) return 'Audio';
  if (TARGET_CHECKS.has(issue.check)) return 'Targets';
  if (INTERVIEW_CHECKS.has(issue.check)) return 'Check';
  return 'Custom check';
};

const number = (value: number): string =>
  value.toLocaleString(undefined, { maximumFractionDigits: Math.abs(value) < 10 ? 1 : 0 });

const percent = (value: number): string => `${number(value)} %`;

const minutes = (value: number): string => `${Math.round(value)} min`;

const asNumber = (value: unknown): number | undefined => {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : undefined;
};

const metadataOf = (issue: QualityIssue): Record<string, any> => (issue.metadata ?? {}) as Record<string, any>;

const label = (name: string | undefined, config: SurveyConfig | null): string =>
  name ? getQuestionLabel(name, config) : '';

function describeCheck(issue: QualityIssue, ctx: Context): Pick<Finding, 'title' | 'detail'> {
  const params = ctx.config?.config_data?.global_parameters ?? {};
  const meta = metadataOf(issue);
  const title = issueName(issue.check);
  switch (issue.check) {
    case 'duration_too_short':
    case 'duration_too_long': {
      const value = asNumber(issue.value);
      const active = issue.field === 'active_interview_time';
      const limit =
        issue.check === 'duration_too_short' ? params.min_survey_duration_minutes : params.max_survey_duration_minutes;
      const kind = issue.check === 'duration_too_short' ? 'minimum' : 'maximum';
      if (value === undefined) return { title, detail: issue.message };
      return {
        title,
        detail: `${minutes(value)}${active ? ' of active time' : ''}.${limit != null ? ` Your ${kind} is ${limit} min.` : ''}`,
      };
    }
    case 'dk_percentage_high':
      if (meta.dk_count == null || meta.dk_eligible_count == null) return { title, detail: issue.message };
      return {
        title,
        detail: `${meta.dk_count} of ${meta.dk_eligible_count} answers (${percent(meta.dk_percentage ?? 0)}). Your limit is ${meta.threshold} %.`,
      };
    case 'empty_percentage_high':
      if (meta.empty_count == null || meta.shown_count == null) return { title, detail: issue.message };
      return {
        title,
        detail: `${meta.empty_count} of ${meta.shown_count} questions shown were left empty (${percent(meta.empty_percentage ?? 0)}). Your limit is ${meta.threshold} %.`,
      };
    case 'interview_on_weekend': {
      const day = issue.message?.split(': ').pop();
      return { title, detail: day ? `Interviewed on a ${day}.` : issue.message };
    }
    case 'interview_out_of_office_hours': {
      const match = /\(([^)]+)\):\s*(.+)$/.exec(issue.message ?? '');
      if (!match) return { title, detail: issue.message };
      const started = new Date(match[2]);
      const time = Number.isNaN(started.getTime())
        ? match[2]
        : started.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      return { title, detail: `Started at ${time}. Office hours are ${match[1].replace(' - ', '–')}.` };
    }
    case 'missing_enumerator':
      return { title, detail: 'No enumerator ID was recorded.' };
    case 'missing_uuid':
      return { title, detail: 'No submission ID was recorded.' };
    case 'sampling_frame_mismatch': {
      const combination = issue.message?.split(': ').slice(1).join(': ');
      return { title, detail: combination ? `${combination} has no target in your targets file.` : issue.message };
    }
    default:
      return { title, detail: issue.message };
  }
}

function describeOutlier(issue: QualityIssue, ctx: Context): Partial<Finding> {
  const variable = issue.check.replace(/^outlier_/, '');
  const meta = metadataOf(issue);
  const value = asNumber(issue.value ?? findAnswer(ctx.data, variable));
  const lower = asNumber(meta.bounds?.lower_bound);
  const upper = asNumber(meta.bounds?.upper_bound);
  const name = label(variable, ctx.config);
  const stats = meta.statistics
    ? [
        meta.statistics.mean != null && `Mean ${number(meta.statistics.mean)}`,
        meta.statistics.median != null && `median ${number(meta.statistics.median)}`,
        meta.statistics.count != null && `${meta.statistics.count} answers`,
        meta.method && `${String(meta.method).toUpperCase()} method`,
      ]
        .filter(Boolean)
        .join(' · ')
    : undefined;
  if (value === undefined || lower === undefined || upper === undefined || meta.bounds?.note) {
    return { title: `${name} looks unusual`, detail: issue.message, stats, warning: meta.sample_size_warning };
  }
  const above = value > upper;
  return {
    title: `${name} is far ${above ? 'above' : 'below'} the rest`,
    detail: `${number(value)}. Most answers fall between ${number(lower)} and ${number(upper)}.`,
    range: { lower, upper, value },
    stats,
    warning: meta.sample_size_warning,
    question: variable,
  };
}

function describeCustom(issue: QualityIssue, ctx: Context): Partial<Finding> {
  const rule = ctx.rules.find((r) => (r.rule_data.check_id || r.rule_name) === issue.check);
  const message = issue.message || rule?.rule_data.issue;
  const title = rule?.rule_name || message || issueName(issue.check);
  const values = (rule?.rule_data.variables_involved ?? [])
    .map((variable) => {
      const answer = findAnswer(ctx.data, variable);
      const shown =
        answer === undefined || answer === null || answer === ''
          ? '—'
          : formatValueForDisplay(answer, variable, ctx.config);
      const name = label(variable, ctx.config);
      return /[?:]$/.test(name) ? `${name} ${shown}` : `${name}: ${shown}`;
    })
    .join(' · ');
  const detail = [message && message !== title ? message : undefined, values || undefined].filter(Boolean).join(' ');
  return { title, detail: detail || undefined };
}

/** One finding per issue, in the order the checks reported them. */
export function describeFindings(issues: QualityIssue[], ctx: Context): Finding[] {
  return issues.map((issue, index) => {
    const source = sourceOf(issue);
    const base = { key: `${issue.check}-${index}`, check: issue.check, source, question: questionName(issue.field) };
    switch (source) {
      case 'Outlier':
        return { ...base, title: issue.check, ...describeOutlier(issue, ctx) } as Finding;
      case 'AI review': {
        const reasoning = metadataOf(issue).llm_reasoning || issue.message;
        const answer = issue.value ?? findAnswer(ctx.data, base.question ?? '');
        return {
          ...base,
          title: aiFindingName(issue.check),
          detail: reasoning,
          quote:
            answer !== undefined && answer !== null
              ? { question: label(base.question, ctx.config), answer: String(answer) }
              : undefined,
        };
      }
      case 'Audio':
        return { ...base, title: issueName(issue.check), detail: issue.message };
      case 'Custom check':
        return { ...base, title: issue.check, ...describeCustom(issue, ctx) } as Finding;
      default:
        return {
          ...base,
          // Findings about the whole interview have no answer to point at.
          question: source === 'Targets' ? base.question : undefined,
          ...describeCheck(issue, ctx),
        };
    }
  });
}

/** The id an answer row carries, so a finding can scroll to it. */
export const answerAnchor = (question: string): string => `answer-${question}`;
