import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as progressApi from '../../services/progressApi';
import { ApiError } from '../../services/apiBase';
import SurveyAccessTab from './SurveyAccessTab';

vi.mock('../../services/progressApi', () => ({
  getSurveyAccess: vi.fn(),
  shareSurvey: vi.fn(),
  updateSurveyAccess: vi.fn(),
  revokeSurveyAccess: vi.fn(),
}));

const api = vi.mocked(progressApi);

const entry = (user_id: string, email: string, permission_level: 'owner' | 'editor' | 'viewer') => ({
  user_id,
  email,
  username: email.split('@')[0],
  full_name: null,
  permission_level,
  granted_at: '2026-01-01T00:00:00Z',
});

const renderTab = () => {
  const onError = vi.fn();
  const onSuccess = vi.fn();
  const view = render(<SurveyAccessTab surveyId="s1" onError={onError} onSuccess={onSuccess} />);
  return { view, onError, onSuccess };
};

describe('SurveyAccessTab', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.getSurveyAccess.mockResolvedValue([entry('u1', 'owner@x.org', 'owner'), entry('u2', 'ana@x.org', 'viewer')]);
  });
  afterEach(cleanup);

  it('shares the survey and shows the list again', async () => {
    api.shareSurvey.mockResolvedValue(entry('u3', 'ben@x.org', 'editor'));
    const { view, onSuccess } = renderTab();
    await waitFor(() => expect(view.getByText('ana@x.org')).toBeTruthy());

    fireEvent.change(view.getByPlaceholderText('user@example.com'), { target: { value: ' ben@x.org ' } });
    fireEvent.change(view.getAllByRole('combobox').at(-1)!, { target: { value: 'editor' } });
    fireEvent.click(view.getByRole('button', { name: 'Share' }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('Survey shared with ben@x.org'));
    expect(api.shareSurvey).toHaveBeenCalledWith('s1', 'ben@x.org', 'editor');
    expect(api.getSurveyAccess).toHaveBeenCalledTimes(2);
    expect((view.getByPlaceholderText('user@example.com') as HTMLInputElement).value).toBe('');
  });

  it('revokes access once confirmed', async () => {
    api.revokeSurveyAccess.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { view } = renderTab();
    await waitFor(() => expect(view.getByText('ana@x.org')).toBeTruthy());

    fireEvent.click(view.getByTitle('Revoke access'));

    await waitFor(() => expect(api.revokeSurveyAccess).toHaveBeenCalledWith('s1', 'u2'));
    await waitFor(() => expect(api.getSurveyAccess).toHaveBeenCalledTimes(2));
  });

  it('reports a failed share without clearing the address', async () => {
    api.shareSurvey.mockRejectedValue(new ApiError('No user with that email', 404, null));
    const { view, onError, onSuccess } = renderTab();
    await waitFor(() => expect(view.getByText('ana@x.org')).toBeTruthy());

    fireEvent.change(view.getByPlaceholderText('user@example.com'), { target: { value: 'nobody@x.org' } });
    fireEvent.click(view.getByRole('button', { name: 'Share' }));

    await waitFor(() => expect(onError).toHaveBeenCalledWith('No user with that email'));
    expect(onSuccess).not.toHaveBeenCalled();
    expect((view.getByPlaceholderText('user@example.com') as HTMLInputElement).value).toBe('nobody@x.org');
  });

  it('tells someone who is not the owner that they cannot manage access', async () => {
    api.getSurveyAccess.mockRejectedValue(new ApiError('This action requires owner access or higher', 403, null));
    const { view } = renderTab();

    await waitFor(() => expect(view.getByText('Only the survey owner can manage access permissions.')).toBeTruthy());
    expect(view.queryByRole('button', { name: 'Share' })).toBeNull();
  });
});
