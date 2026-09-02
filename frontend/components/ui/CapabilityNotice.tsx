import React from 'react';
import { UnavailableCapability } from '../../types';

interface CapabilityNoticeProps {
  /** Reasons this view cannot show anything, as reported by the API. */
  unavailable: UnavailableCapability[];
  /** What the user came here to see, e.g. "Field team performance". */
  title: string;
  /** Opens the survey settings so the missing setting can be filled in. */
  onOpenSettings?: () => void;
}

/**
 * Explains why a view is empty because a survey setting is missing.
 *
 * An empty chart looks like "no data was collected". This says "this needs a
 * setting you have not filled in yet", names the setting, and offers a way to
 * go and set it.
 */
const CapabilityNotice: React.FC<CapabilityNoticeProps> = ({
  unavailable,
  title,
  onOpenSettings,
}) => {
  if (unavailable.length === 0) return null;

  const settings = Array.from(new Set(unavailable.map((item) => item.missing_setting)));

  return (
    <div className="max-w-xl mx-auto my-10 rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-900/20 p-6 text-center">
      <svg
        aria-hidden="true"
        className="h-8 w-8 mx-auto mb-3 text-amber-500 dark:text-amber-400"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.75}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M10.34 3.94c.67-1.17 2.65-1.17 3.32 0l7.17 12.5c.66 1.16-.17 2.62-1.66 2.62H4.83c-1.49 0-2.32-1.46-1.66-2.62l7.17-12.5z"
        />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 3h.01" />
      </svg>

      <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-2">
        {title} needs a bit more setup
      </h3>

      <ul className="text-sm text-gray-700 dark:text-gray-300 space-y-1 mb-4">
        {unavailable.map((item) => (
          <li key={item.capability}>{item.reason}</li>
        ))}
      </ul>

      <p className="text-xs font-mono text-amber-800 dark:text-amber-300 mb-4 break-words">
        {settings.join(', ')}
      </p>

      {onOpenSettings && (
        <button
          type="button"
          onClick={onOpenSettings}
          className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 text-sm font-medium"
        >
          Open survey settings
        </button>
      )}
    </div>
  );
};

export default CapabilityNotice;
