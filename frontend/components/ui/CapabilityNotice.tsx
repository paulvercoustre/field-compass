import React from 'react';

interface CapabilityNoticeProps {
  /** What the user came here to see, e.g. "Field team performance". */
  title: string;
  /** What to do about it, in plain language. */
  message: string;
  /** Opens the survey settings so the missing setting can be filled in. */
  onOpenSettings?: () => void;
}

/**
 * Explains why a view is empty because a survey setting is missing.
 *
 * An empty chart reads as "no data was collected". This says what to do
 * instead. Deliberately does not name the config key: the person reading it
 * is looking at a screen, not a schema.
 */
const CapabilityNotice: React.FC<CapabilityNoticeProps> = ({
  title,
  message,
  onOpenSettings,
}) => (
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

    <p className="text-sm text-gray-700 dark:text-gray-300 mb-5">{message}</p>

    {onOpenSettings && (
      <button
        type="button"
        onClick={onOpenSettings}
        className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 text-sm font-medium"
      >
        Survey settings
      </button>
    )}
  </div>
);

export default CapabilityNotice;
