import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSurvey } from '../contexts/SurveyContext';
import { getSurveyConfig, updateSurvey, SurveyConfig } from '../services/progressApi';
import { reconstructKoboToolData } from '../utils/koboDataUtils';
import { KoboToolData } from '../types';
import CustomChecks from '../components/rule-builder/CustomChecks';
import { Spinner } from '../components/Spinner';
import SettingsLayout from '../components/ui/SettingsLayout';
import ErrorMessage from '../components/ui/ErrorMessage';
import SuccessMessage from '../components/ui/SuccessMessage';
import { getKoboProjectForm } from '../services/api';
import { labelColumnFor, parseKoboAssetId } from '../utils/koboUrl';
import CollectionTargets from '../components/ui/CollectionTargets';
import CollectionTargetsEditor from '../components/ui/CollectionTargetsEditor';
import { useCollectionTargets } from '../hooks/useCollectionTargets';
import { useSectionEditor } from '../hooks/useSectionEditor';
import { useCustomChecks } from '../hooks/useCustomChecks';
import {
  DEFAULT_QUALITY_CHECKS,
  GENERAL_FLAG_KEYS,
  LLM_KEYS,
  OUTLIER_KEYS,
  pick,
  sameSetting,
} from '../utils/qualityCheckSettings';
import VariableDropdown from '../components/ui/VariableDropdown';
import DkStringValues from '../components/ui/DkStringValues';
import DkNumericCodes from '../components/ui/DkNumericCodes';
import { readDkCodes, readDkValues, sameDkCodes, sameDkValues } from '../utils/dkSuggestions';
import FormLintPanel from '../components/linter/FormLintPanel';
import { koboToolPayload, projectFormToKoboTool } from '../utils/koboForm';
import AudioTranscriptionCard from '../components/transcription/AudioTranscriptionCard';
import TranslationCard from '../components/translation/TranslationCard';
import SurveyAccessTab from '../components/settings/SurveyAccessTab';
import OutlierChecksSection from '../components/settings/OutlierChecksSection';
import AiReviewSection from '../components/settings/AiReviewSection';
import GeneralChecksSection from '../components/settings/GeneralChecksSection';
import KoboFormSection from '../components/settings/KoboFormSection';
import DeleteSurveySection from '../components/settings/DeleteSurveySection';
import { SavedNote, SectionActions } from '../components/settings/SectionControls';
import KoboProjectPicker from '../components/ui/KoboProjectPicker';
import { RequestedTab } from '../contexts/NavigationContext';

type SurveySettingsTab = 'settings' | 'access' | 'quality' | 'transcription' | 'translation';
const SURVEY_SETTINGS_TABS: string[] = ['settings', 'access', 'quality', 'transcription', 'translation'];

// The label language a form saved without one is shown in.
const DEFAULT_LABEL_COLUMN = 'label::English (en)';

interface SurveySettingsPageProps {
  /** A tab asked for by a link elsewhere in the app (a notification, the activity panel). */
  requestedTab?: RequestedTab;
  /** The tab shown, for the page's address. */
  onTabChange?: (tab: string) => void;
}

/**
 * The page's sections. Each saves only its own fields, merged into the config
 * as it is on the server at that moment, so saving one section never writes
 * another's unsaved edits (or an older copy of what someone else saved).
 */
type SettingsSection =
  'basicInfo' | 'coreIdentifiers' | 'koboTool' | 'samplingFrame' | 'generalFlags' | 'outlier' | 'llm';

const SurveySettingsPage: React.FC<SurveySettingsPageProps> = ({ requestedTab, onTabChange }) => {
  const { selectedSurvey, refreshSurveys, setSelectedSurvey } = useSurvey();
  const [config, setConfig] = useState<SurveyConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // Wrapped so the handlers can be the ones defined further down.
  const sections = useSectionEditor<SettingsSection>({
    save: (section) => saveSection(section),
    restore: (section) => restoreSection(section),
    onError: setError,
  });
  const [savedAt, setSavedAt] = useState<Partial<Record<SettingsSection, Date>>>({});
  // Saves run one at a time, each on the config as the previous one left it.
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  // The survey on screen now: a save that finishes after a switch must not
  // touch the new survey's page.
  const currentSurveyId = useRef<string | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<SurveySettingsTab>(() =>
    requestedTab && SURVEY_SETTINGS_TABS.includes(requestedTab.tab)
      ? (requestedTab.tab as SurveySettingsTab)
      : 'settings'
  );
  useEffect(() => {
    if (requestedTab && SURVEY_SETTINGS_TABS.includes(requestedTab.tab)) {
      setActiveTab(requestedTab.tab as SurveySettingsTab);
    }
  }, [requestedTab]);
  useEffect(() => onTabChange?.(activeTab), [activeTab, onTabChange]);
  // Audio questions being transcribed: their transcripts can be AI-reviewed.
  const [transcribed, setTranscribed] = useState<{ paths: string[]; enabled: boolean }>({ paths: [], enabled: false });

  // Permission-based access control
  const userPermission = selectedSurvey?.permission;
  const canEditSurvey = userPermission === 'owner' || userPermission === 'admin';
  const canDeleteSurvey = userPermission === 'owner' || userPermission === 'admin';

  const customChecks = useCustomChecks(selectedSurvey?.survey_id, setError);

  // Kobo tool state
  const [koboToolData, setKoboToolData] = useState<KoboToolData | null>(null);
  const targets = useCollectionTargets(koboToolData);
  // A survey whose form has no audio questions has no transcription tab.
  useEffect(() => {
    if (activeTab === 'transcription' && koboToolData && !koboToolData.survey?.some((row) => row.type === 'audio')) {
      setActiveTab('settings');
    }
  }, [activeTab, koboToolData]);
  const [koboToolFileName, setKoboToolFileName] = useState<string>('');
  const [isLoadingTool, setIsLoadingTool] = useState(false);
  const [availableVariables, setAvailableVariables] = useState<string[]>([]);
  // The form's choice rows, carrying names and their label columns.
  const choiceRows: Array<Record<string, any>> = (koboToolData?.choices as any[]) || [];
  const surveyRows: Array<Record<string, any>> = (koboToolData?.survey as any[]) || [];
  // Outlier detection is the only picker that genuinely needs numbers.
  const [numericVariables, setNumericVariables] = useState<string[]>([]);
  const [textVariables, setTextVariables] = useState<Array<{ name: string; label: string; type: string }>>([]);
  const [labelColumnSurvey, setLabelColumnSurvey] = useState<string>(DEFAULT_LABEL_COLUMN);
  // The question text in the chosen label language, or null when the form
  // has none beyond the variable name.
  const questionLabel = (name: string): string | null => {
    const row = surveyRows.find((r) => r.name === name);
    const label = row && (row[labelColumnSurvey] || row['label::English (en)'] || row.label);
    return label && label !== name ? String(label) : null;
  };
  // Open-text questions, plus the audio questions being transcribed: the AI
  // review reads their transcripts.
  const reviewableVariables = useMemo(() => {
    const text = textVariables.map((v) => ({ ...v, label: questionLabel(v.name) || v.name }));
    if (!transcribed.enabled || !koboToolData) return text;
    const audio = (koboToolData.survey as Array<Record<string, any>>)
      .filter((row) => row.type === 'audio' && row.name && !row.roster_name)
      .filter((row) => transcribed.paths.includes(row.group_path ? `${row.group_path}/${row.name}` : row.name))
      .map((row) => ({
        name: row.name as string,
        label: `${questionLabel(row.name) || row.name} (transcript)`,
        type: 'audio',
      }));
    return [...text, ...audio];
  }, [textVariables, transcribed, koboToolData, labelColumnSurvey]);
  const [labelColumnChoices, setLabelColumnChoices] = useState<string>(DEFAULT_LABEL_COLUMN);

  // Sampling frame CSV state

  // Form state
  const [surveyName, setSurveyName] = useState('');
  const [koboAssetId, setKoboAssetId] = useState('');
  const [coreIdentifiers, setCoreIdentifiers] = useState({
    uuid: '_uuid', // always supplied by Kobo as submission metadata
    // Form-dependent, and nothing here is guessed: this screen is reached
    // after the survey exists, so the stored config is the only source of
    // truth. A default could only overwrite it or misrepresent it -- and not
    // merely on screen, since the load merges stored config *over* these, so a
    // config missing a key inherits the default and saving writes it.
    //
    // Suggestions still appear, grouped at the top of each dropdown, where the
    // user can see them and choose.
    enumerator: '',
    date_interview: '',
    start_time: '',
    end_time: '',
    consent: '',
  });
  const [specialValues, setSpecialValues] = useState({
    dk_value: readDkCodes(undefined),
    // Nothing pre-selected here, for the reason the identifiers beside it are
    // empty: the stored config is the source of truth after creation.
    dk_string_value: [] as string[],
  });
  const [globalParameters, setGlobalParameters] = useState({
    data_collection_start_date: '',
    data_collection_end_date: '',
    min_survey_duration_minutes: null as number | null,
    max_survey_duration_minutes: null as number | null,
  });

  // Dirty flags for Basic Info and Core Identifiers (Save/Cancel appear when user edits)
  const pickedAssetId = parseKoboAssetId(koboAssetId) ?? '';
  const isBasicInfoDirty =
    surveyName !== (config?.survey_name || '') ||
    (pickedAssetId || koboAssetId.trim()) !== (config?.kobo_asset_id || '') ||
    globalParameters.data_collection_start_date !==
      (config?.config_data?.global_parameters?.data_collection_start_date || '') ||
    globalParameters.data_collection_end_date !==
      (config?.config_data?.global_parameters?.data_collection_end_date || '');

  // Fallbacks here must match the initial state above, or clearing a field
  // reads as "unchanged" and the Save button never enables.
  const savedCoreIdentifiers = config?.config_data?.core_identifiers || {
    uuid: '_uuid',
    enumerator: '',
    date_interview: '',
    start_time: '',
    end_time: '',
    consent: '',
  };
  const isCoreIdentifiersDirty =
    coreIdentifiers.uuid !== (savedCoreIdentifiers.uuid ?? '_uuid') ||
    coreIdentifiers.enumerator !== (savedCoreIdentifiers.enumerator ?? '') ||
    coreIdentifiers.date_interview !== (savedCoreIdentifiers.date_interview ?? '') ||
    coreIdentifiers.start_time !== (savedCoreIdentifiers.start_time ?? '') ||
    coreIdentifiers.end_time !== (savedCoreIdentifiers.end_time ?? '') ||
    coreIdentifiers.consent !== (savedCoreIdentifiers.consent ?? '') ||
    !sameDkCodes(specialValues.dk_value, readDkCodes(config?.config_data?.special_values?.dk_value)) ||
    !sameDkValues(specialValues.dk_string_value, readDkValues(config?.config_data?.special_values?.dk_string_value));

  // Quality Checks State
  const [qualityChecks, setQualityChecks] = useState(DEFAULT_QUALITY_CHECKS);

  // Dirty flag for General Quality Checks section only (Save/Cancel when user edits)
  const savedQc = config?.config_data?.quality_checks;
  const isGeneralFlagsDirty = savedQc
    ? GENERAL_FLAG_KEYS.some((key) => !sameSetting(qualityChecks[key], savedQc[key] ?? DEFAULT_QUALITY_CHECKS[key])) ||
      globalParameters.min_survey_duration_minutes !==
        (config?.config_data?.global_parameters?.min_survey_duration_minutes ?? null) ||
      globalParameters.max_survey_duration_minutes !==
        (config?.config_data?.global_parameters?.max_survey_duration_minutes ?? null)
    : false;
  const changedSince = (keys: ReadonlyArray<keyof typeof DEFAULT_QUALITY_CHECKS>) =>
    keys.some((key) => !sameSetting(qualityChecks[key], savedQc?.[key] ?? DEFAULT_QUALITY_CHECKS[key]));
  const isOutlierDirty = changedSince(OUTLIER_KEYS);
  const isLlmDirty = changedSince(LLM_KEYS);

  useEffect(() => {
    if (selectedSurvey) {
      // Clear any success/error messages when switching to a different survey
      setSuccess(null);
      setError(null);
      setSavedAt({});
      loadSurveyConfig();
    } else {
      // Keep the success message visible: a deleted survey ends up here.
      setError(null);
    }
    // Keyed on the id, not the object.
    //
    // This effect calls loadSurveyConfig(), which overwrites every field on
    // this page with the saved config. Depending on the object means any
    // refetch that produces an equal-but-new Survey re-runs it and silently
    // discards whatever the user was in the middle of editing -- the form
    // snaps back to what is on the server and stops responding to changes.
    // The id is what actually decides whether we are looking at a different
    // survey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSurvey?.survey_id]);

  useEffect(() => {
    if (koboToolData && koboToolData.variableMap) {
      // Core identifiers can be any question type: an enumerator ID is usually
      // a select_one (best practice, so IDs are consistent) but is sometimes
      // free text, and consent is always a select. Offering only numeric
      // variables made those fields impossible to set -- and silently cleared
      // a saved one, because a <select> cannot display an option that is not
      // in its list. Matches CreateSurveyPage and SurveySetupPage.
      setAvailableVariables(Array.from(koboToolData.variableMap.keys()));

      const numericTypes = ['integer', 'decimal', 'calculate'];
      const numericVars = Array.from(koboToolData.variableMap.entries())
        .filter(([_, variable]) => numericTypes.includes(variable.type))
        .map(([name, _]) => name);
      setNumericVariables(numericVars);

      const textQuestions = koboToolData.survey
        .filter((q) => q.name && (q.type === 'text' || q.type.startsWith('text')))
        .map((q) => ({
          name: q.name,
          label: q['label::English (en)'] || q.name,
          type: q.type,
        }));
      setTextVariables(textQuestions);

      // Clean up outlier_variables and outlier_log_transform_variables to remove any non-numeric variables
      setQualityChecks((prev) => ({
        ...prev,
        outlier_variables: prev.outlier_variables.filter((v) => numericVars.includes(v)),
        outlier_log_transform_variables: prev.outlier_log_transform_variables.filter(
          (v) => numericVars.includes(v) && prev.outlier_variables.includes(v)
        ),
        llm_qualitative_fields: prev.llm_qualitative_fields.filter((v) => textQuestions.some((t) => t.name === v)),
      }));
    }
  }, [koboToolData]);

  /** Show a config's collection targets, or none; drops any unsaved file. */
  /** Show a config's stored Kobo form and label language, or none. */
  const applyKoboTool = (cd: SurveyConfig['config_data']) => {
    setKoboToolFileName('');
    const tool = cd.kobo_tool;
    if (!(tool && tool.survey && tool.choices)) {
      setKoboToolData(null);
      return;
    }
    setFormRefreshed(false);
    setLabelColumnSurvey(tool.label_column_survey ?? DEFAULT_LABEL_COLUMN);
    setLabelColumnChoices(tool.label_column_choices ?? DEFAULT_LABEL_COLUMN);
    // Reconstruct KoboToolData from stored tool with label column
    const reconstructed = reconstructKoboToolData(tool.survey, tool.choices, tool.label_column_survey);
    setKoboToolData({ ...reconstructed, has_audit: tool.has_audit ?? null });
  };

  /** Cancel in a quality-check section: back to what is saved, for its keys only. */
  const restoreQualityChecks = (keys: ReadonlyArray<keyof typeof DEFAULT_QUALITY_CHECKS>) => {
    const saved = (config?.config_data?.quality_checks ?? {}) as Partial<typeof DEFAULT_QUALITY_CHECKS>;
    setQualityChecks((prev) => {
      const next = { ...prev };
      for (const key of keys) {
        (next as Record<string, unknown>)[key] = saved[key] ?? DEFAULT_QUALITY_CHECKS[key];
      }
      return next;
    });
  };

  const loadSurveyConfig = async () => {
    if (!selectedSurvey) return;

    setIsLoading(true);
    setError(null);
    setSuccess(null);

    // Reset all state before loading new survey config to prevent stale data
    // from previous survey.
    targets.load(undefined);
    setKoboToolData(null);
    setKoboToolFileName('');
    setAvailableVariables([]);
    setNumericVariables([]);

    try {
      const data = await getSurveyConfig(selectedSurvey.survey_id);
      setConfig(data);
      setTranscribed({
        paths: data.config_data?.audio_transcription?.questions ?? [],
        enabled: !!data.config_data?.audio_transcription?.enabled,
      });
      setSurveyName(data.survey_name);
      setKoboAssetId(data.kobo_asset_id || '');

      const cd = data.config_data;
      if (cd.core_identifiers) {
        setCoreIdentifiers({ ...coreIdentifiers, ...cd.core_identifiers });
      }
      targets.load(cd.sampling_frame);
      if (cd.special_values) {
        // Stored configs hold `dk_value` as one number and `dk_string_value`
        // as one string; new ones hold lists. Old ones are never rewritten, so
        // both shapes arrive here.
        setSpecialValues({
          ...specialValues,
          ...cd.special_values,
          dk_value: readDkCodes(cd.special_values.dk_value),
          dk_string_value: readDkValues(cd.special_values.dk_string_value),
        });
      }
      if (cd.global_parameters) {
        setGlobalParameters({ ...globalParameters, ...cd.global_parameters });
      }
      if (cd.quality_checks) {
        // Filter outlier variables to only include numeric ones
        const numericTypes = ['integer', 'decimal', 'calculate'];
        const savedOutlierVars = cd.quality_checks.outlier_variables ?? [];
        const validOutlierVars = koboToolData?.variableMap
          ? savedOutlierVars.filter((varName: string) => {
              const varInfo = koboToolData.variableMap.get(varName);
              return varInfo && numericTypes.includes(varInfo.type);
            })
          : savedOutlierVars; // If no tool data, keep all (will be filtered later)

        const savedLogTransformVars = cd.quality_checks.outlier_log_transform_variables ?? [];
        const validLogTransformVars = savedLogTransformVars.filter((v: string) => validOutlierVars.includes(v));

        setQualityChecks({
          flag_out_of_period: cd.quality_checks.flag_out_of_period ?? false,
          flag_weekend: cd.quality_checks.flag_weekend ?? false,
          weekend_days: cd.quality_checks.weekend_days ?? [5, 6],
          flag_office_hours: cd.quality_checks.flag_office_hours ?? false,
          office_hours_start: cd.quality_checks.office_hours_start ?? '08:00',
          office_hours_end: cd.quality_checks.office_hours_end ?? '17:00',
          flag_sampling_frame: cd.quality_checks.flag_sampling_frame ?? false,
          flag_outliers: cd.quality_checks.flag_outliers ?? false,
          outlier_variables: validOutlierVars,
          outlier_log_transform_variables: validLogTransformVars,
          outlier_method: cd.quality_checks.outlier_method ?? 'iqr',
          outlier_threshold: cd.quality_checks.outlier_threshold ?? 1.5,
          flag_dk_percentage: cd.quality_checks.flag_dk_percentage ?? false,
          dk_percentage_threshold: cd.quality_checks.dk_percentage_threshold ?? 50,
          flag_empty_percentage: cd.quality_checks.flag_empty_percentage ?? false,
          empty_percentage_threshold: cd.quality_checks.empty_percentage_threshold ?? 50,
          flag_llm_qualitative: cd.quality_checks.flag_llm_qualitative ?? false,
          llm_qualitative_fields: cd.quality_checks.llm_qualitative_fields ?? [],
          llm_check_types: cd.quality_checks.llm_check_types ?? ['content_quality', 'relevance', 'completeness'],
        });
      }

      applyKoboTool(cd);

      await customChecks.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load survey configuration');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Re-read the form from the Kobo project.
   *
   * Replaces uploading an XLSForm: the project is the source of truth, and a
   * form edited mid-collection has to be picked up from there anyway.
   */
  // The out-of-period check compares against the saved collection dates, and
  // does nothing without at least one of them.
  const hasCollectionDates = Boolean(
    config?.config_data?.global_parameters?.data_collection_start_date ||
    config?.config_data?.global_parameters?.data_collection_end_date
  );

  // Bumped by each successful refresh; the form check runs when it changes.
  const [formCheckRunKey, setFormCheckRunKey] = useState(0);
  // A form read from Kobo and not saved yet.
  const [formRefreshed, setFormRefreshed] = useState(false);
  // Until it is saved, the refreshed form is what the check reads.
  const refreshedFormPayload = useMemo(
    () => (formRefreshed ? koboToolPayload(koboToolData) : null),
    [formRefreshed, koboToolData]
  );
  const savedLabelColumn = config?.config_data?.kobo_tool?.label_column_survey ?? DEFAULT_LABEL_COLUMN;
  const isKoboToolDirty = formRefreshed || labelColumnSurvey !== savedLabelColumn;

  const handleRefreshFormFromProject = async (assetId = config?.kobo_asset_id) => {
    if (!assetId) {
      setError('This survey has no Kobo project linked, so the form cannot be read.');
      return;
    }

    setIsLoadingTool(true);
    setError(null);
    try {
      const form = await getKoboProjectForm(assetId);
      const language = form.languages[0] || 'default';
      setKoboToolData(projectFormToKoboTool(form, language));
      setKoboToolFileName(form.asset_name || assetId);
      setFormRefreshed(true);
      // A freshly read form gets checked without the user asking.
      setFormCheckRunKey((key) => key + 1);

      // Keep the chosen language if the form still has it; otherwise fall back.
      const available = form.languages.map(labelColumnFor);
      if (available.length > 0 && !available.includes(labelColumnSurvey)) {
        setLabelColumnSurvey(available[0]);
      }
      if (available.length > 0 && !available.includes(labelColumnChoices)) {
        setLabelColumnChoices(available[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the form from Kobo.');
    } finally {
      setIsLoadingTool(false);
    }
  };

  currentSurveyId.current = selectedSurvey?.survey_id;

  /**
   * What one section changes, from what is on screen now. Applied later to
   * the config as the server has it, so other sections stay as saved.
   */
  const sectionUpdate = (section: SettingsSection) => {
    const qc = qualityChecks;
    const gp = globalParameters;
    return (base: SurveyConfig) => {
      const cd = { ...base.config_data };
      const update: { survey_name?: string; kobo_asset_id?: string | null; config_data: SurveyConfig['config_data'] } =
        { config_data: cd };
      switch (section) {
        case 'basicInfo':
          update.survey_name = surveyName;
          update.kobo_asset_id = pickedAssetId;
          cd.global_parameters = {
            ...cd.global_parameters,
            data_collection_start_date: gp.data_collection_start_date,
            data_collection_end_date: gp.data_collection_end_date,
          };
          break;
        case 'coreIdentifiers':
          cd.core_identifiers = coreIdentifiers;
          cd.special_values = { ...cd.special_values, ...specialValues };
          break;
        case 'koboTool':
          cd.kobo_tool = koboToolData
            ? {
                survey: koboToolData.survey,
                choices: koboToolData.choices,
                has_audit: koboToolData.has_audit ?? cd.kobo_tool?.has_audit ?? null,
                label_column_survey: labelColumnSurvey,
                label_column_choices: labelColumnChoices,
              }
            : cd.kobo_tool
              ? {
                  ...cd.kobo_tool,
                  label_column_survey: labelColumnSurvey,
                  label_column_choices: labelColumnChoices,
                }
              : undefined;
          break;
        case 'samplingFrame':
          cd.sampling_frame = targets.toConfig();
          break;
        case 'generalFlags':
          cd.quality_checks = { ...cd.quality_checks, ...pick(qc, GENERAL_FLAG_KEYS) };
          cd.global_parameters = {
            ...cd.global_parameters,
            min_survey_duration_minutes: gp.min_survey_duration_minutes,
            max_survey_duration_minutes: gp.max_survey_duration_minutes,
          };
          break;
        case 'outlier':
          cd.quality_checks = { ...cd.quality_checks, ...pick(qc, OUTLIER_KEYS) };
          break;
        case 'llm':
          cd.quality_checks = { ...cd.quality_checks, ...pick(qc, LLM_KEYS) };
          break;
      }
      return update;
    };
  };

  /**
   * Save one section: queued behind any save still running, applied to the
   * config read fresh from the server, and kept on screen without reloading
   * the page -- which used to throw away other sections' unsaved edits and
   * the "saved" message with them. Throws the save's error.
   */
  const saveSection = async (section: SettingsSection) => {
    if (!selectedSurvey) return;
    if (section === 'basicInfo' && !pickedAssetId) {
      throw new Error('Choose the Kobo project this survey reads, or paste its link.');
    }
    const projectChanged = section === 'basicInfo' && pickedAssetId !== (config?.kobo_asset_id || '');
    const surveyId = selectedSurvey.survey_id;
    const build = sectionUpdate(section);
    const run = async () => {
      const latest = await getSurveyConfig(surveyId);
      return updateSurvey(surveyId, build(latest));
    };
    const result = saveQueue.current.then(run, run);
    saveQueue.current = result.catch(() => undefined);
    const saved = await result;
    if (currentSurveyId.current !== surveyId) return;
    setConfig((prev) => (prev ? { ...prev, ...saved } : saved));
    setSavedAt((prev) => ({ ...prev, [section]: new Date() }));
    if (section === 'koboTool') setFormRefreshed(false);
    if (section === 'samplingFrame') targets.markSaved();
    // Another project has another form: read it, to save with the Kobo form.
    if (projectChanged) handleRefreshFormFromProject(pickedAssetId);
  };

  /** Put a section's fields back as last saved: the counterpart of sectionUpdate. */
  const restoreSection = (section: SettingsSection) => {
    if (!config) return;
    const cd = config.config_data;
    switch (section) {
      case 'basicInfo':
        setSurveyName(config.survey_name);
        setKoboAssetId(config.kobo_asset_id || '');
        setGlobalParameters((prev) => ({
          ...prev,
          data_collection_start_date: cd?.global_parameters?.data_collection_start_date || '',
          data_collection_end_date: cd?.global_parameters?.data_collection_end_date || '',
        }));
        break;
      case 'coreIdentifiers': {
        if (cd?.core_identifiers) setCoreIdentifiers((prev) => ({ ...prev, ...cd.core_identifiers }));
        const savedSpecialValues = cd?.special_values;
        if (savedSpecialValues) {
          setSpecialValues((prev) => ({
            ...prev,
            ...savedSpecialValues,
            dk_value: readDkCodes(savedSpecialValues.dk_value),
            dk_string_value: readDkValues(savedSpecialValues.dk_string_value),
          }));
        }
        break;
      }
      case 'koboTool':
        applyKoboTool(cd);
        break;
      case 'samplingFrame':
        targets.load(cd.sampling_frame);
        break;
      case 'generalFlags':
        restoreQualityChecks(GENERAL_FLAG_KEYS);
        setGlobalParameters((prev) => ({
          ...prev,
          min_survey_duration_minutes: cd?.global_parameters?.min_survey_duration_minutes ?? null,
          max_survey_duration_minutes: cd?.global_parameters?.max_survey_duration_minutes ?? null,
        }));
        break;
      case 'outlier':
        restoreQualityChecks(OUTLIER_KEYS);
        break;
      case 'llm':
        restoreQualityChecks(LLM_KEYS);
        break;
    }
  };

  const handleSurveyDeleted = async () => {
    setSuccess('Survey deleted successfully!');
    setSelectedSurvey(null);
    await refreshSurveys();
    // Don't auto-select a survey after deletion - let user choose
    setTimeout(() => {
      setSelectedSurvey(null);
    }, 0);
  };

  if (!selectedSurvey) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center max-w-lg w-full px-4">
          <div className="mb-4 space-y-2">
            <ErrorMessage error={error} className="text-base" autoHide={false} onDismiss={() => setError(null)} />
            <SuccessMessage message={success} onDismiss={() => setSuccess(null)} autoHide={true} autoHideDelay={5000} />
          </div>
          <p className="text-gray-600 dark:text-gray-400 text-lg mb-2">No survey selected</p>
          <p className="text-gray-500 text-sm">Please select a survey from the sidebar to view its settings.</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner />
      </div>
    );
  }

  // Transcription is processing, not a check: its own section, and only for
  // forms that record audio.
  const hasAudioQuestions = !!koboToolData?.survey?.some((row) => row.type === 'audio');
  const navItems: Array<{ id: SurveySettingsTab; label: string }> = [
    { id: 'settings', label: 'General' },
    { id: 'access', label: 'Access' },
    { id: 'quality', label: 'Quality checks' },
    ...(hasAudioQuestions ? [{ id: 'transcription' as const, label: 'Audio transcription' }] : []),
    { id: 'translation', label: 'Translation' },
  ];

  return (
    <SettingsLayout<SurveySettingsTab>
      title="Survey settings"
      items={navItems}
      active={activeTab}
      onSelect={setActiveTab}
      banner={
        <>
          {(error || success) && (
            <div className="mb-4 space-y-2">
              <ErrorMessage error={error} className="text-base" autoHide={false} onDismiss={() => setError(null)} />
              <SuccessMessage
                message={success}
                onDismiss={() => setSuccess(null)}
                autoHide={true}
                autoHideDelay={5000}
              />
            </div>
          )}
        </>
      }
    >
      {activeTab === 'settings' && !canEditSurvey && userPermission && (
        <div className="mb-6">
          <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
            View only
          </span>
        </div>
      )}

      {/* General is only hidden on other tabs, not unmounted, so the form
            check's results survive leaving the tab -- and a refresh's check
            runs once, not again on every return to General. */}
      <div className={activeTab === 'settings' ? 'space-y-6' : 'hidden'}>
        {/* Survey Profile */}
        <section className="bg-white dark:bg-gray-900 p-5 rounded-xl border border-gray-200 dark:border-gray-800 shadow-card">
          <h2 className="text-base font-semibold tracking-tight mb-4 text-gray-900 dark:text-white">Survey profile</h2>
          <div className="space-y-4">
            <div>
              <label
                htmlFor="survey-name"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
              >
                Survey name *
              </label>
              {canEditSurvey ? (
                <input
                  id="survey-name"
                  type="text"
                  value={surveyName}
                  onChange={(e) => setSurveyName(e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md shadow-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  required
                />
              ) : (
                <div className="px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md text-gray-700 dark:text-gray-300">
                  {surveyName}
                </div>
              )}
            </div>
            {canEditSurvey ? (
              <div>
                <KoboProjectPicker
                  value={koboAssetId}
                  onChange={(value) => setKoboAssetId(value)}
                  currentAssetId={config?.kobo_asset_id}
                />
                {config?.kobo_asset_id && pickedAssetId && pickedAssetId !== config.kobo_asset_id && (
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                    Submissions already pulled from the current project stay. Once saved, pulls read the new one.
                  </p>
                )}
              </div>
            ) : (
              <div>
                <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Kobo project</span>
                <div className="px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md text-gray-700 dark:text-gray-300 font-mono text-sm">
                  {config?.kobo_asset_id || '—'}
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="collection-start"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
                >
                  Collection start date
                </label>
                {canEditSurvey ? (
                  <input
                    id="collection-start"
                    type="date"
                    value={globalParameters.data_collection_start_date}
                    onChange={(e) =>
                      setGlobalParameters({ ...globalParameters, data_collection_start_date: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md shadow-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                ) : (
                  <div className="px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md text-gray-700 dark:text-gray-300">
                    {globalParameters.data_collection_start_date || '—'}
                  </div>
                )}
              </div>
              <div>
                <label
                  htmlFor="collection-end"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
                >
                  Collection end date
                </label>
                {canEditSurvey ? (
                  <input
                    id="collection-end"
                    type="date"
                    value={globalParameters.data_collection_end_date}
                    onChange={(e) =>
                      setGlobalParameters({ ...globalParameters, data_collection_end_date: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md shadow-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                ) : (
                  <div className="px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md text-gray-700 dark:text-gray-300">
                    {globalParameters.data_collection_end_date || '—'}
                  </div>
                )}
              </div>
            </div>
            {!isBasicInfoDirty && <SavedNote at={savedAt.basicInfo} className="pt-2" />}
            {canEditSurvey && isBasicInfoDirty && (
              <SectionActions controls={sections.controls('basicInfo', isBasicInfoDirty)} className="pt-2" />
            )}
          </div>
        </section>

        <KoboFormSection
          koboToolData={koboToolData}
          fileName={koboToolFileName}
          variableCount={availableVariables.length}
          labelColumn={labelColumnSurvey}
          onLabelColumnChange={(column) => {
            // One language for both: showing questions in one language
            // and their answers in another helps nobody.
            setLabelColumnSurvey(column);
            setLabelColumnChoices(column);
          }}
          onRefresh={() => handleRefreshFormFromProject()}
          isRefreshing={isLoadingTool}
          canRefresh={Boolean(config?.kobo_asset_id)}
          canEdit={canEditSurvey}
          controls={sections.controls('koboTool', isKoboToolDirty)}
          savedAt={savedAt.koboTool}
        />

        {/* Form readiness: about the Kobo form, so it sits right below it,
                and re-runs on its own when the form is refreshed above. */}
        {selectedSurvey && (
          <FormLintPanel
            surveyId={selectedSurvey.survey_id}
            form={refreshedFormPayload}
            canEdit={canEditSurvey}
            onRulesAdopted={customChecks.reload}
            autoRunKey={formCheckRunKey}
            labelColumn={labelColumnSurvey}
          />
        )}

        {/* Collection Targets */}
        <section className="bg-white dark:bg-gray-900 p-5 rounded-xl border border-gray-200 dark:border-gray-800 shadow-card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold tracking-tight text-gray-900 dark:text-white">
              Data collection targets
            </h2>
            {!targets.dirty && <SavedNote at={savedAt.samplingFrame} className="ml-auto" />}
          </div>
          {canEditSurvey ? (
            <div className="space-y-4">
              <CollectionTargetsEditor
                targets={targets}
                koboToolData={koboToolData}
                labelColumnChoices={labelColumnChoices}
              />
              {targets.dirty && (
                <SectionActions controls={sections.controls('samplingFrame', targets.dirty)} className="mt-4" />
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <CollectionTargets
                mode={targets.settings.mode}
                onModeChange={() => {}}
                totalTarget={targets.settings.total_target}
                onTotalTargetChange={() => {}}
                variable={targets.settings.variable}
                onVariableChange={() => {}}
                targetsByValue={targets.settings.targets_by_value}
                onTargetsByValueChange={() => {}}
                koboToolData={koboToolData}
                labelColumnChoices={labelColumnChoices}
                editable={false}
              />
              {targets.settings.mode === 'uploaded' && targets.frameData ? (
                <div className="text-sm text-gray-700 dark:text-gray-300">
                  {targets.frameData.length} rows,{' '}
                  {targets.settings.sampling_cols.length > 0
                    ? `grouped by ${targets.settings.sampling_cols.join(', ')}`
                    : 'no grouping columns matched'}
                </div>
              ) : null}
            </div>
          )}
        </section>

        {/* Core Identifiers */}
        <section className="bg-white dark:bg-gray-900 p-5 rounded-xl border border-gray-200 dark:border-gray-800 shadow-card">
          <h2 className="text-base font-semibold tracking-tight mb-4 text-gray-900 dark:text-white">
            Core identifiers
          </h2>
          <div className="field-grid">
            <VariableDropdown
              value={coreIdentifiers.enumerator}
              onChange={(value) => setCoreIdentifiers({ ...coreIdentifiers, enumerator: value })}
              label="Enumerator ID"
              helpKey="enumerator"
              availableVariables={availableVariables}
              readOnly={!canEditSurvey}
            />
            <VariableDropdown
              value={coreIdentifiers.consent}
              onChange={(value) => setCoreIdentifiers({ ...coreIdentifiers, consent: value })}
              label="Consent"
              helpKey="consent"
              availableVariables={availableVariables}
              readOnly={!canEditSurvey}
            />
            <VariableDropdown
              value={coreIdentifiers.start_time}
              onChange={(value) => setCoreIdentifiers({ ...coreIdentifiers, start_time: value })}
              label="Start time"
              helpKey="start_time"
              availableVariables={availableVariables}
              readOnly={!canEditSurvey}
            />
            <VariableDropdown
              value={coreIdentifiers.end_time}
              onChange={(value) => setCoreIdentifiers({ ...coreIdentifiers, end_time: value })}
              label="End time"
              helpKey="end_time"
              availableVariables={availableVariables}
              readOnly={!canEditSurvey}
            />
            <VariableDropdown
              value={coreIdentifiers.date_interview}
              onChange={(value) => setCoreIdentifiers({ ...coreIdentifiers, date_interview: value })}
              label="Interview date"
              helpKey="date_interview"
              availableVariables={availableVariables}
              readOnly={!canEditSurvey}
            />
            <DkNumericCodes
              codes={specialValues.dk_value}
              onChange={(codes) => setSpecialValues({ ...specialValues, dk_value: codes })}
              readOnly={!canEditSurvey}
            />
            <DkStringValues
              values={specialValues.dk_string_value}
              onChange={(values) => setSpecialValues({ ...specialValues, dk_string_value: values })}
              survey={surveyRows}
              choices={choiceRows}
              readOnly={!canEditSurvey}
            />
          </div>
          {!isCoreIdentifiersDirty && <SavedNote at={savedAt.coreIdentifiers} className="pt-4" />}
          {canEditSurvey && isCoreIdentifiersDirty && (
            <SectionActions controls={sections.controls('coreIdentifiers', isCoreIdentifiersDirty)} className="pt-4" />
          )}
        </section>

        {canDeleteSurvey && (
          <DeleteSurveySection
            surveyId={selectedSurvey.survey_id}
            surveyName={config?.survey_name ?? selectedSurvey.survey_name}
            onDeleted={handleSurveyDeleted}
          />
        )}
      </div>
      {activeTab === 'access' ? (
        <SurveyAccessTab surveyId={selectedSurvey.survey_id} onError={setError} onSuccess={setSuccess} />
      ) : activeTab === 'quality' ? (
        <div className="space-y-6">
          <GeneralChecksSection
            checks={qualityChecks}
            setChecks={setQualityChecks}
            durations={globalParameters}
            onDurationChange={(key, minutes) => setGlobalParameters((prev) => ({ ...prev, [key]: minutes }))}
            hasCollectionDates={hasCollectionDates}
            canEdit={canEditSurvey}
            controls={sections.controls('generalFlags', isGeneralFlagsDirty)}
            savedAt={savedAt.generalFlags}
          />

          <OutlierChecksSection
            checks={qualityChecks}
            setChecks={setQualityChecks}
            numericVariables={numericVariables}
            questionLabel={questionLabel}
            canEdit={canEditSurvey}
            controls={sections.controls('outlier', isOutlierDirty)}
            savedAt={savedAt.outlier}
          />

          <AiReviewSection
            surveyId={selectedSurvey.survey_id}
            // Not permission === 'owner': an admin's permission reads 'admin'
            // even on their own surveys, which hid the key choice from them.
            isOwner={selectedSurvey.is_owner === true}
            checks={qualityChecks}
            setChecks={setQualityChecks}
            reviewableVariables={reviewableVariables}
            canEdit={canEditSurvey}
            controls={sections.controls('llm', isLlmDirty)}
            savedAt={savedAt.llm}
            onError={setError}
            onSuccess={setSuccess}
          />

          {/* Custom checks */}
          {selectedSurvey && (
            <CustomChecks
              key={selectedSurvey.survey_id}
              surveyId={selectedSurvey.survey_id}
              rules={customChecks.rules}
              isLoading={customChecks.isLoading}
              canEdit={canEditSurvey}
              koboToolData={koboToolData}
              onSave={customChecks.save}
              onDelete={customChecks.remove}
              onAddMany={customChecks.addMany}
            />
          )}
        </div>
      ) : activeTab === 'transcription' && selectedSurvey ? (
        <AudioTranscriptionCard
          key={`transcription-${selectedSurvey.survey_id}`}
          surveyId={selectedSurvey.survey_id}
          surveyName={selectedSurvey.survey_name}
          formKey={config?.updated_at}
          onSettingsChange={(paths, enabled) => setTranscribed({ paths, enabled })}
        />
      ) : activeTab === 'translation' && selectedSurvey ? (
        <TranslationCard
          key={`translation-${selectedSurvey.survey_id}`}
          surveyId={selectedSurvey.survey_id}
          formKey={config?.updated_at}
        />
      ) : null}
    </SettingsLayout>
  );
};

export default SurveySettingsPage;
