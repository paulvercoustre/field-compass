import React from 'react';

/** The compass mark, shared with the marketing site. */
const LogoMark: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M15.6 8.4l-2.1 5.1-5.1 2.1 2.1-5.1z" />
  </svg>
);

/** Mark on an indigo tile, for the sidebar and sign-in page. */
export const LogoTile: React.FC<{ size?: 'sm' | 'lg' }> = ({ size = 'sm' }) => (
  <span
    className={`inline-flex flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-b from-indigo-500 to-indigo-600 text-white shadow-sm ring-1 ring-inset ring-white/15 ${
      size === 'lg' ? 'w-11 h-11 rounded-xl' : 'w-7 h-7'
    }`}
  >
    <LogoMark className={size === 'lg' ? 'w-6 h-6' : 'w-4 h-4'} />
  </span>
);
