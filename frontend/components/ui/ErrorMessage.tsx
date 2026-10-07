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
      className={`px-3 py-2 text-sm bg-red-50 dark:bg-red-500/10 ring-1 ring-inset ring-red-600/15 dark:ring-red-400/20 rounded-lg text-red-900 dark:text-red-200 flex items-center justify-between animate-fade-in ${className}`}
    >
      <span>{errorText}</span>
      {onDismiss && (
        <button
          onClick={() => {
            setIsVisible(false);
            setTimeout(onDismiss, 300);
          }}
          className="ml-4 p-0.5 text-red-700/70 dark:text-red-300/70 hover:text-red-900 dark:hover:text-red-100 rounded"
          aria-label="Dismiss error message"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
};

export default ErrorMessage;
