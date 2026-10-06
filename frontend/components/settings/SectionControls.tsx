import React from 'react';

/** One settings section's edit state and actions, as useSectionEditor gives them. */
export interface SectionControls {
  editing: boolean;
  saving: boolean;
  edit: () => void;
  save: () => void;
  cancel: () => void;
}

/** "Saved 14:32", inside the section, until it is edited again. */
export const SavedNote: React.FC<{ at?: Date; className?: string }> = ({ at, className = '' }) =>
  at ? (
    <span role="status" className={`inline-flex items-center gap-1 text-sm text-emerald-700 dark:text-emerald-400 ${className}`}>
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m5 12.5 4.5 4.5L19 7" />
      </svg>
      Saved {at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
    </span>
  ) : null;

export const SectionEditButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button
    onClick={onClick}
    className="px-3 py-2 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-md"
  >
    Edit
  </button>
);

/** A section's Save changes and Cancel buttons. */
export const SectionActions: React.FC<{ controls: SectionControls; className?: string }> = ({ controls, className = '' }) => (
  <div className={`flex gap-3 ${className}`}>
    <button
      onClick={controls.save}
      disabled={controls.saving}
      className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-500 disabled:opacity-50 text-sm font-medium"
    >
      {controls.saving ? 'Saving...' : 'Save changes'}
    </button>
    <button
      onClick={controls.cancel}
      disabled={controls.saving}
      className="px-4 py-2 bg-white text-gray-900 border border-gray-300 shadow-xs rounded-md hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700 dark:hover:bg-gray-800 text-sm font-medium"
    >
      Cancel
    </button>
  </div>
);
