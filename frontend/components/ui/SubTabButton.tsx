
import React from 'react';

interface SubTabButtonProps<T> {
  tabId: T;
  activeTab: T;
  onClick: (tabId: T) => void;
  children: React.ReactNode;
}

export const SubTabButton = <T extends string>({ tabId, activeTab, onClick, children }: SubTabButtonProps<T>) => {
    const isActive = activeTab === tabId;
    return (
        <button
            onClick={() => onClick(tabId)}
            aria-pressed={isActive}
            className={`h-7 px-3 text-sm font-medium rounded-md transition-colors ${isActive ? 'bg-white text-gray-900 shadow-xs ring-1 ring-gray-200 dark:bg-gray-800 dark:text-white dark:ring-gray-700' : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'}`}
        >
            {children}
        </button>
    );
};