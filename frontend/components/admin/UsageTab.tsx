import React, { useCallback, useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ActivationWeek, AIBudget, getUsage, Usage } from '../../services/adminApi';
import { Card, CardHeader, SectionLabel } from '../ui/Card';
import { CHART_ACCENT, SERIES_COLORS, axisProps, gridProps, tooltipProps } from '../charts/chartTheme';

const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—';

const Stat: React.FC<{ label: string; value: React.ReactNode; hint?: string }> = ({ label, value, hint }) => (
  <Card>
    <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
    <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900 dark:text-white">{value}</p>
    {hint && <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{hint}</p>}
  </Card>
);

const dollars = (amount: number) => (Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`);

/** This month's spend on Field Compass's keys against AI_MONTHLY_BUDGET_USD. */
const AIBudgetCard: React.FC<{ budget: AIBudget }> = ({ budget }) => {
  const month = new Date(`${budget.month}-01T00:00:00Z`).toLocaleString(undefined, {
    month: 'long',
    timeZone: 'UTC',
  });
  const resumes = new Date(budget.resumes_at).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  const share = budget.budget_usd ? Math.round((budget.spent_usd / budget.budget_usd) * 100) : null;
  const bar = budget.paused ? 'bg-red-500' : share !== null && share >= 80 ? 'bg-amber-500' : 'bg-indigo-500';
  return (
    <Card>
      <CardHeader
        title={`AI budget, ${month}`}
        description="Spent on Field Compass's AI keys by everyone, estimated at list price."
      />
      <p className="text-2xl font-semibold tabular-nums text-gray-900 dark:text-white">
        {dollars(budget.spent_usd)}
        {budget.budget_usd !== null && (
          <span className="text-base font-normal text-gray-500 dark:text-gray-400">
            {' '}
            of {dollars(budget.budget_usd)} · {share}%
          </span>
        )}
      </p>
      {share !== null && (
        <div
          className="mt-2 h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, share)}
          aria-label={`AI budget used in ${month}`}
        >
          <div className={`h-1.5 rounded-full ${bar}`} style={{ width: `${Math.min(100, share)}%` }} />
        </div>
      )}
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        {budget.budget_usd === null
          ? 'No monthly budget: set AI_MONTHLY_BUDGET_USD to pause the included AI at a ceiling.'
          : budget.paused
            ? `Paused for everyone until ${resumes}. Raise AI_MONTHLY_BUDGET_USD to resume now.`
            : `The included AI pauses for everyone if it reaches the budget, until ${resumes}. You're emailed at 80% and 100%.`}
      </p>
      {budget.unpriced.length > 0 && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          Not in the price table, so counted at its highest price:{' '}
          {budget.unpriced.map((item) => `${item.model} (${item.calls} calls)`).join(', ')}. Add them to
          services/ai_prices.json.
        </p>
      )}
    </Card>
  );
};

const Check: React.FC<{ on: boolean | null }> = ({ on }) =>
  on === null ? (
    <span
      className="text-gray-300 dark:text-gray-600"
      title="Not measured: signed up before review decisions were recorded"
    >
      ?
    </span>
  ) : (
    <span className={on ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-300 dark:text-gray-600'}>
      {on ? '✓' : '–'}
    </span>
  );

const percent = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '–');

const ACTIVATION_STEPS: { key: keyof ActivationWeek; label: string }[] = [
  { key: 'connected_kobo', label: 'Kobo' },
  { key: 'added_survey', label: 'Survey' },
  { key: 'pulled', label: 'Pulled' },
  { key: 'checks_on', label: 'Check on' },
  { key: 'decided', label: 'Reviewed' },
];

/** Each signup week, how many got to each step within activation_days, newest first. */
const ActivationCard: React.FC<{ weeks: ActivationWeek[]; days: number; since: string | null }> = ({
  weeks,
  days,
  since,
}) => {
  const rows = weeks.filter((week) => week.signups || week.invited).reverse();
  return (
    <Card flush>
      <div className="p-5 pb-0">
        <CardHeader
          title="Activation by signup week"
          description={`Accounts that signed up on their own, and how many got to each step within ${days} days. Activated: a survey of theirs pulled, with a check on and a review decision. ${
            since
              ? `Measured from the week of the first review decision recorded, ${shortDate(since)}.`
              : 'Measured from the first review decision recorded: none yet.'
          }`}
        />
      </div>
      {rows.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-gray-500 dark:text-gray-400">No signups in the last 12 weeks.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs font-medium text-gray-500 dark:border-gray-800 dark:text-gray-400">
                <th className="px-5 py-2 font-medium">Week of</th>
                <th className="px-3 py-2 text-right font-medium">Signups</th>
                {ACTIVATION_STEPS.map((step) => (
                  <th key={step.key} className="px-3 py-2 text-right font-medium">
                    {step.label}
                  </th>
                ))}
                <th className="px-5 py-2 text-right font-medium">Activated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {rows.map((week) => (
                <tr key={week.week}>
                  <td className="whitespace-nowrap px-5 py-2 text-gray-700 dark:text-gray-300">
                    {shortDate(week.week)}
                    {!week.complete && (
                      <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">still open</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">
                    {week.signups}
                    {week.invited > 0 && (
                      <span className="ml-1 text-xs text-gray-400 dark:text-gray-500">+{week.invited} invited</span>
                    )}
                  </td>
                  {ACTIVATION_STEPS.map((step) => (
                    <td key={step.key} className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-400">
                      {week[step.key] ?? '—'}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-5 py-2 text-right tabular-nums font-medium text-gray-900 dark:text-white">
                    {week.activated === null ? '—' : `${week.activated} · ${percent(week.activated, week.signups)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
};

/**
 * Account Settings › App usage, for the accounts in USAGE_ADMIN_EMAILS: signups, who came back, how far
 * people get, who brings others in, where they came from, and how many got set up within a week.
 */
const UsageTab: React.FC = () => {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setUsage(await getUsage());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load usage');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <Card>
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      </Card>
    );
  }
  if (!usage) {
    return (
      <Card>
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading usage…</p>
      </Card>
    );
  }

  const week = usage.last_7_days;
  const month = usage.last_30_days;
  const signedUp = usage.funnel[0]?.users || 0;
  const weekly = usage.weekly.map((row) => ({ ...row, label: shortDate(row.week) }));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-gray-900 dark:text-white">App usage</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Everyone on this Field Compass instance. Visible only to the accounts listed in USAGE_ADMIN_EMAILS.
            {usage.tracking_since
              ? ` Logins and active users are counted from ${shortDate(usage.tracking_since)}.`
              : ' Logins and active users start counting from the next sign-in.'}
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="flex-shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-xs hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div>
        <SectionLabel>Last 7 days</SectionLabel>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 xl:grid-cols-7">
          <Stat
            label="Active surveys"
            value={week.active_surveys ?? 0}
            hint={`Pulled and reviewed · ${month.active_surveys ?? 0} in 30 days`}
          />
          <Stat label="Signups" value={week.signups} hint={`${month.signups} in 30 days`} />
          <Stat label="Active users" value={week.active_users} hint={`${month.active_users} in 30 days`} />
          <Stat label="Logins" value={week.logins} hint={`${month.logins} in 30 days`} />
          <Stat label="Surveys added" value={week.surveys_created} hint={`${month.surveys_created} in 30 days`} />
          <Stat label="Pulls" value={week.pulls} hint={`${month.pulls} in 30 days`} />
          <Stat
            label="Invites sent"
            value={week.invites_sent ?? 0}
            hint={`${week.invites_accepted ?? 0} accepted · ${month.invites_sent ?? 0} sent in 30 days`}
          />
        </div>
      </div>

      <div>
        <SectionLabel>All time, and the last 30 days</SectionLabel>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <Stat label="Accounts" value={usage.totals.users} hint={`${usage.totals.kobo_connected} connected to Kobo`} />
          <Stat
            label="Surveys"
            value={usage.totals.surveys}
            hint={`${usage.totals.submissions.toLocaleString()} submissions held`}
          />
          <Stat
            label="AI reviews (30 days)"
            value={month.ai_reviews.toLocaleString()}
            hint={`$${month.operator_ai_spend_usd.toFixed(2)} on your key, incl. translation and transcription`}
          />
          <Stat
            label="Translations (30 days)"
            value={(month.translations ?? 0).toLocaleString()}
            hint="Answers translated"
          />
          <Stat
            label="Transcriptions (30 days)"
            value={month.transcriptions.toLocaleString()}
            hint={`${month.audio_minutes} minutes of audio`}
          />
        </div>
      </div>

      {usage.ai_budget && <AIBudgetCard budget={usage.ai_budget} />}

      <Card>
        <CardHeader title="Week by week" description="Monday to Sunday, last 12 weeks." />
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weekly} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="label" {...axisProps} />
              <YAxis allowDecimals={false} {...axisProps} />
              <Tooltip {...tooltipProps} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="signups" name="Signups" fill={CHART_ACCENT} radius={[3, 3, 0, 0]} />
              <Bar dataKey="active_users" name="Active users" fill={SERIES_COLORS[1]} radius={[3, 3, 0, 0]} />
              <Bar dataKey="pulls" name="Pulls" fill={SERIES_COLORS[3]} radius={[3, 3, 0, 0]} />
              <Bar dataKey="active_surveys" name="Active surveys" fill={SERIES_COLORS[2]} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="How far people get"
            description={`Every account, all time; each step counts the accounts that have done it. ${
              usage.review_tracking_since
                ? `Review decisions are counted from ${shortDate(usage.review_tracking_since)}.`
                : 'Review decisions are counted from the first one recorded.'
            }`}
          />
          <ul className="space-y-3">
            {usage.funnel.map((step) => {
              const share = signedUp ? Math.round((step.users / signedUp) * 100) : 0;
              return (
                <li key={step.step}>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-700 dark:text-gray-300">{step.step}</span>
                    <span className="tabular-nums text-gray-500 dark:text-gray-400">
                      {step.users} · {share}%
                    </span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-gray-100 dark:bg-gray-800">
                    <div className="h-2 rounded-full bg-indigo-500" style={{ width: `${share}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>

        {/* min-w-0: a grid item is otherwise as wide as its table, past the screen on a phone */}
        <Card flush className="min-w-0">
          <div className="p-5 pb-0">
            <CardHeader
              title="Where signups came from, and how far they got"
              description="Last 12 weeks, from the campaign tags on links to the app."
            />
          </div>
          {usage.signup_funnel_by_source.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-gray-500 dark:text-gray-400">No signups recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs font-medium text-gray-500 dark:border-gray-800 dark:text-gray-400">
                    <th className="px-5 py-2 font-medium">Source</th>
                    <th className="px-3 py-2 text-right font-medium">Signups</th>
                    <th className="px-3 py-2 text-right font-medium">Kobo</th>
                    <th className="px-3 py-2 text-right font-medium">Pulled</th>
                    <th className="px-3 py-2 text-right font-medium">Reviewed</th>
                    <th className="px-5 py-2 text-right font-medium">Activated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {usage.signup_funnel_by_source.map((row) => (
                    <tr key={row.source}>
                      <td className="px-5 py-2 text-gray-700 dark:text-gray-300">{row.source}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">
                        {row.signups}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-400">
                        {row.connected_kobo}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-400">
                        {row.pulled}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-400">
                        {row.decided}
                      </td>
                      <td
                        className="whitespace-nowrap px-5 py-2 text-right tabular-nums text-gray-600 dark:text-gray-400"
                        title="Of the signups late enough to measure"
                      >
                        {row.activation_measured ? `${row.activated} of ${row.activation_measured}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <ActivationCard
        weeks={usage.activation ?? []}
        days={usage.activation_days ?? 7}
        since={usage.review_tracking_since ?? null}
      />

      <Card flush>
        <div className="p-5 pb-0">
          <CardHeader title="Recent signups" description="Newest first." />
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs font-medium text-gray-500 dark:border-gray-800 dark:text-gray-400">
                <th className="px-5 py-2 font-medium">Account</th>
                <th className="px-3 py-2 font-medium">Signed up</th>
                <th className="px-3 py-2 font-medium">Last seen</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 text-center font-medium">Kobo</th>
                <th className="px-3 py-2 text-center font-medium">Surveys</th>
                <th className="px-3 py-2 text-center font-medium">Pulled</th>
                <th className="px-3 py-2 text-center font-medium">Check on</th>
                <th className="px-3 py-2 text-center font-medium">Reviewed</th>
                <th className="px-5 py-2 text-center font-medium">Activated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {usage.recent_signups.map((row) => (
                <tr key={row.email}>
                  <td className="px-5 py-2">
                    <div className="text-gray-900 dark:text-white">{row.full_name || row.email}</div>
                    {row.full_name && <div className="text-xs text-gray-500 dark:text-gray-400">{row.email}</div>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-600 dark:text-gray-400">
                    {shortDate(row.signed_up_at)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-600 dark:text-gray-400">
                    {shortDate(row.last_seen_at)}
                  </td>
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{row.source ?? '—'}</td>
                  <td className="px-3 py-2 text-center">
                    <Check on={row.kobo_connected} />
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums text-gray-600 dark:text-gray-400">{row.surveys}</td>
                  <td className="px-3 py-2 text-center">
                    <Check on={row.pulled} />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <Check on={row.checks_on} />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <Check on={row.decided} />
                  </td>
                  <td className="px-5 py-2 text-center">
                    <Check on={row.activated} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

export default UsageTab;
