import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { getSurveys, Survey } from '../services/progressApi';

interface RefreshOptions {
  allowAutoSelect?: boolean;
}

interface SurveyContextType {
  selectedSurvey: Survey | null;
  surveys: Survey[];
  isLoading: boolean;
  error: string | null;
  setSelectedSurvey: (survey: Survey | null) => void;
  refreshSurveys: (options?: RefreshOptions) => Promise<Survey[]>;
}

const SurveyContext = createContext<SurveyContextType | undefined>(undefined);

export { SurveyContext };

export const useSurvey = () => {
  const context = useContext(SurveyContext);
  if (!context) {
    throw new Error('useSurvey must be used within a SurveyProvider');
  }
  return context;
};

interface SurveyProviderProps {
  children: ReactNode;
}

export const SurveyProvider: React.FC<SurveyProviderProps> = ({ children }) => {
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [selectedSurvey, setSelectedSurvey] = useState<Survey | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshSurveys = useCallback(async (options: RefreshOptions = {}) => {
    const { allowAutoSelect = true } = options;
    setIsLoading(true);
    setError(null);
    try {
      const data = await getSurveys();
      
      // Update surveys state
      setSurveys(data);
      
      // Check for saved survey ID in localStorage BEFORE any state updates
      const savedSurveyId = localStorage.getItem('selectedSurveyId');
      
      // Use functional update to get current selectedSurvey state
      setSelectedSurvey((currentSelected) => {
        if (!allowAutoSelect) {
          if (currentSelected && data.find(s => s.survey_id === currentSelected.survey_id)) {
            return currentSelected;
          }
          return null;
        }

        // Priority 1: Restore from localStorage if no current selection
        if (!currentSelected && savedSurveyId) {
          const savedSurvey = data.find(s => s.survey_id === savedSurveyId);
          if (savedSurvey) {
            return savedSurvey;
          }
        }

        // Priority 2: Keep current selection if it still exists
        if (currentSelected && data.find(s => s.survey_id === currentSelected.survey_id)) {
          return currentSelected;
        }

        // Priority 3: If selected survey no longer exists, select first available
        if (currentSelected && !data.find(s => s.survey_id === currentSelected.survey_id)) {
          return data.length > 0 ? data[0] : null;
        }

        // Priority 4: Auto-select first survey if none selected
        if (!currentSelected && data.length > 0) {
          return data[0];
        }
        
        return currentSelected;
      });
      
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load surveys');
      console.error('Error loading surveys:', err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSurveys();
  }, [refreshSurveys]);

  // Save selected survey to localStorage.
  // Only write when we have a selection; never remove on null (null is the initial loading state).
  // Explicit removal is handled in survey deletion flow (SurveySettingsPage).
  useEffect(() => {
    if (selectedSurvey) {
      localStorage.setItem('selectedSurveyId', selectedSurvey.survey_id);
    }
  }, [selectedSurvey]);

  return (
    <SurveyContext.Provider
      value={{
        selectedSurvey,
        surveys,
        isLoading,
        error,
        setSelectedSurvey,
        refreshSurveys,
      }}
    >
      {children}
    </SurveyContext.Provider>
  );
};
