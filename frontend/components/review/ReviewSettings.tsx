import React, { useState } from 'react';
import { useAuth, UserPreferences } from '../../contexts/AuthContext';

const OPTIONS: Array<{ key: keyof UserPreferences; label: string; hint: string }> = [
  {
    key: 'auto_advance',
    label: 'Open the next submission after a decision',
    hint: 'A decided submission leaves Needs review, and the next one opens. Undo stays available for a few seconds.',
  },
  {
    key: 'review_shortcuts',
    label: 'Keyboard shortcuts',
    hint: 'A approve, N not approved, H on hold, J and K to move, Z to undo, / to search. Arrow keys always move.',
  },
];

/** Account Settings › Reviewing: how the Submissions page behaves for this account, on every device. */
const ReviewSettings: React.FC = () => {
  const { user, updateUser } = useAuth();
  const [saving, setSaving] = useState<keyof UserPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);

  const change = async (key: keyof UserPreferences, on: boolean) => {
    setSaving(key);
    setError(null);
    try {
      await updateUser({ preferences: { [key]: on } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t save the setting.');
    } finally {
      setSaving(null);
    }
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-card dark:border-gray-800 dark:bg-gray-900">
      <h2 className="text-base font-semibold tracking-tight text-gray-900 dark:text-white">Reviewing</h2>
      <p className="mb-5 mt-1 text-sm text-gray-500 dark:text-gray-400">How the Submissions page works for you.</p>
      <div className="space-y-4">
        {OPTIONS.map((option) => (
          <div key={option.key} className="flex items-start gap-3">
            <input
              id={`pref-${option.key}`}
              type="checkbox"
              checked={user?.preferences?.[option.key] ?? true}
              disabled={saving !== null}
              onChange={(event) => change(option.key, event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600 dark:border-gray-600 dark:bg-gray-700"
            />
            <div>
              <label htmlFor={`pref-${option.key}`} className="text-sm font-medium text-gray-900 dark:text-white">
                {option.label}
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400">{option.hint}</p>
            </div>
          </div>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </section>
  );
};

export default ReviewSettings;
