import React, { useCallback, useEffect, useState } from 'react';
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
  form?: Record<string, unknown> | null;
  canEdit?: boolean;
  onRulesAdopted?: () => void;
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

const FindingCard: React.FC<{
  finding: LintFinding;
  canAdopt: boolean;
  adopting: boolean;
  onAdopt?: () => void;
}> = ({ finding, canAdopt, adopting, onAdopt }) => (
  <li className="p-3 bg-white dark:bg-gray-800 rounded-md border border-gray-200 dark:border-gray-700 space-y-2">
    <div className="flex items-start gap-2">
      <span className={`shrink-0 px-2 py-0.5 text-xs font-semibold rounded-full ${SEVERITY_STYLES[finding.severity] || SEVERITY_STYLES.info}`}>
        {finding.severity}
      </span>
      <p className="text-sm text-gray-900 dark:text-white">{finding.message}</p>
    </div>
    {finding.question_path && (
      <p className="text-xs font-mono text-gray-500 dark:text-gray-400">{finding.question_path}</p>
    )}
    <p className="text-xs text-gray-600 dark:text-gray-400">{finding.why_it_matters}</p>
    {finding.suggested_fix && (
      <pre className="text-xs bg-gray-50 dark:bg-gray-900 p-2 rounded overflow-x-auto text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
        {finding.suggested_fix}
      </pre>
    )}
    {canAdopt && finding.auto_rule && onAdopt && (
      <button
        type="button"
        onClick={onAdopt}
        disabled={adopting}
        className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
      >
        {adopting ? 'Adding…' : 'Add as quality check'}
      </button>
    )}
  </li>
);

const FormLintPanel: React.FC<FormLintPanelProps> = ({
  surveyId,
  form,
  canEdit = false,
  onRulesAdopted,
}) => {
  const [report, setReport] = useState<LintReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [adoptingKey, setAdoptingKey] = useState<string | null>(null);
  const [adoptedKeys, setAdoptedKeys] = useState<Set<string>>(new Set());

  const findingKey = (finding: LintFinding) => `${finding.check_id}:${finding.question_path || ''}`;

  const runCheck = useCallback(async () => {
    setError(null);
    setIsChecking(true);
    try {
      const next = surveyId ? await lintSurvey(surveyId) : await lintForm(form as Record<string, unknown>);
      setReport(next);
    } catch (err) {
      setReport(null);
      setError(err instanceof Error ? err.message : 'Could not check this form.');
    } finally {
      setIsChecking(false);
    }
  }, [surveyId, form]);

  useEffect(() => {
    if (surveyId || form) {
      runCheck();
    }
  }, [runCheck, surveyId, form]);

  const handleAdopt = async (finding: LintFinding) => {
    if (!surveyId) return;
    const key = findingKey(finding);
    setAdoptingKey(key);
    setError(null);
    try {
      await adoptLintRules(surveyId, [
        { check_id: finding.check_id, question_path: finding.question_path },
      ]);
      setAdoptedKeys((prev) => new Set(prev).add(key));
      onRulesAdopted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that quality check.');
    } finally {
      setAdoptingKey(null);
    }
  };

  if (!surveyId && !form) {
    return null;
  }

  const grouped = report?.by_severity || { error: [], warning: [], info: [] };
  const total = report ? (report.counts.error || 0) + (report.counts.warning || 0) + (report.counts.info || 0) : 0;

  return (
    <section className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Check this form for best practices
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Reads the form itself — not the submissions — for things that will silently
            disable quality checks or let avoidable field errors through. This is not the
            ODK XLSForm compiler: a form that deploys can still fail these.
          </p>
        </div>
        <button
          type="button"
          onClick={runCheck}
          disabled={isChecking}
          className="px-3 py-2 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-md"
        >
          {isChecking ? 'Checking…' : 'Check again'}
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
                        canAdopt={Boolean(canEdit && surveyId && finding.auto_rule && !already)}
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
