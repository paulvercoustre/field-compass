import React from 'react';
import { QualityChecksForm } from '../../utils/qualityCheckSettings';
import { SavedNote, SectionActions, SectionControls, SectionEditButton } from './SectionControls';

interface OutlierChecksSectionProps {
  checks: QualityChecksForm;
  setChecks: React.Dispatch<React.SetStateAction<QualityChecksForm>>;
  /** Numeric questions that can be checked for outliers. */
  numericVariables: string[];
  questionLabel: (name: string) => string | null;
  canEdit: boolean;
  controls: SectionControls;
  savedAt?: Date;
}

/** Which numeric answers are flagged as outliers, and how. */
const OutlierChecksSection: React.FC<OutlierChecksSectionProps> = ({
  checks,
  setChecks,
  numericVariables,
  questionLabel,
  canEdit,
  controls,
  savedAt,
}) => (
  <section className="bg-white dark:bg-gray-900 p-5 rounded-xl border border-gray-200 dark:border-gray-800 shadow-card">
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-base font-semibold tracking-tight text-gray-900 dark:text-white">Outlier checks</h2>
      {!controls.editing && <SavedNote at={savedAt} className="ml-auto mr-2" />}
      {canEdit && !controls.editing && <SectionEditButton onClick={controls.edit} />}
    </div>
    <div className="space-y-6">
      {/* Outlier Checks Flag */}
      <div className="space-y-2">
        <div className="flex items-start">
          <div className="flex h-5 items-center">
            <input
              type="checkbox"
              disabled={!controls.editing}
              checked={checks.flag_outliers}
              onChange={(e) => setChecks({ ...checks, flag_outliers: e.target.checked })}
              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600 dark:border-gray-600 dark:bg-gray-700"
            />
          </div>
          <div className="ml-3">
            <label className="text-sm font-medium text-gray-900 dark:text-white">Flag outlier values</label>
          </div>
        </div>

        {checks.flag_outliers && (
          <div className="ml-7 p-3 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 space-y-4">
            {/* Variable Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Variables to check
              </label>
              {controls.editing ? (
                <div className="space-y-2 max-h-48 overflow-y-auto border border-gray-200 dark:border-gray-600 rounded p-2">
                  {numericVariables.length > 0 ? (
                    numericVariables.map((variable) => (
                      <label
                        key={variable}
                        className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 p-1 rounded"
                      >
                        <input
                          type="checkbox"
                          checked={checks.outlier_variables.includes(variable)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setChecks({
                                ...checks,
                                outlier_variables: [...checks.outlier_variables, variable],
                              });
                            } else {
                              setChecks({
                                ...checks,
                                outlier_variables: checks.outlier_variables.filter((v) => v !== variable),
                                outlier_log_transform_variables: checks.outlier_log_transform_variables.filter(
                                  (v) => v !== variable
                                ),
                              });
                            }
                          }}
                          className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600 dark:border-gray-600 dark:bg-gray-700"
                        />
                        <span className="text-sm text-gray-700 dark:text-gray-300">
                          {questionLabel(variable) || variable}
                        </span>
                        {questionLabel(variable) && <span className="text-xs text-gray-500">({variable})</span>}
                      </label>
                    ))
                  ) : (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      No variables available. Please upload a Kobo tool first.
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-1">
                  {checks.outlier_variables.length > 0 ? (
                    checks.outlier_variables.map((variable) => (
                      <span
                        key={variable}
                        className="inline-block mr-2 mb-1 px-2 py-1 text-xs bg-indigo-100 text-indigo-800 rounded dark:bg-indigo-900 dark:text-indigo-200"
                      >
                        {questionLabel(variable) || variable}
                        {questionLabel(variable) && <span className="opacity-70"> ({variable})</span>}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-gray-500 dark:text-gray-400">No variables selected</span>
                  )}
                </div>
              )}
            </div>

            {/* Log transform per variable */}
            {checks.outlier_variables.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Log transform (signed)
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                  Use signed log transform for skewed or mixed-sign variables: sign(x) × log(1 + |x|)
                </p>
                {controls.editing ? (
                  <div className="space-y-2">
                    {checks.outlier_variables.map((variable) => (
                      <label
                        key={variable}
                        className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 p-1 rounded"
                      >
                        <input
                          type="checkbox"
                          checked={checks.outlier_log_transform_variables.includes(variable)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setChecks({
                                ...checks,
                                outlier_log_transform_variables: [...checks.outlier_log_transform_variables, variable],
                              });
                            } else {
                              setChecks({
                                ...checks,
                                outlier_log_transform_variables: checks.outlier_log_transform_variables.filter(
                                  (v) => v !== variable
                                ),
                              });
                            }
                          }}
                          className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600 dark:border-gray-600 dark:bg-gray-700"
                        />
                        <span className="text-sm text-gray-700 dark:text-gray-300">
                          {questionLabel(variable) || variable}
                        </span>
                        {questionLabel(variable) && <span className="text-xs text-gray-500">({variable})</span>}
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-1">
                    {checks.outlier_log_transform_variables.length > 0 ? (
                      checks.outlier_log_transform_variables.map((variable) => (
                        <span
                          key={variable}
                          className="inline-block mr-2 mb-1 px-2 py-1 text-xs bg-amber-100 text-amber-800 rounded dark:bg-amber-900 dark:text-amber-200"
                        >
                          {questionLabel(variable) || variable}
                          {questionLabel(variable) && <span className="opacity-70"> ({variable})</span>} (log)
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-gray-500 dark:text-gray-400">None</span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Method Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Detection method
              </label>
              {controls.editing ? (
                <select
                  value={checks.outlier_method}
                  onChange={(e) => {
                    const newMethod = e.target.value as 'iqr' | 'mad' | 'zscore';
                    // Update threshold based on method
                    const defaultThresholds = {
                      iqr: 1.5,
                      mad: 3.0,
                      zscore: 2.0,
                    };
                    setChecks({
                      ...checks,
                      outlier_method: newMethod,
                      outlier_threshold: defaultThresholds[newMethod],
                    });
                  }}
                  className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="iqr">IQR (Interquartile Range)</option>
                  <option value="mad">MAD (Median Absolute Deviation)</option>
                  <option value="zscore">Z-Score</option>
                </select>
              ) : (
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  {checks.outlier_method === 'iqr'
                    ? 'IQR (Interquartile Range)'
                    : checks.outlier_method === 'mad'
                      ? 'MAD (Median Absolute Deviation)'
                      : 'Z-Score'}
                </span>
              )}
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {checks.outlier_method === 'iqr'
                  ? 'Uses quartiles and IQR. Standard threshold: 1.5'
                  : checks.outlier_method === 'mad'
                    ? 'Robust method using median and MAD. Standard threshold: 3.0'
                    : 'Uses mean and standard deviation. Standard threshold: 2.0 (moderate) or 3.0 (strict)'}
              </p>
            </div>

            {/* Threshold */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Threshold</label>
              {controls.editing ? (
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  value={checks.outlier_threshold}
                  onChange={(e) =>
                    setChecks({
                      ...checks,
                      outlier_threshold: parseFloat(e.target.value) || 1.5,
                    })
                  }
                  className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              ) : (
                <span className="text-sm text-gray-700 dark:text-gray-300">{checks.outlier_threshold}</span>
              )}
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {checks.outlier_method === 'iqr'
                  ? 'IQR multiplier (e.g., 1.5 = standard, 3.0 = more conservative)'
                  : checks.outlier_method === 'mad'
                    ? 'Modified Z-score threshold (e.g., 3.0 = standard)'
                    : 'Z-score threshold (e.g., 2.0 = moderate, 3.0 = strict)'}
              </p>
            </div>
          </div>
        )}
      </div>
      {controls.editing && <SectionActions controls={controls} className="pt-4" />}
    </div>
  </section>
);

export default OutlierChecksSection;
