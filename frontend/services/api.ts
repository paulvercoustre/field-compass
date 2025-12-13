
import { Submission, SubmissionHistory, FilterState } from '../types';
import { buildFilterParams } from '../utils/filterUtils';

// API base URL - defaults to localhost:8000 for development
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

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

      const response = await fetch(`${API_BASE_URL}/api/submissions?${params}`);

      if (!response.ok) {
        throw new Error(`Failed to fetch submissions: ${response.statusText}`);
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
      const response = await fetch(`${API_BASE_URL}/api/submissions/${koboId}`);
      
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
      const response = await fetch(`${API_BASE_URL}/api/submissions/${koboId}/history`);
      
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
      const response = await fetch(`${API_BASE_URL}/api/submissions/${koboId}/kobo-edit-url?${params}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch Kobo edit URL: ${response.statusText}`);
      }

      const data: { url: string } = await response.json();
      return data.url;
    } catch (error) {
      console.error(`Error fetching Kobo edit URL for submission ${koboId}:`, error);
      throw error;
    }
  }
};