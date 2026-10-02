import React, { useEffect, useState } from 'react';
import { AccountAIUsage, AIFeatureUsage, getAccountAIUsage } from '../../services/aiConnectionsApi';

const formatTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n));

const sum = (rows: AIFeatureUsage[], key: 'calls' | 'failed' | 'input_tokens' | 'output_tokens') =>
  rows.reduce((total, row) => total + row[key], 0);

/**
 * Account Settings: this month's AI use on every survey the user owns, how
 * much of each survey's free allowance is left, and today's free rule requests.
 */
const AIUsageSection: React.FC = () => {
  const [usage, setUsage] = useState<AccountAIUsage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAccountAIUsage()
      .then(setUsage)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load AI use.'));
  }, []);

  const monthName = usage
    ? new Date(`${usage.month}-01T00:00:00Z`).toLocaleString(undefined, { month: 'long', timeZone: 'UTC' })
    : '';
  const resets = usage
    ? new Date(usage.resets_at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', timeZone: 'UTC' })
    : '';
  const rules = usage?.rule_requests_today;

  return (
    <section className="bg-white dark:bg-gray-900 rounded-xl shadow-card border border-gray-200 dark:border-gray-800 p-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white">AI use{monthName && ` in ${monthName}`}</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 mb-4">
        On the surveys you own. Each survey without its own provider gets a free monthly allowance of AI checks
        {resets && `, renewed on ${resets}`}. Tokens are as reported by the provider.
      </p>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!usage && !error && <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>}

      {usage && rules && rules.limit > 0 && (
        <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">
          Free AI rule requests today: <strong>{rules.used}</strong> of {rules.limit}
          {rules.remaining === 0 && (
            <span className="text-amber-700 dark:text-amber-300">
              {' '}— used up until tomorrow, except on surveys that use your own provider.
            </span>
          )}
        </p>
      )}

      {usage && usage.surveys.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400">You don't own any surveys yet.</p>
      )}

      {usage && usage.surveys.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-gray-700 dark:text-gray-300">
            <thead className="text-xs text-gray-500 dark:text-gray-400">
              <tr>
                <th className="font-medium py-2 pr-3">Survey</th>
                <th className="font-medium py-2 pr-3">Runs on</th>
                <th className="font-medium py-2 pr-3">AI checks</th>
                <th className="font-medium py-2 pr-3 text-right">Rules written</th>
                <th className="font-medium py-2 pr-3 text-right">Failed</th>
                <th className="font-medium py-2 text-right">Tokens in / out</th>
              </tr>
            </thead>
            <tbody>
              {usage.surveys.map((survey) => {
                const checks = survey.by_feature.filter((row) => row.feature === 'qualitative_check');
                const ruleRows = survey.by_feature.filter((row) => row.feature !== 'qualitative_check');
                const allowance = survey.allowance;
                const spent = allowance ? allowance.used + allowance.in_flight : 0;
                const share =
                  allowance && allowance.limit > 0 ? Math.min(100, Math.round((spent / allowance.limit) * 100)) : 100;
                return (
                  <tr key={survey.survey_id} className="border-t border-gray-100 dark:border-gray-700 align-top">
                    <td className="py-2 pr-3 font-medium text-gray-900 dark:text-white">{survey.survey_name}</td>
                    <td className="py-2 pr-3 text-xs">
                      {survey.provider ? survey.provider.label : 'Field Compass allowance'}
                    </td>
                    <td className="py-2 pr-3 min-w-[9rem]">
                      {allowance ? (
                        <>
                          <span className={allowance.remaining === 0 ? 'text-amber-700 dark:text-amber-300' : ''}>
                            {spent} of {allowance.limit}
                          </span>
                          {allowance.in_flight > 0 && (
                            <span className="text-xs text-gray-500 dark:text-gray-400"> ({allowance.in_flight} in progress)</span>
                          )}
                          <div
                            className="mt-1 h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700"
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={allowance.limit}
                            aria-valuenow={spent}
                            aria-label={`Free AI checks used this month on ${survey.survey_name}`}
                          >
                            <div
                              className={`h-1.5 rounded-full ${allowance.remaining === 0 ? 'bg-amber-500' : 'bg-indigo-500'}`}
                              style={{ width: `${share}%` }}
                            />
                          </div>
                        </>
                      ) : (
                        <>
                          {sum(checks, 'calls')}
                          <span className="text-xs text-gray-500 dark:text-gray-400"> · no Field Compass limit</span>
                        </>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right">{sum(ruleRows, 'calls')}</td>
                    <td className="py-2 pr-3 text-right">{sum(survey.by_feature, 'failed')}</td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {formatTokens(sum(survey.by_feature, 'input_tokens'))} /{' '}
                      {formatTokens(sum(survey.by_feature, 'output_tokens'))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export default AIUsageSection;
