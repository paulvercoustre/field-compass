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
  /** The North Star: surveys with a pull and a review decision in the period. */
  active_surveys: number;
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
  active_surveys: number;
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
  /** A survey of theirs has a check on. */
  checks_on: boolean;
  /** Has decided on a submission. */
  decided: boolean;
  /** Within activation_days of signing up; null when it can't be measured. */
  activated: boolean | null;
}

/**
 * The accounts that signed up in one week on their own, and how many got to each step within
 * activation_days. Survey steps count the account's own surveys, whoever took them. Steps are null
 * for weeks before review decisions were recorded.
 */
export interface ActivationWeek {
  week: string; // Monday, ISO date
  signups: number;
  /** Joined through an invitation: counted apart, they came to review. */
  invited: number;
  measured: boolean;
  /** Everyone in it has had their activation_days. */
  complete: boolean;
  connected_kobo: number | null;
  added_survey: number | null;
  pulled: number | null;
  checks_on: number | null;
  decided: number | null;
  /** A survey pulled, with a check on and a review decision. */
  activated: number | null;
}

/** Signups of the last 12 weeks from one source, and how far they got. */
export interface SourceFunnel {
  source: string;
  signups: number;
  connected_kobo: number;
  pulled: number;
  checks_on: number;
  decided: number;
  /** Signups late enough for activation to be measured, and how many of them activated. */
  activation_measured: number;
  activated: number;
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
  /** The first review decision recorded: activation is measured from its week. */
  review_tracking_since: string | null;
  totals: { users: number; kobo_connected: number; surveys: number; submissions: number };
  last_7_days: UsagePeriod;
  last_30_days: UsageLast30;
  ai_budget: AIBudget;
  weekly: UsageWeek[];
  funnel: { step: string; users: number }[];
  activation_days: number;
  activation: ActivationWeek[];
  signup_funnel_by_source: SourceFunnel[];
  recent_signups: RecentSignup[];
}

export const getUsage = () => request<Usage>('/api/admin/usage');
