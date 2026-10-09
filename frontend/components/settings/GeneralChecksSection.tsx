import React, { useId } from 'react';
import { QualityChecksForm } from '../../utils/qualityCheckSettings';
import { SavedNote, SectionActions, SectionControls } from './SectionControls';

type DurationKey = 'min_survey_duration_minutes' | 'max_survey_duration_minutes';

interface GeneralChecksSectionProps {
  checks: QualityChecksForm;
  setChecks: React.Dispatch<React.SetStateAction<QualityChecksForm>>;
  /** Interview duration limits in minutes, null for no limit. */
  durations: Record<DurationKey, number | null>;
  onDurationChange: (key: DurationKey, minutes: number | null) => void;
  /** The out-of-period check compares against the saved collection dates. */
  hasCollectionDates: boolean;
  canEdit: boolean;
  controls: SectionControls;
  savedAt?: Date;
}

const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const PANEL = 'ml-7 p-3 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700';
const SMALL_INPUT =
  'w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white';
const INPUT =
  'w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md shadow-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500';
const READ_ONLY =
  'px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md text-gray-700 dark:text-gray-300';

/** One check's checkbox, and its options underneath while it is on. */
const CheckRow: React.FC<{
  label: string;
  hint?: string;
  checked: boolean;
  disabled: boolean;
  /** Greys the label: the check cannot be turned on yet. */
  unavailable?: boolean;
  onChange: (checked: boolean) => void;
  children?: React.ReactNode;
}> = ({ label, hint, checked, disabled, unavailable = false, onChange, children }) => {
  const id = useId();
  return (
    <div className="space-y-2">
      <div className="flex items-start">
        <div className="flex h-5 items-center">
          <input
            id={id}
            type="checkbox"
            disabled={disabled}
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600 dark:border-gray-600 dark:bg-gray-700"
          />
        </div>
        <div className="ml-3">
          <label
            htmlFor={id}
            className={`text-sm font-medium ${unavailable ? 'text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-white'}`}
          >
            {label}
          </label>
          {hint && <p className="text-xs text-gray-500 dark:text-gray-400">{hint}</p>}
        </div>
      </div>
      {checked && children}
    </div>
  );
};

const PercentThreshold: React.FC<{ value: number; canEdit: boolean; onChange: (percent: number) => void }> = ({
  value,
  canEdit,
  onChange,
}) => {
  const id = useId();
  return (
    <div className={PANEL}>
      <label htmlFor={id} className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
        Threshold (%)
      </label>
      {canEdit ? (
        <input
          id={id}
          type="number"
          min="0"
          max="100"
          step="0.1"
          value={value}
          onChange={(e) => onChange(Math.max(0, Math.min(100, Number.parseFloat(e.target.value) || 0)))}
          className={SMALL_INPUT}
        />
      ) : (
        <span className="text-sm text-gray-700 dark:text-gray-300">{value}%</span>
      )}
    </div>
  );
};

const TimeField: React.FC<{ label: string; value: string; canEdit: boolean; onChange: (time: string) => void }> = ({
  label,
  value,
  canEdit,
  onChange,
}) => {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
        {label}
      </label>
      {canEdit ? (
        <input id={id} type="time" value={value} onChange={(e) => onChange(e.target.value)} className={SMALL_INPUT} />
      ) : (
        <span className="text-sm text-gray-700 dark:text-gray-300">{value}</span>
      )}
    </div>
  );
};

const MinutesField: React.FC<{
  label: string;
  value: number | null;
  placeholder: string;
  canEdit: boolean;
  onChange: (minutes: number | null) => void;
}> = ({ label, value, placeholder, canEdit, onChange }) => {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
        {label}
      </label>
      {canEdit ? (
        <input
          id={id}
          type="number"
          value={value || ''}
          onChange={(e) => onChange(e.target.value ? parseInt(e.target.value) : null)}
          className={INPUT}
          placeholder={placeholder}
        />
      ) : (
        <div className={READ_ONLY}>{value ?? '—'}</div>
      )}
    </div>
  );
};

/** Checks on when and how a submission was collected, saved together. */
const GeneralChecksSection: React.FC<GeneralChecksSectionProps> = ({
  checks,
  setChecks,
  durations,
  onDurationChange,
  hasCollectionDates,
  canEdit,
  controls,
  savedAt,
}) => {
  const set = <K extends keyof QualityChecksForm>(key: K, value: QualityChecksForm[K]) =>
    setChecks((prev) => ({ ...prev, [key]: value }));

  const toggleWeekendDay = (day: number) =>
    setChecks((prev) => {
      const days = prev.weekend_days || [];
      return {
        ...prev,
        weekend_days: days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort(),
      };
    });

  return (
    <section className="bg-white dark:bg-gray-900 p-5 rounded-xl border border-gray-200 dark:border-gray-800 shadow-card">
      <h2 className="text-base font-semibold tracking-tight mb-4 text-gray-900 dark:text-white">General checks</h2>
      <div className="space-y-6">
        <CheckRow
          label="Flag submissions outside the collection period"
          hint={hasCollectionDates ? undefined : 'Needs a collection start or end date (General → Survey profile).'}
          checked={checks.flag_out_of_period && hasCollectionDates}
          disabled={!canEdit || !hasCollectionDates}
          unavailable={!hasCollectionDates}
          onChange={(on) => set('flag_out_of_period', on)}
        />

        <CheckRow
          label="Flag submissions on weekends"
          checked={checks.flag_weekend}
          disabled={!canEdit}
          onChange={(on) => set('flag_weekend', on)}
        >
          <div className={PANEL}>
            <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Select Weekend Days:
            </span>
            <div className="flex flex-wrap gap-2">
              {DAYS_OF_WEEK.map((label, day) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => canEdit && toggleWeekendDay(day)}
                  disabled={!canEdit}
                  className={`px-3 py-1 rounded-full text-xs font-medium border ${
                    checks.weekend_days?.includes(day)
                      ? 'bg-indigo-100 text-indigo-800 border-indigo-300 dark:bg-indigo-900 dark:text-indigo-200 dark:border-indigo-700'
                      : 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:border-gray-600'
                  } ${canEdit ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </CheckRow>

        <CheckRow
          label="Flag submissions outside office hours"
          checked={checks.flag_office_hours}
          disabled={!canEdit}
          onChange={(on) => set('flag_office_hours', on)}
        >
          <div className={`${PANEL} grid grid-cols-2 gap-4`}>
            <TimeField
              label="Start Time"
              value={checks.office_hours_start}
              canEdit={canEdit}
              onChange={(time) => set('office_hours_start', time)}
            />
            <TimeField
              label="End Time"
              value={checks.office_hours_end}
              canEdit={canEdit}
              onChange={(time) => set('office_hours_end', time)}
            />
          </div>
        </CheckRow>

        <CheckRow
          label="Flag submissions outside the collection targets"
          hint="Includes groups missing from the targets file and answers not among the question’s options."
          checked={checks.flag_sampling_frame}
          disabled={!canEdit}
          onChange={(on) => set('flag_sampling_frame', on)}
        />

        <CheckRow
          label={`Flag submissions with a high percentage of "Don't know" answers`}
          checked={checks.flag_dk_percentage}
          disabled={!canEdit}
          onChange={(on) => set('flag_dk_percentage', on)}
        >
          <PercentThreshold
            value={checks.dk_percentage_threshold}
            canEdit={canEdit}
            onChange={(percent) => set('dk_percentage_threshold', percent)}
          />
        </CheckRow>

        <CheckRow
          label="Flag submissions with a high percentage of empty answers"
          hint="Questions hidden by skip logic don’t count as empty."
          checked={checks.flag_empty_percentage}
          disabled={!canEdit}
          onChange={(on) => set('flag_empty_percentage', on)}
        >
          <PercentThreshold
            value={checks.empty_percentage_threshold}
            canEdit={canEdit}
            onChange={(percent) => set('empty_percentage_threshold', percent)}
          />
        </CheckRow>

        <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Interview duration limits</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <MinutesField
              label="Minimum (minutes)"
              value={durations.min_survey_duration_minutes}
              placeholder="e.g., 10"
              canEdit={canEdit}
              onChange={(minutes) => onDurationChange('min_survey_duration_minutes', minutes)}
            />
            <MinutesField
              label="Maximum (minutes)"
              value={durations.max_survey_duration_minutes}
              placeholder="e.g., 240"
              canEdit={canEdit}
              onChange={(minutes) => onDurationChange('max_survey_duration_minutes', minutes)}
            />
          </div>
        </div>
        {!controls.dirty && <SavedNote at={savedAt} className="pt-4" />}
        {canEdit && controls.dirty && <SectionActions controls={controls} className="pt-4" />}
      </div>
    </section>
  );
};

export default GeneralChecksSection;
