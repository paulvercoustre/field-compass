
import { Submission, FilterState } from '../types';
import { buildFilterParams } from '../utils/filterUtils';

import { orMessage, request } from './apiBase';

interface SubmissionListResponse {
  submissions: Submission[];
  total: number;
  page: number;
  page_size: number;
}

const json = (body: unknown): RequestInit['body'] => JSON.stringify(body);

export const api = {
  /** A page of a survey's submissions, narrowed by the filters. */
  getSubmissions: (filters?: FilterState, surveyId?: string, page = 1, pageSize = 50) => {
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (surveyId) params.append('survey_id', surveyId);
    if (filters) {
      for (const [key, value] of buildFilterParams(filters)) params.append(key, value);
    }
    return request<SubmissionListResponse>(`/api/submissions?${params}`);
  },

  /** A link that opens the submission for editing in Kobo (Enketo). */
  getKoboEditUrl: async (koboId: number, surveyId: string): Promise<string> => {
    const params = new URLSearchParams({ survey_id: surveyId });
    const data = await request<{ url: string }>(`/api/submissions/${koboId}/kobo-edit-url?${params}`);
    return data.url;
  },

  /** Sets Kobo's validation status: 'Approved', 'Not Approved', 'On Hold', or null. */
  updateValidationStatus: (koboId: number, surveyId: string, validationStatus: string | null) =>
    request<Submission>(
      `/api/submissions/${koboId}/validation-status?${new URLSearchParams({ survey_id: surveyId })}`,
      { method: 'PATCH', body: json({ validation_status: validationStatus }) }
    ),

  /** Free-text reviewer notes, or null to clear them. */
  updateReviewerNotes: (koboId: number, surveyId: string, reviewerNotes: string | null) =>
    request<Submission>(
      `/api/submissions/${koboId}/reviewer-notes?${new URLSearchParams({ survey_id: surveyId })}`,
      { method: 'PATCH', body: json({ reviewer_notes: reviewerNotes }) }
    ),
};

// --- Kobo projects ----------------------------------------------------------

export interface KoboProject {
  uid: string;
  name: string;
  status: 'deployed' | 'draft' | 'archived';
  submission_count: number | null;
  owner_username: string | null;
  date_modified: string | null;
  /** A Field Compass survey the user can see that already reads this project. */
  existing_survey_name: string | null;
}

/**
 * The survey projects in the user's Kobo account, deployed first and newest
 * first within each status, so a survey can be created by picking one.
 */
export const listKoboProjects = () =>
  orMessage(request<KoboProject[]>('/api/kobo/assets'), 'Could not load your Kobo projects.');

// --- Kobo project form ------------------------------------------------------

export interface KoboFormQuestion {
  path: string;
  name: string;
  /** Every translation the form carries, keyed by language name. */
  labels: Record<string, string>;
  type: string;
  list_name: string | null;
  repeat_name: string | null;
  required?: boolean;
  constraint?: string | null;
  relevant?: string | null;
  calculation?: string | null;
  choice_filter?: string | null;
  /** Enclosing groups, since group rows themselves are not returned. */
  group_path?: string | null;
  /** `relevant` conditions of those groups — a consent gate, usually. */
  group_relevant?: string[];
}

export interface KoboFormChoice {
  name: string;
  labels: Record<string, string>;
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
export const getKoboProjectForm = (assetUid: string) =>
  orMessage(
    request<KoboProjectForm>(`/api/kobo/assets/${encodeURIComponent(assetUid)}/form`),
    'Could not read the form from that Kobo project.'
  );
