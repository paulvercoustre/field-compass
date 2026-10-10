import { ProgressData, PerformanceData, SamplingMode } from '../types';

import { request } from './apiBase';

export interface Survey {
  survey_id: string;
  survey_name: string;
  kobo_asset_id: string | null;
  permission?: 'owner' | 'editor' | 'viewer' | 'admin';
  owner_id?: string | null;
  is_owner?: boolean;
}

export interface SurveyAccessEntry {
  user_id: string;
  email: string;
  username: string;
  full_name: string | null;
  permission_level: 'owner' | 'editor' | 'viewer';
  granted_at: string;
  granted_by?: string | null;
}

export interface SurveyConfig {
  survey_id: string;
  survey_name: string;
  kobo_asset_id: string | null;
  config_data: {
    core_identifiers?: {
      uuid?: string;
      enumerator?: string;
      date_interview?: string;
      start_time?: string;
      end_time?: string;
      consent?: string;
      audit?: string;
    };
    sampling_frame?: {
      // How this survey expresses targets. Absent on configs stored before the
      // field existed, which are inferred rather than defaulted -- see
      // get_sampling_mode() in backend/services/survey_config.py.
      mode?: SamplingMode | null;
      sampling_cols?: string[];
      admin_level_for_label?: string;
      admin_level_choice_name?: string;
      frame_data?: Record<string, any>[] | null;
      // `total` mode: one number for the whole survey.
      total_target?: number | null;
      // `by_variable` mode: the question whose choice list defines the strata,
      // and a target per choice value. `sampling_cols` mirrors `variable`, so
      // everything that disaggregates keeps reading one field.
      variable?: string | null;
      targets_by_value?: Record<string, number> | null;
    };
    special_values?: {
      // One number in configs written before multiple codes; a list (possibly
      // empty, for none) since. Read with `readDkCodes`.
      dk_value?: number | number[] | null;
      // A list since #59. Configs written before that hold a single string and
      // are not rewritten, so both shapes are read.
      dk_string_value?: string | string[];
    };
    pii_cols?: string[] | null;
    roster_processing?: {
      roster_uuid?: string;
      roster_configs?: Record<string, any>;
    };
    global_parameters?: {
      data_collection_start_date?: string;
      data_collection_end_date?: string;
      min_survey_duration_minutes?: number | null;
      max_survey_duration_minutes?: number | null;
    };
    quality_checks?: {
      flag_out_of_period?: boolean;
      flag_weekend?: boolean;
      weekend_days?: number[];
      flag_office_hours?: boolean;
      office_hours_start?: string;
      office_hours_end?: string;
      flag_sampling_frame?: boolean;
      flag_outliers?: boolean;
      outlier_variables?: string[];
      outlier_log_transform_variables?: string[];
      outlier_method?: 'iqr' | 'mad' | 'zscore';
      outlier_threshold?: number;
      flag_dk_percentage?: boolean;
      dk_percentage_threshold?: number;
      flag_empty_percentage?: boolean;
      empty_percentage_threshold?: number;
      flag_llm_qualitative?: boolean;
      llm_qualitative_fields?: string[];
      llm_check_types?: ('content_quality' | 'relevance' | 'completeness')[];
    };
    /** Saved through its own endpoint; see services/transcriptionApi.ts. */
    audio_transcription?: {
      enabled?: boolean;
      questions?: string[];
      language?: string | null;
      multiple_speakers?: boolean;
      send_to_kobo?: boolean;
    };
    kobo_tool?: {
      survey: any[];
      choices: any[];
      label_column_survey?: string; // Column name for survey labels (e.g., 'label::English (en)')
      label_column_choices?: string; // Column name for choice labels (e.g., 'label::English (en)')
      has_audit?: boolean | null; // Whether the form has an `audit` row; null when unknown
    };
  };
  created_at?: string;
  updated_at?: string;
}

export interface SurveyCreate {
  survey_name: string;
  kobo_asset_id?: string | null;
  config_data: SurveyConfig['config_data'];
}

/** Surveys the user can open. */
export const getSurveys = () => request<Survey[]>('/api/surveys');

export const progressApi = {
  /** Every submission but Not approved, against the targets, with the Approved part. */
  getProgressData: (surveyId: string) =>
    request<ProgressData>(`/api/progress?${new URLSearchParams({ survey_id: surveyId })}`),

  /** Field team's figures; a period narrows them to submissions sent within it (YYYY-MM-DD). */
  getPerformanceData: (surveyId: string, period: { startDate?: string; endDate?: string } = {}) => {
    const params = new URLSearchParams({ survey_id: surveyId });
    if (period.startDate) params.append('start_date', period.startDate);
    if (period.endDate) params.append('end_date', period.endDate);
    return request<PerformanceData>(`/api/performance?${params}`);
  },
};

/** A survey's full configuration, with the caller's permission on it. */
export const getSurveyConfig = (surveyId: string) =>
  request<SurveyConfig & { permission?: string; is_owner?: boolean }>(`/api/surveys/${surveyId}`);

export const createSurvey = (surveyData: SurveyCreate) =>
  request<SurveyConfig>('/api/surveys', { method: 'POST', body: JSON.stringify(surveyData) });

export const updateSurvey = (surveyId: string, updates: Partial<SurveyCreate>) =>
  request<SurveyConfig>(`/api/surveys/${surveyId}`, { method: 'PUT', body: JSON.stringify(updates) });

/** Deletes the survey and all its data. */
export const deleteSurvey = async (surveyId: string): Promise<void> => {
  await request(`/api/surveys/${surveyId}`, { method: 'DELETE' });
};

/**
 * Make the next pull run every submission's AI check again (owner only).
 * Returns how many submissions will be re-checked.
 */
export const rerunAiChecks = async (surveyId: string): Promise<number> => {
  const data = await request<{ submissions: number }>(`/api/surveys/${surveyId}/ai-checks/rerun`, {
    method: 'POST',
  });
  return data.submissions;
};

// ============================================================================
// Survey sharing
// ============================================================================

export const getSurveyAccess = (surveyId: string) => request<SurveyAccessEntry[]>(`/api/surveys/${surveyId}/access`);

export const shareSurvey = (surveyId: string, email: string, permissionLevel: 'editor' | 'viewer') =>
  request<SurveyAccessEntry>(`/api/surveys/${surveyId}/access`, {
    method: 'POST',
    body: JSON.stringify({ email, permission_level: permissionLevel }),
  });

export const updateSurveyAccess = async (
  surveyId: string,
  userId: string,
  permissionLevel: 'editor' | 'viewer'
): Promise<void> => {
  await request(`/api/surveys/${surveyId}/access/${userId}`, {
    method: 'PUT',
    body: JSON.stringify({ permission_level: permissionLevel }),
  });
};

export const revokeSurveyAccess = async (surveyId: string, userId: string): Promise<void> => {
  await request(`/api/surveys/${surveyId}/access/${userId}`, { method: 'DELETE' });
};

// ============================================================================
// Validation rules
// ============================================================================

export interface ValidationRule {
  rule_id: string;
  survey_id: string;
  rule_name: string;
  rule_data: {
    check_id?: string;
    issue: string;
    check_expression: string;
    variables_involved?: string[];
    roster_name?: string | null;
  };
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

interface ValidationRuleCreate {
  rule_name: string;
  rule_data: {
    check_id: string;
    issue: string;
    check_expression: string;
    variables_involved: string[];
    roster_name: string | null;
  };
  is_active?: boolean;
}

interface ValidationRuleUpdate {
  rule_name?: string;
  rule_data?: {
    check_id?: string;
    issue?: string;
    check_expression?: string;
    variables_involved?: string[];
    roster_name?: string | null;
  };
  is_active?: boolean;
}

export const getValidationRules = (surveyId: string) => request<ValidationRule[]>(`/api/surveys/${surveyId}/rules`);

export const createValidationRule = (surveyId: string, ruleData: ValidationRuleCreate) =>
  request<ValidationRule>(`/api/surveys/${surveyId}/rules`, {
    method: 'POST',
    body: JSON.stringify(ruleData),
  });

export const updateValidationRule = (surveyId: string, ruleId: string, updates: ValidationRuleUpdate) =>
  request<ValidationRule>(`/api/surveys/${surveyId}/rules/${ruleId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });

export const deleteValidationRule = async (surveyId: string, ruleId: string): Promise<void> => {
  await request(`/api/surveys/${surveyId}/rules/${ruleId}`, { method: 'DELETE' });
};
