import React from 'react';
import { KoboToolData, SamplingMode } from '../../types';

/**
 * How many interviews a survey intends to do, and how that is expressed.
 *
 * User-facing copy says "collection targets", not "sampling frame". A sampling
 * frame, methodologically, is the list of units you sample *from*; this is the
 * opposite end -- how many interviews you intend to *do* per group. The config
 * key stays `sampling_frame` so nothing has to be migrated, but nobody reading
 * the screen should have to know that.
 *
 * The four modes are a ladder, not alternatives of equal weight. Most surveys
 * want the second rung: one number.
 */

export interface CollectionTargetsProps {
  mode: SamplingMode;
  onModeChange: (mode: SamplingMode) => void;

  totalTarget: number | null;
  onTotalTargetChange: (value: number | null) => void;

  variable: string | null;
  onVariableChange: (variable: string | null) => void;

  targetsByValue: Record<string, number>;
  onTargetsByValueChange: (targets: Record<string, number>) => void;

  koboToolData: KoboToolData | null;
  /** e.g. "label::English (en)" -- which translation to show for choices. */
  labelColumnChoices?: string;
  editable: boolean;
  /**
   * The file upload UI for `uploaded` mode, supplied by the page.
   *
   * It differs between the create and settings screens (existing-file notice,
   * validation messages) and is unrelated to choosing a mode, so it stays where
   * it already lives rather than being moved in here twice.
   */
  uploadedSlot?: React.ReactNode;
}

const MODE_OPTIONS: Array<{ value: SamplingMode; label: string; hint: string }> = [
  {
    value: 'none',
    label: 'No targets',
    hint: 'Track how much data is coming in, without a total to measure against.',
  },
  {
    value: 'total',
    label: 'A total for the whole survey',
    hint: 'One number, e.g. 500 interviews. Gives an overall percentage complete.',
  },
  {
    value: 'by_variable',
    label: 'A target per answer to one question',
    hint: 'Pick a question from your form and set a target for each of its answers.',
  },
  {
    value: 'uploaded',
    label: 'Upload a file of targets',
    hint: 'A spreadsheet with one row per group. Use this for more than one grouping question.',
  },
];

/** Parse a target input. Blank and unusable values mean "no target", never 0. */
const parseTarget = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  const whole = Math.floor(value);
  return whole > 0 ? whole : null;
};

const CollectionTargets: React.FC<CollectionTargetsProps> = ({
  mode,
  onModeChange,
  totalTarget,
  onTotalTargetChange,
  variable,
  onVariableChange,
  targetsByValue,
  onTargetsByValueChange,
  koboToolData,
  labelColumnChoices,
  editable,
  uploadedSlot,
}) => {
  const [evenlyTotal, setEvenlyTotal] = React.useState<string>('');

  // select_one only. A select_multiple answer is several values at once, so one
  // submission would count toward several strata and the per-value numbers
  // would exceed the total conducted -- the figures would stop reconciling.
  //
  // The first token, not the whole string: `variableMap` carries the raw
  // XLSForm type ("select_one districts") when the form was rebuilt from a
  // stored config via reconstructKoboToolData, and the split type
  // ("select_one") when it came straight from the Kobo API. Existing callers
  // never noticed because they only match operand-free types like `integer`.
  const strataVariables = React.useMemo(() => {
    if (!koboToolData?.variableMap) return [];
    return Array.from(koboToolData.variableMap.entries())
      .filter(([, info]) => (info.type || '').split(' ')[0] === 'select_one' && info.choiceListName)
      .map(([name, info]) => ({ name, label: info.label || name, listName: info.choiceListName! }));
  }, [koboToolData]);

  const choices = React.useMemo(() => {
    if (!koboToolData || !variable) return [];
    const listName = koboToolData.variableMap?.get(variable)?.choiceListName;
    if (!listName) return [];
    return (koboToolData.choices || [])
      .filter((choice) => choice.list_name === listName)
      .map((choice) => ({
        value: choice.name,
        label:
          (labelColumnChoices && (choice as Record<string, any>)[labelColumnChoices]) ||
          (choice as Record<string, any>)['label::English (en)'] ||
          choice.name,
      }));
  }, [koboToolData, variable, labelColumnChoices]);

  /**
   * Split a total across the strata.
   *
   * The remainder goes one each to the first few rather than being dropped:
   * 500 across 3 groups is 167/167/166, not 166/166/166, which would quietly
   * lose two interviews from the total the user just typed. Prefilled values
   * are editable afterwards -- this is a starting point, not a decision.
   */
  const distributeEvenly = () => {
    const total = parseTarget(evenlyTotal);
    if (!total || choices.length === 0) return;

    const base = Math.floor(total / choices.length);
    const remainder = total % choices.length;
    const next: Record<string, number> = {};
    choices.forEach((choice, index) => {
      const share = base + (index < remainder ? 1 : 0);
      if (share > 0) next[choice.value] = share;
    });
    onTargetsByValueChange(next);
  };

  const setOneTarget = (value: string, raw: string) => {
    const next = { ...targetsByValue };
    const parsed = parseTarget(raw);
    if (parsed === null) {
      delete next[value];
    } else {
      next[value] = parsed;
    }
    onTargetsByValueChange(next);
  };

  const enteredTotal = (Object.values(targetsByValue) as number[]).reduce(
    (sum, n) => sum + n,
    0
  );

  if (!editable) {
    const summary = MODE_OPTIONS.find((option) => option.value === mode)?.label || mode;
    return (
      <div className="text-gray-700 dark:text-gray-300">
        <div className="font-medium">{summary}</div>
        {mode === 'total' && totalTarget ? (
          <div className="text-sm mt-1">{totalTarget} interviews</div>
        ) : null}
        {mode === 'by_variable' && variable ? (
          <div className="text-sm mt-1">
            By {variable} — {enteredTotal || '—'} interviews across{' '}
            {Object.keys(targetsByValue).length} groups
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="block text-sm font-medium text-gray-700 dark:text-gray-400 mb-2">
          How are your collection targets set?
        </legend>
        <div className="space-y-2">
          {MODE_OPTIONS.map((option) => (
            <label
              key={option.value}
              className="flex items-start gap-3 p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md cursor-pointer hover:border-indigo-400 dark:hover:border-indigo-500"
            >
              <input
                type="radio"
                name="collection-targets-mode"
                value={option.value}
                checked={mode === option.value}
                onChange={() => onModeChange(option.value)}
                className="mt-1 text-indigo-600 focus:ring-indigo-500"
              />
              <span>
                <span className="block text-sm font-medium text-gray-900 dark:text-white">
                  {option.label}
                </span>
                <span className="block text-xs text-gray-600 dark:text-gray-400">
                  {option.hint}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {mode === 'total' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-400 mb-1">
            Total interviews planned
          </label>
          <input
            type="number"
            min={1}
            value={totalTarget ?? ''}
            onChange={(e) => onTotalTargetChange(parseTarget(e.target.value))}
            placeholder="e.g. 500"
            className="w-48 px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      )}

      {mode === 'by_variable' && (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-400 mb-1">
              Group by
            </label>
            {strataVariables.length > 0 ? (
              <select
                value={variable || ''}
                onChange={(e) => {
                  onVariableChange(e.target.value || null);
                  // Targets belong to the previous question's answers and mean
                  // nothing under a new one.
                  onTargetsByValueChange({});
                }}
                className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">-- Select a question --</option>
                {strataVariables.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.label} ({item.name})
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-sm text-yellow-600 dark:text-yellow-400">
                {koboToolData
                  ? 'This form has no single-answer questions with a list of options, so there is nothing to group by. Upload a file of targets instead.'
                  : 'Read the form from your Kobo project first, so its questions can be listed.'}
              </p>
            )}
          </div>

          {variable && choices.length > 0 && (
            <>
              <div className="flex flex-wrap items-end gap-2 p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md">
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-400 mb-1">
                    Total sample size
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={evenlyTotal}
                    onChange={(e) => setEvenlyTotal(e.target.value)}
                    placeholder="e.g. 500"
                    className="w-36 px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <button
                  type="button"
                  onClick={distributeEvenly}
                  disabled={!parseTarget(evenlyTotal)}
                  className="px-3 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-indigo-400 text-sm font-medium"
                >
                  Divide evenly
                </button>
                <p className="text-xs text-gray-600 dark:text-gray-400 flex-1 min-w-[14rem]">
                  Fills every group with an equal share, which you can then edit.
                </p>
              </div>

              <div className="overflow-x-auto rounded-md border border-gray-200 dark:border-gray-700">
                <table className="min-w-full">
                  <thead className="bg-gray-100 dark:bg-gray-900">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-400 uppercase tracking-wider">
                        Group
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-400 uppercase tracking-wider">
                        Target interviews
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800">
                    {choices.map((choice) => (
                      <tr key={choice.value} className="border-t border-gray-200 dark:border-gray-700">
                        <td className="px-4 py-2 text-sm text-gray-900 dark:text-white">
                          {choice.label}
                          {choice.label !== choice.value && (
                            <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
                              {choice.value}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="number"
                            min={1}
                            value={targetsByValue[choice.value] ?? ''}
                            onChange={(e) => setOneTarget(choice.value, e.target.value)}
                            placeholder="—"
                            className="w-28 px-2 py-1 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 dark:bg-gray-900">
                    <tr className="border-t border-gray-200 dark:border-gray-700">
                      <td className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                        Total
                      </td>
                      <td className="px-4 py-2 text-sm font-medium text-gray-900 dark:text-white">
                        {enteredTotal || '—'}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                A group left blank has no target. It still appears on the progress page with
                its count, just without a percentage.
              </p>
            </>
          )}
        </div>
      )}

      {mode === 'uploaded' && uploadedSlot}
    </div>
  );
};

export default CollectionTargets;
