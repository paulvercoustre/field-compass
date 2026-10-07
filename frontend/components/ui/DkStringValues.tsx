import React, { useState } from 'react';
import FieldLabel from './FieldLabel';
import { CORE_IDENTIFIER_HINTS } from '../../constants/coreIdentifiers';
import { useDkSuggestions, choiceLabel } from '../../utils/dkSuggestions';

interface DkStringValuesProps {
  values: string[];
  onChange: (values: string[]) => void;
  /** The form's survey rows; suggestions only come from lists a question uses. */
  survey: Array<Record<string, any>>;
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
const DkStringValues: React.FC<DkStringValuesProps> = ({ values, onChange, survey, choices, readOnly = false }) => {
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
  const found = useDkSuggestions(survey, choices) || [];
  // One-click adds only offer what is not added yet.
  const suggestions = found.filter((option) => !chosen.has(option.toLowerCase()));
  // The dropdown's "Suggested" group always lists every don't-know code the
  // form has, as it does for consent and enumerator -- added ones stay
  // visible but disabled, so the group does not vanish once the create
  // screen has pre-selected them all. Everything else follows, without
  // repeating them.
  const suggestedKeys = new Set(found.map((option) => option.toLowerCase()));
  const remaining = Array.from(optionsByName.keys())
    .filter((name) => !chosen.has(name.toLowerCase()) && !suggestedKeys.has(name.toLowerCase()))
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

  // Three children, matching the field-grid rows: label, control, extras.
  // Read-only has no control, so the chosen values take its place.
  const chosenValues =
    values.length > 0 ? (
      <div className="flex flex-wrap gap-2 mb-2">
        {values.map((value) => (
          <span
            key={value}
            title={describe(value)}
            className="inline-flex items-center gap-1 pl-2 pr-1.5 py-0.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 ring-1 ring-inset ring-indigo-600/15 dark:ring-indigo-400/20 rounded-md text-sm"
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
        {readOnly ? '—' : "None set — don't-know rates will count numeric codes only."}
      </p>
    );

  return (
    <div className="field-cell">
      <FieldLabel hint={CORE_IDENTIFIER_HINTS.dk_string_value}>Don't know — answer options</FieldLabel>

      <div>
        {readOnly ? null : (
          <>
            {optionsByName.size > 0 ? (
              <select
                value=""
                onChange={(e) => {
                  add(e.target.value);
                  e.target.value = '';
                }}
                className="w-full mb-2 px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md shadow-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">-- Add another answer option --</option>
                {found.length > 0 ? (
                  <>
                    <optgroup label="Suggested">
                      {found.map((option) => {
                        const added = chosen.has(option.toLowerCase());
                        return (
                          <option key={option} value={option} disabled={added}>
                            {describe(option)}
                            {added ? ' (added)' : ''}
                          </option>
                        );
                      })}
                    </optgroup>
                    <optgroup label="All answer options">
                      {remaining.map((option) => (
                        <option key={option} value={option}>
                          {describe(option)}
                        </option>
                      ))}
                    </optgroup>
                  </>
                ) : (
                  remaining.map((option) => (
                    <option key={option} value={option}>
                      {describe(option)}
                    </option>
                  ))
                )}
              </select>
            ) : (
              // No form read yet. Typing is still allowed, for the same reason
              // the identifier pickers allow it.
              <div className="flex gap-2 mb-2">
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
                  className="min-w-0 flex-1 px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md shadow-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  type="button"
                  onClick={() => {
                    add(typed);
                    setTyped('');
                  }}
                  disabled={!typed.trim()}
                  className="flex-shrink-0 px-3 py-2 text-sm font-medium bg-white text-gray-900 border border-gray-300 shadow-xs rounded-md hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Add
                </button>
              </div>
            )}
          </>
        )}
        {readOnly && chosenValues}
      </div>

      <div>
        {!readOnly && chosenValues}
        {readOnly ? null : (
          <>
            {suggestions.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="text-xs text-gray-500 dark:text-gray-400">In your form:</span>
                {suggestions.length > 1 && (
                  <button
                    type="button"
                    onClick={() => onChange([...values, ...suggestions])}
                    className="px-2 py-1 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-500"
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
          </>
        )}
      </div>
    </div>
  );
};

export default DkStringValues;
