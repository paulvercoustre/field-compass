import React, { useState, useMemo, useRef, useEffect } from 'react';
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
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleIssue = (issue: string) => {
    setSelectedIssues(prev =>
      prev.includes(issue) ? prev.filter(i => i !== issue) : [...prev, issue]
    );
  };

  const selectTop5 = () => setSelectedIssues(top5Issues);
  const selectAll = () => setSelectedIssues(allIssueTypes);
  const selectNone = () => setSelectedIssues([]);

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

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
          Issues Over Time
        </h3>
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="text-xs px-3 py-1.5 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 flex items-center gap-1"
          >
            <span>Indicators</span>
            <svg className={`w-4 h-4 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {dropdownOpen && (
            <div className="absolute right-0 mt-1 z-50 min-w-[200px] max-h-64 overflow-y-auto py-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-md shadow-lg">
              <div className="px-3 py-1.5 border-b border-gray-200 dark:border-gray-600 flex gap-2 sticky top-0 bg-white dark:bg-gray-800">
                <button type="button" onClick={selectTop5} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">Top 5</button>
                <button type="button" onClick={selectAll} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">All</button>
                <button type="button" onClick={selectNone} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">None</button>
              </div>
              {allIssueTypes.map((issue, index) => (
                <label key={issue} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    checked={selectedIssues.includes(issue)}
                    onChange={() => toggleIssue(issue)}
                    className="rounded border-gray-400 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: COLORS[index % COLORS.length] }}
                  />
                  <span className="text-gray-700 dark:text-gray-300 truncate">{issue}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
      
      {data.length === 0 ? (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          No data available
        </div>
      ) : selectedIssues.length === 0 ? (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          Select indicators from the dropdown to display
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
