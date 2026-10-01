import React from 'react';

interface ProgressBarProps {
  /**
   * Percent complete, or null when the survey sets no target for this row.
   *
   * Null is a supported value, not an error state: plenty of surveys never set
   * targets, and there is no honest percentage to draw for them. Rendering a
   * 0% bar would say collection has not started; rendering 100% would say it
   * is finished. Both are claims the data does not support, so nothing is
   * drawn at all.
   *
   * `strictNullChecks` is off in this project, so a null arriving here is not
   * a type error -- it reaches `percentage.toFixed(1)` and throws at render,
   * taking the whole progress page down. Hence the explicit guard.
   */
  percentage: number | null;
}

const ProgressBar: React.FC<ProgressBarProps> = ({ percentage }) => {
  if (percentage === null || percentage === undefined || Number.isNaN(percentage)) {
    return (
      <span className="text-sm text-gray-500 dark:text-gray-400" title="No target set">
        —
      </span>
    );
  }

  // Cap the visual width of the bar at 100%, but use the actual percentage for color logic
  const widthPercentage = Math.min(100, percentage);
  const color = percentage >= 100 ? 'bg-green-500' : 'bg-blue-600';

  return (
    // The label sits beside the bar, not on it: over the coloured fill it
    // fell below 3.5:1, and whether it was over the fill depended on the value.
    <div className="flex items-center gap-2">
        <div className="w-24 bg-gray-200 dark:bg-gray-800 rounded-full h-3 overflow-hidden" aria-hidden="true">
        <div
            className={`h-full rounded-full ${color}`}
            style={{ width: `${widthPercentage}%` }}
        ></div>
        </div>
        <span className="text-xs font-bold text-gray-900 dark:text-white tabular-nums">
        {percentage.toFixed(1)}%
        </span>
    </div>
  );
};

export default ProgressBar;
