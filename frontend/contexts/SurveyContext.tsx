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
      
      // Use functional update to get current selectedSurvey state
      setSelectedSurvey((currentSelected) => {
        if (!allowAutoSelect) {
          // Keep current selection if it still exists, otherwise clear
          if (currentSelected && data.find(s => s.survey_id === currentSelected.survey_id)) {
            return currentSelected;
          }
          return null;
        }

        // Auto-select first survey if none selected and surveys available
        if (!currentSelected && data.length > 0) {
          return data[0];
        }
        
        // If selected survey no longer exists, select first available
        if (currentSelected && !data.find(s => s.survey_id === currentSelected.survey_id)) {
          return data.length > 0 ? data[0] : null;
        }
        
        // Keep current selection if it still exists
        return currentSelected;
      });
      
      // Return the data so callers can use it immediately
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load surveys');
      console.error('Error loading surveys:', err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []); // No dependencies - this function should always fetch fresh data

  useEffect(() => {
    refreshSurveys();
  }, [refreshSurveys]);

  // Load selected survey from localStorage on mount
  useEffect(() => {
    const savedSurveyId = localStorage.getItem('selectedSurveyId');
    if (savedSurveyId && surveys.length > 0) {
      const survey = surveys.find(s => s.survey_id === savedSurveyId);
      if (survey) {
        setSelectedSurvey(survey);
      }
    }
  }, [surveys]);

  // Save selected survey to localStorage
  useEffect(() => {
    if (selectedSurvey) {
      localStorage.setItem('selectedSurveyId', selectedSurvey.survey_id);
    } else {
      localStorage.removeItem('selectedSurveyId');
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

