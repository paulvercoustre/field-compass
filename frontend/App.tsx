import React, { useState, useEffect } from 'react';
import { SurveyProvider } from './contexts/SurveyContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { FilterState } from './types';
import Dashboard from './components/Dashboard';
import DataCollectionProgressPage from './pages/DataCollectionProgressPage';
import EnumeratorPerformancePage from './pages/EnumeratorPerformancePage';
import QualityOverviewPage from './pages/QualityOverviewPage';
import CreateSurveyPage from './pages/CreateSurveyPage';
import SurveySettingsPage from './pages/SurveySettingsPage';
import UserSettingsPage from './pages/UserSettingsPage';
import LoginPage from './pages/LoginPage';
import Sidebar from './components/Sidebar';

type View = 'dashboard' | 'dataCollectionProgress' | 'enumeratorPerformance' | 'qualityOverview' | 'createSurvey' | 'settings' | 'userSettings';

// Main app content (authenticated)
const AppContent: React.FC = () => {
  const { user, isLoading, logout } = useAuth();
  
  // Load view from localStorage on mount, default to 'dashboard' if not found
  const [view, setView] = useState<View>(() => {
    const savedView = localStorage.getItem('currentView');
    return (savedView as View) || 'dashboard';
  });
  
  const [dashboardFilters, setDashboardFilters] = useState<FilterState>({});

  // Save current view to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('currentView', view);
  }, [view]);

  // Listen for navigation events from CreateSurveyPage
  useEffect(() => {
    const handleNavigateToSettings = () => {
      setView('settings');
    };

    const handleNavigateToDashboard = () => {
      setView('dashboard');
    };

    window.addEventListener('navigateToSettings', handleNavigateToSettings);
    window.addEventListener('navigateToDashboard', handleNavigateToDashboard);
    return () => {
      window.removeEventListener('navigateToSettings', handleNavigateToSettings);
      window.removeEventListener('navigateToDashboard', handleNavigateToDashboard);
    };
  }, []);

  // Show loading state while checking auth
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  // Show login page if not authenticated
  if (!user) {
    return <LoginPage onLoginSuccess={() => setView('dashboard')} />;
  }

  const NavButton: React.FC<{ currentView: View; targetView: View; onClick: () => void; children: React.ReactNode }> = ({
    currentView,
    targetView,
    onClick,
    children,
  }) => {
    const isActive = currentView === targetView;
    const classes = `px-3 py-2 text-sm font-medium rounded-md transition-colors ${
      isActive
        ? 'bg-indigo-600 text-white'
        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white'
    }`;
    return (
      <button onClick={onClick} className={classes}>
        {children}
      </button>
    );
  };

  // Cross-navigation handlers
  const handleNavigateToSubmissions = (filters?: Partial<FilterState>) => {
    setDashboardFilters(filters || {});
    setView('dashboard');
  };

  const views: Record<View, React.ReactElement> = {
    dashboard: <Dashboard initialFilters={dashboardFilters} />,
    dataCollectionProgress: <DataCollectionProgressPage />,
    enumeratorPerformance: (
      <EnumeratorPerformancePage 
        onNavigateToSubmissions={handleNavigateToSubmissions}
      />
    ),
    qualityOverview: (
      <QualityOverviewPage 
        onNavigateToSubmissions={handleNavigateToSubmissions}
      />
    ),
    createSurvey: <CreateSurveyPage />,
    settings: <SurveySettingsPage />,
    userSettings: <UserSettingsPage />,
  };

  const handleAddSurvey = () => {
    setView('createSurvey');
  };

  const handleSurveySelect = (surveyId: string | null) => {
    // When a survey is selected, stay on current view or go to dashboard
    if (view === 'createSurvey') {
      setView('dashboard');
    }
  };

  return (
    <SurveyProvider>
      <div className="flex h-full font-sans text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900">
        <Sidebar 
          onAddSurvey={handleAddSurvey} 
          onSurveySelect={handleSurveySelect}
          user={user}
          onUserSettings={() => setView('userSettings')}
          onLogout={logout}
          isUserSettingsActive={view === 'userSettings'}
        />
        
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex-shrink-0 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 min-h-16 py-3 sm:py-0 sm:h-16 px-4 mx-auto max-w-screen-2xl sm:px-6 lg:px-8">
              <h1 className="text-xl font-bold text-gray-900 dark:text-white flex-shrink-0">Field Compass</h1>
              <nav className="flex flex-wrap items-center justify-start sm:justify-end gap-2 w-full sm:w-auto">
                <NavButton currentView={view} targetView="dashboard" onClick={() => { setDashboardFilters({}); setView('dashboard'); }}>
                  Submissions
                </NavButton>
                <NavButton currentView={view} targetView="qualityOverview" onClick={() => setView('qualityOverview')}>
                  Quality Overview
                </NavButton>
                <NavButton currentView={view} targetView="dataCollectionProgress" onClick={() => setView('dataCollectionProgress')}>
                  Data Collection Progress
                </NavButton>
                <NavButton currentView={view} targetView="enumeratorPerformance" onClick={() => setView('enumeratorPerformance')}>
                  Enumerator Performance
                </NavButton>
                <NavButton currentView={view} targetView="settings" onClick={() => setView('settings')}>
                  Settings
                </NavButton>
              </nav>
            </div>
          </header>

          <main className="flex-1 min-h-0 overflow-hidden">
            {views[view]}
          </main>
        </div>
      </div>
    </SurveyProvider>
  );
};

// Wrapper component with auth provider
const App: React.FC = () => {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
};

export default App;