import React, { useEffect, useState } from 'react';

interface ErrorMessageProps {
  message?: string | null;
  error?: string | null; // Keep for backward compatibility
  onDismiss?: () => void;
  autoHide?: boolean;
  autoHideDelay?: number;
  className?: string;
  id?: string;
}

const ErrorMessage: React.FC<ErrorMessageProps> = ({
  message,
  error, // Keep for backward compatibility
  onDismiss,
  autoHide = true,
  autoHideDelay = 5000,
  className = '',
  id,
}) => {
  const errorText = message || error;
  const [isVisible, setIsVisible] = useState(!!errorText);

  useEffect(() => {
    if (errorText) {
      setIsVisible(true);
    }
  }, [errorText]);

  useEffect(() => {
    if (isVisible && autoHide && errorText) {
      const timer = setTimeout(() => {
        setIsVisible(false);
        if (onDismiss) {
          setTimeout(onDismiss, 300); // Wait for fade-out animation
        }
      }, autoHideDelay);

      return () => clearTimeout(timer);
    }
  }, [isVisible, autoHide, autoHideDelay, errorText, onDismiss]);

  if (!errorText || !isVisible) return null;

  return (
    <div
      id={id}
      role="alert"
      aria-live="polite"
      className={`p-4 bg-red-50 dark:bg-red-900/50 border border-red-200 dark:border-red-700 rounded-md text-red-800 dark:text-red-200 flex items-center justify-between transition-opacity duration-300 ${className}`}
    >
      <span>{errorText}</span>
      {onDismiss && (
        <button
          onClick={() => {
            setIsVisible(false);
            setTimeout(onDismiss, 300);
          }}
          className="ml-4 text-red-700 dark:text-red-300 hover:text-red-900 dark:hover:text-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 rounded"
          aria-label="Dismiss error message"
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

export default ErrorMessage;

