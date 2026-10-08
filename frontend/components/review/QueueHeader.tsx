import React, { useEffect, useRef, useState } from 'react';
import { FilterState, QueueSort, ReviewTab, SubmissionFacets } from '../../types';
import { SurveyConfig } from '../../services/progressApi';
import { issueName } from '../../utils/issueNames';
import { formatValueForDisplay, getQuestionLabel } from '../../utils/koboLabelUtils';
import { menuFilterCount } from '../../utils/filterUtils';
import { useNavigation } from '../../contexts/NavigationContext';
import { Spinner } from '../Spinner';
import FilterMenu from './FilterMenu';

const TABS: Array<{ id: ReviewTab; label: string }> = [
  { id: 'needs_review', label: 'Needs review' },
  { id: 'on_hold', label: 'On hold' },
  { id: 'reviewed', label: 'Reviewed' },
  { id: 'all', label: 'All' },
];

const SORTS: Array<{ id: QueueSort; label: string }> = [
  { id: 'issues', label: 'Most issues first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'newest', label: 'Newest first' },
  { id: 'enumerator', label: 'By enumerator' },
];

/** What a link from elsewhere narrowed the list to, and where to fix it. */
const contextOf = (filters: FilterState): { text: string; settingsTab: string; settingsLabel: string } | null => {
  const ai = {
    failed: 'Showing submissions the AI review couldn’t check.',
    in_progress: 'Showing submissions the AI review is still checking.',
    not_run:
      'Showing submissions the AI review didn’t run on: the included reviews were used up, or the run was stopped.',
  } as const;
  const transcript = {
    any: 'Showing submissions with transcribed recordings.',
    failed: 'Showing submissions with a recording that couldn’t be transcribed.',
    no_speech: 'Showing submissions with a recording that has no speech.',
    in_progress: 'Showing submissions with recordings still being transcribed.',
  } as const;
  if (filters.aiReview)
    return { text: ai[filters.aiReview], settingsTab: 'quality', settingsLabel: 'AI review settings' };
  if (filters.transcript)
    return {
      text: transcript[filters.transcript],
      settingsTab: 'transcription',
      settingsLabel: 'Transcription settings',
    };
  return null;
};

interface QueueHeaderProps {
  filters: FilterState;
  facets: SubmissionFacets | null;
  surveyConfig: SurveyConfig | null;
  /** The order the list is in, as the server applied it. */
  sort: QueueSort | undefined;
  loading: boolean;
  onChange: (filters: FilterState) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
}

const Chip: React.FC<{ label: string; kind?: string; onRemove: () => void }> = ({ label, kind, onRemove }) => (
  <span className="inline-flex h-6 max-w-full items-center gap-1 rounded-full border border-gray-200 bg-gray-50 pl-2.5 pr-1 text-xs text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
    {kind && <span className="text-gray-500 dark:text-gray-400">{kind}</span>}
    <span className="truncate">{label}</span>
    <button
      type="button"
      onClick={onRemove}
      aria-label={`Remove ${kind ? `${kind} ` : ''}${label}`}
      className="flex h-4 w-4 items-center justify-center rounded-full text-gray-500 hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-gray-700 dark:hover:text-white"
    >
      ×
    </button>
  </span>
);

/**
 * The top of the queue: the review tabs, search, the filter and sort menus,
 * the filters in force as chips, and a banner for what a link narrowed to.
 */
const QueueHeader: React.FC<QueueHeaderProps> = ({
  filters,
  facets,
  surveyConfig,
  sort,
  loading,
  onChange,
  searchRef,
}) => {
  const { navigate } = useNavigation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [search, setSearch] = useState(filters.search ?? '');
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  // Typing settles for a moment before the list is asked again.
  useEffect(() => setSearch(filters.search ?? ''), [filters.search]);
  useEffect(() => {
    if ((filtersRef.current.search ?? '') === search.trim()) return;
    const timer = window.setTimeout(() => onChange({ ...filtersRef.current, search: search.trim() || undefined }), 300);
    return () => window.clearTimeout(timer);
  }, [search, onChange]);

  useEffect(() => {
    if (!sortOpen) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === 'Escape'
          : !(event.target as HTMLElement).closest('[data-sort-menu]')
      )
        setSortOpen(false);
    };
    document.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
    };
  }, [sortOpen]);

  const count = menuFilterCount(filters);
  const enumeratorField = surveyConfig?.config_data?.core_identifiers?.enumerator;
  const context = contextOf(filters);
  const activeSort = SORTS.find((s) => s.id === sort);

  return (
    <div className="relative border-b border-gray-200 dark:border-gray-800">
      <div role="tablist" aria-label="Review state" className="flex gap-1 overflow-x-auto px-2 pt-2">
        {TABS.map((tab) => {
          const selected = filters.review === tab.id;
          const n = facets?.tabs[tab.id];
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onChange({ ...filters, review: tab.id })}
              className={`-mb-px flex items-center gap-1 whitespace-nowrap border-b-2 px-1 pb-2.5 pt-1.5 text-[13px] transition-colors ${
                selected
                  ? 'border-gray-900 font-medium text-gray-900 dark:border-white dark:text-white'
                  : 'border-transparent text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
              }`}
            >
              {tab.label}
              {n !== undefined && (
                <span
                  className={`tabular rounded-full px-[5px] text-[11px] font-semibold leading-[18px] ${
                    selected && tab.id === 'needs_review' && n > 0
                      ? 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200'
                      : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                  }`}
                >
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="relative flex items-center gap-1.5 border-t border-gray-200 px-3 py-2 dark:border-gray-800">
        <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/25 dark:border-gray-700 dark:bg-gray-900">
          <svg
            className="h-3.5 w-3.5 flex-shrink-0 text-gray-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
          </svg>
          <span className="sr-only">Search submissions</span>
          <input
            ref={searchRef}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search ID or answers"
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0 dark:text-white"
          />
          {loading && <Spinner size="sm" />}
        </label>
        <button
          type="button"
          data-filter-toggle
          aria-expanded={menuOpen}
          aria-haspopup="dialog"
          onClick={() => setMenuOpen((open) => !open)}
          className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-sm font-medium transition-colors ${
            menuOpen || count > 0
              ? 'border-gray-900 text-gray-900 dark:border-white dark:text-white'
              : 'border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
          }`}
        >
          <svg
            className="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M3 5h18M6 12h12M10 19h4" />
          </svg>
          Filter
          {count > 0 && (
            <span className="tabular rounded-full bg-gray-900 px-1.5 text-[11px] leading-4 text-white dark:bg-white dark:text-gray-900">
              {count}
            </span>
          )}
        </button>
        <div className="relative" data-sort-menu>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={sortOpen}
            aria-label={`Sort: ${activeSort?.label ?? 'default'}`}
            title={activeSort?.label}
            onClick={() => setSortOpen((open) => !open)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4" />
            </svg>
          </button>
          {sortOpen && (
            <ul
              role="menu"
              className="absolute right-0 top-full z-30 mt-1 w-48 rounded-xl border border-gray-200 bg-white p-1 shadow-popover animate-fade-in dark:border-gray-800 dark:bg-gray-900"
            >
              {SORTS.map((option) => (
                <li key={option.id} role="none">
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={option.id === sort}
                    onClick={() => {
                      setSortOpen(false);
                      onChange({ ...filters, sort: option.id });
                    }}
                    className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm text-gray-800 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
                  >
                    {option.label}
                    {option.id === sort && <span aria-hidden="true">✓</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {menuOpen && (
          <FilterMenu
            facets={facets}
            filters={filters}
            surveyConfig={surveyConfig}
            onChange={onChange}
            onClose={() => setMenuOpen(false)}
          />
        )}
      </div>

      {(count > 0 || (filters.validationStatuses?.length ?? 0) > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2.5">
          {(filters.issues ?? []).map((check) => (
            <Chip
              key={`issue-${check}`}
              kind="Issue"
              label={issueName(check, (name) => getQuestionLabel(name, surveyConfig))}
              onRemove={() => onChange({ ...filters, issues: filters.issues!.filter((c) => c !== check) })}
            />
          ))}
          {(filters.enumerators ?? []).map((value) => (
            <Chip
              key={`enumerator-${value}`}
              kind="By"
              label={enumeratorField ? formatValueForDisplay(value, enumeratorField, surveyConfig) : value}
              onRemove={() => onChange({ ...filters, enumerators: filters.enumerators!.filter((v) => v !== value) })}
            />
          ))}
          {(filters.samplingFilters ?? []).flatMap((group) =>
            group.values.map((value) => (
              <Chip
                key={`${group.variable}-${value}`}
                label={formatValueForDisplay(value, group.variable, surveyConfig)}
                onRemove={() =>
                  onChange({
                    ...filters,
                    samplingFilters: (filters.samplingFilters ?? [])
                      .map((f) =>
                        f.variable === group.variable ? { ...f, values: f.values.filter((v) => v !== value) } : f
                      )
                      .filter((f) => f.values.length > 0),
                  })
                }
              />
            ))
          )}
          {(filters.validationStatuses ?? []).map((status) => (
            <Chip
              key={`status-${status}`}
              kind="Status"
              label={status}
              onRemove={() =>
                onChange({ ...filters, validationStatuses: filters.validationStatuses!.filter((s) => s !== status) })
              }
            />
          ))}
          <button
            type="button"
            onClick={() =>
              onChange({
                ...filters,
                issues: undefined,
                enumerators: undefined,
                samplingFilters: undefined,
                validationStatuses: undefined,
              })
            }
            className="px-1 text-xs text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            Clear
          </button>
        </div>
      )}

      {context && (
        <div
          role="status"
          className="mx-3 mb-2.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-[13px] text-indigo-900 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-100"
        >
          <p>{context.text}</p>
          <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
            <button
              type="button"
              onClick={() => onChange({ ...filters, aiReview: undefined, transcript: undefined })}
              className="font-medium text-indigo-700 hover:underline dark:text-indigo-300"
            >
              Show all submissions
            </button>
            <button
              type="button"
              onClick={() => navigate({ view: 'settings', tab: context.settingsTab })}
              className="text-indigo-700 hover:underline dark:text-indigo-300"
            >
              {context.settingsLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default QueueHeader;
