import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as progressApi from '../../services/progressApi';
import { DEFAULT_QUALITY_CHECKS } from '../../utils/qualityCheckSettings';
import AiReviewSection from './AiReviewSection';
import type { SectionControls } from './SectionControls';

vi.mock('../../services/progressApi', () => ({ rerunAiChecks: vi.fn() }));
vi.mock('../ai/SurveyKeyPicker', () => ({ default: () => null }));

const controls = (editing: boolean): SectionControls => ({
  editing,
  saving: false,
  edit: vi.fn(),
  save: vi.fn(),
  cancel: vi.fn(),
});

const renderSection = (editing: boolean) => {
  const props = {
    surveyId: 's1',
    isOwner: true,
    checks: { ...DEFAULT_QUALITY_CHECKS, flag_llm_qualitative: true, llm_qualitative_fields: ['comments'] },
    setChecks: vi.fn(),
    reviewableVariables: [
      { name: 'comments', label: 'Any comments?' },
      { name: 'other', label: 'Other, specify' },
    ],
    canEdit: true,
    controls: controls(editing),
    onError: vi.fn(),
    onSuccess: vi.fn(),
  };
  return { view: render(<AiReviewSection {...props} />), props };
};

describe('AiReviewSection', () => {
  afterEach(cleanup);

  it('asks for the answers to be reviewed again and says how many', async () => {
    vi.mocked(progressApi.rerunAiChecks).mockResolvedValue(42);
    const { view, props } = renderSection(false);

    fireEvent.click(view.getByRole('button', { name: 'Review all answers again' }));

    await waitFor(() =>
      expect(props.onSuccess).toHaveBeenCalledWith('42 submissions will be reviewed again on the next pull.')
    );
    expect(progressApi.rerunAiChecks).toHaveBeenCalledWith('s1');
  });

  it('only lets questions be picked while editing', () => {
    const closed = renderSection(false).view;
    expect((closed.getByRole('checkbox', { name: /Any comments/ }) as HTMLInputElement).disabled).toBe(true);
    cleanup();

    const { view, props } = renderSection(true);
    fireEvent.click(view.getByRole('checkbox', { name: /Other, specify/ }));
    expect(props.setChecks).toHaveBeenCalledWith(
      expect.objectContaining({ llm_qualitative_fields: ['comments', 'other'] })
    );
    expect(view.queryByRole('button', { name: 'Review all answers again' })).toBeNull();
  });
});
