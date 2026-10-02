import React from 'react';

type Tone = 'info' | 'success' | 'warning' | 'error';

const tones: Record<Tone, { box: string; icon: React.ReactNode }> = {
  info: {
    box: 'bg-sky-50 text-sky-900 ring-sky-600/15 dark:bg-sky-500/10 dark:text-sky-200 dark:ring-sky-400/20',
    icon: <><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></>,
  },
  success: {
    box: 'bg-emerald-50 text-emerald-900 ring-emerald-600/15 dark:bg-emerald-500/10 dark:text-emerald-200 dark:ring-emerald-400/20',
    icon: <><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>,
  },
  warning: {
    box: 'bg-amber-50 text-amber-900 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-400/20',
    icon: <><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></>,
  },
  error: {
    box: 'bg-red-50 text-red-900 ring-red-600/15 dark:bg-red-500/10 dark:text-red-200 dark:ring-red-400/20',
    icon: <><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></>,
  },
};

interface BannerProps {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
  /** Renders a dismiss button when given. */
  onDismiss?: () => void;
  id?: string;
}

/** An inline status line: what happened, in the place the user is looking. */
const Banner: React.FC<BannerProps> = ({ tone = 'info', children, className = '', onDismiss, id }) => (
  <div
    id={id}
    role={tone === 'error' ? 'alert' : 'status'}
    className={`flex items-start gap-2.5 rounded-lg px-3 py-2 text-13 ring-1 ring-inset animate-fade-in ${tones[tone].box} ${className}`}
  >
    <svg className="mt-0.5 h-4 w-4 flex-shrink-0 opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {tones[tone].icon}
    </svg>
    <div className="min-w-0 flex-1">{children}</div>
    {onDismiss && (
      <button
        onClick={onDismiss}
        className="-mr-1 rounded p-0.5 opacity-60 hover:opacity-100"
        aria-label="Dismiss"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    )}
  </div>
);

export default Banner;
