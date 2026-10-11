export enum QAStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL', // Passes HFC checks, waiting for approval in Kobo
  FLAGGED = 'FLAGGED', // Has HFC issues that need to be fixed
  APPROVED = 'APPROVED', // Approved in KoboToolbox
  REJECTED = 'REJECTED', // Rejected/Not Approved in KoboToolbox
}

export interface QualityIssue {
  check: string;
  field: string;
  value: any;
  message: string;
  metadata?: {
    method?: string;
    threshold?: number;
    bounds?: {
      lower_bound?: number;
      upper_bound?: number;
      note?: string;
    };
    statistics?: {
      mean?: number;
      median?: number;
      count?: number;
    };
    sample_size_warning?: string;
  };
}

export interface Submission {
  _id: number;
  _uuid: string;
  _submission_time: string;
  end: string;
  submission_data: Record<string, any>;
  is_edited: boolean;
  has_edit_history: boolean;
  data_quality_issues: QualityIssue[];
  qa_status: QAStatus;
  kobo_validation_status?: string | null; // Kobo's validation status (Approved, Not Approved, On Hold, etc.)
  kobo_edit_url?: string | null; // URL to view/edit this submission in KoboToolbox
  reviewer_notes?: string | null;
  llm_check_status?:
    'pending' | 'running' | 'waiting' | 'success' | 'failed' | 'not_run_allowance' | 'cancelled' | 'skipped' | null;
  llm_job_id?: string | null;
  llm_queued_at?: string | null;
  llm_started_at?: string | null;
  llm_checked_at?: string | null;
  llm_last_error?: string | null;
  /** Its audio transcripts, when the survey transcribes recordings. */
  transcript_summary?: {
    count: number;
    success: number;
    failed: number;
    in_progress: number;
    no_speech: number;
  } | null;
}

// --- Rule Builder Types ---

export interface KoboQuestion {
  type: string;
  name: string;
  'label::English (en)'?: string;
  roster_name: string | null;
  list_name?: string | null;
  /** XLSForm choice_filter: which options of the list a respondent is offered. */
  choice_filter?: string;
  /** XLSForm relevant: when the question (or note) was shown. */
  relevant?: string;
  group_path?: string;
  group_relevant?: string[];
}

export interface KoboChoice {
  list_name: string;
  name: string;
  'label::English (en)'?: string;
}

export interface KoboVariable {
  type: string;
  label: string;
  choiceListName: string | null;
  roster_name: string | null;
}

export interface KoboToolData {
  survey: KoboQuestion[];
  choices: KoboChoice[];
  variableMap: Map<string, KoboVariable>;
  /**
   * Whether the form has an `audit` row. Kept separately because the stored
   * survey rows are filtered and may not include it; undefined means unknown.
   */
  has_audit?: boolean | null;
  /** The label column its labels were read from (utils/koboLabelUtils labelColumnOf). */
  labelColumn?: string;
}

export interface RuleCondition {
  variable: string;
  operator: string;
  value: string;
  valueType: 'static' | 'variable';
}

export type RulePart = RuleCondition | { joiner: '&' | '|' };

export interface StagedRule {
  id: string; // UUID
  description: string;
  issue_message: string;
  conditions: RulePart[];
  roster_name: string | null;
}

// --- Progress Tracker Types ---

// How a survey expresses its collection targets. `none` is a supported choice,
// not a misconfiguration: plenty of surveys never set a target.
export type SamplingMode = 'none' | 'total' | 'by_variable' | 'uploaded';

// `target` and `progress` are null when the survey sets no target -- null, not
// 0. The two are not the same, and collapsing them is what made an untargeted
// survey report 100% complete.
/** Submissions counted, by where they stand in review: the Submissions tabs' own words. */
export interface ReviewSplit {
  approved: number;
  clean: number;
  on_hold: number;
  needs_review: number;
}

/** The survey against its sampling plan. With targets, the review split is of `toward_target`; without, of `conducted`. */
export interface OverallProgress extends ReviewSplit {
  conducted: number;
  target: number | null;
  /** Done toward the targets as the sampling plan counts them: each group up to its target. Null without targets. */
  toward_target: number | null;
  /** Counted, but beyond their group's target. */
  over_target: number;
  /** Counted, but in a group with no target. */
  no_target: number;
  /** Percent of the target done toward it. */
  progress: number | null;
  days_active: number;
  submissions_per_day: number | null;
  /** Of the last 7 days' submissions, how many counted toward the targets (all, without targets). */
  last_7_days: number;
}

/** What a breakdown row carries besides its progress. */
interface ProgressCounts extends ReviewSplit {
  /** Of those counted, how many were sent in the 7 days to today. */
  last_7_days: number;
  /** Not approved, so left out of `conducted`. */
  not_approved: number;
}

export interface ProgressByColumn extends ProgressCounts {
  value: string;
  conducted: number;
  target: number | null;
  progress: number | null;
  share: number | null; // Percent of all submissions, when there is no target to compare against
}

export interface DetailedProgress extends ProgressCounts {
  values: Record<string, string>; // Map of column name to value
  target: number | null;
  conducted: number;
  progress: number | null;
}

export interface ProgressData {
  mode: SamplingMode;
  overall: OverallProgress;
  byColumn: Record<string, ProgressByColumn[]>; // Key is column name, value is list of progress by column value
  detailed: DetailedProgress[];
  samplingColumns: string[];
  /** Submissions marked Not approved: never counted toward the target. */
  not_approved: number;
  /** Submissions counted by the day they were sent, and how many of them counted toward the targets. */
  daily: { day: string; counted: number; toward: number }[];
  /** The survey's planned last day of collection (YYYY-MM-DD), if it sets one. */
  planned_end: string | null;
  /** The day the last 7 days end on (YYYY-MM-DD), as the server counts them. */
  today: string;
}

/**
 * The named counts and measurements of a set of submissions
 * (backend/services/metrics.py; the words for them are in utils/glossary.ts).
 * submissions = needs_review + on_hold + clean + approved + not_approved.
 */
/** One day of collection. */
export interface DayPoint {
  day: string;
  submissions: number;
  flagged: number;
  issues: number;
}

export interface SubmissionSummary {
  submissions: number;
  flagged: number;
  issues: number;
  needs_review: number;
  on_hold: number;
  clean: number;
  reviewed: number;
  approved: number;
  not_approved: number;
  /** Null with no submissions. */
  issues_per_submission: number | null;
  /** Median minutes: audit active time, else start to end. Null when none could be measured. */
  duration_minutes: number | null;
  duration_measured: number;
  /** Of the measured durations, how many came from start and end: no audit log. */
  duration_from_start_end: number;
  /** Percent. Null when nothing could be measured. */
  dk_rate: number | null;
  /** Submissions flagged by each check, by its issue key. */
  checks: Record<string, number>;
  first_submission: string | null;
  last_submission: string | null;
  /** By the day collected, oldest first. */
  daily: DayPoint[];
}

export interface EnumeratorSummary extends SubmissionSummary {
  id: string;
  /** Each measured interview's minutes. */
  durations: number[];
}

export interface UnavailableCapability {
  capability: string;
  reason: string;
  missing_setting: string;
}

export interface PerformanceData extends ChecksInUse {
  /** The whole team: every submission, so the figures match Data quality's. Null when unavailable. */
  team: SubmissionSummary | null;
  enumerators: EnumeratorSummary[];
  // Present when a required survey setting is missing, so the view can
  // explain itself instead of rendering an empty chart.
  unavailable?: UnavailableCapability[];
  /**
   * Submissions with no enumerator recorded: in the team's figures, never an
   * enumerator of their own. Null when every submission has one.
   */
  no_enumerator: SubmissionSummary | null;
}

// --- Filtering Types ---

export interface SamplingFilter {
  variable: string;
  values: string[];
}

/** The Submissions page's tabs (backend services/review_queue.py). */
export type ReviewTab = 'needs_review' | 'on_hold' | 'reviewed' | 'all';

export type QueueSort = 'issues' | 'newest' | 'oldest' | 'enumerator';

export interface FilterState {
  /** The review tab. Unset: Needs review when anything needs it, otherwise All. */
  review?: ReviewTab;
  /** Only submissions with one of these checks. */
  issues?: string[];
  enumerators?: string[];
  samplingFilters?: SamplingFilter[];
  /** Searched in the submission ID and every answer. */
  search?: string;
  /** Unset: most issues first in Needs review and On hold, newest first otherwise. */
  sort?: QueueSort;
  // Context filters. Links from elsewhere set them, and the queue shows them
  // as a banner saying what is shown, rather than in the filter menu.
  /** Kobo validation statuses: Approved, Not Approved, On Hold, Not Reviewed. */
  validationStatuses?: string[];
  /** AI review state. */
  aiReview?: 'failed' | 'in_progress' | 'not_run';
  /** Audio transcript state. */
  transcript?: 'any' | 'failed' | 'no_speech' | 'in_progress';
}

export interface FacetCount {
  value: string;
  count: number;
}

/** The counts behind the Submissions tabs and filter menu; each leaves out its own filter. */
export interface SubmissionFacets {
  review: ReviewTab;
  tabs: Record<ReviewTab, number>;
  issues: FacetCount[];
  enumerators: FacetCount[];
  sampling: Array<{ variable: string; values: FacetCount[] }>;
  /** Clean submissions with no decision: ready to approve together, or still being checked. */
  clean: { ready: number; waiting: number };
}

// --- Quality Overview Types ---

/** One question on Data quality's By question view (backend services/questions.py). */
export interface QuestionRow {
  name: string;
  path: string;
  label: string;
  /** Its groups' labels, outermost first, joined by ›. */
  group: string;
  type: string;
  /** When it is asked, its groups' conditions included; null when asked of everyone. */
  condition: string | null;
  /** Submissions it was shown in. */
  asked: number;
  /** The condition could not be worked out, so `asked` is how many answered. */
  asked_from_answers: boolean;
  answered: number;
  dk_allowed: boolean;
  dk: number;
  dk_enumerators: number;
  answer_enumerators: number;
  /** Answers choosing Other; null when the question has no Other. */
  other: number | null;
  /** The choice question whose "Other" this one asks to specify. */
  specifies: string | null;
  /** A number question the outlier check is on for: its outliers are among the flags. */
  outlier_check: boolean;
  /** Submissions with a finding on this question, and by check. */
  flagged: number;
  flagged_by: Record<string, number>;
  /** Submissions where it was edited in Kobo. */
  corrected: number;
  form_findings: { check_id: string; message: string }[];
  attention: QuestionAttention[];
  dk_by_enumerator: { id: string; dk: number; answers: number }[];
  numbers: { median: number } | null;
  /** A number question's answers in equal bins from `start`, with those the outlier check flagged in each; the far-out ones counted apart. */
  histogram: {
    start: number;
    width: number;
    counts: number[];
    outliers: number[];
    below: number;
    above: number;
  } | null;
  /** Every option of a choice question, in the form's order; the don't-know and "Other" ones marked. */
  choices: { name: string; label: string; count: number; kind: 'dk' | 'other' | null }[];
  /** How evenly a single-choice question's answers spread over its options, 0 to 1. */
  variety: number | null;
  /** Submissions flagged on it, and those it was asked in, each of the 14 days to `last_day`. */
  flagged_days: number[];
  asked_days: number[];
  corrections: { submission_id: number; old: unknown; new: unknown }[];
  /** Its place in the form. */
  order: number;
  /** Time on it, from the audit logs; null without any. */
  time: QuestionTime | null;
}

/** Time on a question, from the submissions' audit logs. */
export interface QuestionTime {
  /** Answers with a time. */
  timed: number;
  median_seconds: number;
  /** Answered in under `rushed_under` seconds: a third of its median, 2 s at least. */
  rushed: number;
  rushed_under: number;
  /** Its seconds per word over the form's usual: 2 is twice as slow. Null on a shared screen or too few answers. */
  pace: number | null;
  /** Other questions on its screen (a field-list group): the times are the screen's. */
  screen_with: number;
  /** Answers by time in bins of `bin_width` seconds from 0, the last one and beyond; of those, rushed. */
  bin_width: number;
  bins: number[];
  rushed_bins: number[];
}

export type QuestionAttention =
  'never_shown' | 'rarely_asked' | 'many_dk' | 'often_other' | 'often_flagged' | 'often_corrected' | 'rushed' | 'slow';

export interface QuestionsResponse {
  submissions: number;
  questions: QuestionRow[];
  /** Everything Form check found in the form. */
  form_findings: number;
  /** The day the 14 days end on. */
  last_day: string;
  form_missing: boolean;
  logic_missing: boolean;
  /** Submissions with seconds per question, from an audit log. */
  timed_submissions: number;
  /** The form's usual seconds per word of a question. */
  form_pace: number | null;
}

/** The enumerator a check flagged most often. */
export interface TopEnumerator {
  id: string;
  /** Their submissions the check flagged. */
  flagged: number;
  /** All their submissions. */
  submissions: number;
}

/** One check on Data quality's By check view. */
export interface CheckRow {
  /** The issue it writes, or the built-in check's key when it flagged nothing. */
  check: string;
  /** A built-in check's setting; null for the survey's own rules. */
  on: boolean | null;
  /** Submissions it flagged. */
  flagged: number;
  issues: number;
  /** Of those flagged, still in Needs review. */
  needs_review: number;
  /** Submissions it flagged each day, the 14 days up to the last submission; empty when off. Out of QualityOverviewResponse.last_14_days. */
  last_14_days: number[];
  top_enumerator: TopEnumerator | null;
}

/** Which checks are on: the built-in ones by key (backend survey_config.built_in_checks), and the survey's own. */
export interface ChecksInUse {
  checks_on: string[];
  checks_off: string[];
  /** The survey's own rules that are active. */
  custom_checks: number;
}

export interface QualityOverviewResponse extends ChecksInUse {
  summary: SubmissionSummary;
  /** When the oldest submission still in Needs review was sent. */
  oldest_needs_review: string | null;
  /** Checks that flagged something, most first; then built-in checks on, then off. */
  by_check: CheckRow[];
  /** Submissions each day, the 14 days up to the last: what each check's days are a share of. */
  last_14_days: number[];
  date_range: { start: string; end: string };
}

export interface QualityOverviewFilters {
  startDate?: string;
  endDate?: string;
  enumerator?: string;
  samplingFilters?: string;
}
