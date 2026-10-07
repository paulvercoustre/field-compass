import React, { useState } from 'react';
import { KoboToolData } from '../../types';
import { CollectionTargetsState } from '../../hooks/useCollectionTargets';
import { isTargetColumn } from '../../utils/samplingFrameParser';
import CollectionTargets, { totalFromFrameRows } from './CollectionTargets';

interface CollectionTargetsEditorProps {
  targets: CollectionTargetsState;
  koboToolData: KoboToolData | null;
  labelColumnChoices?: string;
}

/** The editable targets picker, with the upload for the "file of targets" mode. */
const CollectionTargetsEditor: React.FC<CollectionTargetsEditorProps> = ({
  targets,
  koboToolData,
  labelColumnChoices,
}) => {
  const [showHelp, setShowHelp] = useState(false);
  const { settings, frameData, fileName, isLoading, error, note } = targets;
  const planned = frameData ? totalFromFrameRows(frameData, isTargetColumn) : null;

  return (
    <CollectionTargets
      mode={settings.mode}
      onModeChange={targets.changeMode}
      totalTarget={settings.total_target}
      onTotalTargetChange={targets.setTotalTarget}
      variable={settings.variable}
      onVariableChange={targets.setVariable}
      targetsByValue={settings.targets_by_value}
      onTargetsByValueChange={targets.setTargetsByValue}
      koboToolData={koboToolData}
      labelColumnChoices={labelColumnChoices}
      editable={true}
      uploadedSlot={
        <>
          {frameData && (
            <div className="mb-3">
              <p className="text-sm font-medium text-gray-900 dark:text-white">{fileName || 'Targets file'}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {[
                  `${frameData.length} rows`,
                  settings.sampling_cols.length > 0 && `grouped by ${settings.sampling_cols.join(', ')}`,
                  planned !== null && `${planned} interviews planned`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
          )}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-400">
                Upload a file of targets (CSV or XLSX)
              </label>
              <button
                type="button"
                onClick={() => setShowHelp(!showHelp)}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                File format
              </button>
            </div>
            {showHelp && (
              <div className="mb-3 p-3 bg-blue-50 dark:bg-gray-800/50 border border-blue-200 dark:border-gray-700 rounded-md text-xs text-gray-700 dark:text-gray-300 space-y-2">
                <ul className="list-disc list-inside space-y-1.5 ml-2">
                  <li>
                    <strong>Format:</strong> CSV or Excel (.xlsx)
                  </li>
                  <li>
                    <strong>Column Headers:</strong> Must match variable names from your Kobo tool (e.g.,{' '}
                    <code className="bg-white dark:bg-gray-900 px-1 rounded">district</code>,{' '}
                    <code className="bg-white dark:bg-gray-900 px-1 rounded">village</code>,{' '}
                    <code className="bg-white dark:bg-gray-900 px-1 rounded">sector</code>)
                  </li>
                  <li>
                    <strong>Target Column (Optional):</strong> A column for interview targets/sample size that doesn't
                    need to match Kobo variables. Recognized names: target, target_interviews, sample_size,
                    interview_target, expected_interviews, etc.
                  </li>
                </ul>
                <div className="mt-2 pt-2 border-t border-blue-200 dark:border-gray-700">
                  <p className="font-medium text-gray-900 dark:text-gray-200 mb-1">Example file structure:</p>
                  <div className="bg-white dark:bg-gray-900 p-2 rounded text-xs overflow-x-auto font-mono">
                    <div>region,district,village,target</div>
                    <div>North,District A,Village 1,50</div>
                    <div>North,District A,Village 2,45</div>
                    <div>South,District B,Village 3,60</div>
                  </div>
                </div>
              </div>
            )}
            <input
              type="file"
              accept=".csv,.xlsx"
              onChange={targets.upload}
              className="block w-full text-sm text-gray-600 dark:text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-indigo-600 file:text-white hover:file:bg-indigo-700"
              disabled={isLoading || !koboToolData}
            />
            {error && (
              <div className="mt-2 p-3 bg-red-50 dark:bg-red-900/50 border border-red-200 dark:border-red-700 rounded-md text-red-800 dark:text-red-200 text-sm">
                {error}
              </div>
            )}
            {note && !error && (
              <div className="mt-2 p-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md text-gray-700 dark:text-gray-300 text-sm">
                {note}
              </div>
            )}
            {fileName && !error && !frameData && (
              <div className="mt-2 text-sm text-green-600 dark:text-green-400">✓ {fileName}</div>
            )}
            {!koboToolData && (
              <p className="mt-2 text-sm text-yellow-600 dark:text-yellow-400">
                Read the form from your Kobo project first.
              </p>
            )}
          </div>
        </>
      }
    />
  );
};

export default CollectionTargetsEditor;
