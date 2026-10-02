import React, { useState, useRef, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from 'recharts';
import { TemporalDataPoint } from '../../types';
import { axisProps, gridProps, tooltipProps, STATUS_COLORS } from '../charts/chartTheme';

const STATUS_OPTIONS = [
  { key: 'total_submissions', label: 'Total', color: STATUS_COLORS.total },
  { key: 'approved_count', label: 'Approved', color: STATUS_COLORS.approved },
  { key: 'not_approved_count', label: 'Not Approved', color: STATUS_COLORS.notApproved },
  { key: 'on_hold_count', label: 'On Hold', color: STATUS_COLORS.onHold },
  { key: 'not_reviewed_count', label: 'Not Reviewed', color: STATUS_COLORS.notReviewed },
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
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
          Submission status over time
        </h3>
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="h-7 text-xs font-medium px-2.5 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md shadow-xs hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200 flex items-center gap-1"
          >
            <span>Indicators</span>
            <svg className={`w-4 h-4 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {dropdownOpen && (
            <div className="absolute right-0 mt-1 z-50 min-w-[180px] py-1 bg-white dark:bg-gray-900 ring-1 ring-gray-200 dark:ring-gray-800 rounded-lg shadow-popover animate-fade-in">
              <div className="px-3 py-1.5 border-b border-gray-100 dark:border-gray-800 flex gap-3">
                <button type="button" onClick={selectAll} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">All</button>
                <button type="button" onClick={selectNone} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">None</button>
              </div>
              {STATUS_OPTIONS.map(opt => (
                <label key={opt.key} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer text-13">
                  <input
                    type="checkbox"
                    checked={selectedKeys.includes(opt.key)}
                    onChange={() => toggleKey(opt.key)}
                    className="rounded border-gray-300 dark:border-gray-600 dark:bg-gray-800 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-gray-700 dark:text-gray-300">{opt.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
      
      {data.length === 0 ? (
        <div className="text-center py-8 text-13 text-gray-500 dark:text-gray-400">
          No data available
        </div>
      ) : selectedKeys.length === 0 ? (
        <div className="text-center py-8 text-13 text-gray-500 dark:text-gray-400">
          Select indicators from the dropdown to display
        </div>
      ) : (
        <div style={{ width: '100%', height: 300 }}>
          <ResponsiveContainer>
            <LineChart data={chartData} margin={{ top: 5, right: 8, left: -12, bottom: 5 }}>
              <CartesianGrid {...gridProps} />
              <XAxis 
                dataKey="displayDate" 
                {...axisProps}
              />
              <YAxis 
                {...axisProps}
                allowDecimals={false}
              />
              <Tooltip
                {...tooltipProps}
                labelFormatter={(label) => `Date: ${label}`}
              />
              <Legend
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ paddingTop: '12px' }}
                formatter={(value) => <span className="text-xs text-gray-600 dark:text-gray-300">{value}</span>}
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
                  activeDot={{ r: 4, strokeWidth: 0 }}
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
