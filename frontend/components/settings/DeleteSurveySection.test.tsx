import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as progressApi from '../../services/progressApi';
import DeleteSurveySection from './DeleteSurveySection';

vi.mock('../../services/progressApi', () => ({ deleteSurvey: vi.fn() }));
const api = vi.mocked(progressApi);

const open = () => {
  const onDeleted = vi.fn();
  const view = render(<DeleteSurveySection surveyId="s1" surveyName="Household 2026" onDeleted={onDeleted} />);
  fireEvent.click(view.getByRole('button', { name: 'Delete survey' }));
  const dialog = view.getByRole('dialog');
  const confirm = () => view.getAllByRole('button', { name: 'Delete survey' }).find((b) => dialog.contains(b))!;
  return { view, onDeleted, confirm };
};

describe('DeleteSurveySection', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it('deletes only once the name is typed back', async () => {
    api.deleteSurvey.mockResolvedValue(undefined as never);
    const { view, onDeleted, confirm } = open();
    expect(confirm().hasAttribute('disabled')).toBe(true);

    fireEvent.change(view.getByPlaceholderText('Survey name'), { target: { value: 'Household 2026' } });
    fireEvent.click(confirm());

    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(api.deleteSurvey).toHaveBeenCalledWith('s1');
    expect(view.queryByRole('dialog')).toBeNull();
  });

  it('keeps the dialog open with the error when the delete fails', async () => {
    api.deleteSurvey.mockRejectedValue(new Error('Only the owner can delete this survey'));
    const { view, onDeleted, confirm } = open();

    fireEvent.change(view.getByPlaceholderText('Survey name'), { target: { value: 'Household 2026' } });
    fireEvent.click(confirm());

    await waitFor(() => expect(view.getByText('Only the owner can delete this survey')).toBeTruthy());
    expect(view.getByRole('dialog')).toBeTruthy();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('cancelling forgets what was typed', () => {
    const { view } = open();
    fireEvent.change(view.getByPlaceholderText('Survey name'), { target: { value: 'House' } });
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(view.getByRole('button', { name: 'Delete survey' }));
    expect((view.getByPlaceholderText('Survey name') as HTMLInputElement).value).toBe('');
  });
});
