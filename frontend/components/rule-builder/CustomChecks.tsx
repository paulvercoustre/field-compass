import React, { useEffect, useRef, useState } from 'react';
import { KoboToolData, StagedRule } from '../../types';
import { generateRuleFromNaturalLanguage } from '../../services/aiApi';
import RuleEditor from './RuleEditor';
import AISuggestedRules from './AISuggestedRules';
import ErrorMessage from '../ui/ErrorMessage';
import { Spinner } from '../Spinner';
import { describeConditions } from './conditionText';

interface CustomChecksProps {
  surveyId: string;
  rules: StagedRule[];
  isLoading: boolean;
  canEdit: boolean;
  /** The survey's form; adding or editing a check needs its questions. */
  koboToolData: KoboToolData | null;
  /** Creates a check when `ruleId` is null, otherwise updates that one. Throws on failure. */
  onSave: (rule: Omit<StagedRule, 'id'>, ruleId: string | null) => Promise<void>;
  onDelete: (ruleId: string) => Promise<void>;
  onAddMany: (rules: StagedRule[]) => Promise<void>;
  /** Opens the composer on arrival, e.g. right after a survey is created. */
  startComposing?: boolean;
}

type Panel = 'none' | 'compose' | 'suggest';

const SparkleIcon: React.FC = () => (
  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
    <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
  </svg>
);

const describeAiError = (message: string): string => {
  if (message.includes('Not authenticated')) {
    return 'Your session has expired. Refresh the page and sign in again.';
  }
  if (message.includes('AI service is not available')) {
    return 'AI is not set up for this survey. Add a provider in Account settings → AI integration.';
  }
  return message;
};

const secondaryButton =
  'inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-900 shadow-xs hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const ghostButton =
  'inline-flex h-7 items-center rounded-md px-2 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white';

/**
 * The custom checks of a survey: the list comes first, and adding, editing
 * and AI help open only when asked for, next to what they change.
 */
const CustomChecks: React.FC<CustomChecksProps> = ({
  surveyId,
  rules,
  isLoading,
  canEdit,
  koboToolData,
  onSave,
  onDelete,
  onAddMany,
  startComposing = false,
}) => {
  const [panel, setPanel] = useState<Panel>('none');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // "Describe it" state for the composer
  const [prompt, setPrompt] = useState('');
  const [seed, setSeed] = useState<Omit<StagedRule, 'id'> | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const canCompose = canEdit && !!koboToolData;

  // The form usually arrives after this mounts; open the composer once it does.
  const openedOnArrival = useRef(false);
  useEffect(() => {
    if (startComposing && canCompose && !openedOnArrival.current) {
      openedOnArrival.current = true;
      setPanel('compose');
    }
  }, [startComposing, canCompose]);

  const closePanel = () => {
    setPanel('none');
    setPrompt('');
    setSeed(null);
    setAiError(null);
  };

  const openPanel = (next: Panel) => {
    setEditingId(null);
    setSeed(null);
    setAiError(null);
    setPanel(next);
  };

  const handleFillWithAI = async () => {
    if (!prompt.trim()) return;
    setIsGenerating(true);
    setAiError(null);
    try {
      setSeed(await generateRuleFromNaturalLanguage(surveyId, prompt));
    } catch (err) {
      setAiError(describeAiError(err instanceof Error ? err.message : 'Could not write the check'));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCreate = async (rule: Omit<StagedRule, 'id'>) => {
    try {
      await onSave(rule, null);
      closePanel();
    } catch {
      // The page reports the error; keep the composer open with the user's input.
    }
  };

  const handleUpdate = async (rule: Omit<StagedRule, 'id'>) => {
    if (!editingId) return;
    try {
      await onSave(rule, editingId);
      setEditingId(null);
    } catch {
      // As above: stay in edit mode.
    }
  };

  const handleDelete = async (ruleId: string) => {
    setDeletingId(ruleId);
    try {
      await onDelete(ruleId);
    } finally {
      setDeletingId(null);
      setConfirmingDeleteId(null);
    }
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-card dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-gray-900 dark:text-white">Custom checks</h2>
          {canEdit && !koboToolData && (
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">Load the Kobo form (General → Kobo form) to add checks.</p>
          )}
        </div>
        {canEdit && panel === 'none' && (
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => openPanel('suggest')} disabled={!canCompose} className={ghostButton}>
              Suggest from form
            </button>
            <button type="button" onClick={() => openPanel('compose')} disabled={!canCompose} className={secondaryButton}>
              <span aria-hidden="true">+</span> Add check
            </button>
          </div>
        )}
      </div>

      {panel === 'compose' && koboToolData && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50/60 p-4 dark:border-gray-800 dark:bg-gray-950/40">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleFillWithAI();
                }
              }}
              placeholder="Describe the check, e.g. flag interviews shorter than 10 minutes"
              aria-label="Describe the check"
              disabled={isGenerating}
              className="h-9 min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 shadow-xs placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
            <button type="button" onClick={handleFillWithAI} disabled={!prompt.trim() || isGenerating} className={`${secondaryButton} h-9 justify-center`}>
              {isGenerating ? <Spinner size="sm" className="text-current" /> : <SparkleIcon />}
              {isGenerating ? 'Writing…' : 'Fill in with AI'}
            </button>
          </div>
          {aiError && <ErrorMessage error={aiError} autoHide={false} className="mb-4" />}

          <RuleEditor
            koboToolData={koboToolData}
            editingRule={null}
            seed={seed}
            showCancel
            onCancel={closePanel}
            onSave={handleCreate}
          />
        </div>
      )}

      {panel === 'suggest' && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50/60 p-4 dark:border-gray-800 dark:bg-gray-950/40">
          <p className="mb-3 text-sm font-medium text-gray-900 dark:text-white">Suggested from your form</p>
          <AISuggestedRules surveyId={surveyId} autoStart onRulesAdded={onAddMany} onClose={closePanel} />
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : rules.length === 0 ? (
        panel === 'none' && <p className="text-sm text-gray-500 dark:text-gray-400">No custom checks yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
          {rules.map((rule) =>
            editingId === rule.id && koboToolData ? (
              <li key={rule.id} className="bg-gray-50/60 p-4 dark:bg-gray-950/40">
                <RuleEditor
                  koboToolData={koboToolData}
                  editingRule={rule}
                  onCancel={() => setEditingId(null)}
                  onSave={handleUpdate}
                />
              </li>
            ) : (
              <li key={rule.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1 basis-64">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{rule.description}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{rule.issue_message}</p>
                  <code className="mt-1 block truncate font-mono text-xs text-gray-600 dark:text-gray-300" title={describeConditions(rule.conditions)}>
                    {describeConditions(rule.conditions)}
                  </code>
                  {rule.roster_name && (
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">In roster {rule.roster_name}</p>
                  )}
                </div>
                {canEdit && (
                  confirmingDeleteId === rule.id ? (
                    <div className="flex flex-shrink-0 items-center gap-2">
                      <span className="text-sm text-gray-600 dark:text-gray-400">Delete this check?</span>
                      <button type="button" onClick={() => setConfirmingDeleteId(null)} className={ghostButton}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(rule.id)}
                        disabled={deletingId === rule.id}
                        className="inline-flex h-7 items-center rounded-md bg-red-600 px-2.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
                      >
                        {deletingId === rule.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          closePanel();
                          setConfirmingDeleteId(null);
                          setEditingId(rule.id);
                        }}
                        disabled={!koboToolData}
                        className={ghostButton}
                      >
                        Edit
                      </button>
                      <button type="button" onClick={() => setConfirmingDeleteId(rule.id)} className={`${ghostButton} hover:text-red-600 dark:hover:text-red-400`}>
                        Delete
                      </button>
                    </div>
                  )
                )}
              </li>
            )
          )}
        </ul>
      )}
    </section>
  );
};

export default CustomChecks;
