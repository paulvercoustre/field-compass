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
      className={`p-4 bg-green-50 dark:bg-green-900/50 border border-green-200 dark:border-green-700 rounded-md text-green-800 dark:text-green-200 flex items-center justify-between transition-opacity duration-300 ${className}`}
    >
      <span>{message}</span>
      {onDismiss && (
        <button
          onClick={() => {
            setIsVisible(false);
            setTimeout(onDismiss, 300);
          }}
          className="ml-4 text-green-700 dark:text-green-300 hover:text-green-900 dark:hover:text-green-100 focus:outline-none focus:ring-2 focus:ring-green-500 rounded"
          aria-label="Dismiss success message"
        >
          <svg
            className="w-5 h-5"
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

