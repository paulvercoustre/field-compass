import React, { useEffect, useState } from 'react';

interface SuccessMessageProps {
  message: string | null;
  onDismiss?: () => void;
  autoHide?: boolean;
  autoHideDelay?: number;
  className?: string;
}

const SuccessMessage: React.FC<SuccessMessageProps> = ({
  message,
  onDismiss,
  autoHide = true,
  autoHideDelay = 5000,
  className = '',
}) => {
  const [isVisible, setIsVisible] = useState(!!message);

  useEffect(() => {
    if (message) {
      setIsVisible(true);
    }
  }, [message]);

  useEffect(() => {
    if (isVisible && autoHide && message) {
      const timer = setTimeout(() => {
        setIsVisible(false);
        if (onDismiss) {
          setTimeout(onDismiss, 300); // Wait for fade-out animation
        }
      }, autoHideDelay);

      return () => clearTimeout(timer);
    }
  }, [isVisible, autoHide, autoHideDelay, message, onDismiss]);

  if (!message || !isVisible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`px-3 py-2 text-sm bg-emerald-50 dark:bg-emerald-500/10 ring-1 ring-inset ring-emerald-600/15 dark:ring-emerald-400/20 rounded-lg text-emerald-900 dark:text-emerald-200 flex items-center justify-between animate-fade-in ${className}`}
    >
      <span>{message}</span>
      {onDismiss && (
        <button
          onClick={() => {
            setIsVisible(false);
            setTimeout(onDismiss, 300);
          }}
          className="ml-4 p-0.5 text-emerald-700/70 dark:text-emerald-300/70 hover:text-emerald-900 dark:hover:text-emerald-100 rounded"
          aria-label="Dismiss success message"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      )}
    </div>
  );
};

export default SuccessMessage;

