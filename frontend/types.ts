
export enum QAStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL',  // Passes HFC checks, waiting for approval in Kobo
  FLAGGED = 'FLAGGED',  // Has HFC issues that need to be fixed
  APPROVED = 'APPROVED',  // Approved in KoboToolbox
  REJECTED = 'REJECTED',  // Rejected/Not Approved in KoboToolbox
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
  kobo_validation_status?: string | null;  // Kobo's validation status (Approved, Not Approved, On Hold, etc.)
  kobo_edit_url?: string | null;  // URL to view/edit this submission in KoboToolbox
  reviewer_notes?: string | null;
  llm_check_status?: 'pending' | 'running' | 'success' | 'failed' | 'skipped' | null;
  llm_job_id?: string | null;
  llm_queued_at?: string | null;
  llm_started_at?: string | null;
  llm_checked_at?: string | null;
  llm_last_error?: string | null;
}

export interface JsonPatch {
  op: 'add' | 'remove' | 'replace';
  path: string;
  value?: any;
  from?: string;
}

export interface SubmissionHistory {
  history_id: number;
  kobo_id: number;
  timestamp: string;
  deprecated_uuid: string;
  data_delta: JsonPatch[];
}

// --- Rule Builder Types ---

export interface KoboQuestion {
  type: string;
  name: string;
  'label::English (en)'?: string;
  roster_name: string | null;
  list_name?: string;
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

export interface GlobalParameters {
    data_collection_start_date: string;
    data_collection_end_date: string;
    min_survey_duration_minutes: number | null;
    max_survey_duration_minutes: number | null;
}

// --- Progress Tracker Types ---

// How a survey expresses its collection targets. `none` is a supported choice,
// not a misconfiguration: plenty of surveys never set a target.
export type SamplingMode = 'none' | 'total' | 'by_variable' | 'uploaded';

// `target` and `progress` are null when the survey sets no target -- null, not
// 0. The two are not the same, and collapsing them is what made an untargeted
// survey report 100% complete.
export interface OverallProgress {
  conducted: number;
  target: number | null;
  progress: number | null;
  days_active: number;
  submissions_per_day: number | null;
}

export interface ProgressByColumn {
  value: string;
  conducted: number;
  target: number | null;
  progress: number | null;
  share: number | null;  // Percent of all submissions, when there is no target to compare against
}

export interface DetailedProgress {
  values: Record<string, string>;  // Map of column name to value
  target: number | null;
  conducted: number;
  progress: number | null;
}

export interface ProgressData {
  mode: SamplingMode;
  overall: OverallProgress;
  byColumn: Record<string, ProgressByColumn[]>;  // Key is column name, value is list of progress by column value
  detailed: DetailedProgress[];
  samplingColumns: string[];
  // Legacy fields for backward compatibility
  byDistrict?: ProgressByColumn[];
  byLivelihood?: ProgressByColumn[];
}

export interface EnumeratorCollectionStats {
  id: string;
  needsReview: number;
  validated: number;
  total: number;
  percentValidated: string;
  percentNeedsReview: string;
}

export interface EnumeratorQualityStats {
  id: string;
  avgActiveTime: number;
  avgTotalTime: number;
  avgDkRate: string;
  avgIssuesPerSurvey: number;
}

export interface UnavailableCapability {
  capability: string;
  reason: string;
  missing_setting: string;
}

export interface PerformanceData {
  collection: EnumeratorCollectionStats[];
  quality: EnumeratorQualityStats[];
  // Present when a required survey setting is missing, so the view can
  // explain itself instead of rendering an empty chart.
  unavailable?: UnavailableCapability[];
}

// --- Filtering Types ---

export interface SamplingFilter {
  variable: string;
  values: string[];
}

export interface FilterState {
  qaStatuses?: QAStatus[];  // Keep for backward compatibility if needed
  validationStatuses?: string[];  // Kobo validation statuses: Approved, Not Approved, On Hold, Not Reviewed
  enumerators?: string[];
  samplingFilters?: SamplingFilter[];
}

// --- Quality Overview Types ---

export interface SubmissionStatusSummary {
  total_submissions: number;
  approved_count: number;
  approved_percentage: number;
  not_approved_count: number;
  not_approved_percentage: number;
  on_hold_count: number;
  on_hold_percentage: number;
  not_reviewed_count: number;
  not_reviewed_percentage: number;
}

export interface QualityMetricsSummary {
  total_issues: number;
  submissions_with_issues: number;
  avg_issues_per_submission: number;
  avg_dk_percentage?: number | null;
  avg_active_duration_minutes?: number | null;
}

export interface IssueFrequency {
  check: string;
  count: number;
  percentage: number;
  affected_submissions: number;
}

export interface TemporalDataPoint {
  date: string;
  total_submissions: number;
  approved_count: number;
  not_approved_count: number;
  on_hold_count: number;
  not_reviewed_count: number;
  total_issues: number;
}

export interface IssueTimeSeriesPoint {
  date: string;
  issue_counts: Record<string, number>;
}

export interface QualityOverviewResponse {
  status_summary: SubmissionStatusSummary;
  quality_metrics: QualityMetricsSummary;
  issue_frequency: IssueFrequency[];
  temporal_data: TemporalDataPoint[];
  issue_time_series: IssueTimeSeriesPoint[];
  date_range: { start: string; end: string };
}

export interface QualityOverviewFilters {
  startDate?: string;
  endDate?: string;
  enumerator?: string;
  samplingFilters?: string;
}