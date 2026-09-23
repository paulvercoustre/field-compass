import React, { useState } from 'react';
import InfoTip from './InfoTip';
import { CORE_IDENTIFIER_HELP } from '../../constants/coreIdentifiers';
import { useDkSuggestions, choiceLabel } from '../../utils/dkSuggestions';

interface DkStringValuesProps {
  values: string[];
  onChange: (values: string[]) => void;
  /** The form's choice rows, carrying `name` and its label columns. */
  choices: Array<Record<string, any>>;
  readOnly?: boolean;
}

/**
 * The answer options this survey counts as "don't know".
 *
 * More than one, because a form assembled from several modules -- or revised
 * mid-project -- can carry two codings of the same answer. With only one
 * countable, every occurrence of the other was silently counted as a real
 * answer, quietly understating the DK rate.
 *
 * A form can have hundreds of answer options, so this is not a checkbox list:
 * chosen values are chips, the codings the form actually contains are offered
 * as one-click adds, and a dropdown covers everything else.
 */
const DkStringValues: React.FC<DkStringValuesProps> = ({
  values,
  onChange,
  choices,
  readOnly = false,
}) => {
  const [typed, setTyped] = useState('');

  // One entry per name: the same coding appears in every list that offers it.
  const optionsByName = new Map<string, string>();
  for (const choice of choices || []) {
    const name = choice?.name === undefined || choice?.name === null ? '' : String(choice.name);
    if (name && !optionsByName.has(name)) {
      optionsByName.set(name, choiceLabel(choice));
    }
  }

  // A label is worth showing only when it says more than the name already does.
  const describe = (name: string): string => {
    const label = optionsByName.get(name);
    return label && label.toLowerCase() !== name.toLowerCase() ? `${name} — ${label}` : name;
  };

  const chosen = new Set(values.map((value) => value.toLowerCase()));
  const suggestions = (useDkSuggestions(choices) || []).filter(
    (option) => !chosen.has(option.toLowerCase())
  );
  const remaining = Array.from(optionsByName.keys())
    .filter((name) => !chosen.has(name.toLowerCase()))
    .sort();

  const add = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || chosen.has(trimmed.toLowerCase())) {
      return;
    }
    onChange([...values, trimmed]);
  };

  const remove = (value: string) => {
    onChange(values.filter((existing) => existing !== value));
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-400 mb-1">
        Don't know — answer options
        <InfoTip help={CORE_IDENTIFIER_HELP.dk_string_value} />
      </label>

      {values.length > 0 ? (
        <div className="flex flex-wrap gap-2 mb-2">
          {values.map((value) => (
            <span
              key={value}
              title={describe(value)}
              className="inline-flex items-center gap-1 px-2 py-1 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-200 rounded-md text-sm"
            >
              {value}
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => remove(value)}
                  aria-label={`Remove ${value}`}
                  className="text-indigo-600 dark:text-indigo-300 hover:text-indigo-900 dark:hover:text-white"
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-500 mb-2">
          {readOnly ? '—' : 'None set — don\'t-know rates will count the numeric code only.'}
        </p>
      )}

      {readOnly ? null : (
        <>
          {suggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="text-xs text-gray-500 dark:text-gray-400">In your form:</span>
              {suggestions.length > 1 && (
                <button
                  type="button"
                  onClick={() => onChange([...values, ...suggestions])}
                  className="px-2 py-1 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
                >
                  + Add all {suggestions.length}
                </button>
              )}
              {suggestions.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => add(option)}
                  className="px-2 py-1 text-sm border border-dashed border-indigo-400 dark:border-indigo-500 text-indigo-700 dark:text-indigo-300 rounded-md hover:bg-indigo-50 dark:hover:bg-indigo-900/30"
                >
                  + {describe(option)}
                </button>
              ))}
            </div>
          )}

          {optionsByName.size > 0 ? (
            <select
              value=""
              onChange={(e) => {
                add(e.target.value);
                e.target.value = '';
              }}
              className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">-- Add another answer option --</option>
              {remaining.map((option) => (
                <option key={option} value={option}>
                  {describe(option)}
                </option>
              ))}
            </select>
          ) : (
            // No form read yet. Typing is still allowed, for the same reason
            // the identifier pickers allow it.
            <div className="flex gap-2">
              <input
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    add(typed);
                    setTyped('');
                  }
                }}
                placeholder="Enter answer option"
                className="flex-1 px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="button"
                onClick={() => {
                  add(typed);
                  setTyped('');
                }}
                disabled={!typed.trim()}
                className="px-3 py-2 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default DkStringValues;
