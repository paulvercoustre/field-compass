import React, { useState, useRef, useEffect } from 'react';
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
  isOpen?: boolean;
  onToggle?: () => void;
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

const SidebarToggleIcon: React.FC<{ className?: string }> = ({ className = "w-5 h-5" }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <rect x="2" y="4" width="20" height="16" rx="1" strokeWidth="2" />
    <line x1="8" y1="4" x2="8" y2="20" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const Sidebar: React.FC<SidebarProps> = ({ 
  onAddSurvey, 
  onSurveySelect,
  user,
  onUserSettings,
  onLogout,
  isUserSettingsActive = false,
  isOpen = true,
  onToggle
}) => {
  const { surveys, selectedSurvey, isLoading, setSelectedSurvey } = useSurvey();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };
    if (isUserMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isUserMenuOpen]);

  const handleSurveyClick = (surveyId: string) => {
    const survey = surveys.find(s => s.survey_id === surveyId);
    if (survey) {
      setSelectedSurvey(survey);
      onSurveySelect(surveyId);
    }
  };

  const iconButtonClass = "p-2 rounded-md text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center justify-center";

  return (
    <aside className={`${isOpen ? 'w-64' : 'w-14'} bg-gray-50 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col flex-shrink-0 h-screen transition-[width] duration-200`}>
      {/* App title and toggle (or just toggle when collapsed) */}
      <div className={`p-4 flex items-center ${isOpen ? 'justify-between gap-2 mb-1' : 'justify-center'}`}>
        {isOpen && <h1 className="text-lg font-bold text-gray-900 dark:text-white">Field Compass</h1>}
        {onToggle && (
          <button
            onClick={onToggle}
            className={`${iconButtonClass} flex-shrink-0`}
            title={isOpen ? "Collapse sidebar" : "Expand sidebar"}
            aria-label={isOpen ? "Collapse sidebar" : "Expand sidebar"}
          >
            <SidebarToggleIcon className={isOpen ? "w-5 h-5" : "w-5 h-5"} />
          </button>
        )}
      </div>

      {/* New survey button - always visible */}
      <div className={isOpen ? "px-2" : "px-2 flex justify-center"}>
        <button
          onClick={onAddSurvey}
          className={`flex items-center gap-3 rounded-lg text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${isOpen ? 'w-full px-3 py-2 mb-1' : 'p-2'}`}
          title="New survey"
        >
          <span className="flex-shrink-0 w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-600 flex items-center justify-center">
            <svg className="w-3.5 h-3.5 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </span>
          {isOpen && <span className="font-medium">New survey</span>}
        </button>
      </div>

      {/* Spacer when collapsed - pushes user to bottom */}
      {!isOpen && <div className="flex-1" />}

      {/* Survey List - only when expanded */}
      {isOpen && (
        <div className="flex-1 overflow-y-auto min-h-0">
          {isLoading ? (
            <div className="p-4 text-center text-gray-600 dark:text-gray-400">Loading...</div>
          ) : (
            <div className="p-2">
              <div className="px-3 py-2 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                Surveys
              </div>
              {surveys.length === 0 ? (
                <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                  No surveys yet.
                </div>
              ) : (
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
              )}
            </div>
          )}
        </div>
      )}

      {/* User Menu - Bottom of Sidebar with popup */}
      {user && (
        <div ref={userMenuRef} className={`relative border-t border-gray-200 dark:border-gray-700 ${isOpen ? 'p-3' : 'p-2 flex flex-col items-center'}`}>
          {/* User popup - appears above the user section */}
          {isUserMenuOpen && (
            <div
              className={`absolute bottom-full mb-1 py-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50 min-w-[14rem] ${
                isOpen ? 'left-2 right-2 w-[calc(100%-1rem)]' : 'left-3'
              }`}
            >
              <button
                onClick={() => {
                  onUserSettings?.();
                  setIsUserMenuOpen(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
              >
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span>Account Settings</span>
              </button>
              <button
                onClick={() => {
                  onLogout?.();
                  setIsUserMenuOpen(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
              >
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                <span>Logout</span>
              </button>
            </div>
          )}

          {/* User button - click toggles popup */}
          <button
            onClick={() => setIsUserMenuOpen(prev => !prev)}
            className={`flex items-center rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
              isOpen ? 'w-full gap-3 px-3 py-2.5' : 'p-2'
            }`}
            title={user.email}
          >
            <div className="w-8 h-8 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center text-gray-700 dark:text-gray-300 text-sm font-bold flex-shrink-0">
              {user.username?.charAt(0).toUpperCase() || user.email?.charAt(0).toUpperCase()}
            </div>
            {isOpen && (
              <div className="flex-1 text-left truncate">
                <div className="truncate">{user.username || 'Account'}</div>
                <div className="text-xs opacity-60 truncate">{user.email}</div>
              </div>
            )}
          </button>
        </div>
      )}
    </aside>
  );
};

export default Sidebar;


