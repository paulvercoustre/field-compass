
import React from 'react';

interface ProgressBarProps {
  percentage: number;
}

const ProgressBar: React.FC<ProgressBarProps> = ({ percentage }) => {
  // Cap the visual width of the bar at 100%, but use the actual percentage for color logic
  const widthPercentage = Math.min(100, percentage);
  const color = percentage >= 100 ? 'bg-green-500' : 'bg-blue-600';

  return (
    <div className="w-32">
        <div className="bg-gray-200 dark:bg-gray-800 rounded-full h-6 relative overflow-hidden">
        <div
            className={`h-full rounded-full ${color}`}
            style={{ width: `${widthPercentage}%` }}
        ></div>
        <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs font-bold text-gray-900 dark:text-white">
            {percentage.toFixed(1)}%
            </span>
        </div>
        </div>
    </div>
  );
};

export default ProgressBar;