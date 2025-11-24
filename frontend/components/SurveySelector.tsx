import React from 'react';
import { useSurvey } from '../contexts/SurveyContext';
import { Spinner } from './Spinner';

const SurveySelector: React.FC = () => {
  const { selectedSurvey, surveys, isLoading, error, setSelectedSurvey } = useSurvey();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <Spinner />
        <span className="text-sm text-gray-600 dark:text-gray-400">Loading surveys...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-red-600 dark:text-red-400">
        Error loading surveys
      </div>
    );
  }

  if (surveys.length === 0) {
    return (
      <div className="text-sm text-yellow-600 dark:text-yellow-400">
        No surveys available
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="survey-select" className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
        Survey:
      </label>
      <select
        id="survey-select"
        value={selectedSurvey?.survey_id || ''}
        onChange={(e) => {
          if (e.target.value === '') {
            setSelectedSurvey(null);
          } else {
            const survey = surveys.find(s => s.survey_id === e.target.value);
            setSelectedSurvey(survey || null);
          }
        }}
        className="px-3 py-1.5 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
      >
        <option value="">-- Create New Survey --</option>
        {surveys.map((survey) => (
          <option key={survey.survey_id} value={survey.survey_id}>
            {survey.survey_name}
          </option>
        ))}
      </select>
    </div>
  );
};

export default SurveySelector;

