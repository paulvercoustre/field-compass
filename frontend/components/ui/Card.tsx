import React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Removes the inner padding, for tables and charts that bleed to the edge. */
  flush?: boolean;
}

/** A white surface with a hairline border: the one container style. */
export const Card: React.FC<CardProps> = ({ flush = false, className = '', children, ...rest }) => (
  <div
    className={`rounded-xl border border-gray-200 bg-white shadow-card dark:border-gray-800 dark:bg-gray-900 ${flush ? '' : 'p-5'} ${className}`}
    {...rest}
  >
    {children}
  </div>
);

interface CardHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export const CardHeader: React.FC<CardHeaderProps> = ({ title, description, actions, className = 'mb-4' }) => (
  <div className={`flex items-start justify-between gap-4 ${className}`}>
    <div className="min-w-0">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
      {description && <p className="mt-0.5 text-13 text-gray-500 dark:text-gray-400">{description}</p>}
    </div>
    {actions && <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
  </div>
);

/** A small heading over a group of cards. */
export const SectionLabel: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = 'mb-3' }) => (
  <h3 className={`text-13 font-medium text-gray-500 dark:text-gray-400 ${className}`}>{children}</h3>
);
