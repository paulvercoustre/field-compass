import React, { useState } from 'react';
import FieldLabel from './FieldLabel';
import { CORE_IDENTIFIER_HINTS } from '../../constants/coreIdentifiers';
import { parseDkCode } from '../../utils/dkSuggestions';

interface DkNumericCodesProps {
  codes: number[];
  onChange: (codes: number[]) => void;
  readOnly?: boolean;
}

/**
 * The numbers this survey counts as "don't know", e.g. -99.
 *
 * Optional, because a form can code don't-know only as an answer option and
 * take none on its numeric questions; and several, because modules written by
 * different teams often use different codes (-99 and -999). Each one is also
 * left out of outlier statistics.
 */
const DkNumericCodes: React.FC<DkNumericCodesProps> = ({ codes, onChange, readOnly = false }) => {
  const [typed, setTyped] = useState('');
  const typedCode = parseDkCode(typed);
  const canAdd = typedCode !== null && !codes.includes(typedCode);

  const add = () => {
    if (!canAdd || typedCode === null) return;
    onChange([...codes, typedCode]);
    setTyped('');
  };

  const chosenCodes =
    codes.length > 0 ? (
      <div className="flex flex-wrap gap-2 mb-2">
        {codes.map((code) => (
          <span
            key={code}
            className="inline-flex items-center gap-1 pl-2 pr-1.5 py-0.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 ring-1 ring-inset ring-indigo-600/15 dark:ring-indigo-400/20 rounded-md text-sm font-mono"
          >
            {code}
            {!readOnly && (
              <button
                type="button"
                onClick={() => onChange(codes.filter((existing) => existing !== code))}
                aria-label={`Remove ${code}`}
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
        {readOnly ? '—' : 'None — no number counts as don’t know.'}
      </p>
    );

  // Three children, matching the field-grid rows: label, control, extras.
  return (
    <div className="field-cell">
      <FieldLabel hint={CORE_IDENTIFIER_HINTS.dk_value}>Don't know — numeric codes</FieldLabel>
      <div>
        {readOnly ? (
          chosenCodes
        ) : (
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              inputMode="numeric"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add();
                }
              }}
              placeholder="Add a code, e.g. -99"
              aria-label="Add a numeric don't-know code"
              className="min-w-0 flex-1 px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md shadow-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="button"
              onClick={add}
              disabled={!canAdd}
              className="flex-shrink-0 px-3 py-2 text-sm font-medium bg-white text-gray-900 border border-gray-300 shadow-xs rounded-md hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add
            </button>
          </div>
        )}
      </div>
      <div>{!readOnly && chosenCodes}</div>
    </div>
  );
};

export default DkNumericCodes;
