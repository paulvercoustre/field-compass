import { Submission, FilterState, KoboChoice, KoboQuestion, QueueSort, ReviewTab, SubmissionFacets } from '../types';
import { buildFilterParams } from '../utils/filterUtils';
import type { EditRecord } from '../utils/editHistory';

import { orMessage, request } from './apiBase';

interface SubmissionListResponse {
  submissions: Submission[];
  total: number;
  page: number;
  page_size: number;
  /** The tab and order used: the defaults when the filters named none. */
  review: ReviewTab;
  sort: QueueSort;
}

const json = (body: unknown): RequestInit['body'] => JSON.stringify(body);

const queueParams = (filters: FilterState, surveyId: string, options?: { withSort?: boolean }) => {
  const params = buildFilterParams(filters, options);
  params.append('survey_id', surveyId);
  return params;
};

export const api = {
  /** A page of a survey's submissions in one review tab, filtered and sorted. */
  /** Part of a tab's list: `limit` submissions from `offset`, with the total and the tab and order used. */
  getSubmissions: (filters: FilterState, surveyId: string, { offset = 0, limit = 50 } = {}) => {
    const params = queueParams(filters, surveyId);
    params.append('offset', String(offset));
    params.append('page_size', String(limit));
    return request<SubmissionListResponse>(`/api/submissions?${params}`);
  },

  /** The counts behind the tabs and the filter menu, for the same filters. */
  getSubmissionFacets: (filters: FilterState, surveyId: string) =>
    request<SubmissionFacets>(`/api/submissions/facets?${queueParams(filters, surveyId, { withSort: false })}`),

  /** Approve in Kobo every clean submission under the filters whose checks have finished. */
  approveCleanSubmissions: (filters: FilterState, surveyId: string) =>
    request<{ approved: number; failed: number }>(
      `/api/submissions/approve-clean?${queueParams(filters, surveyId, { withSort: false })}`,
      { method: 'POST' }
    ),

  /** A link that opens the submission for editing in Kobo (Enketo). */
  getKoboEditUrl: async (koboId: number, surveyId: string): Promise<string> => {
    const params = new URLSearchParams({ survey_id: surveyId });
    const data = await request<{ url: string }>(`/api/submissions/${koboId}/kobo-edit-url?${params}`);
    return data.url;
  },

  /** Sets Kobo's validation status: 'Approved', 'Not Approved', 'On Hold', or null. */
  /** A submission's edits in Kobo, newest first (utils/editHistory.ts reads them). */
  getSubmissionHistory: (koboId: number) => request<EditRecord[]>(`/api/submissions/${koboId}/history`),

  /** One submission of a survey, for a link to one that isn't in the list. */
  getSubmission: (koboId: number, surveyId: string) =>
    request<Submission>(`/api/submissions/${koboId}?${new URLSearchParams({ survey_id: surveyId })}`),

  updateValidationStatus: (koboId: number, surveyId: string, validationStatus: string | null) =>
    request<Submission>(
      `/api/submissions/${koboId}/validation-status?${new URLSearchParams({ survey_id: surveyId })}`,
      { method: 'PATCH', body: json({ validation_status: validationStatus }) }
    ),

  /** Free-text reviewer notes, or null to clear them. */
  updateReviewerNotes: (koboId: number, surveyId: string, reviewerNotes: string | null) =>
    request<Submission>(`/api/submissions/${koboId}/reviewer-notes?${new URLSearchParams({ survey_id: surveyId })}`, {
      method: 'PATCH',
      body: json({ reviewer_notes: reviewerNotes }),
    }),
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

export interface KoboProjectForm {
  asset_uid: string;
  asset_name: string | null;
  languages: string[];
  has_audit: boolean | null;
  /** The form as a survey stores it: question rows, translations in `label::<language>` columns. */
  survey: KoboQuestion[];
  choices: KoboChoice[];
}

/**
 * Fetch a Kobo project's form, in the shape a survey stores it, so a survey
 * can be set up without the user exporting and uploading the XLSForm.
 */
export const getKoboProjectForm = (assetUid: string) =>
  orMessage(
    request<KoboProjectForm>(`/api/kobo/assets/${encodeURIComponent(assetUid)}/form`),
    'Could not read the form from that Kobo project.'
  );
