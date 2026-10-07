import React, { useState } from 'react';
import { deleteSurvey } from '../../services/progressApi';

interface DeleteSurveySectionProps {
  surveyId: string;
  surveyName: string;
  /** After the survey is gone: let the rest of the app forget it. */
  onDeleted: () => Promise<void> | void;
}

/** Deletes the survey, once its name is typed back to confirm. */
const DeleteSurveySection: React.FC<DeleteSurveySectionProps> = ({ surveyId, surveyName, onDeleted }) => {
  const [confirming, setConfirming] = useState(false);
  const [typedName, setTypedName] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = () => {
    setTypedName('');
    setError(null);
    setConfirming(true);
  };

  const close = () => {
    setConfirming(false);
    setTypedName('');
    setError(null);
  };

  const confirm = async () => {
    setError(null);
    setIsDeleting(true);
    try {
      await deleteSurvey(surveyId);
      setConfirming(false);
      await onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete survey');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <section className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-red-200 dark:border-red-900/50 p-6">
      <h2 className="text-base font-semibold tracking-tight text-gray-900 dark:text-white mb-2">Delete survey</h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Permanently deletes the survey and its data. This cannot be undone.
      </p>
      <button
        type="button"
        onClick={open}
        disabled={isDeleting}
        className="px-4 py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white font-medium rounded-lg transition-colors"
      >
        Delete survey
      </button>

      {confirming && (
        <div className="fixed inset-0 bg-gray-950/40 backdrop-blur-[2px] flex items-center justify-center z-50">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-survey-title"
            className="bg-white dark:bg-gray-900 rounded-xl p-6 max-w-md w-full mx-4 border border-gray-200 dark:border-gray-800 shadow-popover animate-fade-in"
          >
            <h2
              id="delete-survey-title"
              className="text-base font-semibold tracking-tight text-gray-900 dark:text-white mb-4"
            >
              Delete survey
            </h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              Are you sure you want to delete <strong className="text-gray-900 dark:text-white">{surveyName}</strong>?
              <br />
              <br />
              This action cannot be undone. This will permanently delete the survey configuration and all associated
              data.
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Type <strong className="text-gray-900 dark:text-white">{surveyName}</strong> to confirm
                <input
                  type="text"
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                  placeholder="Survey name"
                  className="mt-1.5 w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white font-normal focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                />
              </label>
            </div>
            {error && (
              <div className="p-3 text-sm bg-red-50 dark:bg-red-500/10 ring-1 ring-inset ring-red-600/15 dark:ring-red-400/20 rounded-lg mb-4">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={close}
                disabled={isDeleting}
                className="px-4 py-2 bg-white text-gray-900 border border-gray-300 shadow-xs rounded-md hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={isDeleting || typedName !== surveyName}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-red-300 dark:disabled:bg-red-700 disabled:cursor-not-allowed text-sm font-medium"
              >
                {isDeleting ? 'Deleting...' : 'Delete survey'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default DeleteSurveySection;
