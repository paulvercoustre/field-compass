import React from 'react';
import { AccountAIUsage } from '../../services/aiConnectionsApi';
import AIUsageChart from './AIUsageChart';

interface MeterProps {
  used: number;
  limit: number;
  unit?: string;
  label: string;
  inFlight?: number;
}

/** "143 of 200" with a bar that turns amber when it is used up. */
const Meter: React.FC<MeterProps> = ({ used, limit, unit = '', label, inFlight = 0 }) => {
  const share = limit > 0 ? Math.min(100, Math.round(((used + inFlight) / limit) * 100)) : 100;
  const full = used + inFlight >= limit;
  return (
    <div className="min-w-[8rem]">
      <span className={`tabular text-sm ${full ? 'text-amber-700 dark:text-amber-300' : 'text-gray-900 dark:text-white'}`}>
        {Math.round((used + inFlight) * 10) / 10} of {limit}
        {unit}
      </span>
      {inFlight > 0 && <span className="text-xs text-gray-500 dark:text-gray-400"> ({inFlight} in progress)</span>}
      <div
        className="mt-1 h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={used + inFlight}
        aria-label={label}
      >
        <div className={`h-1.5 rounded-full ${full ? 'bg-amber-500' : 'bg-indigo-500'}`} style={{ width: `${share}%` }} />
      </div>
    </div>
  );
};

const OwnKey: React.FC<{ label: string; amount: string }> = ({ label, amount }) => (
  <div>
    <span className="tabular text-sm text-gray-900 dark:text-white">{amount}</span>
    <span className="block text-xs text-gray-500 dark:text-gray-400">on {label} · no limit</span>
  </div>
);

interface AIUsageSectionProps {
  usage: AccountAIUsage | null;
  error: string | null;
  refreshKey?: number;
}

/**
 * Account settings › AI integration › Usage: a chart over time, then this
 * month per survey against its included usage, or on its own keys.
 */
const AIUsageSection: React.FC<AIUsageSectionProps> = ({ usage, error, refreshKey }) => {
  const monthName = usage
    ? new Date(`${usage.month}-01T00:00:00Z`).toLocaleString(undefined, { month: 'long', timeZone: 'UTC' })
    : '';
  const rules = usage?.rule_requests_today;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-card dark:border-gray-800 dark:bg-gray-900">
      <h2 className="text-base font-semibold tracking-tight text-gray-900 dark:text-white">Usage</h2>
      <p className="mt-1 mb-4 text-sm text-gray-500 dark:text-gray-400">On the surveys you own.</p>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!usage && !error && <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>}

      {usage && (
        <>
          <AIUsageChart surveys={usage.surveys} refreshKey={refreshKey} />

          <h3 className="mt-6 text-sm font-medium text-gray-900 dark:text-white">{monthName}</h3>
          {usage.surveys.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">You don't own any surveys yet.</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-gray-500 dark:text-gray-400">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Survey</th>
                    <th className="py-2 pr-4 font-medium">AI review</th>
                    <th className="py-2 pr-4 font-medium">Translation</th>
                    <th className="py-2 font-medium">Transcription</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.surveys.map((survey) => {
                    const reviews = survey.by_feature
                      .filter((row) => row.feature === 'qualitative_check')
                      .reduce((total, row) => total + row.calls - row.failed, 0);
                    const transcription = survey.transcription;
                    const translation = survey.translation;
                    return (
                      <tr key={survey.survey_id} className="border-t border-gray-100 align-top dark:border-gray-800">
                        <td className="py-3 pr-4 font-medium text-gray-900 dark:text-white">{survey.survey_name}</td>
                        <td className="py-3 pr-4">
                          {survey.allowance ? (
                            <Meter
                              used={survey.allowance.used}
                              inFlight={survey.allowance.in_flight}
                              limit={survey.allowance.limit}
                              label={`Included AI reviews used in ${monthName} on ${survey.survey_name}`}
                            />
                          ) : survey.provider ? (
                            <OwnKey label={survey.provider.label} amount={`${reviews.toLocaleString()} reviewed`} />
                          ) : (
                            <span className="text-xs text-gray-400 dark:text-gray-500">None</span>
                          )}
                        </td>
                        <td className="py-3 pr-4">
                          {translation?.provider ? (
                            <OwnKey
                              label={translation.provider.label}
                              amount={`${translation.own_key_translations.toLocaleString()} translated`}
                            />
                          ) : translation?.allowance ? (
                            <Meter
                              used={translation.allowance.used}
                              inFlight={translation.allowance.in_flight}
                              limit={translation.allowance.limit}
                              label={`Included translations used in ${monthName} on ${survey.survey_name}`}
                            />
                          ) : (
                            <span className="text-xs text-gray-400 dark:text-gray-500">Off</span>
                          )}
                        </td>
                        <td className="py-3">
                          {transcription?.provider ? (
                            <OwnKey label={transcription.provider.label} amount={`${transcription.own_key_minutes} min`} />
                          ) : transcription ? (
                            <Meter
                              used={transcription.used_minutes}
                              limit={transcription.limit_minutes}
                              unit=" min"
                              label={`Included transcription minutes used in ${monthName} on ${survey.survey_name}`}
                            />
                          ) : (
                            <span className="text-xs text-gray-400 dark:text-gray-500">Off</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {rules && rules.limit > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-gray-100 pt-4 dark:border-gray-800">
              <span className="text-sm text-gray-700 dark:text-gray-300">AI rule requests today</span>
              <div className="w-48">
                <Meter used={rules.used} limit={rules.limit} label="Included AI rule requests used today" />
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
};

export default AIUsageSection;
