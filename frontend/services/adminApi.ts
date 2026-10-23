/** Usage figures for admins: GET /api/admin/usage (backend/routers/admin.py). */

import { request } from './apiBase';

export interface UsagePeriod {
  signups: number;
  active_users: number;
  logins: number;
  surveys_created: number;
  pulls: number;
  /** Surveys shared with an address with no confirmed account. */
  invites_sent: number;
  invites_accepted: number;
}

export interface UsageLast30 extends UsagePeriod {
  submissions_synced: number;
  ai_reviews: number;
  ai_cost_usd: number;
  operator_ai_spend_usd: number;
  /** Answers translated, on any key. */
  translations: number;
  transcriptions: number;
  audio_minutes: number;
}

export interface UsageWeek {
  week: string; // Monday, ISO date
  signups: number;
  active_users: number;
  surveys: number;
  pulls: number;
}

export interface RecentSignup {
  email: string;
  full_name: string | null;
  signed_up_at: string | null;
  last_seen_at: string | null;
  source: string | null;
  kobo_connected: boolean;
  surveys: number;
  pulled: boolean;
}

/** This calendar month's spend on Field Compass's AI keys, all accounts together. */
export interface AIBudget {
  month: string; // "2026-10"
  /** Estimated at list price; unpriced calls at the highest price. */
  spent_usd: number;
  /** AI_MONTHLY_BUDGET_USD; null when unset. */
  budget_usd: number | null;
  /** Spent: the included AI waits for resumes_at. */
  paused: boolean;
  resumes_at: string;
  /** Models the price table doesn't list, counted at its highest price. */
  unpriced: { model: string; calls: number }[];
}

export interface Usage {
  generated_at: string;
  tracking_since: string | null;
  totals: { users: number; kobo_connected: number; surveys: number; submissions: number };
  last_7_days: UsagePeriod;
  last_30_days: UsageLast30;
  ai_budget: AIBudget;
  weekly: UsageWeek[];
  funnel: { step: string; users: number }[];
  signup_sources_30_days: { source: string; signups: number }[];
  recent_signups: RecentSignup[];
}

export const getUsage = () => request<Usage>('/api/admin/usage');
