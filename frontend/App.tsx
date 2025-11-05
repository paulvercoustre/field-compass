
import React, { useState } from 'react';
import Dashboard from './components/Dashboard';
import RuleBuilder from './pages/RuleBuilder';
import DataCollectionProgressPage from './pages/DataCollectionProgressPage';
import EnumeratorPerformancePage from './pages/EnumeratorPerformancePage';

type View = 'dashboard' | 'ruleBuilder' | 'dataCollectionProgress' | 'enumeratorPerformance';

const App: React.FC = () => {
  const [view, setView] = useState<View>('dataCollectionProgress');

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
    ruleBuilder: <RuleBuilder />,
    dataCollectionProgress: <DataCollectionProgressPage />,
    enumeratorPerformance: <EnumeratorPerformancePage />,
  };

  return (
    <div className="flex flex-col h-full font-sans text-gray-300 bg-gray-900">
      <header className="flex-shrink-0 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center justify-between h-16 px-4 mx-auto max-w-screen-2xl sm:px-6 lg:px-8">
          <h1 className="text-xl font-bold text-white">Field Compass</h1>
          <nav className="flex flex-wrap items-center justify-end gap-2 sm:space-x-4">
            <NavButton currentView={view} targetView="dashboard" onClick={() => setView('dashboard')}>
              QA Dashboard
            </NavButton>
            <NavButton currentView={view} targetView="ruleBuilder" onClick={() => setView('ruleBuilder')}>
              Rule Builder
            </NavButton>
            <NavButton currentView={view} targetView="dataCollectionProgress" onClick={() => setView('dataCollectionProgress')}>
              Data Collection Progress
            </NavButton>
            <NavButton currentView={view} targetView="enumeratorPerformance" onClick={() => setView('enumeratorPerformance')}>
              Enumerator Performance
            </NavButton>
          </nav>
        </div>
      </header>

      <main className="flex-1 min-h-0">
        {views[view]}
      </main>
    </div>
  );
};

export default App;