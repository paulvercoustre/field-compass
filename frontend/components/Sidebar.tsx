import React, { useState, useRef, useEffect } from 'react';
import { useSurvey } from '../contexts/SurveyContext';
import { useActivity } from '../contexts/ActivityContext';
import { forgetSurveyId } from '../utils/selectedSurveyStorage';
import { LogoTile } from './ui/Logo';
import { ChevronUpDownIcon, LogoutIcon, PlusIcon, SidebarIcon, UserCogIcon } from './ui/icons';

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

const PermissionBadge: React.FC<{ permission?: string }> = ({ permission }) => {
  if (!permission || permission === 'owner' || permission === 'admin') return null;
  
  const colors = permission === 'editor'
    ? 'bg-sky-50 text-sky-700 ring-sky-600/15 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/20'
    : 'bg-gray-100 text-gray-600 ring-gray-500/15 dark:bg-gray-700/50 dark:text-gray-300 dark:ring-gray-400/20';
  
  return (
    <span className={`ml-auto flex-shrink-0 rounded px-1.5 py-px text-xs font-medium ring-1 ring-inset ${colors}`}>
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
  isUserSettingsActive = false,
  isOpen = true,
  onToggle
}) => {
  const { surveys, selectedSurvey, isLoading, setSelectedSurvey } = useSurvey();
  const { isSurveyBusy } = useActivity();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsUserMenuOpen(false);
    };
    if (isUserMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isUserMenuOpen]);

  const handleSurveyClick = (surveyId: string) => {
    const survey = surveys.find(s => s.survey_id === surveyId);
    if (survey) {
      setSelectedSurvey(survey);
      onSurveySelect(surveyId);
    }
  };

  const iconButtonClass = "inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-500 hover:bg-gray-200/70 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white transition-colors";
  const rowClass = "flex w-full items-center gap-2.5 rounded-md text-sm transition-colors";
  const initial = (user?.username?.charAt(0) || user?.email?.charAt(0) || '?').toUpperCase();

  return (
    <aside className={`${isOpen ? 'w-60' : 'w-14'} bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col flex-shrink-0 h-screen transition-[width] duration-200`}>
      {/* Brand and toggle (just the toggle when collapsed) */}
      <div className={`flex h-12 flex-shrink-0 items-center ${isOpen ? 'justify-between pl-4 pr-2.5' : 'justify-center'}`}>
        {isOpen && (
          <div className="flex min-w-0 items-center gap-2.5">
            <LogoTile />
            <span className="truncate text-sm font-semibold tracking-tight text-gray-900 dark:text-white">Field Compass</span>
          </div>
        )}
        {onToggle && (
          <button
            onClick={onToggle}
            className={iconButtonClass}
            title={isOpen ? "Collapse sidebar" : "Expand sidebar"}
            aria-label={isOpen ? "Collapse sidebar" : "Expand sidebar"}
          >
            <SidebarIcon />
          </button>
        )}
      </div>

      {/* New survey button - always visible */}
      <div className={isOpen ? "px-2.5 pt-1" : "flex justify-center px-2 pt-1"}>
        <button
          onClick={() => {
            // Clear the selection on the way in. Leaving a survey highlighted
            // here while "Create New Survey" fills the pane suggests the form
            // is editing that survey, and the first thing it asks for is a
            // name.
            setSelectedSurvey(null);
            forgetSurveyId();
            onAddSurvey();
          }}
          className={isOpen
            ? `${rowClass} h-8 px-2 font-medium text-gray-700 hover:bg-gray-200/60 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white`
            : iconButtonClass}
          title="New survey"
          aria-label="New survey"
        >
          <span className={`flex flex-shrink-0 items-center justify-center rounded-md ${isOpen ? 'h-5 w-5 border border-gray-300 bg-white text-gray-600 shadow-xs dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300' : ''}`}>
            <PlusIcon className={isOpen ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
          </span>
          {isOpen && <span>New survey</span>}
        </button>
      </div>

      {/* Spacer when collapsed - pushes user to bottom */}
      {!isOpen && <div className="flex-1" />}

      {/* Survey List - only when expanded */}
      {isOpen && (
        <div className="flex-1 overflow-y-auto min-h-0">
          {isLoading ? (
            <div className="px-5 py-4 text-sm text-gray-500 dark:text-gray-400">Loading…</div>
          ) : (
            <div className="px-2.5 pb-3 pt-4">
              <div className="px-2 pb-1 text-sm font-medium text-gray-500 dark:text-gray-400">
                Surveys
              </div>
              {surveys.length === 0 ? (
                <div className="px-2 py-1.5 text-sm text-gray-500 dark:text-gray-400">
                  No surveys yet.
                </div>
              ) : (
                <div className="space-y-px">
                  {surveys.map((survey) => {
                    const isSelected = selectedSurvey?.survey_id === survey.survey_id;
                    return (
                      <button
                        key={survey.survey_id}
                        onClick={() => handleSurveyClick(survey.survey_id)}
                        aria-current={isSelected ? 'true' : undefined}
                        className={`w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors ${
                          isSelected
                            ? 'bg-white text-gray-900 shadow-xs ring-1 ring-gray-200 dark:bg-gray-800 dark:text-white dark:ring-gray-700'
                            : 'text-gray-600 hover:bg-gray-200/60 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800/70 dark:hover:text-white'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{survey.survey_name}</span>
                          {isSurveyBusy(survey.survey_id) && (
                            <span className="relative flex h-2 w-2 flex-shrink-0" title="Pulling or checking" aria-label="Pulling or checking">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-60" />
                              <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-500" />
                            </span>
                          )}
                          <PermissionBadge permission={survey.permission} />
                        </div>
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
        <div ref={userMenuRef} className={`relative border-t border-gray-200 dark:border-gray-800 ${isOpen ? 'p-2.5' : 'p-2 flex flex-col items-center'}`}>
          {/* User popup - appears above the user section */}
          {isUserMenuOpen && (
            <div
              role="menu"
              className={`absolute bottom-full mb-1.5 p-1 bg-white dark:bg-gray-900 rounded-lg shadow-popover ring-1 ring-gray-200 dark:ring-gray-800 z-50 min-w-[14rem] animate-fade-in ${
                isOpen ? 'left-2.5 right-2.5' : 'left-3'
              }`}
            >
              <div className="px-2.5 pb-2 pt-1.5">
                <div className="truncate text-sm font-medium text-gray-900 dark:text-white">{user.username || 'Account'}</div>
                <div className="truncate text-xs text-gray-500 dark:text-gray-400">{user.email}</div>
              </div>
              <div className="my-1 h-px bg-gray-100 dark:bg-gray-800" />
              <button
                role="menuitem"
                onClick={() => {
                  onUserSettings?.();
                  setIsUserMenuOpen(false);
                }}
                className={`${rowClass} h-8 px-2.5 text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800`}
              >
                <UserCogIcon className="w-4 h-4 text-gray-400" />
                <span>Account settings</span>
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  onLogout?.();
                  setIsUserMenuOpen(false);
                }}
                className={`${rowClass} h-8 px-2.5 text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800`}
              >
                <LogoutIcon className="w-4 h-4 text-gray-400" />
                <span>Log out</span>
              </button>
            </div>
          )}

          {/* User button - click toggles popup */}
          <button
            onClick={() => setIsUserMenuOpen(prev => !prev)}
            aria-haspopup="menu"
            aria-expanded={isUserMenuOpen}
            className={`flex items-center rounded-md text-sm transition-colors ${
              isUserSettingsActive || isUserMenuOpen ? 'bg-gray-200/60 dark:bg-gray-800' : 'hover:bg-gray-200/60 dark:hover:bg-gray-800'
            } ${isOpen ? 'w-full gap-2.5 px-2 py-1.5' : 'p-1'}`}
            title={user.email}
          >
            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-violet-600 text-xs font-semibold text-white">
              {initial}
            </div>
            {isOpen && (
              <>
                <div className="flex-1 min-w-0 text-left">
                  <div className="truncate font-medium text-gray-900 dark:text-white">{user.username || 'Account'}</div>
                  <div className="truncate text-xs text-gray-500 dark:text-gray-400">{user.email}</div>
                </div>
                <ChevronUpDownIcon className="w-4 h-4 flex-shrink-0 text-gray-400" />
              </>
            )}
          </button>
        </div>
      )}
    </aside>
  );
};

export default Sidebar;


