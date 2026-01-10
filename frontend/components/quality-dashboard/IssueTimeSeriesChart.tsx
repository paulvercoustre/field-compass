import React, { useState, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { IssueTimeSeriesPoint, IssueFrequency } from '../../types';

interface IssueTimeSeriesChartProps {
  data: IssueTimeSeriesPoint[];
  issueFrequency: IssueFrequency[]; // For getting top issues
}

// Color palette for issue lines
const COLORS = [
  '#6366f1', // indigo
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#f43f5e', // rose
  '#84cc16', // lime
  '#0ea5e9', // sky
  '#a855f7', // purple
];

const IssueTimeSeriesChart: React.FC<IssueTimeSeriesChartProps> = ({ data, issueFrequency }) => {
  // Get all unique issue types from the data
  const allIssueTypes = useMemo(() => {
    const types = new Set<string>();
    data.forEach(point => {
      Object.keys(point.issue_counts).forEach(type => types.add(type));
    });
    return Array.from(types);
  }, [data]);

  // Default to top 5 issues by frequency
  const top5Issues = useMemo(() => {
    return issueFrequency.slice(0, 5).map(i => i.check);
  }, [issueFrequency]);

  const [selectedIssues, setSelectedIssues] = useState<string[]>(top5Issues);

  // Transform data for recharts - flatten issue_counts into top-level properties
  const chartData = useMemo(() => {
    return data.map(point => {
      const displayDate = new Date(point.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const flatPoint: Record<string, any> = { 
        date: point.date, 
        displayDate 
      };
      selectedIssues.forEach(issue => {
        flatPoint[issue] = point.issue_counts[issue] || 0;
      });
      return flatPoint;
    });
  }, [data, selectedIssues]);

  const handleIssueToggle = (issue: string) => {
    setSelectedIssues(prev => 
      prev.includes(issue) 
        ? prev.filter(i => i !== issue)
        : [...prev, issue]
    );
  };

  const selectTop5 = () => {
    setSelectedIssues(top5Issues);
  };

  const selectAll = () => {
    setSelectedIssues(allIssueTypes);
  };

  const selectNone = () => {
    setSelectedIssues([]);
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
          Issues Over Time
        </h3>
        <div className="flex gap-2">
          <button 
            onClick={selectTop5}
            className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300"
          >
            Top 5
          </button>
          <button 
            onClick={selectAll}
            className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300"
          >
            All
          </button>
          <button 
            onClick={selectNone}
            className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300"
          >
            None
          </button>
        </div>
      </div>

      {/* Issue type filter chips */}
      <div className="flex flex-wrap gap-2 mb-4">
        {allIssueTypes.map((issue, index) => (
          <button
            key={issue}
            onClick={() => handleIssueToggle(issue)}
            className={`
              text-xs px-2 py-1 rounded-full border transition-colors
              ${selectedIssues.includes(issue) 
                ? 'border-transparent text-white' 
                : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 bg-transparent hover:bg-gray-100 dark:hover:bg-gray-700'
              }
            `}
            style={selectedIssues.includes(issue) ? { backgroundColor: COLORS[index % COLORS.length] } : {}}
          >
            {issue}
          </button>
        ))}
      </div>
      
      {data.length === 0 ? (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          No data available
        </div>
      ) : selectedIssues.length === 0 ? (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          Select issue types above to display
        </div>
      ) : (
        <div style={{ width: '100%', height: 300 }}>
          <ResponsiveContainer>
            <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <XAxis 
                dataKey="displayDate" 
                stroke="#9ca3af" 
                fontSize={12}
                tick={{ fill: '#9ca3af' }}
              />
              <YAxis 
                stroke="#9ca3af" 
                fontSize={12}
                tick={{ fill: '#9ca3af' }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1f2937',
                  border: '1px solid #374151',
                  borderRadius: '0.5rem',
                  color: '#f3f4f6',
                }}
                labelFormatter={(label) => `Date: ${label}`}
              />
              <Legend 
                wrapperStyle={{ paddingTop: '10px' }}
                formatter={(value) => <span className="text-gray-600 dark:text-gray-300 text-xs">{value}</span>}
              />
              {selectedIssues.map((issue, index) => (
                <Line 
                  key={issue}
                  type="monotone" 
                  dataKey={issue}
                  name={issue}
                  stroke={COLORS[allIssueTypes.indexOf(issue) % COLORS.length]} 
                  strokeWidth={2}
                  dot={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

export default IssueTimeSeriesChart;
