import React from 'react';

interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Controls aligned to the right of the title (filters, the primary action). */
  actions?: React.ReactNode;
  /** Status lines under the title row, e.g. the outcome of a pull. */
  children?: React.ReactNode;
}

/** The title bar at the top of every page, so they all line up. */
const PageHeader: React.FC<PageHeaderProps> = ({ title, description, actions, children }) => (
  <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 px-6 py-3">
    <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-tight text-gray-900 dark:text-white">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
    {children}
  </div>
);

export default PageHeader;
