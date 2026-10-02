import React, { useEffect, useState } from 'react';
import { getSurveyAIUsage, SurveyAIUsage as Usage } from '../../services/aiConnectionsApi';

const FEATURE_LABELS: Record<string, string> = {
  qualitative_check: 'AI checks',
  rule_generation: 'Rules written',
  rule_suggestion: 'Rule suggestions',
};

const formatTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n));

/**
 * This month's AI use for a survey, and how much of the free allowance is
 * left when it runs on the Field Compass key. Which provider a survey uses is
 * chosen in Account Settings, not here.
 */
const SurveyAIUsage: React.FC<{ surveyId: string }> = ({ surveyId }) => {
  const [usage, setUsage] = useState<Usage | null>(null);

  useEffect(() => {
    let cancelled = false;
    setUsage(null);
    getSurveyAIUsage(surveyId)
      .then((data) => !cancelled && setUsage(data))
      .catch(() => {
        // Viewers cannot see usage; the section simply does not show.
      });
    return () => {
      cancelled = true;
    };
  }, [surveyId]);

  if (!usage) return null;

  const monthName = new Date(`${usage.month}-01T00:00:00Z`).toLocaleString(undefined, { month: 'long', timeZone: 'UTC' });
  const resets = new Date(usage.resets_at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', timeZone: 'UTC' });
  const allowance = usage.allowance;
  const spent = allowance ? allowance.used + allowance.in_flight : 0;
  const share = allowance && allowance.limit > 0 ? Math.min(100, Math.round((spent / allowance.limit) * 100)) : 100;

  return (
    <div className="p-3 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
      <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-2">AI use in {monthName}</h3>

      {allowance ? (
        <div className="mb-3">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            Field Compass AI allowance: <strong>{spent}</strong> of {allowance.limit} checks used
            {allowance.in_flight > 0 && ` (${allowance.in_flight} in progress)`}. Resets {resets}.
          </p>
          <div
            className="mt-1.5 h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={allowance.limit}
            aria-valuenow={spent}
            aria-label="Free AI checks used this month"
          >
            <div
              className={`h-1.5 rounded-full ${allowance.remaining === 0 ? 'bg-amber-500' : 'bg-indigo-500'}`}
              style={{ width: `${share}%` }}
            />
          </div>
          {allowance.remaining === 0 && (
            <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-300">
              Used up: new submissions are not AI-checked until {resets}, or straight away with your own AI provider
              (Account Settings › AI providers).
            </p>
          )}
        </div>
      ) : (
        usage.provider && (
          <p className="mb-3 text-sm text-gray-700 dark:text-gray-300">
            Runs on {usage.provider.label} ({usage.provider.host}), so there is no Field Compass limit.
          </p>
        )
      )}

      {usage.by_feature.length === 0 ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">No AI calls yet this month.</p>
      ) : (
        <table className="w-full text-xs text-left text-gray-700 dark:text-gray-300">
          <thead className="text-gray-500 dark:text-gray-400">
            <tr>
              <th className="font-medium py-1">&nbsp;</th>
              <th className="font-medium py-1 text-right">Calls</th>
              <th className="font-medium py-1 text-right">Failed</th>
              <th className="font-medium py-1 text-right">Tokens in / out</th>
            </tr>
          </thead>
          <tbody>
            {usage.by_feature.map((row) => (
              <tr key={row.feature} className="border-t border-gray-100 dark:border-gray-700">
                <td className="py-1">{FEATURE_LABELS[row.feature] ?? row.feature}</td>
                <td className="py-1 text-right">{row.calls}</td>
                <td className="py-1 text-right">{row.failed}</td>
                <td className="py-1 text-right">
                  {formatTokens(row.input_tokens)} / {formatTokens(row.output_tokens)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default SurveyAIUsage;
