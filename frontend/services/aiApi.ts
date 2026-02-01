/**
 * AI API service for rule generation and suggestions
 */

import { StagedRule } from '../types';

// API base URL - defaults to localhost:8000 for development
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// Helper to get auth token from localStorage
const getAuthToken = (): string | null => {
  return localStorage.getItem('field_compass_token');
};

// Helper to create headers with auth
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

/**
 * Generate a validation rule from natural language description
 * 
 * @param surveyId - UUID of the survey
 * @param prompt - Natural language description of the rule
 * @returns Promise<StagedRule> - Generated rule without ID (to be added by frontend)
 * @throws Error if API request fails
 */
export async function generateRuleFromNaturalLanguage(
  surveyId: string,
  prompt: string
): Promise<Omit<StagedRule, 'id'>> {
  const response = await fetch(`${API_BASE_URL}/api/ai/generate-rule`, {
    method: 'POST',
    headers: createAuthHeaders(),
    body: JSON.stringify({
      survey_id: surveyId,
      prompt: prompt.trim(),
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(errorData.detail || `Failed to generate rule: ${response.statusText}`);
  }

  const data = await response.json();
  
  // Return rule in StagedRule format (without id, which will be added by caller)
  return {
    description: data.description,
    issue_message: data.issue_message,
    conditions: data.conditions,
    roster_name: data.roster_name || null,
  };
}

/**
 * Get AI-suggested validation rules based on survey form structure
 * 
 * @param surveyId - UUID of the survey
 * @returns Promise<StagedRule[]> - Array of suggested rules without IDs
 * @throws Error if API request fails
 */
export async function getSuggestedRules(
  surveyId: string
): Promise<Array<Omit<StagedRule, 'id'>>> {
  const response = await fetch(`${API_BASE_URL}/api/ai/suggest-rules`, {
    method: 'POST',
    headers: createAuthHeaders(),
    body: JSON.stringify({
      survey_id: surveyId,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(errorData.detail || `Failed to get suggestions: ${response.statusText}`);
  }

  const data = await response.json();
  
  // Return array of rules in StagedRule format (without ids)
  return data.map((rule: any) => ({
    description: rule.description,
    issue_message: rule.issue_message,
    conditions: rule.conditions,
    roster_name: rule.roster_name || null,
  }));
}
