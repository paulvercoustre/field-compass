import React from 'react';
import { AccountAIUsage, AI_FEATURES } from '../../services/aiConnectionsApi';
import { SparkleIcon, TranslateIcon } from '../ui/icons';

const MicIcon: React.FC<{ className?: string }> = ({ className = 'h-4 w-4' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8" />
  </svg>
);

interface AIOverviewSectionProps {
  usage: AccountAIUsage | null;
}

/**
 * Account settings › AI integration, first card: what AI does in Field
 * Compass, which provider powers each part, and what the included usage is.
 * Explained once here, so the cards below don't have to.
 */
const AIOverviewSection: React.FC<AIOverviewSectionProps> = ({ usage }) => {
  const reviewLimit = usage?.included.reviews_per_survey_month ?? null;
  const translationLimit = usage?.included.translations_per_survey_month ?? null;
  const minutesLimit = usage?.included.transcription_minutes_per_survey_month ?? null;
  const renews = usage
    ? new Date(usage.resets_at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', timeZone: 'UTC' })
    : null;
  const rules = usage?.included.rule_requests_per_month ?? null;
  const figures = [
    reviewLimit ? { value: reviewLimit, unit: 'AI-reviewed submissions', per: 'per survey, per month' } : null,
    translationLimit ? { value: translationLimit, unit: 'translated answers', per: 'per survey, per month' } : null,
    minutesLimit ? { value: minutesLimit, unit: 'minutes of transcription', per: 'per survey, per month' } : null,
    rules ? { value: rules, unit: 'AI rule requests', per: 'per person, per month' } : null,
  ].filter((figure): figure is { value: number; unit: string; per: string } => figure !== null);

  const features = [
    { icon: <SparkleIcon className="h-4 w-4" />, ...AI_FEATURES.review, runsOn: 'any OpenAI-compatible model' },
    { icon: <TranslateIcon className="h-4 w-4" />, ...AI_FEATURES.translation, runsOn: 'any OpenAI-compatible model' },
    { icon: <MicIcon className="h-4 w-4" />, ...AI_FEATURES.transcription, runsOn: 'ElevenLabs Scribe' },
  ];

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-card dark:border-gray-800 dark:bg-gray-900">
      <h2 className="text-base font-semibold tracking-tight text-gray-900 dark:text-white">AI in Field Compass</h2>

      {/* Plain rows, not boxes: this is what each part does, not something to click. */}
      <dl className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
        {features.map((feature) => (
          <div key={feature.name} className="grid grid-cols-1 gap-x-6 gap-y-0.5 py-3 sm:grid-cols-[11rem,1fr]">
            <dt className="flex items-center gap-1.5 text-sm font-medium text-gray-900 dark:text-white">
              <span className="text-gray-400 dark:text-gray-500" aria-hidden="true">
                {feature.icon}
              </span>
              {feature.name}
            </dt>
            <dd className="text-sm text-gray-600 dark:text-gray-400">
              {feature.does} <span className="text-gray-500 dark:text-gray-500">Runs on {feature.runsOn}.</span>
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-2 border-t border-gray-100 pt-4 dark:border-gray-800">
        <h3 className="text-sm font-medium text-gray-900 dark:text-white">Included usage</h3>
        {figures.length > 0 ? (
          <ul className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4 sm:gap-0 sm:divide-x sm:divide-gray-100 dark:sm:divide-gray-800">
            {figures.map((figure, index) => (
              <li key={figure.unit} className={index > 0 ? 'sm:pl-5' : ''}>
                <span className="tabular block text-2xl font-semibold tracking-tight text-gray-900 dark:text-white">
                  {figure.value.toLocaleString()}
                </span>
                <span className="block text-sm text-gray-700 dark:text-gray-300">{figure.unit}</span>
                <span className="block text-xs text-gray-500 dark:text-gray-400">{figure.per}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">None on this server: AI runs on your own keys.</p>
        )}
        <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
          {renews && figures.length > 0 ? `Renews ${renews}. ` : ''}A survey that uses your own API key for a feature has no
          Field Compass limit for it: choose the key in the survey's settings, or below.
        </p>
      </div>
    </section>
  );
};

export default AIOverviewSection;
