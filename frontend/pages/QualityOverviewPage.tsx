import React from 'react';
import { FilterState } from '../types';
import { useSurvey } from '../contexts/SurveyContext';
import QualityOverviewDashboard from '../components/quality-dashboard/QualityOverviewDashboard';
import type { ReviewCount } from '../components/quality-dashboard/StatusSummaryCards';

interface QualityOverviewPageProps {
  onNavigateToSubmissions?: (filters?: FilterState) => void;
}

const QualityOverviewPage: React.FC<QualityOverviewPageProps> = ({ onNavigateToSubmissions }) => {
  const { selectedSurvey } = useSurvey();

  if (!selectedSurvey) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="text-center">
          <h2 className="text-sm font-medium text-gray-900 dark:text-white mb-1">No Survey Selected</h2>
          <p className="text-gray-500 dark:text-gray-400">
            Please select a survey from the sidebar to view quality overview.
          </p>
        </div>
      </div>
    );
  }

  // A card opens the Submissions tab of the same name; Approved and Not
  // approved share Reviewed, so they also filter to their decision.
  const handleStatusClick = (state: ReviewCount) => {
    if (!onNavigateToSubmissions) return;
    if (state === 'needs_review') onNavigateToSubmissions({ review: 'needs_review' });
    else if (state === 'on_hold') onNavigateToSubmissions({ review: 'on_hold' });
    else
      onNavigateToSubmissions({
        review: 'reviewed',
        validationStatuses: [state === 'approved' ? 'Approved' : 'Not Approved'],
      });
  };

  // An issue bar opens every submission with that issue, so the count matches the bar.
  const handleIssueClick = (check: string) => {
    onNavigateToSubmissions?.({ review: 'all', issues: [check] });
  };

  return (
    <div className="h-full overflow-auto p-6">
      <QualityOverviewDashboard
        surveyId={selectedSurvey.survey_id}
        onStatusClick={handleStatusClick}
        onIssueClick={handleIssueClick}
      />
    </div>
  );
};

export default QualityOverviewPage;
