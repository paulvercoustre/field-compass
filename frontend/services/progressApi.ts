
import { ProgressData, PerformanceData, SamplingMode } from '../types';

import { API_BASE_URL, apiFetch } from './apiBase';

// Helper to get auth token from localStorage
const getAuthToken = (): string | null => {
  return localStorage.getItem('field_compass_token');
};

// Helper to create headers with optional auth
const createAuthHeaders = (): HeadersInit => {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  
  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  return headers;
};

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

/**
 * Fetch list of surveys (only surveys user has access to)
 */
export const getSurveys = async (): Promise<Survey[]> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/api/surveys`, {
      headers: createAuthHeaders(),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch surveys: ${response.statusText}`);
    }

    const data: Survey[] = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching surveys:', error);
    throw error;
  }
};

/**
 * Fetch progress data from the API
 * @param surveyId Optional survey ID to filter by (UUID string)
 */
export interface ProgressQueryOptions {
  approvedOnly?: boolean;
}

export const progressApi = {
  getProgressData: async (surveyId: string, options: ProgressQueryOptions = {}): Promise<ProgressData> => {
    if (!surveyId) {
      throw new Error('surveyId is required');
    }
    
    try {
      const params = new URLSearchParams();
      params.append('survey_id', surveyId);
      if (options.approvedOnly) {
        params.append('approved_only', 'true');
      }

      const url = `${API_BASE_URL}/api/progress?${params.toString()}`;
      const response = await apiFetch(url, {
        headers: createAuthHeaders(),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch progress data: ${response.statusText}`);
      }

      const data: ProgressData = await response.json();
      return data;
    } catch (error) {
      console.error('Error fetching progress data:', error);
      throw error;
    }
  },

  /**
   * Fetch performance data from the API
   * @param surveyId Required survey ID (UUID string)
   */
  getPerformanceData: async (surveyId: string): Promise<PerformanceData> => {
    if (!surveyId) {
      throw new Error('surveyId is required');
    }
    
    try {
      const params = new URLSearchParams();
      params.append('survey_id', surveyId);

      const url = `${API_BASE_URL}/api/performance?${params.toString()}`;
      const response = await apiFetch(url, {
        headers: createAuthHeaders(),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch performance data: ${response.statusText}`);
      }

      const data: PerformanceData = await response.json();
      return data;
    } catch (error) {
      console.error('Error fetching performance data:', error);
      throw error;
    }
  }
};

/**
 * Fetch full survey configuration by ID
 */
export const getSurveyConfig = async (surveyId: string): Promise<SurveyConfig & { permission?: string; is_owner?: boolean }> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/api/surveys/${surveyId}`, {
      headers: createAuthHeaders(),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch survey config: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching survey config:', error);
    throw error;
  }
};

/**
 * Create a new survey configuration
 */
export const createSurvey = async (surveyData: SurveyCreate): Promise<SurveyConfig> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/api/surveys`, {
      method: 'POST',
      headers: createAuthHeaders(),
      body: JSON.stringify(surveyData),
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(errorData.detail || `Failed to create survey: ${response.statusText}`);
    }

    const data: SurveyConfig = await response.json();
    return data;
  } catch (error) {
    console.error('Error creating survey:', error);
    throw error;
  }
};

/**
 * Update an existing survey configuration
 */
export const updateSurvey = async (
  surveyId: string,
  updates: Partial<SurveyCreate>
): Promise<SurveyConfig> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/api/surveys/${surveyId}`, {
      method: 'PUT',
      headers: createAuthHeaders(),
      body: JSON.stringify(updates),
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(errorData.detail || `Failed to update survey: ${response.statusText}`);
    }

    const data: SurveyConfig = await response.json();
    return data;
  } catch (error) {
    console.error('Error updating survey:', error);
    throw error;
  }
};

/**
 * Delete a survey and all associated data
 */
export const deleteSurvey = async (surveyId: string): Promise<void> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/api/surveys/${surveyId}`, {
      method: 'DELETE',
      headers: createAuthHeaders(),
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(errorData.detail || `Failed to delete survey: ${response.statusText}`);
    }
  } catch (error) {
    console.error('Error deleting survey:', error);
    throw error;
  }
};

/**
 * Make the next pull run every submission's AI check again (owner only).
 * Returns how many submissions will be re-checked.
 */
export const rerunAiChecks = async (surveyId: string): Promise<number> => {
  const response = await apiFetch(`${API_BASE_URL}/api/surveys/${surveyId}/ai-checks/rerun`, {
    method: 'POST',
    headers: createAuthHeaders(),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(errorData.detail || `Could not schedule the review: ${response.statusText}`);
  }
  const data = await response.json();
  return data.submissions as number;
};

// ============================================================================
// Survey Sharing API
// ============================================================================

/**
 * Get list of users with access to a survey
 */
export const getSurveyAccess = async (surveyId: string): Promise<SurveyAccessEntry[]> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/api/surveys/${surveyId}/access`, {
      headers: createAuthHeaders(),
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(errorData.detail || `Failed to fetch survey access: ${response.statusText}`);
    }

    const data: SurveyAccessEntry[] = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching survey access:', error);
    throw error;
  }
};

/**
 * Share a survey with another user
 */
export const shareSurvey = async (
  surveyId: string,
  email: string,
  permissionLevel: 'editor' | 'viewer'
): Promise<SurveyAccessEntry> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/api/surveys/${surveyId}/access`, {
      method: 'POST',
      headers: createAuthHeaders(),
      body: JSON.stringify({ email, permission_level: permissionLevel }),
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(errorData.detail || `Failed to share survey: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error sharing survey:', error);
    throw error;
  }
};

/**
 * Update a user's access level for a survey
 */
export const updateSurveyAccess = async (
  surveyId: string,
  userId: string,
  permissionLevel: 'editor' | 'viewer'
): Promise<void> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/api/surveys/${surveyId}/access/${userId}`, {
      method: 'PUT',
      headers: createAuthHeaders(),
      body: JSON.stringify({ permission_level: permissionLevel }),
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(errorData.detail || `Failed to update access: ${response.statusText}`);
    }
  } catch (error) {
    console.error('Error updating survey access:', error);
    throw error;
  }
};

/**
 * Revoke a user's access to a survey
 */
export const revokeSurveyAccess = async (surveyId: string, userId: string): Promise<void> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/api/surveys/${surveyId}/access/${userId}`, {
      method: 'DELETE',
      headers: createAuthHeaders(),
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(errorData.detail || `Failed to revoke access: ${response.statusText}`);
    }
  } catch (error) {
    console.error('Error revoking survey access:', error);
    throw error;
  }
};

// ============================================================================
// Validation Rules API
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

export interface ValidationRuleCreate {
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

export interface ValidationRuleUpdate {
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

/**
 * Get all validation rules for a survey
 */
export const getValidationRules = async (surveyId: string): Promise<ValidationRule[]> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/api/surveys/${surveyId}/rules`, {
      headers: createAuthHeaders(),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch validation rules: ${response.statusText}`);
    }

    const data: ValidationRule[] = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching validation rules:', error);
    throw error;
  }
};

/**
 * Create a new validation rule
 */
export const createValidationRule = async (
  surveyId: string,
  ruleData: ValidationRuleCreate
): Promise<ValidationRule> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/api/surveys/${surveyId}/rules`, {
      method: 'POST',
      headers: createAuthHeaders(),
      body: JSON.stringify(ruleData),
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(errorData.detail || `Failed to create validation rule: ${response.statusText}`);
    }

    const data: ValidationRule = await response.json();
    return data;
  } catch (error) {
    console.error('Error creating validation rule:', error);
    throw error;
  }
};

/**
 * Update an existing validation rule
 */
export const updateValidationRule = async (
  surveyId: string,
  ruleId: string,
  updates: ValidationRuleUpdate
): Promise<ValidationRule> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/api/surveys/${surveyId}/rules/${ruleId}`, {
      method: 'PUT',
      headers: createAuthHeaders(),
      body: JSON.stringify(updates),
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(errorData.detail || `Failed to update validation rule: ${response.statusText}`);
    }

    const data: ValidationRule = await response.json();
    return data;
  } catch (error) {
    console.error('Error updating validation rule:', error);
    throw error;
  }
};

/**
 * Delete a validation rule
 */
export const deleteValidationRule = async (surveyId: string, ruleId: string): Promise<void> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/api/surveys/${surveyId}/rules/${ruleId}`, {
      method: 'DELETE',
      headers: createAuthHeaders(),
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(errorData.detail || `Failed to delete validation rule: ${response.statusText}`);
    }
  } catch (error) {
    console.error('Error deleting validation rule:', error);
    throw error;
  }
};
