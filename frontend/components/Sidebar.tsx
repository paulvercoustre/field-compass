import React from 'react';
import { useSurvey } from '../contexts/SurveyContext';

interface User {
  username: string;
  email: string;
}

interface SidebarProps {
  onAddSurvey: () => void;
  onSurveySelect: (surveyId: string | null) => void;
  user?: User | null;
  onUserSettings?: () => void;
  onLogout?: () => void;
  isUserSettingsActive?: boolean;
}

const PermissionBadge: React.FC<{ permission?: string; isSelected?: boolean }> = ({ permission, isSelected }) => {
  if (!permission || permission === 'owner' || permission === 'admin') return null;
  
  const colors = isSelected
    ? 'bg-white/20 text-white'
    : permission === 'editor'
      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
      : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400';
  
  return (
    <span className={`ml-2 px-1.5 py-0.5 text-[10px] font-medium rounded ${colors}`}>
      {permission === 'editor' ? 'Editor' : 'Viewer'}
    </span>
  );
};

const Sidebar: React.FC<SidebarProps> = ({ 
  onAddSurvey, 
  onSurveySelect,
  user,
  onUserSettings,
  onLogout,
  isUserSettingsActive = false
}) => {
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
              {surveys.map((survey) => {
                const isSelected = selectedSurvey?.survey_id === survey.survey_id;
                
                return (
                  <button
                    key={survey.survey_id}
                    onClick={() => handleSurveyClick(survey.survey_id)}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                      isSelected
                        ? 'bg-indigo-600 text-white'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white'
                    }`}
                  >
                    <div className="flex items-center">
                      <span className="font-medium truncate">{survey.survey_name}</span>
                      <PermissionBadge permission={survey.permission} isSelected={isSelected} />
                    </div>
                    {survey.kobo_asset_id && (
                      <div className="text-xs opacity-75 truncate mt-0.5">
                        {survey.kobo_asset_id}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* User Menu - Bottom of Sidebar */}
      {user && (
        <div className="border-t border-gray-200 dark:border-gray-700 p-3">
          <button
            onClick={onUserSettings}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              isUserSettingsActive
                ? 'bg-indigo-600 text-white'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
            title={user.email}
          >
            <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
              {user.username?.charAt(0).toUpperCase() || user.email?.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 text-left truncate">
              <div className="truncate">{user.username || 'Account'}</div>
              <div className="text-xs opacity-60 truncate">{user.email}</div>
            </div>
          </button>
          <button
            onClick={onLogout}
            className="w-full mt-2 flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span>Sign out</span>
          </button>
        </div>
      )}
    </aside>
  );
};

export default Sidebar;


