/**
 * The survey chosen in this browser tab.
 *
 * sessionStorage is the whole point: it survives a reload but is gone when the
 * tab closes. That is the difference between "I refreshed" and "I arrived" --
 * a refresh keeps your place, while opening the app fresh, or signing in,
 * starts on the empty state rather than on a survey nobody chose this session.
 *
 * Signing in clears it explicitly (AuthContext), because the tab may have been
 * used by a different account whose surveys this user cannot even see.
 *
 * Lives in its own module so SurveyContext and AuthContext can share the key
 * without importing each other -- AuthContext sits outside SurveyProvider.
 *
 * Every accessor is wrapped: sessionStorage throws outright in some privacy
 * modes, and losing a convenience must not take the app down with it.
 */
const SELECTED_SURVEY_KEY = 'field_compass_selected_survey';

export const readRememberedSurveyId = (): string | null => {
  try {
    return sessionStorage.getItem(SELECTED_SURVEY_KEY);
  } catch {
    return null;
  }
};

export const rememberSurveyId = (surveyId: string): void => {
  try {
    sessionStorage.setItem(SELECTED_SURVEY_KEY, surveyId);
  } catch {
    /* not remembering is survivable; failing to render is not */
  }
};

export const forgetSurveyId = (): void => {
  try {
    sessionStorage.removeItem(SELECTED_SURVEY_KEY);
  } catch {
    /* as above */
  }
};
