import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as progressApi from '../services/progressApi';
import type { SurveyConfig } from '../services/progressApi';
import SurveySettingsPage from './SurveySettingsPage';

vi.mock('../services/progressApi', () => ({
  getSurveyConfig: vi.fn(),
  updateSurvey: vi.fn(),
  deleteSurvey: vi.fn(),
  rerunAiChecks: vi.fn(),
  getValidationRules: vi.fn(async () => []),
  createValidationRule: vi.fn(),
  updateValidationRule: vi.fn(),
  deleteValidationRule: vi.fn(),
}));
vi.mock('../services/api', () => ({ getKoboProjectForm: vi.fn() }));
vi.mock('../contexts/SurveyContext', () => ({
  useSurvey: () => ({
    selectedSurvey: { survey_id: 's1', survey_name: 'Household 2026', kobo_asset_id: null, permission: 'owner' },
    refreshSurveys: vi.fn(),
    setSelectedSurvey: vi.fn(),
  }),
}));
// Cards that fetch their own data; not what these tests are about.
vi.mock('../components/transcription/AudioTranscriptionCard', () => ({ default: () => null }));
vi.mock('../components/translation/TranslationCard', () => ({ default: () => null }));
vi.mock('../components/ai/SurveyKeyPicker', () => ({ default: () => null }));
vi.mock('../components/linter/FormLintPanel', () => ({ default: () => null }));

const api = vi.mocked(progressApi);

const config = (survey_name: string): SurveyConfig =>
  ({
    survey_id: 's1',
    survey_name,
    kobo_asset_id: null,
    config_data: { global_parameters: {}, quality_checks: {}, core_identifiers: { uuid: '_uuid' } },
  }) as unknown as SurveyConfig;

const renderPage = async () => {
  const view = render(<SurveySettingsPage />);
  await waitFor(() => expect(view.getByDisplayValue('Household 2026')).toBeTruthy());
  return view;
};

describe('SurveySettingsPage survey profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getSurveyConfig.mockResolvedValue(config('Household 2026'));
  });
  afterEach(cleanup);

  it('saves only once the name changes, and sends the new name', async () => {
    api.updateSurvey.mockImplementation(async (_id, update) => config(update.survey_name ?? ''));
    const view = await renderPage();
    expect(view.queryByRole('button', { name: 'Save changes' })).toBeNull();

    fireEvent.change(view.getByDisplayValue('Household 2026'), { target: { value: 'Household 2026, round 2' } });
    fireEvent.click(view.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(api.updateSurvey).toHaveBeenCalled());
    expect(api.updateSurvey.mock.calls[0][1]).toMatchObject({ survey_name: 'Household 2026, round 2' });
    await waitFor(() => expect(view.queryByRole('button', { name: 'Save changes' })).toBeNull());
    expect(view.getByDisplayValue('Household 2026, round 2')).toBeTruthy();
  });

  it('cancelling puts the saved name back without saving', async () => {
    const view = await renderPage();

    fireEvent.change(view.getByDisplayValue('Household 2026'), { target: { value: 'Typo' } });
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }));

    expect(view.getByDisplayValue('Household 2026')).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Save changes' })).toBeNull();
    expect(api.updateSurvey).not.toHaveBeenCalled();
  });

  it('keeps the edit and shows the error when the save fails', async () => {
    api.updateSurvey.mockRejectedValue(new Error('Survey name already taken'));
    const view = await renderPage();

    fireEvent.change(view.getByDisplayValue('Household 2026'), { target: { value: 'Duplicate' } });
    fireEvent.click(view.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(view.getAllByText('Survey name already taken').length).toBeGreaterThan(0));
    expect(view.getByDisplayValue('Duplicate')).toBeTruthy();
    expect(view.getByRole('button', { name: 'Save changes' })).toBeTruthy();
  });
});
