
import { ProgressData, PerformanceData } from '../types';

// API base URL - defaults to localhost:8000 for development
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export interface Survey {
  survey_id: string;
  survey_name: string;
  kobo_asset_id: string | null;
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
      sampling_cols?: string[];
      admin_level_for_label?: string;
      admin_level_choice_name?: string;
    };
    special_values?: {
      dk_value?: number;
      dk_string_value?: string;
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
    kobo_tool?: {
      survey: any[];
      choices: any[];
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
 * Fetch list of surveys
 */
export const getSurveys = async (): Promise<Survey[]> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/surveys`);
    
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
export const progressApi = {
  getProgressData: async (surveyId?: string): Promise<ProgressData> => {
    try {
      const params = new URLSearchParams();
      if (surveyId) {
        params.append('survey_id', surveyId);
      }

      const url = `${API_BASE_URL}/api/progress${params.toString() ? `?${params}` : ''}`;
      const response = await fetch(url);
      
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
   * @param surveyId Optional survey ID to filter by (UUID string)
   */
  getPerformanceData: async (surveyId?: string): Promise<PerformanceData> => {
    try {
      const params = new URLSearchParams();
      if (surveyId) {
        params.append('survey_id', surveyId);
      }

      const url = `${API_BASE_URL}/api/performance${params.toString() ? `?${params}` : ''}`;
      const response = await fetch(url);
      
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
export const getSurveyConfig = async (surveyId: string): Promise<SurveyConfig> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/surveys/${surveyId}`);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch survey config: ${response.statusText}`);
    }

    const data: SurveyConfig = await response.json();
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
    const response = await fetch(`${API_BASE_URL}/api/surveys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
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
    const response = await fetch(`${API_BASE_URL}/api/surveys/${surveyId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
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
    const response = await fetch(`${API_BASE_URL}/api/surveys/${surveyId}`, {
      method: 'DELETE',
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
    const response = await fetch(`${API_BASE_URL}/api/surveys/${surveyId}/rules`);
    
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
    const response = await fetch(`${API_BASE_URL}/api/surveys/${surveyId}/rules`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
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
    const response = await fetch(`${API_BASE_URL}/api/surveys/${surveyId}/rules/${ruleId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
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
    const response = await fetch(`${API_BASE_URL}/api/surveys/${surveyId}/rules/${ruleId}`, {
      method: 'DELETE',
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