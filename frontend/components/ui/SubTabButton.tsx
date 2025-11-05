
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
            className={`font-semibold py-1 px-3 text-sm rounded-md transition-colors duration-200 ${isActive ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
        >
            {children}
        </button>
    );
};