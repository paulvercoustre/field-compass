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
          <select
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

      {data.length === 0 ? (
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
