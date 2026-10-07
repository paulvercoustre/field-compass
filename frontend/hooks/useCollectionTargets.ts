import React, { useState } from 'react';
import { KoboToolData, SamplingMode } from '../types';
import { SurveyConfig } from '../services/progressApi';
import { parseSamplingFrame, validateSamplingFrameColumns } from '../utils/samplingFrameParser';
import { inferSamplingMode } from '../utils/samplingMode';

type StoredTargets = NonNullable<SurveyConfig['config_data']['sampling_frame']>;

/** A survey's collection targets, as edited: everything but the uploaded rows. */
interface TargetsSettings {
  mode: SamplingMode | null;
  sampling_cols: string[];
  admin_level_for_label: string;
  admin_level_choice_name: string;
  total_target: number | null;
  variable: string | null;
  targets_by_value: Record<string, number>;
}

const NO_TARGETS: TargetsSettings = {
  mode: null,
  sampling_cols: [],
  admin_level_for_label: '',
  admin_level_choice_name: '',
  total_target: null,
  variable: null,
  targets_by_value: {},
};

/**
 * The collection-targets editor's state, shared by survey creation and survey
 * settings: the chosen mode and its settings, and an uploaded targets file
 * checked against the form's questions.
 */
export function useCollectionTargets(koboToolData: KoboToolData | null) {
  const [settings, setSettings] = useState<TargetsSettings>(NO_TARGETS);
  const [frameData, setFrameData] = useState<Record<string, any>[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const clearFile = () => {
    setFrameData(null);
    setFileName('');
    setError(null);
    setNote(null);
  };

  /** Show what is stored (on load, and on Cancel). */
  const load = (frame: StoredTargets | undefined) => {
    clearFile();
    setSettings({
      // A config stored before `mode` existed carries none. Infer it the
      // way get_sampling_mode() does rather than defaulting to a constant,
      // so an existing survey shows the mode it actually behaves as.
      mode: frame ? inferSamplingMode(frame) : null,
      sampling_cols: frame?.sampling_cols || [],
      admin_level_for_label: frame?.admin_level_for_label || '',
      admin_level_choice_name: frame?.admin_level_choice_name || '',
      total_target: frame?.total_target ?? null,
      variable: frame?.variable ?? null,
      targets_by_value: frame?.targets_by_value || {},
    });
    if (frame?.frame_data) setFrameData(frame.frame_data);
  };

  /**
   * Switching mode discards the settings that belonged to the old one.
   *
   * Each mode owns its own settings and they mean nothing under another --
   * per-answer targets name a question the new mode does not use, an uploaded
   * file describes groupings nobody reads. Leaving them behind produces a
   * config that claims to be `total` while still carrying a frame, which the
   * next reader has to guess at. Nothing is written until Save, so Cancel
   * still restores.
   */
  const changeMode = (mode: SamplingMode) => {
    if (mode !== 'uploaded') clearFile();
    setSettings((prev) => ({
      ...prev,
      mode,
      total_target: mode === 'total' ? prev.total_target : null,
      variable: mode === 'by_variable' ? prev.variable : null,
      targets_by_value: mode === 'by_variable' ? prev.targets_by_value : {},
      // sampling_cols is the uploaded file's matched columns, or the chosen
      // variable, depending on the mode.
      sampling_cols:
        mode === 'uploaded' ? prev.sampling_cols : mode === 'by_variable' && prev.variable ? [prev.variable] : [],
    }));
  };

  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setError(null);
    setNote(null);
    setFileName('');
    try {
      const { headers, rows } = await parseSamplingFrame(file);
      if (!koboToolData?.variableMap) {
        throw new Error(
          'Read the form from your Kobo project first, so its columns can be checked against your questions'
        );
      }
      const validation = validateSamplingFrameColumns(headers, Array.from(koboToolData.variableMap.keys()));
      if (!validation.isValid) {
        throw new Error(
          'None of the columns in this file match a question in your form. It needs at least one column named after a question, so targets can be matched to submissions.'
        );
      }

      setFrameData(rows);
      setFileName(file.name);
      // Lead with what worked. A real targets file carried `Region / AO`,
      // `sampling_admin_1_label` and `sampling_livelihood_label` alongside the
      // columns the app uses; ignoring those is correct behaviour, and saying
      // so in the register of a problem told the user their file was wrong.
      if (validation.hasUnmatchedColumns) {
        const targetInfo = validation.targetColumn
          ? ` "${validation.targetColumn}" is being read as the target column.`
          : '';
        setNote(
          `Using ${validation.matchingColumns.join(', ')} from this file.${targetInfo} Other columns are ignored: ${validation.unmatchedColumns.join(', ')}.`
        );
      }
      // Only the columns that match a question group the targets.
      setSettings((prev) => ({
        ...prev,
        sampling_cols: validation.matchingColumns,
        admin_level_for_label: validation.matchingColumns[0] || prev.admin_level_for_label,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that targets file');
    } finally {
      setIsLoading(false);
      event.target.value = '';
    }
  };

  return {
    settings,
    frameData,
    fileName,
    isLoading,
    error,
    note,
    load,
    changeMode,
    upload,
    setTotalTarget: (total_target: number | null) => setSettings((prev) => ({ ...prev, total_target })),
    // sampling_cols mirrors the chosen question, so every consumer keeps
    // reading one field.
    setVariable: (variable: string | null) =>
      setSettings((prev) => ({ ...prev, variable, sampling_cols: variable ? [variable] : [] })),
    setTargetsByValue: (targets_by_value: Record<string, number>) =>
      setSettings((prev) => ({ ...prev, targets_by_value })),
    /** What the config stores. */
    toConfig: () => ({ ...settings, frame_data: frameData }),
  };
}

export type CollectionTargetsState = ReturnType<typeof useCollectionTargets>;
