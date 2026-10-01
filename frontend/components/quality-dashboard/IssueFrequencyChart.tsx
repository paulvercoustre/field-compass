import React, { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { IssueFrequency } from '../../types';
import { checkLabel } from '../../utils/checkLabels';

interface IssueFrequencyChartProps {
  data: IssueFrequency[];
}

type DisplayLimit = 5 | 10 | 20 | 'all';

// Bars are not clickable yet. They used to say "click to filter" and then open
// the unfiltered list, which reads as "these are the matching submissions".
// Wire them up once the submissions list can filter by issue.
const IssueFrequencyChart: React.FC<IssueFrequencyChartProps> = ({ data }) => {
  const [displayLimit, setDisplayLimit] = useState<DisplayLimit>(5);
  
  const displayData = displayLimit === 'all' ? data : data.slice(0, displayLimit);
  
  // Prepare data for horizontal bar chart
  const chartData = displayData.map(item => ({
    name: checkLabel(item.check),
    count: item.count,
    percentage: item.percentage,
    affected: item.affected_submissions,
  }));

  const barColor = '#6366f1'; // indigo-500

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
          Issue Frequency
        </h3>
        <div className="flex items-center gap-2">
          <select
            value={displayLimit}
            onChange={(e) => setDisplayLimit(e.target.value === 'all' ? 'all' : parseInt(e.target.value) as DisplayLimit)}
            className="text-sm bg-gray-100 dark:bg-gray-700 border border-gray-500 dark:border-gray-600 rounded px-2 py-1 text-gray-700 dark:text-gray-300"
          >
            <option value={5}>Top 5</option>
            <option value={10}>Top 10</option>
            <option value={20}>Top 20</option>
            <option value="all">All</option>
          </select>
        </div>
      </div>
      
      {data.length === 0 ? (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          No issues found
        </div>
      ) : (
        <>
          <div style={{ width: '100%', height: Math.max(200, chartData.length * 35) }}>
            <ResponsiveContainer>
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
              >
                <XAxis type="number" stroke="#9ca3af" fontSize={12} />
                <YAxis 
                  type="category" 
                  dataKey="name" 
                  width={240}
                  stroke="#9ca3af" 
                  fontSize={12}
                  tick={{ fill: 'currentColor' }}
                  className="text-gray-700 dark:text-gray-300"
                  interval={0}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1f2937',
                    border: '1px solid #374151',
                    borderRadius: '0.5rem',
                    color: '#f3f4f6',
                  }}
                  formatter={(value: number, name: string, props: any) => {
                    if (name === 'count') {
                      return [`${value} occurrences (${props.payload.percentage}%)`, 'Count'];
                    }
                    return [value, name];
                  }}
                  labelFormatter={(label) => `Issue: ${label}`}
                />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={barColor} />
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
