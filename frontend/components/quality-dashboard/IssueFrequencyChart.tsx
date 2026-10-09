import React, { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { IssueFrequency } from '../../types';
import { issueName } from '../../utils/issueNames';
import { axisProps, tooltipProps, CHART_ACCENT } from '../charts/chartTheme';

interface IssueFrequencyChartProps {
  data: IssueFrequency[];
  onIssueClick?: (check: string) => void;
}

type DisplayLimit = 5 | 10 | 20 | 'all';

const IssueFrequencyChart: React.FC<IssueFrequencyChartProps> = ({ data, onIssueClick }) => {
  const [displayLimit, setDisplayLimit] = useState<DisplayLimit>(5);
  // The bars open their submissions with a mouse; the table does it from the
  // keyboard and reads out for a screen reader.
  const [view, setView] = useState<'chart' | 'table'>('chart');

  const displayData = displayLimit === 'all' ? data : data.slice(0, displayLimit);

  // Prepare data for horizontal bar chart
  const chartData = displayData.map((item) => ({
    check: item.check,
    name: issueName(item.check),
    count: item.count,
    percentage: item.percentage,
    affected: item.affected_submissions,
  }));

  const barColor = CHART_ACCENT;

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Issue frequency</h3>
        <div className="flex items-center gap-2">
          <div
            role="group"
            aria-label="Show as"
            className="inline-flex h-7 overflow-hidden rounded-md border border-gray-300 text-xs font-medium dark:border-gray-700"
          >
            {(['chart', 'table'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={view === option}
                onClick={() => setView(option)}
                className={`px-2.5 ${
                  view === option
                    ? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white'
                    : 'text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800/60'
                }`}
              >
                {option === 'chart' ? 'Chart' : 'Table'}
              </button>
            ))}
          </div>
          <select
            aria-label="How many issues to show"
            value={displayLimit}
            onChange={(e) =>
              setDisplayLimit(e.target.value === 'all' ? 'all' : (parseInt(e.target.value) as DisplayLimit))
            }
            className="h-7 text-xs font-medium bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md shadow-xs pl-2.5 pr-7 py-0 text-gray-700 dark:text-gray-200"
          >
            <option value={5}>Top 5</option>
            <option value={10}>Top 10</option>
            <option value={20}>Top 20</option>
            <option value="all">All</option>
          </select>
        </div>
      </div>

      {data.length > 0 && view === 'table' ? (
        <table className="min-w-full text-sm">
          <caption className="sr-only">Issue frequency</caption>
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
              <th scope="col" className="py-2 pr-3 font-medium">
                Issue
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Times found
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Submissions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {chartData.map((row) => (
              <tr key={row.check}>
                <td className="py-2 pr-3">
                  {onIssueClick ? (
                    <button
                      type="button"
                      onClick={() => onIssueClick(row.check)}
                      className="rounded text-left text-indigo-700 hover:underline dark:text-indigo-300"
                    >
                      {row.name}
                    </button>
                  ) : (
                    row.name
                  )}
                </td>
                <td className="tabular py-2 pr-3 text-right text-gray-700 dark:text-gray-300">
                  {row.count} ({row.percentage}%)
                </td>
                <td className="tabular py-2 text-right text-gray-700 dark:text-gray-300">{row.affected}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : data.length === 0 ? (
        <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">No issues found</div>
      ) : (
        <>
          <div style={{ width: '100%', height: Math.max(200, chartData.length * 35) }}>
            <ResponsiveContainer>
              <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                <XAxis type="number" {...axisProps} allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={240}
                  {...axisProps}
                  tick={{ fill: 'var(--fc-chart-tick)', fontSize: 12 }}
                />
                <Tooltip
                  {...tooltipProps}
                  formatter={(value, name, props) => {
                    if (name === 'count') {
                      return [`${value} occurrences (${props.payload.percentage}%)`, 'Count'];
                    }
                    return [value, name];
                  }}
                  labelFormatter={(label) => label}
                />
                <Bar
                  dataKey="count"
                  radius={[0, 4, 4, 0]}
                  barSize={18}
                  cursor={onIssueClick ? 'pointer' : 'default'}
                  onClick={(data: any) => onIssueClick && onIssueClick(data.check ?? data.payload?.check)}
                >
                  {chartData.map((_entry, index) => (
                    <Cell key={`cell-${index}`} fill={barColor} className="hover:opacity-80 transition-opacity" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
};

export default IssueFrequencyChart;
