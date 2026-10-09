import React, { useState } from 'react';
import { rerunAiChecks } from '../../services/progressApi';
import { QualityChecksForm } from '../../utils/qualityCheckSettings';
import SurveyKeyPicker from '../ai/SurveyKeyPicker';
import { SparkleIcon } from '../ui/icons';
import { SavedNote, SectionActions, SectionControls } from './SectionControls';

interface AiReviewSectionProps {
  surveyId: string;
  isOwner: boolean;
  checks: QualityChecksForm;
  setChecks: React.Dispatch<React.SetStateAction<QualityChecksForm>>;
  /** Open-text questions, and transcribed audio ones, the AI can review. */
  reviewableVariables: Array<{ name: string; label: string }>;
  canEdit: boolean;
  controls: SectionControls;
  savedAt?: Date;
  onError: (message: string | null) => void;
  onSuccess: (message: string) => void;
}

/** The AI review of open-text answers: whether it runs, on which questions, and running it again. */
const AiReviewSection: React.FC<AiReviewSectionProps> = ({
  surveyId,
  isOwner,
  checks,
  setChecks,
  reviewableVariables,
  canEdit,
  controls,
  savedAt,
  onError,
  onSuccess,
}) => {
  const [isRerunning, setIsRerunning] = useState(false);

  const rerun = async () => {
    setIsRerunning(true);
    onError(null);
    try {
      const count = await rerunAiChecks(surveyId);
      onSuccess(`${count} submissions will be reviewed again on the next pull.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not schedule the review');
    } finally {
      setIsRerunning(false);
    }
  };

  return (
    <section className="bg-white dark:bg-gray-900 p-5 rounded-xl border border-gray-200 dark:border-gray-800 shadow-card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight text-gray-900 dark:text-white">
          <SparkleIcon className="h-4 w-4 text-indigo-500 dark:text-indigo-400" />
          AI review
        </h2>
        {!controls.dirty && <SavedNote at={savedAt} className="ml-auto" />}
      </div>
      {isOwner && (
        <div className="mb-4">
          <SurveyKeyPicker surveyId={surveyId} use="review" />
        </div>
      )}
      <div className="space-y-4">
        <div className="flex items-start">
          <div className="flex h-5 items-center">
            <input
              id="ai-review-enabled"
              type="checkbox"
              disabled={!canEdit}
              checked={checks.flag_llm_qualitative}
              onChange={(e) =>
                setChecks({
                  ...checks,
                  flag_llm_qualitative: e.target.checked,
                })
              }
              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600 dark:border-gray-600 dark:bg-gray-700"
            />
          </div>
          <div className="ml-3">
            <label htmlFor="ai-review-enabled" className="text-sm font-medium text-gray-900 dark:text-white">
              Flag weak open-text answers
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Unreadable, off-topic or too vague answers to the questions you pick. Counts toward the included usage,
              unless it runs on your own API key.
            </p>
          </div>
        </div>

        {checks.flag_llm_qualitative && (
          <div className="ml-7 p-3 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-medium mb-2 text-gray-900 dark:text-white">Questions to review</h3>
            {reviewableVariables.length === 0 ? (
              <p className="text-xs text-gray-500 dark:text-gray-400">This form has no open-text questions.</p>
            ) : (
              <div className="max-h-48 overflow-y-auto space-y-1">
                {reviewableVariables.map((variable) => (
                  <label key={variable.name} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      disabled={!canEdit}
                      checked={checks.llm_qualitative_fields.includes(variable.name)}
                      onChange={(e) => {
                        const selected = checks.llm_qualitative_fields;
                        if (e.target.checked) {
                          setChecks({
                            ...checks,
                            llm_qualitative_fields: [...selected, variable.name],
                          });
                        } else {
                          setChecks({
                            ...checks,
                            llm_qualitative_fields: selected.filter((name) => name !== variable.name),
                          });
                        }
                      }}
                      className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600 dark:border-gray-600 dark:bg-gray-700"
                    />
                    <span className="text-gray-900 dark:text-white">{variable.label}</span>
                    <span className="text-xs text-gray-500">({variable.name})</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
        {/* Only for what is saved: the next pull reviews with the saved questions. */}
        {canEdit && !controls.dirty && checks.flag_llm_qualitative && (
          <div className="ml-7 flex flex-wrap items-center gap-3">
            <button
              onClick={rerun}
              disabled={isRerunning}
              className="px-3 py-2 text-sm font-medium text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-md disabled:opacity-50"
            >
              {isRerunning ? 'Scheduling…' : 'Review all answers again'}
            </button>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              On the next pull, including answers already reviewed. Counts toward the included usage, unless it runs on
              your own API key.
            </p>
          </div>
        )}
        {canEdit && controls.dirty && <SectionActions controls={controls} className="pt-4" />}
      </div>
    </section>
  );
};

export default AiReviewSection;
