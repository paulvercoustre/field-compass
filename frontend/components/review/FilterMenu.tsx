import React, { useEffect, useRef, useState } from 'react';
import { FacetCount, FilterState, SamplingFilter, SubmissionFacets } from '../../types';
import { SurveyConfig } from '../../services/progressApi';
import { issueName } from '../../utils/issueNames';
import { formatValueForDisplay, getQuestionLabel } from '../../utils/koboLabelUtils';

interface FilterMenuProps {
  facets: SubmissionFacets | null;
  filters: FilterState;
  surveyConfig: SurveyConfig | null;
  onChange: (filters: FilterState) => void;
  onClose: () => void;
}

const SHOWN = 6;

/** The options of one facet: its counts, plus anything chosen that no longer has any. */
const withChosen = (counts: FacetCount[], chosen: string[]): FacetCount[] => [
  ...counts,
  ...chosen.filter((value) => !counts.some((c) => c.value === value)).map((value) => ({ value, count: 0 })),
];

const toggle = (values: string[] | undefined, value: string): string[] | undefined => {
  const next = values?.includes(value) ? values.filter((v) => v !== value) : [...(values ?? []), value];
  return next.length ? next : undefined;
};

const Section: React.FC<{ title: string; hint?: string; children: React.ReactNode }> = ({ title, hint, children }) => (
  <fieldset className="border-t border-gray-100 px-3 py-2.5 first:border-t-0 dark:border-gray-800">
    <legend className="sr-only">{title}</legend>
    <div className="mb-1.5 flex justify-between text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
      <span aria-hidden="true">{title}</span>
      {hint && <span className="font-normal normal-case tracking-normal">{hint}</span>}
    </div>
    {children}
  </fieldset>
);

const CheckList: React.FC<{
  name: string;
  options: FacetCount[];
  chosen: string[];
  label: (value: string) => string;
  onToggle: (value: string) => void;
  bars?: boolean;
}> = ({ name, options, chosen, label, onToggle, bars }) => {
  const [all, setAll] = useState(false);
  const max = Math.max(1, ...options.map((o) => o.count));
  const shown = all ? options : options.slice(0, SHOWN);
  return (
    <>
      <ul className="space-y-0.5">
        {shown.map((option) => {
          const id = `${name}-${option.value}`;
          return (
            <li key={option.value}>
              <label
                htmlFor={id}
                className="grid cursor-pointer grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1 py-1 text-sm text-gray-800 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800/60"
              >
                <input
                  id={id}
                  type="checkbox"
                  checked={chosen.includes(option.value)}
                  onChange={() => onToggle(option.value)}
                  className="h-3.5 w-3.5 rounded border-gray-300 text-gray-900 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800"
                />
                <span className="truncate" title={label(option.value)}>
                  {label(option.value)}
                </span>
                <span className="flex items-center gap-2">
                  {bars && (
                    <span
                      className="hidden h-1 w-14 overflow-hidden rounded-full bg-gray-100 sm:block dark:bg-gray-800"
                      aria-hidden="true"
                    >
                      <span
                        className="block h-full rounded-full bg-amber-300 dark:bg-amber-500/60"
                        style={{ width: `${(option.count / max) * 100}%` }}
                      />
                    </span>
                  )}
                  <span className="tabular w-6 text-right text-xs text-gray-500 dark:text-gray-400">
                    {option.count}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {options.length > SHOWN && (
        <button
          type="button"
          onClick={() => setAll((open) => !open)}
          className="ml-7 mt-1 text-xs text-indigo-700 hover:underline dark:text-indigo-300"
        >
          {all ? 'Show fewer' : `Show ${options.length - SHOWN} more`}
        </button>
      )}
    </>
  );
};

/**
 * The filter menu: issues, enumerators and the targets' groups, each option
 * with how many submissions it would show. Choices apply at once.
 */
const FilterMenu: React.FC<FilterMenuProps> = ({ facets, filters, surveyConfig, onChange, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (ref.current && !ref.current.contains(target) && !target.closest('[data-filter-toggle]')) onClose();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    ref.current?.querySelector<HTMLElement>('input, button')?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  const enumeratorField = surveyConfig?.config_data?.core_identifiers?.enumerator;
  const setSampling = (variable: string, value: string) => {
    const current = filters.samplingFilters ?? [];
    const existing = current.find((f) => f.variable === variable);
    const values = toggle(existing?.values, value);
    const rest = current.filter((f) => f.variable !== variable);
    const next: SamplingFilter[] = values ? [...rest, { variable, values }] : rest;
    onChange({ ...filters, samplingFilters: next.length ? next : undefined });
  };

  const issues = withChosen(facets?.issues ?? [], filters.issues ?? []);
  const enumerators = withChosen(facets?.enumerators ?? [], filters.enumerators ?? []);
  const nothing = !issues.length && !enumerators.length && !(facets?.sampling ?? []).some((s) => s.values.length);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Filter submissions"
      className="absolute left-3 right-3 top-full z-30 mt-1 max-h-[70vh] overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-popover animate-fade-in sm:left-auto sm:w-[22rem] dark:border-gray-800 dark:bg-gray-900"
    >
      {nothing && (
        <p className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
          Nothing to filter by in this tab.
        </p>
      )}
      {issues.length > 0 && (
        <Section title="Issue" hint="submissions">
          <CheckList
            name="filter-issue"
            options={issues}
            chosen={filters.issues ?? []}
            label={(check) => issueName(check, (name) => getQuestionLabel(name, surveyConfig))}
            onToggle={(value) => onChange({ ...filters, issues: toggle(filters.issues, value) })}
            bars
          />
        </Section>
      )}
      {enumeratorField && enumerators.length > 0 && (
        <Section title="Enumerator">
          <CheckList
            name="filter-enumerator"
            options={enumerators}
            chosen={filters.enumerators ?? []}
            label={(value) => formatValueForDisplay(value, enumeratorField, surveyConfig)}
            onToggle={(value) => onChange({ ...filters, enumerators: toggle(filters.enumerators, value) })}
          />
        </Section>
      )}
      {(facets?.sampling ?? []).map(({ variable, values }) => {
        const chosen = filters.samplingFilters?.find((f) => f.variable === variable)?.values ?? [];
        const options = withChosen(values, chosen);
        if (!options.length) return null;
        return (
          <Section key={variable} title={getQuestionLabel(variable, surveyConfig)}>
            <div className="flex flex-wrap gap-1.5">
              {options.map((option) => {
                const on = chosen.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setSampling(variable, option.value)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                      on
                        ? 'border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900'
                        : 'border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
                    }`}
                  >
                    {formatValueForDisplay(option.value, variable, surveyConfig)}
                    <span className={on ? 'opacity-70' : 'text-gray-400'}>{option.count}</span>
                  </button>
                );
              })}
            </div>
          </Section>
        );
      })}
    </div>
  );
};

export default FilterMenu;
