import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Submission, FilterState, SamplingFilter } from '../types';
import { SurveyConfig } from '../services/progressApi';
import { Spinner } from './Spinner';
import {
  extractUniqueEnumerators,
  extractUniqueSamplingValues,
  hasActiveFilters,
  supportsEnumeratorFiltering,
  supportsSamplingFiltering,
  getSamplingVariables
} from '../utils/filterUtils';

interface SubmissionFiltersProps {
  submissions: Submission[];
  surveyConfig: SurveyConfig | null;
  activeFilters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  isLoading: boolean;
}

// Multi-Select Dropdown Component
interface MultiSelectDropdownProps {
  label: string;
  options: Array<{ value: string; label: string }>;
  selectedValues: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  maxDisplayItems?: number;
}

const MultiSelectDropdown: React.FC<MultiSelectDropdownProps> = ({
  label,
  options,
  selectedValues,
  onChange,
  placeholder = "Select options...",
  maxDisplayItems = 2,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchTerm('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredOptions = options.filter(option =>
    option.label.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleToggleOption = (value: string) => {
    const newValues = selectedValues.includes(value)
      ? selectedValues.filter(v => v !== value)
      : [...selectedValues, value];
    onChange(newValues);
  };

  const handleRemoveValue = (value: string, e: React.MouseEvent) => {
    e.stopPropagation();
    handleToggleOption(value);
  };

  const displayedValues = selectedValues.slice(0, maxDisplayItems);
  const remainingCount = selectedValues.length - maxDisplayItems;

  return (
    <div className="flex flex-col gap-1" ref={dropdownRef}>
      <label className="text-xs font-medium text-gray-600 dark:text-gray-400">{label}</label>
      <div className="relative">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={`w-full min-w-[200px] min-h-[2.25rem] pl-2.5 pr-8 py-1.5 text-left bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md shadow-xs text-gray-900 dark:text-white text-13 hover:border-gray-400 dark:hover:border-gray-600 transition-colors ${
            isOpen ? 'ring-2 ring-indigo-500 border-indigo-500' : ''
          }`}
        >
          <div className="flex flex-wrap items-center gap-1">
            {selectedValues.length === 0 ? (
              <span className="text-gray-500 dark:text-gray-400">{placeholder}</span>
            ) : (
              <>
                {displayedValues.map(value => {
                  const option = options.find(opt => opt.value === value);
                  return (
                    <span
                      key={value}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 text-xs font-medium rounded ring-1 ring-inset ring-indigo-600/15 dark:ring-indigo-400/20"
                    >
                      {option?.label || value}
                      <button
                        onClick={(e) => handleRemoveValue(value, e)}
                        className="hover:text-indigo-900 dark:hover:text-white text-indigo-800 dark:text-indigo-300"
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
                {remainingCount > 0 && (
                  <span className="text-xs text-gray-600 dark:text-gray-400">+{remainingCount} more</span>
                )}
              </>
            )}
          </div>
          <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
            <svg
              className={`w-4 h-4 text-gray-600 dark:text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </button>

        {isOpen && (
          <div className="absolute z-50 w-full min-w-[200px] mt-1 bg-white dark:bg-gray-900 ring-1 ring-gray-200 dark:ring-gray-800 rounded-lg shadow-popover max-h-60 overflow-hidden animate-fade-in">
            {options.length > 5 && (
              <div className="p-2 border-b border-gray-100 dark:border-gray-800">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search..."
                  className="w-full px-2 py-1 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md text-gray-900 dark:text-white text-13 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            )}
            <div className="max-h-48 overflow-y-auto">
              {filteredOptions.length === 0 ? (
                <div className="p-3 text-center text-gray-600 dark:text-gray-400 text-sm">
                  No options found
                </div>
              ) : (
                filteredOptions.map(option => (
                  <label
                    key={option.value}
                    className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer text-13"
                  >
                    <input
                      type="checkbox"
                      checked={selectedValues.includes(option.value)}
                      onChange={() => handleToggleOption(option.value)}
                      className="rounded border-gray-300 dark:border-gray-600 dark:bg-gray-800 text-indigo-600 focus:ring-indigo-500 flex-shrink-0"
                    />
                    <span className="text-gray-900 dark:text-white break-words" title={option.label}>
                      {option.label}
                    </span>
                  </label>
                ))
              )}
            </div>
            {selectedValues.length > 0 && (
              <div className="border-t border-gray-100 dark:border-gray-800 p-2">
                <button
                  onClick={() => onChange([])}
                  className="w-full text-left text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                >
                  Clear all
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const SubmissionFilters: React.FC<SubmissionFiltersProps> = ({
  submissions,
  surveyConfig,
  activeFilters,
  onFiltersChange,
  isLoading,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // Extract filter options from submissions
  const filterOptions = useMemo(() => {
    return {
      enumerators: extractUniqueEnumerators(submissions, surveyConfig),
      samplingVariables: getSamplingVariables(surveyConfig),
      samplingValues: activeFilters.samplingVariable
        ? extractUniqueSamplingValues(submissions, activeFilters.samplingVariable, surveyConfig)
        : [],
    };
  }, [submissions, surveyConfig, activeFilters.samplingVariable]);

  // Handle filter changes with debouncing
  const handleFilterChange = useCallback((newFilters: Partial<FilterState>) => {
    const updatedFilters = { ...activeFilters, ...newFilters };
    onFiltersChange(updatedFilters);
  }, [activeFilters, onFiltersChange]);


  // Handle sampling filter changes
  const handleSamplingFilterChange = useCallback((variable: string, values: string[]) => {
    let newSamplingFilters = [...(activeFilters.samplingFilters || [])];
    const existingFilterIndex = newSamplingFilters.findIndex(f => f.variable === variable);

    if (values.length > 0) {
      if (existingFilterIndex >= 0) {
        // Update existing filter
        newSamplingFilters[existingFilterIndex].values = values;
      } else {
        // Create new filter
        newSamplingFilters.push({ variable, values });
      }
    } else {
      // Remove filter if no values selected
      if (existingFilterIndex >= 0) {
        newSamplingFilters.splice(existingFilterIndex, 1);
      }
    }

    handleFilterChange({ samplingFilters: newSamplingFilters.length > 0 ? newSamplingFilters : undefined });
  }, [activeFilters.samplingFilters, handleFilterChange]);

  // Handle removing a specific filter
  const handleRemoveFilter = useCallback((filterType: 'validationStatuses' | 'enumerators' | 'samplingFilters', value?: string, variable?: string) => {
    const updatedFilters = { ...activeFilters };

    if (filterType === 'validationStatuses' && value) {
      updatedFilters.validationStatuses = (activeFilters.validationStatuses || []).filter(s => s !== value);
      if (updatedFilters.validationStatuses.length === 0) {
        updatedFilters.validationStatuses = undefined;
      }
    } else if (filterType === 'enumerators' && value) {
      updatedFilters.enumerators = (activeFilters.enumerators || []).filter(e => e !== value);
      if (updatedFilters.enumerators.length === 0) {
        updatedFilters.enumerators = undefined;
      }
    } else if (filterType === 'samplingFilters' && variable && value) {
      updatedFilters.samplingFilters = (activeFilters.samplingFilters || []).map(f => {
        if (f.variable === variable) {
          f.values = f.values.filter(v => v !== value);
        }
        return f;
      }).filter(f => f.values.length > 0);
      if (updatedFilters.samplingFilters.length === 0) {
        updatedFilters.samplingFilters = undefined;
      }
    }

    onFiltersChange(updatedFilters);
  }, [activeFilters, onFiltersChange]);

  // Handle clearing all filters
  const handleClearAllFilters = useCallback(() => {
    onFiltersChange({});
  }, [onFiltersChange]);

  // Get active filter count
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (activeFilters.validationStatuses) count += activeFilters.validationStatuses.length;
    if (activeFilters.enumerators) count += activeFilters.enumerators.length;
    if (activeFilters.samplingFilters) {
      count += activeFilters.samplingFilters.reduce((sum, filter) => sum + filter.values.length, 0);
    }
    return count;
  }, [activeFilters]);

  return (
    <div className="border-b border-gray-200 dark:border-gray-800">
      {/* Collapsed Header */}
      <div className="flex h-11 items-center justify-between px-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            aria-expanded={isExpanded}
            className="flex h-7 items-center gap-1.5 px-2 text-13 font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
          >
            <svg className="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 5h18M6 12h12M10 19h4" />
            </svg>
            <span>Filters</span>
            {activeFilterCount > 0 && (
              <span className="tabular min-w-[1.25rem] bg-indigo-600 text-white text-[11px] leading-5 px-1.5 rounded-full text-center">
                {activeFilterCount}
              </span>
            )}
          </button>
          {isLoading && <Spinner size="sm" />}
        </div>
        {activeFilterCount > 0 && (
          <button
            onClick={handleClearAllFilters}
            className="h-7 rounded-md px-2 text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-white transition-colors"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Expanded Filter Panel */}
      {isExpanded && (
        <div className="px-3 pb-4 border-t border-gray-100 dark:border-gray-800 animate-fade-in">
          {/* Filter Summary */}
          {activeFilterCount > 0 && (
            <div className="mt-4 mb-4">
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                Active filters
              </div>
              <div className="flex flex-wrap gap-2">
                {/* Validation Status Chips */}
                {(activeFilters.validationStatuses || []).map((status) => (
                  <span key={status} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 text-xs font-medium rounded-md ring-1 ring-inset ring-indigo-600/15 dark:ring-indigo-400/20">
                    Status: {status}
                    <button
                      onClick={() => handleRemoveFilter('validationStatuses', status)}
                      className="ml-0.5 rounded px-1 hover:bg-indigo-100 hover:text-indigo-900 dark:hover:bg-indigo-500/20 dark:hover:text-white"
                    >
                      ×
                    </button>
                  </span>
                ))}

                {/* Enumerator Chips */}
                {(activeFilters.enumerators || []).map((enumerator) => (
                  <span key={enumerator} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 text-xs font-medium rounded-md ring-1 ring-inset ring-indigo-600/15 dark:ring-indigo-400/20">
                    Enumerator: {enumerator}
                    <button
                      onClick={() => handleRemoveFilter('enumerators', enumerator)}
                      className="ml-0.5 rounded px-1 hover:bg-indigo-100 hover:text-indigo-900 dark:hover:bg-indigo-500/20 dark:hover:text-white"
                    >
                      ×
                    </button>
                  </span>
                ))}

                {/* Sampling Filter Chips */}
                {(activeFilters.samplingFilters || []).map((filter) =>
                  filter.values.map((value) => (
                    <span key={`${filter.variable}-${value}`} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 text-xs font-medium rounded-md ring-1 ring-inset ring-indigo-600/15 dark:ring-indigo-400/20">
                      {filter.variable}: {value}
                      <button
                        onClick={() => handleRemoveFilter('samplingFilters', value, filter.variable)}
                        className="ml-0.5 rounded px-1 hover:bg-indigo-100 hover:text-indigo-900 dark:hover:bg-indigo-500/20 dark:hover:text-white"
                      >
                        ×
                      </button>
                    </span>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Filter Controls */}
          <div className="flex flex-col gap-4 mt-3">
            {/* Validation Status Multi-Select */}
            <MultiSelectDropdown
              label="Validation Status"
              options={[
                { value: 'Approved', label: 'Approved' },
                { value: 'Not Approved', label: 'Not Approved' },
                { value: 'On Hold', label: 'On Hold' },
                { value: 'Not Reviewed', label: 'Not Reviewed' },
              ]}
              selectedValues={activeFilters.validationStatuses || []}
              onChange={(values) => handleFilterChange({ validationStatuses: values.length > 0 ? values : undefined })}
              placeholder="Select validation statuses..."
            />

            {/* Enumerator Multi-Select */}
            {supportsEnumeratorFiltering(surveyConfig) && (
              <MultiSelectDropdown
                label="Enumerator"
                options={filterOptions.enumerators.map(enumValue => ({
                  value: enumValue,
                  label: enumValue
                }))}
                selectedValues={activeFilters.enumerators || []}
                onChange={(values) => handleFilterChange({ enumerators: values.length > 0 ? values : undefined })}
                placeholder="Select enumerators..."
              />
            )}

            {/* Sampling Variables */}
            {supportsSamplingFiltering(surveyConfig) && (
              <div className="flex flex-col gap-2 xl:col-span-1">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Sampling Variables</label>
                <div className="space-y-3">
                  {filterOptions.samplingVariables.map((variable) => {
                    const values = extractUniqueSamplingValues(submissions, variable, surveyConfig);
                    const currentFilter = (activeFilters.samplingFilters || []).find(f => f.variable === variable);

                    return (
                      <MultiSelectDropdown
                        key={variable}
                        label={variable}
                        options={values.map(value => ({ value, label: value }))}
                        selectedValues={currentFilter?.values || []}
                        onChange={(selectedValues) => handleSamplingFilterChange(variable, selectedValues)}
                        placeholder={`Select ${variable} values...`}
                        maxDisplayItems={1}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SubmissionFilters;
