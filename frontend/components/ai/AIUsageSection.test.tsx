import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountAIUsage } from '../../services/aiConnectionsApi';
import AIUsageSection from './AIUsageSection';

vi.mock('./AIUsageChart', () => ({ default: () => null }));

const usage = (overrides: Partial<AccountAIUsage> = {}): AccountAIUsage => ({
  month: '2026-10',
  resets_at: '2026-11-01T00:00:00Z',
  included: {
    reviews_per_month: 200,
    translations_per_month: 500,
    transcription_minutes_per_month: 120,
    rule_requests_per_month: 30,
  },
  included_usage: {
    reviews: { limit: 200, used: 42, in_flight: 3, remaining: 155 },
    translations: { limit: 500, used: 10, in_flight: 0, remaining: 490 },
    transcription: null,
  },
  rule_requests_this_month: { limit: 30, used: 2, remaining: 28 },
  surveys: [
    {
      survey_id: 's1',
      survey_name: 'Household',
      provider: null,
      reviews: 30,
      transcription: null,
      translation: { provider: null, translations: 10 },
      by_feature: [],
    },
    {
      survey_id: 's2',
      survey_name: 'Market',
      provider: {
        connection_id: 'c1',
        label: 'My OpenAI',
        preset: 'openai',
        check_model: 'gpt-5-mini',
        status: 'ok',
      } as never,
      reviews: 12,
      transcription: null,
      translation: null,
      by_feature: [],
    },
  ],
  ...overrides,
});

describe('AIUsageSection', () => {
  afterEach(cleanup);

  it('shows one shared meter per feature, and each survey on the included usage or its own key', () => {
    const view = render(<AIUsageSection usage={usage()} error={null} />);

    expect(view.getByText(/shared by all your surveys/)).toBeTruthy();
    expect(
      view.getByRole('progressbar', { name: 'Included AI reviews used in October' }).getAttribute('aria-valuenow')
    ).toBe('45');
    expect(view.getByRole('progressbar', { name: 'Included translations used in October' })).toBeTruthy();
    expect(view.queryByRole('progressbar', { name: /transcription minutes/ })).toBeNull();

    expect(view.getByText('30 reviewed')).toBeTruthy();
    expect(view.getAllByText('included usage').length).toBe(2); // Household's reviews and translations
    expect(view.getByText('12 reviewed')).toBeTruthy();
    expect(view.getByText('on My OpenAI · no limit')).toBeTruthy();
  });

  it('shows no shared meters when this server includes nothing', () => {
    const view = render(
      <AIUsageSection
        usage={usage({ included_usage: { reviews: null, translations: null, transcription: null } })}
        error={null}
      />
    );
    expect(view.queryByText(/shared by all your surveys/)).toBeNull();
    // Household has neither included usage nor a key, for reviews or translations.
    expect(view.getAllByText('None').length).toBe(2);
  });
});
