import React from 'react';
import InfoTip from './InfoTip';
import { CORE_IDENTIFIER_HELP } from '../../constants/coreIdentifiers';
import { suggestIdentifiers } from '../../utils/identifierSuggestions';

interface VariableDropdownProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  /** Questions in the loaded form. Empty until a form has been read. */
  availableVariables: string[];
  /** Key into CORE_IDENTIFIER_HELP, and the identifier suggestions are keyed on. */
  helpKey?: string;
  /** Settings shows saved config as text until the user clicks Edit. */
  readOnly?: boolean;
}

/**
 * Picks the question that plays a given role in the user's form.
 *
 * Shared by the create and settings screens, which previously kept their own
 * near-identical copies -- and drifted, offering different defaults for the
 * same field.
 *
 * Conventional names the form actually contains are grouped at the top. That
 * grouping is the only help this control gives when several could be right:
 * it shows every `consent_*` the form has rather than picking one, leaving a
 * choice the app has no basis to make with the person who does.
 */
const VariableDropdown: React.FC<VariableDropdownProps> = ({
  value,
  onChange,
  label,
  availableVariables,
  helpKey,
  readOnly = false,
}) => {
  const suggested = helpKey ? suggestIdentifiers(availableVariables, helpKey) : [];
  const rest = availableVariables.filter((name) => !suggested.includes(name));

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-400 mb-1">
        {label}
        {helpKey && CORE_IDENTIFIER_HELP[helpKey] && <InfoTip help={CORE_IDENTIFIER_HELP[helpKey]} />}
      </label>

      {readOnly ? (
        <div className="px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md text-gray-700 dark:text-gray-300">
          {value || '—'}
        </div>
      ) : availableVariables.length > 0 ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">-- Select variable --</option>
          {suggested.length > 0 ? (
            <>
              <optgroup label="Suggested">
                {suggested.map((varName) => (
                  <option key={varName} value={varName}>
                    {varName}
                  </option>
                ))}
              </optgroup>
              <optgroup label="All questions">
                {rest.map((varName) => (
                  <option key={varName} value={varName}>
                    {varName}
                  </option>
                ))}
              </optgroup>
            </>
          ) : (
            availableVariables.map((varName) => (
              <option key={varName} value={varName}>
                {varName}
              </option>
            ))
          )}
        </select>
      ) : (
        // No form read yet. Typing a name is still allowed -- a user who knows
        // their form should not be blocked on the app having fetched it.
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="Enter variable name"
        />
      )}
    </div>
  );
};

export default VariableDropdown;
