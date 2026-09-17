import React, { useCallback, useEffect, useState } from 'react';
import {
  adoptLintRules,
  lintForm,
  lintSurvey,
  LintFinding,
  LintReport,
  pretestForm,
  pretestSurvey,
  PretestFinding,
  PretestReport,
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

const PretestCard: React.FC<{ finding: PretestFinding }> = ({ finding }) => (
  <li className="p-3 bg-white dark:bg-gray-800 rounded-md border border-gray-200 dark:border-gray-700 space-y-2">
    <div className="flex items-start gap-2 flex-wrap">
      <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${SEVERITY_STYLES[finding.severity] || SEVERITY_STYLES.info}`}>
        {finding.severity}
      </span>
      {finding.source === 'agent' && (
        <span className="px-2 py-0.5 text-xs rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300">
          agent
        </span>
      )}
      {finding.profile && (
        <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
          {finding.profile.replace(/_/g, ' ')}
        </span>
      )}
      <p className="text-sm text-gray-900 dark:text-white">{finding.message}</p>
    </div>
    {finding.question_path && (
      <p className="text-xs font-mono text-gray-500 dark:text-gray-400">{finding.question_path}</p>
    )}
    <p className="text-xs text-gray-600 dark:text-gray-400">{finding.why_it_matters}</p>
  </li>
);

const FormLintPanel: React.FC<FormLintPanelProps> = ({
  surveyId,
  form,
  canEdit = false,
  onRulesAdopted,
}) => {
  const [report, setReport] = useState<LintReport | null>(null);
  const [pretest, setPretest] = useState<PretestReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLinting, setIsLinting] = useState(false);
  const [isPretesting, setIsPretesting] = useState(false);
  const [adoptingKey, setAdoptingKey] = useState<string | null>(null);
  const [adoptedKeys, setAdoptedKeys] = useState<Set<string>>(new Set());

  const findingKey = (finding: LintFinding) => `${finding.check_id}:${finding.question_path || ''}`;

  const runLint = useCallback(async () => {
    setError(null);
    setIsLinting(true);
    try {
      const next = surveyId ? await lintSurvey(surveyId) : await lintForm(form as Record<string, unknown>);
      setReport(next);
    } catch (err) {
      setReport(null);
      setError(err instanceof Error ? err.message : 'Could not lint this form.');
    } finally {
      setIsLinting(false);
    }
  }, [surveyId, form]);

  useEffect(() => {
    if (surveyId || form) {
      runLint();
    }
  }, [runLint, surveyId, form]);

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

  const handlePretest = async (useAgent: boolean) => {
    setError(null);
    setIsPretesting(true);
    try {
      const next = surveyId
        ? await pretestSurvey(surveyId, useAgent)
        : await pretestForm(form as Record<string, unknown>, useAgent);
      setPretest(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not pretest this form.');
    } finally {
      setIsPretesting(false);
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
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Form linter</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Checks the form itself — not the submissions — for things that will silently
            disable quality checks or let avoidable field errors through. This is not the
            ODK XLSForm compiler: a form that deploys can still fail these.
          </p>
        </div>
        <button
          type="button"
          onClick={runLint}
          disabled={isLinting}
          className="px-3 py-2 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-md"
        >
          {isLinting ? 'Linting…' : 'Re-run'}
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
      )}

      {isLinting && !report && (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      )}

      {report && (
        <div className="space-y-4">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {total === 0
              ? `No issues on ${report.question_count} questions.`
              : `${report.counts.error || 0} errors, ${report.counts.warning || 0} warnings, ${report.counts.info || 0} notes — across ${report.question_count} questions.`}
          </p>
          {(['error', 'warning', 'info'] as const).map((severity) => {
            const items = grouped[severity] || [];
            if (items.length === 0) return null;
            return (
              <div key={severity}>
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2 capitalize">
                  {severity}s
                </h3>
                <ul className="space-y-2">
                  {items.map((finding) => {
                    const key = findingKey(finding);
                    const already = adoptedKeys.has(key);
                    return (
                      <FindingCard
                        key={key}
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

      <div className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Cognitive pretest</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Walks the questionnaire as coverage profiles (no children, consent refused,
            all don't-know) looking for instrument defects — unanswerable items, skip
            traps, double-barrelled questions. It does not predict what a population
            would answer. Respondent data is not sent.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => handlePretest(true)}
            disabled={isPretesting}
            className="px-3 py-2 text-sm font-medium bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
          >
            {isPretesting ? 'Walking the form…' : 'Run pretest'}
          </button>
          <button
            type="button"
            onClick={() => handlePretest(false)}
            disabled={isPretesting}
            className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md"
          >
            Structural only
          </button>
        </div>
        {pretest && (
          <div className="space-y-2">
            {pretest.agent_error && (
              <p className="text-sm text-yellow-800 dark:text-yellow-200">{pretest.agent_error}</p>
            )}
            {pretest.findings.length === 0 ? (
              <p className="text-sm text-gray-600 dark:text-gray-400">
                No instrument defects from this walk
                {pretest.agent_ran ? '' : ' (structural only)'}.
              </p>
            ) : (
              <ul className="space-y-2">
                {pretest.findings.map((finding, index) => (
                  <PretestCard key={`${finding.check_id}:${finding.question_path}:${index}`} finding={finding} />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
};

export default FormLintPanel;
