import React, { useCallback, useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getUsage, Usage } from '../../services/adminApi';
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

const Check: React.FC<{ on: boolean }> = ({ on }) => (
  <span className={on ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-300 dark:text-gray-600'}>
    {on ? '✓' : '–'}
  </span>
);

/**
 * Account Settings › App usage, for the accounts in USAGE_ADMIN_EMAILS: signups, who came back, how far
 * people get, and where they came from.
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
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <Stat label="Signups" value={week.signups} hint={`${month.signups} in 30 days`} />
          <Stat label="Active users" value={week.active_users} hint={`${month.active_users} in 30 days`} />
          <Stat label="Logins" value={week.logins} hint={`${month.logins} in 30 days`} />
          <Stat label="Surveys added" value={week.surveys_created} hint={`${month.surveys_created} in 30 days`} />
          <Stat label="Pulls" value={week.pulls} hint={`${month.pulls} in 30 days`} />
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
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="How far people get" description="Every account, all time." />
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

        <Card>
          <CardHeader
            title="Where signups came from"
            description="Last 30 days, from the campaign tags on links to the app."
          />
          {usage.signup_sources_30_days.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No signups recorded yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {usage.signup_sources_30_days.map((row) => (
                <li key={row.source} className="flex justify-between py-2 text-sm">
                  <span className="text-gray-700 dark:text-gray-300">{row.source}</span>
                  <span className="tabular-nums text-gray-500 dark:text-gray-400">{row.signups}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

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
                <th className="px-5 py-2 text-center font-medium">Pulled</th>
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
                  <td className="px-5 py-2 text-center">
                    <Check on={row.pulled} />
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
