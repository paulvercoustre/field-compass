import React, { useState } from 'react';
import { SurveyProvider } from './contexts/SurveyContext';
import Dashboard from './components/Dashboard';
import DataCollectionProgressPage from './pages/DataCollectionProgressPage';
import EnumeratorPerformancePage from './pages/EnumeratorPerformancePage';
import CreateSurveyPage from './pages/CreateSurveyPage';
import SurveySettingsPage from './pages/SurveySettingsPage';
import Sidebar from './components/Sidebar';

type View = 'dashboard' | 'dataCollectionProgress' | 'enumeratorPerformance' | 'createSurvey' | 'settings';

const App: React.FC = () => {
  const [view, setView] = useState<View>('dashboard');

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
        : 'text-gray-300 hover:bg-gray-700 hover:text-white'
    }`;
    return (
      <button onClick={onClick} className={classes}>
        {children}
      </button>
    );
  };

  const views: Record<View, React.ReactElement> = {
    dashboard: <Dashboard />,
    dataCollectionProgress: <DataCollectionProgressPage />,
    enumeratorPerformance: <EnumeratorPerformancePage />,
    createSurvey: <CreateSurveyPage />,
    settings: <SurveySettingsPage />,
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
      <div className="flex h-full font-sans text-gray-300 bg-gray-900">
        <Sidebar onAddSurvey={handleAddSurvey} onSurveySelect={handleSurveySelect} />
        
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex-shrink-0 bg-gray-800 border-b border-gray-700">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 min-h-16 py-3 sm:py-0 sm:h-16 px-4 mx-auto max-w-screen-2xl sm:px-6 lg:px-8">
              <h1 className="text-xl font-bold text-white flex-shrink-0">Field Compass</h1>
              <nav className="flex flex-wrap items-center justify-start sm:justify-end gap-2 w-full sm:w-auto">
                <NavButton currentView={view} targetView="dashboard" onClick={() => setView('dashboard')}>
                  QA Dashboard
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

export default App;