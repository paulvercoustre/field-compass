import React from 'react';
import { useAuth } from '../../contexts/AuthContext';
import KoboConnection from '../kobo/KoboConnection';

type StepState = 'done' | 'current' | 'upcoming';

const StepMarker: React.FC<{ number: number; state: StepState }> = ({ number, state }) => {
  const styles = {
    done: 'bg-green-600 text-white',
    current: 'bg-indigo-600 text-white',
    upcoming: 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  }[state];
  return (
    <span
      className={`flex-shrink-0 flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${styles}`}
      aria-hidden="true"
    >
      {state === 'done' ? '✓' : number}
    </span>
  );
};

const Step: React.FC<{
  number: number;
  state: StepState;
  title: string;
  children: React.ReactNode;
}> = ({ number, state, title, children }) => (
  <li className="flex gap-4 py-5 first:pt-0 last:pb-0">
    <StepMarker number={number} state={state} />
    <div className="flex-1 min-w-0">
      <h2
        className={`text-base font-semibold ${
          state === 'upcoming' ? 'text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-white'
        }`}
      >
        {title}
        <span className="sr-only">{state === 'done' ? ' (done)' : state === 'current' ? ' (next step)' : ''}</span>
      </h2>
      <div className="mt-2">{children}</div>
    </div>
  </li>
);

/**
 * What a signed-in user with no surveys sees: the order things have to happen
 * in. Connecting Kobo comes first because adding a survey reads the form from
 * Kobo; finding that out from an error halfway through the form was the
 * old first run.
 */
const SetupChecklist: React.FC<{ onAddSurvey: () => void }> = ({ onAddSurvey }) => {
  const { user } = useAuth();
  const connected = Boolean(user?.has_kobo_api_key);

  return (
    <div className="h-full overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div className="max-w-2xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Set up your first survey</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Three steps, then pull submissions from Kobo and start reviewing.
        </p>

        <ol className="mt-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 divide-y divide-gray-200 dark:divide-gray-700">
          <Step number={1} state={connected ? 'done' : 'current'} title="Connect KoboToolbox">
            {!connected && (
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                Field Compass reads your forms and submissions from Kobo with your API key. You only do this once.
              </p>
            )}
            <KoboConnection />
          </Step>

          <Step number={2} state={connected ? 'current' : 'upcoming'} title="Add a survey">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Paste the link to your Kobo project. Field Compass reads its form, so there's nothing to upload.
            </p>
            <button
              type="button"
              onClick={onAddSurvey}
              disabled={!connected}
              className="mt-3 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:text-gray-500 dark:disabled:text-gray-400 disabled:cursor-not-allowed"
            >
              + Add a survey
            </button>
            {!connected && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">Connect Kobo first.</p>
            )}
          </Step>

          <Step number={3} state="upcoming" title="Choose quality checks">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Once the survey is added, pick the checks to run on each submission. You can change them any time in
              Survey Settings.
            </p>
          </Step>
        </ol>
      </div>
    </div>
  );
};

export default SetupChecklist;
