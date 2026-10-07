import React from 'react';
import { AccountAIUsage, AIConnectionSummary } from '../../services/aiConnectionsApi';
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
      <span
        className={`tabular text-sm ${full ? 'text-amber-700 dark:text-amber-300' : 'text-gray-900 dark:text-white'}`}
      >
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
        <div
          className={`h-1.5 rounded-full ${full ? 'bg-amber-500' : 'bg-indigo-500'}`}
          style={{ width: `${share}%` }}
        />
      </div>
    </div>
  );
};

/** One survey's use this month: on its own key, or its share of the included usage. */
const SurveyShare: React.FC<{ amount: string; provider: AIConnectionSummary | null; included: boolean }> = ({
  amount,
  provider,
  included,
}) =>
  provider || included ? (
    <div>
      <span className="tabular text-sm text-gray-900 dark:text-white">{amount}</span>
      <span className="block text-xs text-gray-500 dark:text-gray-400">
        {provider ? `on ${provider.label} · no limit` : 'included usage'}
      </span>
    </div>
  ) : (
    <span className="text-xs text-gray-400 dark:text-gray-500">None</span>
  );

const IncludedMeter: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <span className="block text-xs font-medium text-gray-700 dark:text-gray-300">{title}</span>
    <div className="mt-1">{children}</div>
  </div>
);

interface AIUsageSectionProps {
  usage: AccountAIUsage | null;
  error: string | null;
  refreshKey?: number;
}

/**
 * Account settings › AI integration › Usage: a chart over time, then this
 * month's included usage -- shared by all the user's surveys -- and each
 * survey's use, on the included usage or on its own keys.
 */
const AIUsageSection: React.FC<AIUsageSectionProps> = ({ usage, error, refreshKey }) => {
  const monthName = usage
    ? new Date(`${usage.month}-01T00:00:00Z`).toLocaleString(undefined, { month: 'long', timeZone: 'UTC' })
    : '';
  const rules = usage?.rule_requests_this_month;
  const included = usage?.included_usage ?? { reviews: null, translations: null, transcription: null };
  const hasIncluded = Boolean(included.reviews || included.translations || included.transcription);

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
          {hasIncluded && (
            <div className="mt-2 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Included usage, shared by all your surveys on Field Compass's keys
              </p>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
                {included.reviews && (
                  <IncludedMeter title="AI review">
                    <Meter
                      used={included.reviews.used}
                      inFlight={included.reviews.in_flight}
                      limit={included.reviews.limit}
                      label={`Included AI reviews used in ${monthName}`}
                    />
                  </IncludedMeter>
                )}
                {included.translations && (
                  <IncludedMeter title="Translation">
                    <Meter
                      used={included.translations.used}
                      inFlight={included.translations.in_flight}
                      limit={included.translations.limit}
                      label={`Included translations used in ${monthName}`}
                    />
                  </IncludedMeter>
                )}
                {included.transcription && (
                  <IncludedMeter title="Transcription">
                    <Meter
                      used={included.transcription.used_minutes}
                      limit={included.transcription.limit_minutes}
                      unit=" min"
                      label={`Included transcription minutes used in ${monthName}`}
                    />
                  </IncludedMeter>
                )}
              </div>
            </div>
          )}
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
                    const { transcription, translation } = survey;
                    return (
                      <tr key={survey.survey_id} className="border-t border-gray-100 align-top dark:border-gray-800">
                        <td className="py-3 pr-4 font-medium text-gray-900 dark:text-white">{survey.survey_name}</td>
                        <td className="py-3 pr-4">
                          <SurveyShare
                            amount={`${survey.reviews.toLocaleString()} reviewed`}
                            provider={survey.provider}
                            included={included.reviews !== null}
                          />
                        </td>
                        <td className="py-3 pr-4">
                          {translation ? (
                            <SurveyShare
                              amount={`${translation.translations.toLocaleString()} translated`}
                              provider={translation.provider}
                              included={included.translations !== null}
                            />
                          ) : (
                            <span className="text-xs text-gray-400 dark:text-gray-500">Off</span>
                          )}
                        </td>
                        <td className="py-3">
                          {transcription ? (
                            <SurveyShare
                              amount={`${transcription.minutes} min`}
                              provider={transcription.provider}
                              included={included.transcription !== null}
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
              <span className="text-sm text-gray-700 dark:text-gray-300">AI rule requests this month</span>
              <div className="w-48">
                <Meter used={rules.used} limit={rules.limit} label="Included AI rule requests used this month" />
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
};

export default AIUsageSection;
