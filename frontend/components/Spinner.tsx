import React from 'react';

interface SpinnerProps {
  /** sm sits inside buttons and inline text; md fills an empty pane. */
  size?: 'sm' | 'md';
  className?: string;
}

export const Spinner: React.FC<SpinnerProps> = ({ size = 'md', className = 'text-gray-400 dark:text-gray-500' }) => (
  <svg
    className={`${size === 'sm' ? 'w-3.5 h-3.5' : 'w-6 h-6'} animate-spin ${className}`}
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <circle className="opacity-20" cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="2.5" />
    <path d="M21.5 12a9.5 9.5 0 0 0-9.5-9.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);
