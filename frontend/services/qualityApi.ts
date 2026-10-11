/**
 * Quality Overview API client
 */

import { QualityOverviewResponse, QualityOverviewFilters, QuestionsResponse } from '../types';

import { request } from './apiBase';

/** The quality dashboard's figures for a survey, narrowed by the filters. */
export const fetchQualityOverview = (surveyId: string, filters?: QualityOverviewFilters) => {
  const params = new URLSearchParams({ survey_id: surveyId });
  if (filters?.startDate) params.append('start_date', filters.startDate);
  if (filters?.endDate) params.append('end_date', filters.endDate);
  if (filters?.enumerator) params.append('enumerator', filters.enumerator);
  if (filters?.samplingFilters) params.append('sampling_filters', filters.samplingFilters);
  return request<QualityOverviewResponse>(`/api/quality/overview?${params}`);
};

/** Data quality by question, over the submissions sent in the period. */
export const fetchQualityQuestions = (surveyId: string, period?: { startDate?: string; endDate?: string }) => {
  const params = new URLSearchParams({ survey_id: surveyId });
  if (period?.startDate) params.append('start_date', period.startDate);
  if (period?.endDate) params.append('end_date', period.endDate);
  return request<QuestionsResponse>(`/api/quality/questions?${params}`);
};
