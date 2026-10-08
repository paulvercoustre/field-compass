import React, { useEffect, useRef } from 'react';
import { Submission } from '../types';
import { SurveyConfig } from '../services/progressApi';
import SubmissionListItem from './SubmissionListItem';

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
}

const SubmissionList: React.FC<SubmissionListProps> = ({
  submissions,
  onSelect,
  selectedSubmissionId,
  surveyConfig,
  showStatus,
  summary,
  empty,
}) => {
  const listRef = useRef<HTMLUListElement>(null);

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
          <ul ref={listRef} aria-label="Submissions">
            {submissions.map((submission) => (
              <li key={submission._id} data-submission-id={submission._id}>
                <SubmissionListItem
                  submission={submission}
                  onSelect={onSelect}
                  isSelected={submission._id === selectedSubmissionId}
                  surveyConfig={surveyConfig}
                  showStatus={showStatus}
                />
              </li>
            ))}
          </ul>
        ) : (
          empty
        )}
      </div>
    </div>
  );
};

export default SubmissionList;
