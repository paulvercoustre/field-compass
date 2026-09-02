
import { Submission, SubmissionHistory, FilterState } from '../types';
import { buildFilterParams } from '../utils/filterUtils';

import { API_BASE_URL } from './apiBase';

// Helper to get auth token from localStorage
const getAuthToken = (): string | null => {
  return localStorage.getItem('field_compass_token');
};

// Helper to create headers with optional auth
const createHeaders = (includeAuth: boolean = true): HeadersInit => {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  
  if (includeAuth) {
    const token = getAuthToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }
  
  return headers;
};

interface SubmissionListResponse {
  submissions: Submission[];
  total: number;
  page: number;
  page_size: number;
}

/**
 * Fetch submissions from the API with optional filtering
 * @param filters Optional filter state object
 * @param surveyId Optional filter by survey ID (required for enumerator/sampling filters)
 * @param page Page number (default: 1)
 * @param pageSize Items per page (default: 50)
 */
export const api = {
  getSubmissions: async (
    filters?: FilterState,
    surveyId?: string,
    page: number = 1,
    pageSize: number = 50
  ): Promise<SubmissionListResponse> => {
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: pageSize.toString(),
      });

      if (surveyId) {
        params.append('survey_id', surveyId);
      }

      // Add filter parameters if provided
      if (filters) {
        const filterParams = buildFilterParams(filters);
        for (const [key, value] of filterParams) {
          params.append(key, value);
        }
      }

      const response = await fetch(`${API_BASE_URL}/api/submissions?${params}`, {
        headers: createHeaders(),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: response.statusText }));
        throw new Error(errorData.detail || `Failed to fetch submissions: ${response.statusText}`);
      }

      const data: SubmissionListResponse = await response.json();
      return data;
    } catch (error) {
      console.error('Error fetching submissions:', error);
      throw error;
    }
  },

  /**
   * Fetch a single submission by ID
   * @param koboId The Kobo submission ID
   */
  getSubmission: async (koboId: number): Promise<Submission> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/submissions/${koboId}`, {
        headers: createHeaders(),
      });
      
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Submission ${koboId} not found`);
        }
        throw new Error(`Failed to fetch submission: ${response.statusText}`);
      }

      const data: Submission = await response.json();
      return data;
    } catch (error) {
      console.error(`Error fetching submission ${koboId}:`, error);
      throw error;
    }
  },

  /**
   * Fetch submission history
   * @param koboId The Kobo submission ID
   */
  getSubmissionHistory: async (koboId: number): Promise<SubmissionHistory[]> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/submissions/${koboId}/history`, {
        headers: createHeaders(),
      });
      
      if (!response.ok) {
        if (response.status === 404) {
          return []; // No history found, return empty array
        }
        throw new Error(`Failed to fetch submission history: ${response.statusText}`);
      }

      const data: SubmissionHistory[] = await response.json();
      return data;
    } catch (error) {
      console.error(`Error fetching history for submission ${koboId}:`, error);
      throw error;
    }
  },

  /**
   * Get Kobo edit URL for a submission
   * @param koboId The Kobo submission ID
   * @param surveyId The survey ID to get the Kobo asset ID
   */
  getKoboEditUrl: async (koboId: number, surveyId: string): Promise<string> => {
    try {
      const params = new URLSearchParams({
        survey_id: surveyId,
      });
      const response = await fetch(`${API_BASE_URL}/api/submissions/${koboId}/kobo-edit-url?${params}`, {
        headers: createHeaders(),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch Kobo edit URL: ${response.statusText}`);
      }

      const data: { url: string } = await response.json();
      return data.url;
    } catch (error) {
      console.error(`Error fetching Kobo edit URL for submission ${koboId}:`, error);
      throw error;
    }
  },

  /**
   * Update Kobo validation status for a submission
   * @param koboId The Kobo submission ID
   * @param surveyId The survey ID
   * @param validationStatus Kobo validation status ('Approved', 'Not Approved', 'On Hold', or null)
   */
  updateValidationStatus: async (
    koboId: number,
    surveyId: string,
    validationStatus: string | null
  ): Promise<Submission> => {
    try {
      const params = new URLSearchParams({
        survey_id: surveyId,
      });
      
      const response = await fetch(
        `${API_BASE_URL}/api/submissions/${koboId}/validation-status?${params}`,
        {
          method: 'PATCH',
          headers: createHeaders(),
          body: JSON.stringify({ validation_status: validationStatus }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: response.statusText }));
        throw new Error(errorData.detail || `Failed to update validation status: ${response.statusText}`);
      }

      const data: Submission = await response.json();
      return data;
    } catch (error) {
      console.error(`Error updating validation status for submission ${koboId}:`, error);
      throw error;
    }
  },

  /**
   * Update reviewer notes for a submission
   * @param koboId The Kobo submission ID
   * @param surveyId The survey ID
   * @param reviewerNotes Free-text reviewer notes (or null to clear)
   */
  updateReviewerNotes: async (
    koboId: number,
    surveyId: string,
    reviewerNotes: string | null
  ): Promise<Submission> => {
    try {
      const params = new URLSearchParams({
        survey_id: surveyId,
      });

      const response = await fetch(
        `${API_BASE_URL}/api/submissions/${koboId}/reviewer-notes?${params}`,
        {
          method: 'PATCH',
          headers: createHeaders(),
          body: JSON.stringify({ reviewer_notes: reviewerNotes }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: response.statusText }));
        throw new Error(errorData.detail || `Failed to update reviewer notes: ${response.statusText}`);
      }

      const data: Submission = await response.json();
      return data;
    } catch (error) {
      console.error(`Error updating reviewer notes for submission ${koboId}:`, error);
      throw error;
    }
  }
};
// --- Kobo project form ------------------------------------------------------

export interface KoboFormQuestion {
  path: string;
  name: string;
  label: string;
  type: string;
  list_name: string | null;
  repeat_name: string | null;
}

export interface KoboFormChoice {
  name: string;
  label: string;
}

export interface KoboProjectForm {
  asset_uid: string;
  asset_name: string | null;
  languages: string[];
  has_audit: boolean | null;
  questions: KoboFormQuestion[];
  choice_lists: Record<string, KoboFormChoice[]>;
}

/**
 * Fetch a Kobo project's form structure so configuration pickers can be
 * populated without the user exporting and uploading the XLSForm.
 */
export const getKoboProjectForm = async (assetUid: string): Promise<KoboProjectForm> => {
  const response = await fetch(
    `${API_BASE_URL}/api/kobo/assets/${encodeURIComponent(assetUid)}/form`,
    { headers: createHeaders() }
  );

  if (!response.ok) {
    let detail = 'Could not read the form from that Kobo project.';
    try {
      const body = await response.json();
      if (body?.detail) detail = body.detail;
    } catch {
      // Non-JSON error body; the default message is more useful than the raw text.
    }
    throw new Error(detail);
  }

  return response.json();
};
