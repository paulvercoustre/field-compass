import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { Submission } from '../types';
import { SurveyConfig } from '../services/progressApi';
import { EASE_OUT, play } from '../utils/motion';
import SubmissionListItem from './SubmissionListItem';

// How long a decided row takes to fold away, at the end of the pause that shows the decision.
export const TUCK_MS = 200;
const GLIDE = `transform 180ms ${EASE_OUT}, height 180ms ${EASE_OUT}`;

interface SubmissionListProps {
  submissions: Submission[];
  onSelect: (id: number) => void;
  selectedSubmissionId: number | null;
  surveyConfig: SurveyConfig | null;
  /** Show each row's review status; pointless in Needs review, where none has one. */
  showStatus: boolean;
  /** A line above the rows: the count, and anything to do with the list as a whole. */
  summary?: React.ReactNode;
  /** What to say when there are no rows. */
  empty: React.ReactNode;
  /** A decided row about to leave the list: it folds away, in its decision's colour. */
  leavingId?: number | null;
}

const SubmissionList: React.FC<SubmissionListProps> = ({
  submissions,
  onSelect,
  selectedSubmissionId,
  surveyConfig,
  showStatus,
  summary,
  empty,
  leavingId = null,
}) => {
  const listRef = useRef<HTMLUListElement>(null);
  const markerRef = useRef<HTMLDivElement>(null);
  const markedId = useRef<number | null>(null);

  // One marker for the selected row, which glides from row to row rather
  // than jumping, so the eye follows the move. It appears in place when
  // there was no row to glide from.
  const placeMarker = useCallback((id: number | null, glide: boolean) => {
    const marker = markerRef.current;
    const row = id === null ? null : listRef.current?.querySelector<HTMLElement>(`[data-submission-id="${id}"]`);
    if (!marker || !row) {
      if (marker) marker.style.opacity = '0';
      markedId.current = null;
      return;
    }
    marker.style.transition = glide ? GLIDE : 'none';
    marker.style.transform = `translateY(${row.offsetTop}px)`;
    marker.style.height = `${row.offsetHeight}px`;
    marker.style.opacity = '1';
    markedId.current = id;
  }, []);

  useLayoutEffect(() => {
    placeMarker(selectedSubmissionId, markedId.current !== null && markedId.current !== selectedSubmissionId);
  }, [selectedSubmissionId, submissions, placeMarker]);

  // Rows take their height from the list's width, and have none while the
  // list is hidden (the focus layout, or a phone showing the submission).
  const hasRows = submissions.length > 0;
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === 'undefined') return;
    let width = list.offsetWidth;
    const observer = new ResizeObserver(() => {
      if (list.offsetWidth === width) return;
      width = list.offsetWidth;
      placeMarker(markedId.current, false);
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [hasRows, placeMarker]);

  useLayoutEffect(() => {
    if (leavingId === null) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-submission-id="${leavingId}"]`);
    const fold = play(
      row,
      [
        { height: `${row?.offsetHeight ?? 0}px`, opacity: 1 },
        { height: '0px', opacity: 0 },
      ],
      { duration: TUCK_MS, easing: 'ease-in', fill: 'forwards' }
    );
    // Kept after all (undone, or decided again): the row comes back.
    return () => fold?.cancel();
  }, [leavingId]);

  // Moving with the keyboard keeps the selected row in view.
  useEffect(() => {
    if (selectedSubmissionId === null) return;
    listRef.current
      ?.querySelector(`[data-submission-id="${selectedSubmissionId}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedSubmissionId]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {summary}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {submissions.length > 0 ? (
          <div className="relative">
            <div
              ref={markerRef}
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 bg-indigo-50/70 opacity-0 dark:bg-indigo-500/10"
            >
              <span className="absolute inset-y-0 left-0 w-0.5 bg-indigo-600 dark:bg-indigo-400" />
            </div>
            <ul ref={listRef} aria-label="Submissions">
              {submissions.map((submission) => (
                <li key={submission._id} data-submission-id={submission._id} className="overflow-hidden">
                  <SubmissionListItem
                    submission={submission}
                    onSelect={onSelect}
                    isSelected={submission._id === selectedSubmissionId}
                    leaving={submission._id === leavingId}
                    surveyConfig={surveyConfig}
                    showStatus={showStatus}
                  />
                </li>
              ))}
            </ul>
          </div>
        ) : (
          empty
        )}
      </div>
    </div>
  );
};

export default SubmissionList;
