import React from 'react';

export interface SettingsNavItem<T extends string> {
  id: T;
  label: string;
}

interface SettingsLayoutProps<T extends string> {
  title: string;
  items: SettingsNavItem<T>[];
  active: T;
  onSelect: (id: T) => void;
  /** Shown above both columns, e.g. page-level save outcomes. */
  banner?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * A settings page: the title and its sections listed down the left, the
 * selected section on the right. Shared by survey and account settings so
 * the two look and behave the same.
 */
const SettingsLayout = <T extends string>({ title, items, active, onSelect, banner, children }: SettingsLayoutProps<T>) => (
  <div className="h-full overflow-y-auto p-4 md:p-8 text-gray-700 dark:text-gray-300">
    <div className="w-full max-w-7xl mx-auto">
      {banner}
      <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-8">
        <aside className="md:w-48 flex-shrink-0">
          <h1 className="text-lg font-semibold tracking-tight text-gray-900 dark:text-white mb-4">{title}</h1>
          <nav aria-label={title} className="flex gap-1 overflow-x-auto md:flex-col md:gap-0.5">
            {items.map((item) => {
              const isActive = active === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onSelect(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex-shrink-0 text-left px-3 py-1.5 rounded-md text-sm font-medium transition-colors md:w-full ${
                    isActive
                      ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white'
                      : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-900 hover:text-gray-900 dark:hover:text-white'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* pt-11 lines the first section up with the first nav item (title + mb-4) */}
        <main className="flex-1 min-w-0 max-w-4xl md:pt-11">{children}</main>
      </div>
    </div>
  </div>
);

export default SettingsLayout;
