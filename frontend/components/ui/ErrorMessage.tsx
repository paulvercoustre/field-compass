import React from 'react';

interface ErrorMessageProps {
  error?: string | null;
  className?: string;
  id?: string;
}

const ErrorMessage: React.FC<ErrorMessageProps> = ({ error, className = '', id }) => {
  if (!error) return null;

  return (
    <div
      id={id}
      role="alert"
      aria-live="polite"
      className={`text-sm text-red-600 dark:text-red-400 mt-1 ${className}`}
    >
      {error}
    </div>
  );
};

export default ErrorMessage;

