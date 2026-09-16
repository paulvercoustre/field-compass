import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { getSurveys, Survey } from '../services/progressApi';
import { readRememberedSurveyId, rememberSurveyId } from '../utils/selectedSurveyStorage';

interface SurveyContextType {
  selectedSurvey: Survey | null;
  surveys: Survey[];
  isLoading: boolean;
  error: string | null;
  setSelectedSurvey: (survey: Survey | null) => void;
  refreshSurveys: () => Promise<Survey[]>;
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

  const refreshSurveys = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await getSurveys();
      
      // Update surveys state
      setSurveys(data);
      
      // Use functional update to get current selectedSurvey state
      setSelectedSurvey((currentSelected) => {
        // Nothing is ever selected on the user's behalf.
        //
        // Landing on a survey nobody chose is how someone edits settings, or
        // reads a progress page, believing it belongs to a different survey.
        // With several surveys in the sidebar the wrong one looks exactly as
        // legitimate as the right one. An empty state costs a click; a silent
        // wrong selection costs trust in the numbers.
        //
        // Keep a selection that is still valid -- that one was chosen.
        if (currentSelected && data.find(s => s.survey_id === currentSelected.survey_id)) {
          return currentSelected;
        }

        // Restore a choice made earlier in this browser tab, so a refresh does
        // not lose your place. sessionStorage, not localStorage, is what draws
        // the line the user asked for: it survives a reload but dies with the
        // tab, and login clears it explicitly (see AuthContext). So a fresh
        // login lands on the empty state, while F5 does not.
        //
        // Still validated against the list: a survey deleted, or access
        // revoked, since the choice was made must not come back.
        // Read straight from storage rather than a one-shot ref. StrictMode
        // invokes this effect twice in development, and anything consumed on
        // first use loses the race on the second pass. Storage is idempotent:
        // it is only ever written by an actual selection, and only cleared by
        // login, logout, or starting a new survey.
        const rememberedId = readRememberedSurveyId();
        if (rememberedId) {
          const remembered = data.find(s => s.survey_id === rememberedId);
          if (remembered) {
            return remembered;
          }
        }

        // A selection that no longer exists falls back to nothing rather than
        // to whatever happens to be first.
        return null;
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

  // Remember the choice for the life of this tab, so a refresh keeps your
  // place. Cleared on login (AuthContext) so signing in starts clean.
  // Write only. Clearing on a null selection would fire on mount -- before
  // the id has been read back -- and erase exactly what it is meant to keep.
  // The three places a selection is genuinely abandoned clear it themselves:
  // login, logout, and starting a new survey.
  useEffect(() => {
    if (selectedSurvey) {
      rememberSurveyId(selectedSurvey.survey_id);
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
