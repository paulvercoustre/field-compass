/**
 * Quality Overview API client
 */

import { QualityOverviewResponse, QualityOverviewFilters } from '../types';

import { API_BASE_URL } from './apiBase';

// Helper to get auth token from localStorage
const getAuthToken = (): string | null => {
  return localStorage.getItem('field_compass_token');
};

// Helper to create headers with auth
const createHeaders = (): HeadersInit => {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  
  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  return headers;
};

/**
 * Fetch quality overview data for a survey
 * @param surveyId The survey ID (required)
 * @param filters Optional filters (date range, enumerator, sampling variables)
 */
export const fetchQualityOverview = async (
  surveyId: string,
  filters?: QualityOverviewFilters
): Promise<QualityOverviewResponse> => {
  try {
    const params = new URLSearchParams({
      survey_id: surveyId,
    });

    if (filters?.startDate) {
      params.append('start_date', filters.startDate);
    }
    if (filters?.endDate) {
      params.append('end_date', filters.endDate);
    }
    if (filters?.enumerator) {
      params.append('enumerator', filters.enumerator);
    }
    if (filters?.samplingFilters) {
      params.append('sampling_filters', filters.samplingFilters);
    }

    const response = await fetch(`${API_BASE_URL}/api/quality/overview?${params}`, {
      headers: createHeaders(),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: response.statusText }));
      const errorMessage = typeof errorData.detail === 'string' 
        ? errorData.detail 
        : JSON.stringify(errorData.detail) || `Failed to fetch quality overview: ${response.statusText}`;
      throw new Error(errorMessage);
    }

    const data: QualityOverviewResponse = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching quality overview:', error);
    throw error;
  }
};

/**
 * Trigger ETL pipeline for a survey
 * @param surveyId The survey ID (required)
 * @param limit Optional limit on number of submissions to process
 * @param startDate Optional start date filter (YYYY-MM-DD)
 */
export interface ETLStats {
  fetched: number;
  created: number;
  updated: number;
  edited: number;
  validated: number;  // Number of submissions that went through validation checks
  skipped: number;    // Number of submissions that skipped validation (incremental optimization)
  validation_reasons?: Record<string, number>;  // Breakdown of why submissions were validated
  hfc_flagged: number;
  errors: number;
  duration_seconds: number;
}

export const triggerETL = async (
  surveyId: string,
  limit?: number,
  startDate?: string
): Promise<ETLStats> => {
  try {
    const params = new URLSearchParams();
    if (limit) {
      params.append('limit', limit.toString());
    }
    if (startDate) {
      params.append('start_date', startDate);
    }

    const url = `${API_BASE_URL}/api/etl/run/${surveyId}${params.toString() ? `?${params}` : ''}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: createHeaders(),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(errorData.detail || `Failed to trigger ETL: ${response.statusText}`);
    }

    const data = await response.json();
    return data.data as ETLStats;
  } catch (error) {
    console.error('Error triggering ETL:', error);
    throw error;
  }
};
