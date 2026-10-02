import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  adoptLintRules,
  lintForm,
  lintSurvey,
  LintFinding,
  LintReport,
} from '../../services/lintApi';
import { Spinner } from '../Spinner';

interface FormLintPanelProps {
  surveyId?: string | null;
  /**
   * A form to check instead of the one saved on the survey: the create
   * screen's form, or a refreshed form on settings that is not saved yet.
   */
  form?: Record<string, unknown> | null;
  canEdit?: boolean;
  onRulesAdopted?: () => void;
  /**
   * Run the check without waiting for the button: whenever this is truthy
   * and changes, and again whenever the form changes while it is set.
   */
  autoRunKey?: number | boolean;
  /**
   * The survey's label language as a sheet column (`label::French (fr)`).
   * Findings quote question labels in it; changing it re-checks a form that
   * already has results.
   */
  labelColumn?: string | null;
}

const SEVERITY_STYLES: Record<string, string> = {
  error: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200',
  warning: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-200',
  info: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
};

const SEVERITY_HEADINGS: Record<string, string> = {
  error: 'Fix before collecting',
  warning: 'Worth fixing',
  info: 'Worth knowing',
};

/**
 * One finding: the headline always, the specifics on request.
 *
 * A real form can produce dozens of findings, so each one opens as a single
 * line saying what is wrong; codes, question names, why it matters and the
 * XLSForm fix are behind "Show details".
 */
const FindingCard: React.FC<{
  finding: LintFinding;
  canAdopt: boolean;
  adopting: boolean;
  onAdopt?: () => void;
}> = ({ finding, canAdopt, adopting, onAdopt }) => {
  const [open, setOpen] = useState(false);
  return (
    <li className="p-3 bg-white dark:bg-gray-800 rounded-md border border-gray-200 dark:border-gray-700 space-y-2">
      <div className="flex items-start gap-2">
        <span className={`shrink-0 px-2 py-0.5 text-xs font-semibold rounded-full ${SEVERITY_STYLES[finding.severity] || SEVERITY_STYLES.info}`}>
          {finding.severity}
        </span>
        <p className="flex-1 text-sm font-medium text-gray-900 dark:text-white">{finding.message}</p>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="shrink-0 text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          {open ? 'Hide details' : 'Show details'}
        </button>
      </div>
      {open && (
        <div className="space-y-2 pl-1">
          {finding.details && (
            <p className="text-sm text-gray-800 dark:text-gray-200">{finding.details}</p>
          )}
          {finding.question_path && (
            <p className="text-xs font-mono text-gray-500 dark:text-gray-400">{finding.question_path}</p>
          )}
          <p className="text-xs text-gray-600 dark:text-gray-400">
            <span className="font-semibold">Why it matters: </span>
            {finding.why_it_matters}
          </p>
          {finding.suggested_fix && (
            <pre className="text-xs bg-gray-50 dark:bg-gray-900 p-2 rounded overflow-x-auto text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
              {finding.suggested_fix}
            </pre>
          )}
        </div>
      )}
      {canAdopt && finding.auto_rule && onAdopt && (
        <button
          type="button"
          onClick={onAdopt}
          disabled={adopting}
          className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-500 disabled:opacity-50"
        >
          {adopting ? 'Adding…' : 'Add as quality check'}
        </button>
      )}
    </li>
  );
};

const FormLogicMissingNotice: React.FC = () => (
  <p className="text-sm p-3 rounded-md bg-yellow-50 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200">
    The copy of this form saved with the survey has no constraints, skip logic, or
    required flags, and it could not be re-read from Kobo (add your Kobo API key in
    user settings). Checks that need them were skipped. Read the form from the Kobo
    project again and save to run them.
  </p>
);

const FormLintPanel: React.FC<FormLintPanelProps> = ({
  surveyId,
  form,
  canEdit = false,
  onRulesAdopted,
  autoRunKey,
  labelColumn,
}) => {
  const [report, setReport] = useState<LintReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [adoptingKey, setAdoptingKey] = useState<string | null>(null);
  const [adoptedKeys, setAdoptedKeys] = useState<Set<string>>(new Set());

  // Bumped whenever the panel is pointed at a different survey or form, so a
  // response that arrives after the switch is dropped instead of being shown
  // against the wrong form. `checkSeq` does the same for overlapping re-runs.
  const sourceGen = useRef(0);
  const checkSeq = useRef(0);

  const findingKey = (finding: LintFinding) => `${finding.check_id}:${finding.question_path || ''}`;

  const runCheck = useCallback(async () => {
    const seq = ++checkSeq.current;
    setError(null);
    setIsChecking(true);
    try {
      const next = form
        ? await lintForm(form, labelColumn)
        : await lintSurvey(surveyId as string, labelColumn);
      if (seq !== checkSeq.current) return;
      setReport(next);
    } catch (err) {
      if (seq !== checkSeq.current) return;
      setReport(null);
      setError(err instanceof Error ? err.message : 'Could not check this form.');
    } finally {
      if (seq === checkSeq.current) setIsChecking(false);
    }
  }, [surveyId, form, labelColumn]);

  // A different survey or form clears the previous results. The check itself
  // only runs when the user asks for it.
  useEffect(() => {
    sourceGen.current += 1;
    checkSeq.current += 1;
    setReport(null);
    setAdoptedKeys(new Set());
    setAdoptingKey(null);
    setIsChecking(false);
    setError(null);
  }, [surveyId, form]);

  // A new label language re-quotes the labels in results already on screen;
  // with nothing checked yet there is nothing to redo.
  const hasReport = useRef(false);
  hasReport.current = report !== null;
  const lastLabelColumn = useRef(labelColumn);
  useEffect(() => {
    if (lastLabelColumn.current === labelColumn) return;
    lastLabelColumn.current = labelColumn;
    // With auto-run on, the effect below already re-runs on the new language.
    if (hasReport.current && !autoRunKey) runCheck();
  }, [labelColumn, runCheck, autoRunKey]);

  // Declared after the reset above so a new form is cleared, then checked.
  useEffect(() => {
    if (autoRunKey && (surveyId || form)) {
      runCheck();
    }
  }, [autoRunKey, runCheck, surveyId, form]);

  // Quality checks are created from the form saved on the survey; while an
  // unsaved form is shown, adopting would act on a different form.
  const unsavedForm = Boolean(surveyId && form);

  const handleAdopt = async (finding: LintFinding) => {
    if (!surveyId) return;
    const gen = sourceGen.current;
    const key = findingKey(finding);
    setAdoptingKey(key);
    setError(null);
    try {
      await adoptLintRules(
        surveyId,
        [{ check_id: finding.check_id, question_path: finding.question_path }],
        true,
        labelColumn
      );
      onRulesAdopted?.();
      if (gen !== sourceGen.current) return;
      setAdoptedKeys((prev) => new Set(prev).add(key));
    } catch (err) {
      if (gen !== sourceGen.current) return;
      setError(err instanceof Error ? err.message : 'Could not add that quality check.');
    } finally {
      if (gen === sourceGen.current) setAdoptingKey(null);
    }
  };

  if (!surveyId && !form) {
    return null;
  }

  const grouped = report?.by_severity || { error: [], warning: [], info: [] };
  const total = report ? (report.counts.error || 0) + (report.counts.warning || 0) + (report.counts.info || 0) : 0;

  return (
    <section className="bg-white dark:bg-gray-900 p-5 rounded-xl border border-gray-200 dark:border-gray-800 shadow-card space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-gray-900 dark:text-white">
            Check this form for best practices
          </h2>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            Finds form issues that would switch off quality checks or let errors through.
          </p>
        </div>
        <button
          type="button"
          onClick={runCheck}
          disabled={isChecking}
          className={
            report
              ? 'px-3 py-2 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-md disabled:opacity-50'
              : 'px-3 py-2 text-sm font-medium bg-indigo-600 text-white rounded-md hover:bg-indigo-500 disabled:opacity-50'
          }
        >
          {isChecking ? 'Checking…' : report ? 'Check again' : 'Check form'}
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
      )}

      {isChecking && !report && (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      )}

      {report && (
        <div className="space-y-4">
          {report.form_logic_missing && <FormLogicMissingNotice />}
          {unsavedForm && (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Checked the refreshed form. Save it to add findings as quality checks.
            </p>
          )}
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {total === 0
              ? `Nothing to fix on ${report.question_count} questions.`
              : `${report.counts.error || 0} to fix, ${report.counts.warning || 0} worth fixing, ${report.counts.info || 0} worth knowing — across ${report.question_count} questions.`}
          </p>
          {(['error', 'warning', 'info'] as const).map((severity) => {
            const items = grouped[severity] || [];
            if (items.length === 0) return null;
            return (
              <div key={severity}>
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">
                  {SEVERITY_HEADINGS[severity]}
                </h3>
                <ul className="space-y-2">
                  {items.map((finding, index) => {
                    const key = findingKey(finding);
                    const already = adoptedKeys.has(key);
                    return (
                      <FindingCard
                        // A form-level check can report more than once (one
                        // finding per language, per coding convention), so the
                        // check id alone is not unique.
                        key={`${key}:${index}`}
                        finding={finding}
                        canAdopt={Boolean(canEdit && surveyId && !unsavedForm && finding.auto_rule && !already)}
                        adopting={adoptingKey === key}
                        onAdopt={already ? undefined : () => handleAdopt(finding)}
                      />
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default FormLintPanel;
