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
};

const usage: adminApi.Usage = {
  generated_at: '2026-10-19T10:00:00Z',
  tracking_since: '2026-09-01T00:00:00Z',
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
  weekly: [],
  funnel: [
    { step: 'Signed up', users: 10 },
    { step: 'Shared a survey', users: 4 },
  ],
  signup_sources_30_days: [{ source: 'invite', signups: 3 }],
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
});
