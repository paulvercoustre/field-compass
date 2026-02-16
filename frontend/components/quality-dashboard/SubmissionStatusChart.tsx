import React, { useState, useRef, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { TemporalDataPoint } from '../../types';

const STATUS_OPTIONS = [
  { key: 'total_submissions', label: 'Total', color: '#6b7280' },
  { key: 'approved_count', label: 'Approved', color: '#22c55e' },
  { key: 'not_approved_count', label: 'Not Approved', color: '#ef4444' },
  { key: 'on_hold_count', label: 'On Hold', color: '#eab308' },
  { key: 'not_reviewed_count', label: 'Not Reviewed', color: '#6b7280' },
] as const;

interface SubmissionStatusChartProps {
  data: TemporalDataPoint[];
}

const SubmissionStatusChart: React.FC<SubmissionStatusChartProps> = ({ data }) => {
  const [selectedKeys, setSelectedKeys] = useState<string[]>(
    STATUS_OPTIONS.map(o => o.key)
  );
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

  const toggleKey = (key: string) => {
    setSelectedKeys(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const selectAll = () => setSelectedKeys(STATUS_OPTIONS.map(o => o.key));
  const selectNone = () => setSelectedKeys([]);

  // Format date for display
  const chartData = data.map(point => ({
    ...point,
    displayDate: new Date(point.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  }));

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
          Submission Status Over Time
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
            <div className="absolute right-0 mt-1 z-50 min-w-[180px] py-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-md shadow-lg">
              <div className="px-3 py-1.5 border-b border-gray-200 dark:border-gray-600 flex gap-2">
                <button type="button" onClick={selectAll} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">All</button>
                <button type="button" onClick={selectNone} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">None</button>
              </div>
              {STATUS_OPTIONS.map(opt => (
                <label key={opt.key} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    checked={selectedKeys.includes(opt.key)}
                    onChange={() => toggleKey(opt.key)}
                    className="rounded border-gray-400 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-gray-700 dark:text-gray-300">{opt.label}</span>
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
      ) : selectedKeys.length === 0 ? (
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
                formatter={(value) => <span className="text-gray-600 dark:text-gray-300">{value}</span>}
              />
              {STATUS_OPTIONS.filter(opt => selectedKeys.includes(opt.key)).map(opt => (
                <Line
                  key={opt.key}
                  type="monotone"
                  dataKey={opt.key}
                  name={opt.label}
                  stroke={opt.color}
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

export default SubmissionStatusChart;
