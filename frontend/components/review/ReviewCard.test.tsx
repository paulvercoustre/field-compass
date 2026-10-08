import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import ReviewCard from './ReviewCard';
import { Finding } from '../../utils/findings';

const finding: Finding = { key: 'k', check: 'duration_too_short', title: 'Interview too short', source: 'Check' };

const card = (submissionId: number, status: string | null) => (
  <ReviewCard
    submissionId={submissionId}
    status={status}
    findings={[finding]}
    passed={3}
    allChecksOpen={false}
    onToggleAllChecks={() => undefined}
    canEdit
    shortcuts
    note=""
    onNoteChange={() => undefined}
    savedNote=""
    saving={null}
    error={null}
    onDecide={() => undefined}
    onSaveNote={() => undefined}
  />
);

describe('ReviewCard after a decision', () => {
  afterEach(cleanup);

  it('changes only the button when the decision is made here', () => {
    const view = render(card(1, null));
    const before = view.getByRole('heading').textContent;
    view.rerender(card(1, 'Approved'));
    expect(view.getByRole('heading').textContent).toBe(before);
    expect(view.getByRole('button', { name: /^Approved/ }).getAttribute('aria-pressed')).toBe('true');
    expect(view.queryByText(/in Kobo/)).toBeNull();
  });

  it('says where a submission stands when it arrives decided', () => {
    const view = render(card(1, null));
    view.rerender(card(2, 'On Hold'));
    expect(view.container.textContent).toContain('Marked on hold in Kobo.');
    view.rerender(card(2, 'Approved'));
    expect(view.container.textContent).toContain('Marked approved in Kobo.');
  });
});
