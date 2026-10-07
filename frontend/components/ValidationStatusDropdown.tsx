import React from 'react';
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import { statusDotClass } from './Badge';
import { Spinner } from './Spinner';

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

  // A neutral control with the status carried by its dot, so the decision
  // button does not shout in green or red before anything is decided.
  const buttonClasses =
    'inline-flex h-7 items-center gap-2 pl-2.5 pr-2 text-xs font-medium rounded-md border shadow-xs transition-colors ' +
    (isUpdating || disabled
      ? 'bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed dark:bg-gray-900 dark:text-gray-500 dark:border-gray-800'
      : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700 dark:hover:bg-gray-800');

  const options = [
    { value: 'Approved', label: 'Approve' },
    { value: 'Not Approved', label: 'Not Approved' },
    { value: 'On Hold', label: 'On Hold' },
    ...(currentStatus ? [{ value: null, label: 'Clear status' }] : []),
  ];

  return (
    <Menu as="div" className="relative inline-block text-left">
      <MenuButton className={buttonClasses} disabled={isUpdating || disabled}>
        {isUpdating ? (
          <Spinner size="sm" className="text-current" />
        ) : (
          <span
            className={`h-2 w-2 rounded-full ${statusDotClass(getStatusDisplay(currentStatus))}`}
            aria-hidden="true"
          />
        )}
        <span>{isUpdating ? 'Updating…' : getStatusDisplay(currentStatus)}</span>
        {!isUpdating && (
          <svg
            className="w-3.5 h-3.5 text-gray-400"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        )}
      </MenuButton>

      <MenuItems
        anchor="bottom end"
        className="z-20 mt-1 w-44 origin-top-right rounded-lg bg-white dark:bg-gray-900 p-1 shadow-popover ring-1 ring-gray-200 dark:ring-gray-800 focus:outline-none [--anchor-gap:4px]"
      >
        {options.map((option) => (
          <MenuItem key={option.label}>
            {({ focus }) => (
              <button
                onClick={() => onChange(option.value)}
                disabled={currentStatus === option.value}
                className={`${focus ? 'bg-gray-100 dark:bg-gray-800' : ''} ${
                  currentStatus === option.value ? 'opacity-50 cursor-not-allowed' : ''
                } group flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-gray-700 dark:text-gray-200`}
              >
                {option.value ? (
                  <span className={`h-2 w-2 rounded-full ${statusDotClass(option.value)}`} aria-hidden="true" />
                ) : (
                  <span className="h-2 w-2 rounded-full ring-1 ring-inset ring-gray-400" aria-hidden="true" />
                )}
                <span>{option.label}</span>
              </button>
            )}
          </MenuItem>
        ))}
      </MenuItems>
    </Menu>
  );
};

export default ValidationStatusDropdown;
