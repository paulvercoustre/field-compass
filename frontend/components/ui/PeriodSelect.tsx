import React from 'react';
import { PERIODS, Period } from '../../utils/period';

/** The period menu in a data page's header. */
const PeriodSelect: React.FC<{ value: Period; onChange: (period: Period) => void }> = ({ value, onChange }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value as Period)}
    aria-label="Period"
    className="h-8 text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md shadow-xs pl-2.5 pr-8 py-0 text-gray-700 dark:text-gray-200"
  >
    {PERIODS.map((p) => (
      <option key={p.value} value={p.value}>
        {p.label}
      </option>
    ))}
  </select>
);

export default PeriodSelect;
