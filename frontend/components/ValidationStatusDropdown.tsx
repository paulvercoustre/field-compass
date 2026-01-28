import React from 'react';
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';

interface ValidationStatusDropdownProps {
  currentStatus: string | null;
  onChange: (status: string | null) => void;
  isUpdating: boolean;
  disabled?: boolean;
}

const ValidationStatusDropdown: React.FC<ValidationStatusDropdownProps> = ({
  currentStatus,
  onChange,
  isUpdating,
  disabled = false,
}) => {
  // Get display text for current status
  const getStatusDisplay = (status: string | null): string => {
    if (!status) return 'Not Reviewed';
    return status;
  };

  // Get button color classes based on status
  const getButtonClasses = (status: string | null): string => {
    const baseClasses = 'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border rounded transition-colors';
    
    if (isUpdating || disabled) {
      return `${baseClasses} bg-gray-100 text-gray-400 border-gray-300 cursor-not-allowed`;
    }
    
    if (!status) {
      return `${baseClasses} text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600`;
    }
    
    switch (status) {
      case 'Approved':
        return `${baseClasses} text-green-700 bg-green-50 border-green-200 hover:bg-green-100`;
      case 'Not Approved':
        return `${baseClasses} text-red-700 bg-red-50 border-red-200 hover:bg-red-100`;
      case 'On Hold':
        return `${baseClasses} text-yellow-700 bg-yellow-50 border-yellow-200 hover:bg-yellow-100`;
      default:
        return `${baseClasses} text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600`;
    }
  };

  // Get icon for current status
  const getStatusIcon = (status: string | null) => {
    if (isUpdating) {
      return (
        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      );
    }

    if (!status) {
      return (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    }

    switch (status) {
      case 'Approved':
        return (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        );
      case 'Not Approved':
        return (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        );
      case 'On Hold':
        return (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      default:
        return null;
    }
  };

  const options = [
    { value: 'Approved', label: 'Approve', icon: '✓' },
    { value: 'Not Approved', label: 'Not Approved', icon: '✗' },
    { value: 'On Hold', label: 'On Hold', icon: '⏸' },
    ...(currentStatus ? [{ value: null, label: 'Clear', icon: '⌀' }] : []),
  ];

  return (
    <Menu as="div" className="relative inline-block text-left">
      <MenuButton
        className={getButtonClasses(currentStatus)}
        disabled={isUpdating || disabled}
      >
        {getStatusIcon(currentStatus)}
        <span>{isUpdating ? 'Updating...' : getStatusDisplay(currentStatus)}</span>
        {!isUpdating && (
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </MenuButton>

      <MenuItems
        className="absolute left-0 mt-1 w-40 origin-top-left rounded-md bg-white dark:bg-gray-800 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none z-10"
      >
        <div className="py-1">
          {options.map((option) => (
            <MenuItem key={option.label}>
              {({ focus }) => (
                <button
                  onClick={() => onChange(option.value)}
                  disabled={currentStatus === option.value}
                  className={`${
                    focus ? 'bg-gray-100 dark:bg-gray-700' : ''
                  } ${
                    currentStatus === option.value
                      ? 'opacity-50 cursor-not-allowed'
                      : ''
                  } group flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200`}
                >
                  <span className="text-sm">{option.icon}</span>
                  <span>{option.label}</span>
                </button>
              )}
            </MenuItem>
          ))}
        </div>
      </MenuItems>
    </Menu>
  );
};

export default ValidationStatusDropdown;
