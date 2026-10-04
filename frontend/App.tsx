import React, { useState, useEffect } from 'react';
import { SurveyProvider, useSurvey } from './contexts/SurveyContext';
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
import { Spinner } from './components/Spinner';
import SetupChecklist from './components/onboarding/SetupChecklist';
import { ActivityProvider, NAVIGATE_EVENT, NavigationTarget } from './contexts/ActivityContext';
import ActivityIndicator, { ActivityPanel } from './components/activity/ActivityIndicator';
import NotificationBell from './components/activity/NotificationBell';

type View = 'dashboard' | 'dataCollectionProgress' | 'enumeratorPerformance' | 'qualityOverview' | 'createSurvey' | 'settings' | 'userSettings';

// Views that are about one survey. Rendering them with nothing selected is
// what produced a permanent spinner on the Submissions queue: the page waits
// for a survey that is never coming.
//
// The gate lives here rather than in each page so the answer is the same
// everywhere -- and so a view added later gets it by being listed, rather than
// by someone remembering to write the empty state again.
const SURVEY_SCOPED_VIEWS: View[] = [
  'dashboard',
  'dataCollectionProgress',
  'enumeratorPerformance',
  'qualityOverview',
  'settings',
];

const RequiresSurvey: React.FC<{ view: View; onAddSurvey: () => void; children: React.ReactNode }> = ({
  view,
  onAddSurvey,
  children,
}) => {
  const { selectedSurvey, surveys, isLoading, error } = useSurvey();

  if (!SURVEY_SCOPED_VIEWS.includes(view) || selectedSurvey) {
    return <>{children}</>;
  }

  // Say nothing while the list is still arriving. "No survey selected" during
  // the first load would be a claim about a question not yet answered.
  if (isLoading) {
    return null;
  }

  // If there was an error loading surveys, show the error instead of onboarding
  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-red-600 dark:text-red-400 text-lg mb-2">Failed to load surveys</p>
          <p className="text-gray-500 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  // No surveys at all: a new user. Show what to do, in order, rather than
  // pointing at an empty sidebar.
  if (surveys.length === 0) {
    return <SetupChecklist onAddSurvey={onAddSurvey} />;
  }

  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">No survey selected</p>
        <p className="text-gray-500 dark:text-gray-400 text-sm">
          Choose a survey from the list on the left.
        </p>
      </div>
    </div>
  );
};

// Main app content (authenticated)
const AppContent: React.FC = () => {
  const { user, isLoading, logout } = useAuth();
  
  // Load view from localStorage on mount, default to 'dashboard' if not found
  const [view, setView] = useState<View>(() => {
    const savedView = localStorage.getItem('currentView');
    return (savedView as View) || 'dashboard';
  });
  
  const [dashboardFilters, setDashboardFilters] = useState<FilterState>({});
  // A tab requested by a link (a notification, a problem in the activity
  // panel); `at` makes the same tab requested twice still switch.
  const [requestedTab, setRequestedTab] = useState<{ tab: string; at: number } | undefined>();
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    // On a phone-width screen an open sidebar covers most of the page, so
    // start collapsed there whatever was saved; it is one tap to open.
    if (window.matchMedia('(max-width: 767px)').matches) return false;
    const saved = localStorage.getItem('sidebarOpen');
    return saved !== null ? saved === 'true' : true;
  });

  // Save current view to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('currentView', view);
  }, [view]);

  const handleSidebarToggle = () => {
    setIsSidebarOpen(prev => {
      const next = !prev;
      localStorage.setItem('sidebarOpen', String(next));
      return next;
    });
  };

  // Listen for navigation events from CreateSurveyPage
  useEffect(() => {
    const handleNavigateToSettings = () => {
      setView('settings');
    };

    const handleNavigateToDashboard = () => {
      setView('dashboard');
    };

    // Links from notifications and the activity panel. The survey is
    // selected by the activity context before this fires.
    const handleNavigate = (event: Event) => {
      const target = (event as CustomEvent<NavigationTarget>).detail;
      if (!target) return;
      if (target.view === 'dashboard') {
        setDashboardFilters((target.filters as FilterState) || {});
      }
      if (target.tab) setRequestedTab({ tab: target.tab, at: Date.now() });
      setView(target.view);
    };

    window.addEventListener('navigateToSettings', handleNavigateToSettings);
    window.addEventListener('navigateToDashboard', handleNavigateToDashboard);
    window.addEventListener(NAVIGATE_EVENT, handleNavigate);
    return () => {
      window.removeEventListener('navigateToSettings', handleNavigateToSettings);
      window.removeEventListener('navigateToDashboard', handleNavigateToDashboard);
      window.removeEventListener(NAVIGATE_EVENT, handleNavigate);
    };
  }, []);

  // Show loading state while checking auth
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-white dark:bg-gray-950">
        <Spinner />
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
    // The underline sits on the header's bottom border, as in a tab strip.
    return (
      <button
        onClick={onClick}
        aria-current={isActive ? 'page' : undefined}
        className={`group relative flex h-full flex-shrink-0 items-center px-1 text-sm font-medium transition-colors ${
          isActive
            ? 'text-gray-900 dark:text-white'
            : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
        }`}
      >
        <span className="rounded-md px-2.5 py-1.5 group-hover:bg-gray-100 dark:group-hover:bg-gray-800/70">
          {children}
        </span>
        {isActive && <span className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-gray-900 dark:bg-white" aria-hidden="true" />}
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
    settings: <SurveySettingsPage requestedTab={requestedTab} />,
    userSettings: <UserSettingsPage requestedTab={requestedTab} />,
  };

  const handleAddSurvey = () => {
    setView('createSurvey');
  };

  const handleSurveySelect = (surveyId: string | null) => {
    // Picking a survey stays on the current survey page. Pages that are not
    // about a survey -- creating one, Account settings -- have nothing to
    // show for it, so they make way for its dashboard.
    if (view === 'createSurvey' || view === 'userSettings') {
      setView('dashboard');
    }
  };

  return (
    <SurveyProvider>
      <ActivityProvider>
      <div className="flex h-full font-sans text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-950">
        <Sidebar 
          onAddSurvey={handleAddSurvey} 
          onSurveySelect={handleSurveySelect}
          user={user}
          onUserSettings={() => setView('userSettings')}
          onLogout={logout}
          isUserSettingsActive={view === 'userSettings'}
          isOpen={isSidebarOpen}
          onToggle={handleSidebarToggle}
        />
        
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex-shrink-0 border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
            <div className="flex h-12 items-stretch gap-4 px-4">
              <nav aria-label="Survey views" className="-mb-px flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto">
                <NavButton currentView={view} targetView="dashboard" onClick={() => { setDashboardFilters({}); setView('dashboard'); }}>
                  Submissions
                </NavButton>
                <NavButton currentView={view} targetView="qualityOverview" onClick={() => setView('qualityOverview')}>
                  Data quality
                </NavButton>
                <NavButton currentView={view} targetView="dataCollectionProgress" onClick={() => setView('dataCollectionProgress')}>
                  Progress
                </NavButton>
                <NavButton currentView={view} targetView="enumeratorPerformance" onClick={() => setView('enumeratorPerformance')}>
                  Field team
                </NavButton>
                <NavButton currentView={view} targetView="settings" onClick={() => setView('settings')}>
                  Settings
                </NavButton>
              </nav>
              {/* Background work and notifications, on every page. */}
              <div className="flex flex-shrink-0 items-center gap-1">
                <ActivityIndicator />
                <NotificationBell />
              </div>
            </div>
          </header>

          <main className="flex-1 min-h-0 overflow-hidden">
            <RequiresSurvey view={view} onAddSurvey={handleAddSurvey}>
              {views[view]}
            </RequiresSurvey>
          </main>
        </div>
      </div>
      <ActivityPanel />
      </ActivityProvider>
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