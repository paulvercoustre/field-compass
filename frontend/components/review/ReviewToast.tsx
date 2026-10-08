import React, { useEffect } from 'react';

interface ReviewToastProps {
  message: string;
  /** Offered after a single decision; a bulk approval has none. */
  onUndo?: () => void;
  shortcuts: boolean;
  onDismiss: () => void;
}

const SHOWN_FOR_MS = 8000;

/**
 * What just happened, with Undo for a while. Bottom right on wide screens,
 * clear of the decision buttons; centred on a phone.
 */
const ReviewToast: React.FC<ReviewToastProps> = ({ message, onUndo, shortcuts, onDismiss }) => {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, SHOWN_FOR_MS);
    return () => window.clearTimeout(timer);
  }, [message, onDismiss]);

  return (
    <div
      role="status"
      className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center md:left-auto md:right-6 md:translate-x-0 gap-4 rounded-xl bg-gray-900 py-2.5 pl-4 pr-2.5 text-sm text-white shadow-popover animate-fade-in dark:bg-white dark:text-gray-900"
    >
      <span>{message}</span>
      {onUndo && (
        <button
          type="button"
          onClick={onUndo}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium text-indigo-300 hover:bg-white/10 dark:text-indigo-700 dark:hover:bg-gray-100"
        >
          Undo
          {shortcuts && (
            <kbd className="rounded border border-gray-600 px-1 font-sans text-[11px] leading-4 text-gray-400 dark:border-gray-300 dark:text-gray-500">
              Z
            </kbd>
          )}
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="rounded-md px-1.5 text-gray-400 hover:text-white dark:text-gray-500 dark:hover:text-gray-900"
      >
        ×
      </button>
    </div>
  );
};

export default ReviewToast;
