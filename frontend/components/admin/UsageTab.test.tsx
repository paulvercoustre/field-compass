import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as adminApi from '../../services/adminApi';
import UsageTab from './UsageTab';

vi.mock('../../services/adminApi', () => ({ getUsage: vi.fn() }));

const period = {
  signups: 3,
  active_users: 2,
  logins: 4,
  surveys_created: 1,
  pulls: 5,
  invites_sent: 6,
  invites_accepted: 2,
  active_surveys: 3,
};

const usage: adminApi.Usage = {
  generated_at: '2026-10-19T10:00:00Z',
  tracking_since: '2026-09-01T00:00:00Z',
  review_tracking_since: '2026-10-26T09:00:00Z',
  totals: { users: 10, kobo_connected: 6, surveys: 4, submissions: 1200 },
  last_7_days: period,
  last_30_days: {
    ...period,
    invites_sent: 9,
    submissions_synced: 800,
    ai_reviews: 40,
    ai_cost_usd: 1.2,
    operator_ai_spend_usd: 1.2,
    translations: 0,
    transcriptions: 0,
    audio_minutes: 0,
  },
  ai_budget: {
    month: '2026-10',
    spent_usd: 120.4,
    budget_usd: 150,
    paused: false,
    resumes_at: '2026-11-01T00:00:00Z',
    unpriced: [{ model: 'gpt-9', calls: 12 }],
  },
  weekly: [],
  funnel: [
    { step: 'Signed up', users: 10 },
    { step: 'Shared a survey', users: 4 },
  ],
  activation_days: 7,
  activation: [
    {
      week: '2026-10-12',
      signups: 4,
      invited: 0,
      measured: false,
      complete: true,
      connected_kobo: null,
      added_survey: null,
      pulled: null,
      checks_on: null,
      decided: null,
      activated: null,
    },
    {
      week: '2026-10-26',
      signups: 8,
      invited: 2,
      measured: true,
      complete: false,
      connected_kobo: 6,
      added_survey: 5,
      pulled: 4,
      checks_on: 3,
      decided: 2,
      activated: 2,
    },
  ],
  signup_funnel_by_source: [
    {
      source: 'invite',
      signups: 3,
      connected_kobo: 0,
      pulled: 0,
      checks_on: 0,
      decided: 3,
      activation_measured: 0,
      activated: 0,
    },
    {
      source: 'kobo-forum',
      signups: 5,
      connected_kobo: 4,
      pulled: 3,
      checks_on: 2,
      decided: 2,
      activation_measured: 4,
      activated: 1,
    },
  ],
  recent_signups: [],
};

describe('UsageTab', () => {
  afterEach(cleanup);

  it('shows the invites sent and accepted, and who shared a survey', async () => {
    vi.mocked(adminApi.getUsage).mockResolvedValue(usage);
    const page = render(<UsageTab />);

    expect(await page.findByText('Invites sent')).toBeTruthy();
    expect(page.getByText('2 accepted · 9 sent in 30 days')).toBeTruthy();
    expect(page.getByText('Shared a survey')).toBeTruthy();
    expect(page.getByText('4 · 40%')).toBeTruthy();
    expect(page.getByText('invite')).toBeTruthy();
  });

  it('shows the North Star, and how far each source and signup week got', async () => {
    vi.mocked(adminApi.getUsage).mockResolvedValue(usage);
    const page = render(<UsageTab />);

    expect(await page.findByText('Active surveys')).toBeTruthy();
    expect(page.getByText('Pulled and reviewed · 3 in 30 days')).toBeTruthy();

    const forum = page.getByText('kobo-forum').closest('tr') as HTMLElement;
    expect(forum.textContent).toContain('1 of 4');

    const card = page.getByText('Activation by signup week').closest('div.rounded-xl') as HTMLElement;
    const [, newest, older] = Array.from(card.querySelectorAll('tr'));
    expect(newest.textContent).toContain('+2 invited');
    expect(newest.textContent).toContain('still open');
    expect(newest.textContent).toContain('2 · 25%');
    // Before review decisions were recorded: signups only
    expect(older.textContent).toContain('—');
    expect(older.textContent).not.toContain('%');
  });

  it("shows this month's AI budget, and the models it can't price", async () => {
    vi.mocked(adminApi.getUsage).mockResolvedValue(usage);
    const page = render(<UsageTab />);

    expect(await page.findByText('AI budget, October')).toBeTruthy();
    expect(page.getByText(/of \$150 · 80%/)).toBeTruthy();
    expect(page.getByRole('progressbar', { name: 'AI budget used in October' }).getAttribute('aria-valuenow')).toBe(
      '80'
    );
    expect(page.getByText(/gpt-9 \(12 calls\)/)).toBeTruthy();
  });

  it('says when the included AI is paused', async () => {
    vi.mocked(adminApi.getUsage).mockResolvedValue({
      ...usage,
      ai_budget: { ...usage.ai_budget, spent_usd: 151, paused: true, unpriced: [] },
    });
    const page = render(<UsageTab />);

    expect(await page.findByText(/Paused for everyone until (November 1|1 November)/)).toBeTruthy();
  });
});
