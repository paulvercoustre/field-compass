import React from 'react';
import { useSurvey } from '../contexts/SurveyContext';
import QualityOverviewDashboard from '../components/quality-dashboard/QualityOverviewDashboard';

interface QualityOverviewPageProps {
  onNavigateToSubmissions?: (enumeratorFilter?: string) => void;
}

const QualityOverviewPage: React.FC<QualityOverviewPageProps> = ({ 
  onNavigateToSubmissions,
}) => {
  const { selectedSurvey } = useSurvey();

  if (!selectedSurvey) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300 mb-2">
            No Survey Selected
          </h2>
          <p className="text-gray-500 dark:text-gray-400">
            Please select a survey from the sidebar to view quality overview.
          </p>
        </div>
      </div>
    );
  }

  const handleStatusClick = (status: string) => {
    // For now, just navigate to submissions without specific filter
    // TODO: Could extend to filter by status
    if (onNavigateToSubmissions) {
      onNavigateToSubmissions();
    }
  };

  const handleIssueClick = (check: string) => {
    // For now, just navigate to submissions
    // TODO: Could extend to filter by issue type
    if (onNavigateToSubmissions) {
      onNavigateToSubmissions();
    }
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
