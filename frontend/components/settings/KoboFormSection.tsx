import React from 'react';
import { KoboToolData } from '../../types';
import { Spinner } from '../Spinner';
import { SavedNote, SectionActions, SectionControls } from './SectionControls';

interface KoboFormSectionProps {
  koboToolData: KoboToolData | null;
  fileName: string;
  variableCount: number;
  /** The `label::<language>` column questions and answers are shown in. */
  labelColumn: string;
  onLabelColumnChange: (column: string) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  /** The survey is linked to a Kobo project, so there is a form to read. */
  canRefresh: boolean;
  canEdit: boolean;
  controls: SectionControls;
  savedAt?: Date;
}

/** Translations are stored as `label::<language>` columns, so those are the form's languages. */
const labelColumns = (form: KoboToolData): string[] =>
  Array.from(
    new Set(
      [...form.survey, ...form.choices].flatMap((row) => Object.keys(row).filter((key) => key.startsWith('label::')))
    )
  );

const FormSummary: React.FC<{ fileName: string; variableCount: number }> = ({ fileName, variableCount }) => (
  <div>
    <p className="text-sm font-medium text-gray-900 dark:text-white">{fileName || 'Form loaded'}</p>
    <p className="text-xs text-gray-500 dark:text-gray-400">{variableCount} variables</p>
  </div>
);

/** The survey's Kobo form, read from the linked project, and the language its labels are shown in. */
const KoboFormSection: React.FC<KoboFormSectionProps> = ({
  koboToolData,
  fileName,
  variableCount,
  labelColumn,
  onLabelColumnChange,
  onRefresh,
  isRefreshing,
  canRefresh,
  canEdit,
  controls,
  savedAt,
}) => {
  // Only offered when the form has more than one translation: a control with
  // a single option asks the user to read something they cannot act on.
  const languages = koboToolData ? labelColumns(koboToolData) : [];

  return (
    <section className="bg-white dark:bg-gray-900 p-5 rounded-xl border border-gray-200 dark:border-gray-800 shadow-card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold tracking-tight text-gray-900 dark:text-white">Kobo form</h2>
        {!controls.dirty && <SavedNote at={savedAt} className="ml-auto" />}
      </div>
      <div className="space-y-2 text-gray-700 dark:text-gray-300">
        {koboToolData ? (
          <FormSummary fileName={fileName} variableCount={variableCount} />
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">No form loaded yet.</p>
        )}
        {canEdit && (
          <>
            <p className="pt-1 text-xs text-gray-500 dark:text-gray-400">
              Each pull reads the form from Kobo again. Refresh to see a change made in Kobo now.
            </p>
            <button
              type="button"
              onClick={onRefresh}
              disabled={isRefreshing || !canRefresh}
              className="px-4 py-2 bg-white text-gray-900 border border-gray-300 shadow-xs rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700 dark:hover:bg-gray-800 text-sm font-medium flex items-center gap-2"
            >
              {isRefreshing ? (
                <>
                  <Spinner size="sm" className="text-current" />
                  <span>Reading form...</span>
                </>
              ) : (
                <span>Refresh form</span>
              )}
            </button>
          </>
        )}

        {languages.length > 1 && (
          <div className="mt-4 space-y-2 pt-4 border-t border-gray-200 dark:border-gray-700">
            <label htmlFor="label-language" className="block text-sm font-semibold text-gray-900 dark:text-white">
              Label language
            </label>
            {canEdit ? (
              <select
                id="label-language"
                value={labelColumn}
                onChange={(e) => onLabelColumnChange(e.target.value)}
                className="w-full sm:w-72 px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md shadow-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {languages.map((column) => (
                  <option key={column} value={column}>
                    {column.replace('label::', '')}
                  </option>
                ))}
              </select>
            ) : (
              <p id="label-language" className="text-sm text-gray-900 dark:text-white">
                {labelColumn.replace('label::', '')}
              </p>
            )}
          </div>
        )}
        {canEdit && controls.dirty && <SectionActions controls={controls} className="mt-4" />}
      </div>
    </section>
  );
};

export default KoboFormSection;
