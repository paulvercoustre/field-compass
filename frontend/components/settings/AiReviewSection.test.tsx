import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as progressApi from '../../services/progressApi';
import { DEFAULT_QUALITY_CHECKS } from '../../utils/qualityCheckSettings';
import AiReviewSection from './AiReviewSection';
import type { SectionControls } from './SectionControls';

vi.mock('../../services/progressApi', () => ({ rerunAiChecks: vi.fn() }));
vi.mock('../ai/SurveyKeyPicker', () => ({ default: () => null }));

const controls = (dirty: boolean): SectionControls => ({
  dirty,
  saving: false,
  save: vi.fn(),
  cancel: vi.fn(),
});

const renderSection = ({ canEdit = true, dirty = false } = {}) => {
  const props = {
    surveyId: 's1',
    isOwner: true,
    checks: { ...DEFAULT_QUALITY_CHECKS, flag_llm_qualitative: true, llm_qualitative_fields: ['comments'] },
    setChecks: vi.fn(),
    reviewableVariables: [
      { name: 'comments', label: 'Any comments?' },
      { name: 'other', label: 'Other, specify' },
    ],
    canEdit,
    controls: controls(dirty),
    onError: vi.fn(),
    onSuccess: vi.fn(),
  };
  return { view: render(<AiReviewSection {...props} />), props };
};

describe('AiReviewSection', () => {
  afterEach(cleanup);

  it('asks for the answers to be reviewed again and says how many', async () => {
    vi.mocked(progressApi.rerunAiChecks).mockResolvedValue(42);
    const { view, props } = renderSection();

    fireEvent.click(view.getByRole('button', { name: 'Review all answers again' }));

    await waitFor(() =>
      expect(props.onSuccess).toHaveBeenCalledWith('42 submissions will be reviewed again on the next pull.')
    );
    expect(progressApi.rerunAiChecks).toHaveBeenCalledWith('s1');
  });

  it('lets editors pick questions straight away, and viewers only read them', () => {
    const viewer = renderSection({ canEdit: false }).view;
    expect((viewer.getByRole('checkbox', { name: /Any comments/ }) as HTMLInputElement).disabled).toBe(true);
    cleanup();

    const { view, props } = renderSection();
    fireEvent.click(view.getByRole('checkbox', { name: /Other, specify/ }));
    expect(props.setChecks).toHaveBeenCalledWith(
      expect.objectContaining({ llm_qualitative_fields: ['comments', 'other'] })
    );
  });

  it('offers to review again only what is saved', () => {
    const { view } = renderSection({ dirty: true });
    expect(view.getByRole('button', { name: 'Save changes' })).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Review all answers again' })).toBeNull();
  });
});
