import React from 'react';

interface FieldLabelProps {
  children: React.ReactNode;
  /** One line in lighter text under the label; leave out when the label says it all. */
  hint?: React.ReactNode;
  htmlFor?: string;
}

/**
 * A field's label, with an optional hint underneath: the same main-text /
 * lighter-detail pattern the check toggles use.
 */
const FieldLabel: React.FC<FieldLabelProps> = ({ children, hint, htmlFor }) => (
  <div className="mb-1.5">
    <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-700 dark:text-gray-300">
      {children}
    </label>
    {hint && <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{hint}</p>}
  </div>
);

export default FieldLabel;
