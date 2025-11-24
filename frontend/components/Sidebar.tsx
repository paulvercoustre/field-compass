import React from 'react';
import { useSurvey } from '../contexts/SurveyContext';

interface SidebarProps {
  onAddSurvey: () => void;
  onSurveySelect: (surveyId: string | null) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ onAddSurvey, onSurveySelect }) => {
  const { surveys, selectedSurvey, isLoading, setSelectedSurvey } = useSurvey();

  const handleSurveyClick = (surveyId: string) => {
    const survey = surveys.find(s => s.survey_id === surveyId);
    if (survey) {
      setSelectedSurvey(survey);
      onSurveySelect(surveyId);
    }
  };

  return (
    <aside className="w-64 bg-gray-50 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col flex-shrink-0 h-screen">
      {/* Add Survey Button */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={onAddSurvey}
          className="w-full px-4 py-3 bg-indigo-600 text-white font-semibold rounded-md hover:bg-indigo-700 transition-colors shadow-md"
        >
          + Add Survey
        </button>
      </div>

      {/* Survey List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-4 text-center text-gray-600 dark:text-gray-400">Loading...</div>
        ) : surveys.length === 0 ? (
          <div className="p-4 text-center text-gray-500 text-sm">
            No surveys yet. Click "Add Survey" to create one.
          </div>
        ) : (
          <div className="p-2">
            <div className="px-3 py-2 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
              Surveys
            </div>
            <div className="space-y-1">
              {surveys.map((survey) => (
                <button
                  key={survey.survey_id}
                  onClick={() => handleSurveyClick(survey.survey_id)}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                    selectedSurvey?.survey_id === survey.survey_id
                      ? 'bg-indigo-600 text-white'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white'
                  }`}
                >
                  <div className="font-medium truncate">{survey.survey_name}</div>
                  {survey.kobo_asset_id && (
                    <div className="text-xs opacity-75 truncate mt-0.5">
                      {survey.kobo_asset_id}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};

export default Sidebar;

