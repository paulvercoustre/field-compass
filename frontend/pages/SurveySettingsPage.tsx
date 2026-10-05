import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSurvey } from '../contexts/SurveyContext';
import { getSurveyConfig, updateSurvey, deleteSurvey, SurveyConfig, getValidationRules, createValidationRule, updateValidationRule, deleteValidationRule } from '../services/progressApi';
import { reconstructKoboToolData } from '../utils/koboDataUtils';
import { stagedRuleToDbFormat, dbFormatToStagedRule } from '../utils/ruleConverter';
import { KoboToolData, StagedRule } from '../types';
import CustomChecks from '../components/rule-builder/CustomChecks';
import { Spinner } from '../components/Spinner';
import SettingsLayout from '../components/ui/SettingsLayout';
import ErrorMessage from '../components/ui/ErrorMessage';
import SuccessMessage from '../components/ui/SuccessMessage';
import { getKoboProjectForm } from '../services/api';
import { labelColumnFor } from '../utils/koboUrl';
import CollectionTargets from '../components/ui/CollectionTargets';
import CollectionTargetsEditor from '../components/ui/CollectionTargetsEditor';
import { useCollectionTargets } from '../hooks/useCollectionTargets';
import { useSectionEditor } from '../hooks/useSectionEditor';
import { DEFAULT_QUALITY_CHECKS, GENERAL_FLAG_KEYS, LLM_KEYS, OUTLIER_KEYS, pick, sameSetting } from '../utils/qualityCheckSettings';
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
import { SavedNote, SectionActions, SectionEditButton } from '../components/settings/SectionControls';
import { RequestedTab } from '../contexts/NavigationContext';

type SurveySettingsTab = 'settings' | 'access' | 'quality' | 'transcription' | 'translation';
const SURVEY_SETTINGS_TABS: string[] = ['settings', 'access', 'quality', 'transcription', 'translation'];

interface SurveySettingsPageProps {
  /** A tab asked for by a link elsewhere in the app (a notification, the activity panel). */
  requestedTab?: RequestedTab;
}

/**
 * The page's sections. Each saves only its own fields, merged into the config
 * as it is on the server at that moment, so saving one section never writes
 * another's unsaved edits (or an older copy of what someone else saved).
 */
type SettingsSection = 'basicInfo' | 'coreIdentifiers' | 'koboTool' | 'samplingFrame' | 'generalFlags' | 'outlier' | 'llm';

const SurveySettingsPage: React.FC<SurveySettingsPageProps> = ({ requestedTab }) => {
  const { selectedSurvey, refreshSurveys, setSelectedSurvey } = useSurvey();
  const [config, setConfig] = useState<SurveyConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
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
  // Audio questions being transcribed: their transcripts can be AI-reviewed.
  const [transcribed, setTranscribed] = useState<{ paths: string[]; enabled: boolean }>({ paths: [], enabled: false });

  // Permission-based access control
  const userPermission = selectedSurvey?.permission;
  const canEditSurvey = userPermission === 'owner' || userPermission === 'admin';
  const canDeleteSurvey = userPermission === 'owner' || userPermission === 'admin';

  // Validation rules state
  const [stagedRules, setStagedRules] = useState<StagedRule[]>([]);
  const [isLoadingRules, setIsLoadingRules] = useState(false);

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
  const [labelColumnSurvey, setLabelColumnSurvey] = useState<string>('label::English (en)');
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
  const [labelColumnChoices, setLabelColumnChoices] = useState<string>('label::English (en)');

  // Sampling frame CSV state

  // Form state
  const [surveyName, setSurveyName] = useState('');
  const [koboAssetId, setKoboAssetId] = useState('');
  const [coreIdentifiers, setCoreIdentifiers] = useState({
    uuid: '_uuid',  // always supplied by Kobo as submission metadata
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
  const isBasicInfoDirty =
    surveyName !== (config?.survey_name || '') ||
    koboAssetId !== (config?.kobo_asset_id || '') ||
    globalParameters.data_collection_start_date !== (config?.config_data?.global_parameters?.data_collection_start_date || '') ||
    globalParameters.data_collection_end_date !== (config?.config_data?.global_parameters?.data_collection_end_date || '');

  // Fallbacks here must match the initial state above, or clearing a field
  // reads as "unchanged" and the Save button never enables.
  const savedCoreIdentifiers = config?.config_data?.core_identifiers || { uuid: '_uuid', enumerator: '', date_interview: '', start_time: '', end_time: '', consent: '' };
  const isCoreIdentifiersDirty =
    coreIdentifiers.uuid !== (savedCoreIdentifiers.uuid ?? '_uuid') ||
    coreIdentifiers.enumerator !== (savedCoreIdentifiers.enumerator ?? '') ||
    coreIdentifiers.date_interview !== (savedCoreIdentifiers.date_interview ?? '') ||
    coreIdentifiers.start_time !== (savedCoreIdentifiers.start_time ?? '') ||
    coreIdentifiers.end_time !== (savedCoreIdentifiers.end_time ?? '') ||
    coreIdentifiers.consent !== (savedCoreIdentifiers.consent ?? '') ||
    !sameDkCodes(specialValues.dk_value, readDkCodes(config?.config_data?.special_values?.dk_value)) ||
    !sameDkValues(
      specialValues.dk_string_value,
      readDkValues(config?.config_data?.special_values?.dk_string_value)
    );

  // Quality Checks State
  const [qualityChecks, setQualityChecks] = useState(DEFAULT_QUALITY_CHECKS);

  // Dirty flag for General Quality Checks section only (Save/Cancel when user edits)
  const savedQc = config?.config_data?.quality_checks;
  const isGeneralFlagsDirty = savedQc ? (
    GENERAL_FLAG_KEYS.some((key) => !sameSetting(qualityChecks[key], savedQc[key] ?? DEFAULT_QUALITY_CHECKS[key])) ||
    globalParameters.min_survey_duration_minutes !== (config?.config_data?.global_parameters?.min_survey_duration_minutes ?? null) ||
    globalParameters.max_survey_duration_minutes !== (config?.config_data?.global_parameters?.max_survey_duration_minutes ?? null)
  ) : false;

  useEffect(() => {
    if (selectedSurvey) {
      // Clear any success/error messages when switching to a different survey
      setSuccess(null);
      setError(null);
      setSavedAt({});
      loadSurveyConfig();
    } else {
      // Reset deletion state when no survey is selected (keep success message visible)
      setIsDeleting(false);
      setShowDeleteConfirm(false);
      setError(null);
      sections.closeAll();
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

  // Reset deletion state when modal is closed
  useEffect(() => {
    if (!showDeleteConfirm) {
      setDeleteConfirmInput('');
      setDeleteError(null);
      setIsDeleting(false);
    }
  }, [showDeleteConfirm]);

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
        outlier_log_transform_variables: prev.outlier_log_transform_variables.filter((v) =>
          numericVars.includes(v) && prev.outlier_variables.includes(v)
        ),
        llm_qualitative_fields: prev.llm_qualitative_fields.filter((v) =>
          textQuestions.some((t) => t.name === v)
        ),
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
    // Load label column settings first
    if (tool.label_column_survey) setLabelColumnSurvey(tool.label_column_survey);
    if (tool.label_column_choices) setLabelColumnChoices(tool.label_column_choices);
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
        const validLogTransformVars = savedLogTransformVars.filter((v: string) =>
          validOutlierVars.includes(v)
        );

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
      
      // Load validation rules
      await loadValidationRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load survey configuration');
    } finally {
      setIsLoading(false);
    }
  };

  const loadValidationRules = async () => {
    if (!selectedSurvey) return;
    
    setIsLoadingRules(true);
    try {
      const rules = await getValidationRules(selectedSurvey.survey_id);
      // Convert to StagedRule format for display/editing
      const staged = rules.map(rule => 
        dbFormatToStagedRule(rule.rule_id, rule.rule_name, rule.rule_data)
      );
      setStagedRules(staged);
    } catch (err) {
      console.error('Error loading validation rules:', err);
      // Don't show error to user, just log it
    } finally {
      setIsLoadingRules(false);
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
  // Until it is saved, the refreshed form is what the check reads.
  const refreshedFormPayload = useMemo(
    () => (formCheckRunKey > 0 && sections.isEditing('koboTool') ? koboToolPayload(koboToolData) : null),
    [formCheckRunKey, sections.isEditing('koboTool'), koboToolData]
  );

  const handleRefreshFormFromProject = async () => {
    const assetId = config?.kobo_asset_id;
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
      const update: { survey_name?: string; kobo_asset_id?: string | null; config_data: SurveyConfig['config_data'] } = { config_data: cd };
      switch (section) {
        case 'basicInfo':
          update.survey_name = surveyName;
          update.kobo_asset_id = koboAssetId || null;
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
          cd.kobo_tool = koboToolData ? {
            survey: koboToolData.survey,
            choices: koboToolData.choices,
            has_audit: koboToolData.has_audit ?? cd.kobo_tool?.has_audit ?? null,
            label_column_survey: labelColumnSurvey,
            label_column_choices: labelColumnChoices,
          } : cd.kobo_tool ? {
            ...cd.kobo_tool,
            label_column_survey: labelColumnSurvey,
            label_column_choices: labelColumnChoices,
          } : undefined;
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

  const handleDeleteClick = () => {
    // Reset deletion state when opening the modal
    setIsDeleting(false);
    setDeleteConfirmInput('');
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = async () => {
    if (!selectedSurvey) return;

    setDeleteError(null);
    setIsDeleting(true);
    setSuccess(null);

    try {
      await deleteSurvey(selectedSurvey.survey_id);
      setSuccess('Survey deleted successfully!');
      
      // Close confirmation dialog and reset state
      setShowDeleteConfirm(false);
      setIsDeleting(false);
      
      // Clear selection and refresh surveys list
      setSelectedSurvey(null);
      await refreshSurveys();
      
      // Don't auto-select a survey after deletion - let user choose
      setTimeout(() => {
        setSelectedSurvey(null);
      }, 0);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete survey');
      setIsDeleting(false);
    }
  };

  const handleDeleteCancel = () => {
    setShowDeleteConfirm(false);
    setDeleteConfirmInput('');
    setDeleteError(null);
  };

  const handleSaveCustomCheck = useCallback(async (rule: Omit<StagedRule, 'id'>, ruleId: string | null) => {
    if (!selectedSurvey) return;

    try {
      const dbRule = stagedRuleToDbFormat({ ...rule, id: '' });
      if (ruleId) {
        await updateValidationRule(selectedSurvey.survey_id, ruleId, {
          rule_name: rule.description,
          rule_data: dbRule,
        });
      } else {
        await createValidationRule(selectedSurvey.survey_id, {
          rule_name: rule.description,
          rule_data: dbRule,
          is_active: true,
        });
      }
      await loadValidationRules(); // Refresh from server
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save the check');
      throw err; // Lets the form stay open with what the user entered
    }
  }, [selectedSurvey]);

  const handleDeleteRule = useCallback(async (ruleId: string) => {
    if (!selectedSurvey) return;

    try {
      await deleteValidationRule(selectedSurvey.survey_id, ruleId);
      setStagedRules(rules => rules.filter(r => r.id !== ruleId));
      await loadValidationRules(); // Refresh from server
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete the check');
    }
  }, [selectedSurvey]);

  const handleAISuggestedRulesAdded = useCallback(async (rules: StagedRule[]) => {
    // Save all suggested rules to the database
    if (!selectedSurvey) return;
    
    try {
      for (const rule of rules) {
        const dbRule = stagedRuleToDbFormat({ ...rule, id: '' });
        await createValidationRule(selectedSurvey.survey_id, {
          rule_name: rule.description,
          rule_data: dbRule,
          is_active: true,
        });
      }
      await loadValidationRules(); // Refresh from server
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add the suggested checks');
      throw err;
    }
  }, [selectedSurvey]);

  const handleWeekendDayToggle = (day: number) => {
    setQualityChecks(prev => {
      const currentDays = prev.weekend_days || [];
      if (currentDays.includes(day)) {
        return { ...prev, weekend_days: currentDays.filter(d => d !== day) };
      } else {
        return { ...prev, weekend_days: [...currentDays, day].sort() };
      }
    });
  };


  if (!selectedSurvey) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center max-w-lg w-full px-4">
          <div className="mb-4 space-y-2">
            <ErrorMessage error={error} className="text-base" autoHide={false} onDismiss={() => setError(null)} />
            <SuccessMessage
              message={success}
              onDismiss={() => setSuccess(null)}
              autoHide={true}
              autoHideDelay={5000}
            />
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

  const daysOfWeek = [
    { value: 0, label: 'Mon' },
    { value: 1, label: 'Tue' },
    { value: 2, label: 'Wed' },
    { value: 3, label: 'Thu' },
    { value: 4, label: 'Fri' },
    { value: 5, label: 'Sat' },
    { value: 6, label: 'Sun' },
  ];

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
      banner={<>
        {(error || success) && <div className="mb-4 space-y-2">
          <ErrorMessage error={error} className="text-base" autoHide={false} onDismiss={() => setError(null)} />
          <SuccessMessage 
            message={success} 
            onDismiss={() => setSuccess(null)}
            autoHide={true}
            autoHideDelay={5000}
          />
        </div>}

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 bg-gray-950/40 backdrop-blur-[2px] flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-900 rounded-xl p-6 max-w-md w-full mx-4 border border-gray-200 dark:border-gray-800 shadow-popover animate-fade-in">
              <h2 className="text-base font-semibold tracking-tight text-gray-900 dark:text-white mb-4">Delete survey</h2>
              <p className="text-gray-700 dark:text-gray-300 mb-4">
                Are you sure you want to delete <strong className="text-gray-900 dark:text-white">{surveyName}</strong>?
                <br />
                <br />
                This action cannot be undone. This will permanently delete the survey configuration and all associated data.
              </p>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Type <strong className="text-gray-900 dark:text-white">{surveyName}</strong> to confirm
                </label>
                <input
                  type="text"
                  value={deleteConfirmInput}
                  onChange={(e) => setDeleteConfirmInput(e.target.value)}
                  placeholder="Survey name"
                  className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                />
              </div>
              {deleteError && (
                <div className="p-3 text-sm bg-red-50 dark:bg-red-500/10 ring-1 ring-inset ring-red-600/15 dark:ring-red-400/20 rounded-lg mb-4">
                  <p className="text-sm text-red-600 dark:text-red-400">{deleteError}</p>
                </div>
              )}
              <div className="flex justify-end gap-3">
                <button
                  onClick={handleDeleteCancel}
                  disabled={isDeleting}
                  className="px-4 py-2 bg-white text-gray-900 border border-gray-300 shadow-xs rounded-md hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteConfirm}
                  disabled={isDeleting || deleteConfirmInput !== surveyName}
                  className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-red-300 dark:disabled:bg-red-700 disabled:cursor-not-allowed text-sm font-medium"
                >
                  {isDeleting ? 'Deleting...' : 'Delete survey'}
                </button>
              </div>
            </div>
          </div>
        )}

</>}
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
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Survey name *
                  </label>
                  {canEditSurvey ? (
                    <input
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
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Kobo asset ID
                  </label>
                  {canEditSurvey ? (
                    <input
                      type="text"
                      value={koboAssetId}
                      onChange={(e) => setKoboAssetId(e.target.value)}
                      className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md shadow-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="e.g., a3wCWjYRXo46cSygF8gQAc"
                    />
                  ) : (
                    <div className="px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md text-gray-700 dark:text-gray-300">
                      {koboAssetId || '—'}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                      Collection start date
                    </label>
                    {canEditSurvey ? (
                      <input
                        type="date"
                        value={globalParameters.data_collection_start_date}
                        onChange={(e) => setGlobalParameters({ ...globalParameters, data_collection_start_date: e.target.value })}
                        className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md shadow-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    ) : (
                      <div className="px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md text-gray-700 dark:text-gray-300">
                        {globalParameters.data_collection_start_date || '—'}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                      Collection end date
                    </label>
                    {canEditSurvey ? (
                      <input
                        type="date"
                        value={globalParameters.data_collection_end_date}
                        onChange={(e) => setGlobalParameters({ ...globalParameters, data_collection_end_date: e.target.value })}
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
                  <SectionActions controls={sections.controls('basicInfo')} className="pt-2" />
                )}
              </div>
            </section>

            {/* Kobo Tool */}
            <section className="bg-white dark:bg-gray-900 p-5 rounded-xl border border-gray-200 dark:border-gray-800 shadow-card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold tracking-tight text-gray-900 dark:text-white">Kobo form</h2>
                {!sections.isEditing('koboTool') && <SavedNote at={savedAt.koboTool} className="ml-auto mr-2" />}
                {canEditSurvey && !sections.isEditing('koboTool') && (
                  <SectionEditButton onClick={() => sections.edit('koboTool')} />
                )}
              </div>
              {sections.isEditing('koboTool') ? (
                <div className="space-y-2">
                  {koboToolData && (
                    <div className="mb-3">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{koboToolFileName || 'Form loaded'}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{availableVariables.length} variables</p>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={handleRefreshFormFromProject}
                    disabled={isLoadingTool || !config?.kobo_asset_id}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium flex items-center gap-2"
                  >
                    {isLoadingTool ? (
                      <>
                        <Spinner size="sm" className="text-current" />
                        <span>Reading form...</span>
                      </>
                    ) : (
                      <span>Refresh form</span>
                    )}
                  </button>
                  
                  {/* Label language. Only shown when the form has more than one
                      translation: a control with a single option asks the user to
                      read something they cannot act on. */}
                  {koboToolData && (() => {
                    // Translations are stored as `label::<language>` columns, so the
                    // languages the form carries are exactly those column names.
                    const languages = Array.from(
                      new Set(
                        [...koboToolData.survey, ...koboToolData.choices].flatMap((row) =>
                          Object.keys(row).filter((key) => key.startsWith('label::'))
                        )
                      )
                    );
                    if (languages.length < 2) return null;

                    return (
                      <div className="mt-4 space-y-2 pt-4 border-t border-gray-200 dark:border-gray-700">
                        <label className="block text-sm font-semibold text-gray-900 dark:text-white">
                          Label language
                        </label>
                        <select
                          value={labelColumnSurvey}
                          onChange={(e) => {
                            // One language for both: showing questions in one language
                            // and their answers in another helps nobody.
                            setLabelColumnSurvey(e.target.value);
                            setLabelColumnChoices(e.target.value);
                          }}
                          className="w-full sm:w-72 px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md shadow-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                          {languages.map((column) => (
                            <option key={column} value={column}>
                              {column.replace('label::', '')}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })()}
                  <SectionActions controls={sections.controls('koboTool')} className="mt-4" />
                </div>
              ) : (
                <div className="text-gray-700 dark:text-gray-300">
                  {koboToolData ? (
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{koboToolFileName || 'Form loaded'}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{availableVariables.length} variables</p>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500 dark:text-gray-400">No form loaded yet.</p>
                  )}
                </div>
              )}
            </section>

            {/* Form readiness: about the Kobo form, so it sits right below it,
                and re-runs on its own when the form is refreshed above. */}
            {selectedSurvey && (
              <FormLintPanel
                surveyId={selectedSurvey.survey_id}
                form={refreshedFormPayload}
                canEdit={canEditSurvey}
                onRulesAdopted={loadValidationRules}
                autoRunKey={formCheckRunKey}
                labelColumn={labelColumnSurvey}
              />
            )}

            {/* Collection Targets */}
            <section className="bg-white dark:bg-gray-900 p-5 rounded-xl border border-gray-200 dark:border-gray-800 shadow-card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold tracking-tight text-gray-900 dark:text-white">Data collection targets</h2>
                {!sections.isEditing('samplingFrame') && <SavedNote at={savedAt.samplingFrame} className="ml-auto mr-2" />}
                {canEditSurvey && !sections.isEditing('samplingFrame') && (
                  <SectionEditButton onClick={() => sections.edit('samplingFrame')} />
                )}
              </div>
              {sections.isEditing('samplingFrame') ? (
                <div className="space-y-4">
                  <CollectionTargetsEditor
                    targets={targets}
                    koboToolData={koboToolData}
                    labelColumnChoices={labelColumnChoices}
                  />
                  <SectionActions controls={sections.controls('samplingFrame')} className="mt-4" />
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
              <h2 className="text-base font-semibold tracking-tight mb-4 text-gray-900 dark:text-white">Core identifiers</h2>
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
                <SectionActions controls={sections.controls('coreIdentifiers')} className="pt-4" />
              )}
            </section>

            {/* Delete survey Section */}
            {canDeleteSurvey && (
              <section className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-red-200 dark:border-red-900/50 p-6">
                <h2 className="text-base font-semibold tracking-tight text-gray-900 dark:text-white mb-2">Delete survey</h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  Permanently deletes the survey and its data. This cannot be undone.
                </p>

                <button
                  type="button"
                  onClick={handleDeleteClick}
                  disabled={isDeleting}
                  className="px-4 py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white font-medium rounded-lg transition-colors"
                >
                  Delete survey
                </button>
              </section>
            )}
          </div>
        {activeTab === 'access' ? (
          <SurveyAccessTab surveyId={selectedSurvey.survey_id} onError={setError} onSuccess={setSuccess} />
        ) : activeTab === 'quality' ? (
          <div className="space-y-6">
            {/* General Quality Checks - dirty pattern like Survey Profile */}
            <section className="bg-white dark:bg-gray-900 p-5 rounded-xl border border-gray-200 dark:border-gray-800 shadow-card">
              <h2 className="text-base font-semibold tracking-tight mb-4 text-gray-900 dark:text-white">General checks</h2>
              <div className="space-y-6">
                
                {/* Out of Period Flag */}
                <div className="flex items-start">
                  <div className="flex h-5 items-center">
                    <input
                      type="checkbox"
                      disabled={!canEditSurvey || !hasCollectionDates}
                      checked={qualityChecks.flag_out_of_period && hasCollectionDates}
                      onChange={(e) => setQualityChecks({ ...qualityChecks, flag_out_of_period: e.target.checked })}
                      className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600 dark:border-gray-600 dark:bg-gray-700"
                    />
                  </div>
                  <div className="ml-3">
                    <label className={`text-sm font-medium ${hasCollectionDates ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}`}>
                      Flag submissions outside the collection period
                    </label>
                    {!hasCollectionDates && (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Needs a collection start or end date (General → Survey profile).
                      </p>
                    )}
                  </div>
                </div>

                {/* Weekend Flag */}
                <div className="space-y-2">
                  <div className="flex items-start">
                    <div className="flex h-5 items-center">
                      <input
                        type="checkbox"
                        disabled={!canEditSurvey}
                        checked={qualityChecks.flag_weekend}
                        onChange={(e) => setQualityChecks({ ...qualityChecks, flag_weekend: e.target.checked })}
                        className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600 dark:border-gray-600 dark:bg-gray-700"
                      />
                    </div>
                    <div className="ml-3">
                      <label className="text-sm font-medium text-gray-900 dark:text-white">
                        Flag submissions on weekends
                      </label>
                    </div>
                  </div>
                  
                  {qualityChecks.flag_weekend && (
                    <div className="ml-7 p-3 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
                      <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Select Weekend Days:</span>
                      <div className="flex flex-wrap gap-2">
                        {daysOfWeek.map((day) => (
                          <button
                            key={day.value}
                            onClick={() => canEditSurvey && handleWeekendDayToggle(day.value)}
                            disabled={!canEditSurvey}
                            className={`px-3 py-1 rounded-full text-xs font-medium border ${
                              qualityChecks.weekend_days?.includes(day.value)
                                ? 'bg-indigo-100 text-indigo-800 border-indigo-300 dark:bg-indigo-900 dark:text-indigo-200 dark:border-indigo-700'
                                : 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:border-gray-600'
                            } ${canEditSurvey ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
                          >
                            {day.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Office Hours Flag */}
                <div className="space-y-2">
                  <div className="flex items-start">
                    <div className="flex h-5 items-center">
                      <input
                        type="checkbox"
                        disabled={!canEditSurvey}
                        checked={qualityChecks.flag_office_hours}
                        onChange={(e) => setQualityChecks({ ...qualityChecks, flag_office_hours: e.target.checked })}
                        className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600 dark:border-gray-600 dark:bg-gray-700"
                      />
                    </div>
                    <div className="ml-3">
                      <label className="text-sm font-medium text-gray-900 dark:text-white">
                        Flag submissions outside office hours
                      </label>
                    </div>
                  </div>

                  {qualityChecks.flag_office_hours && (
                    <div className="ml-7 p-3 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Start Time</label>
                        {canEditSurvey ? (
                          <input
                            type="time"
                            value={qualityChecks.office_hours_start}
                            onChange={(e) => setQualityChecks({ ...qualityChecks, office_hours_start: e.target.value })}
                            className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                          />
                        ) : (
                          <span className="text-sm text-gray-700 dark:text-gray-300">{qualityChecks.office_hours_start}</span>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">End Time</label>
                        {canEditSurvey ? (
                          <input
                            type="time"
                            value={qualityChecks.office_hours_end}
                            onChange={(e) => setQualityChecks({ ...qualityChecks, office_hours_end: e.target.value })}
                            className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                          />
                        ) : (
                          <span className="text-sm text-gray-700 dark:text-gray-300">{qualityChecks.office_hours_end}</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Collection targets check */}
                <div className="flex items-start">
                  <div className="flex h-5 items-center">
                    <input
                      type="checkbox"
                      disabled={!canEditSurvey}
                      checked={qualityChecks.flag_sampling_frame}
                      onChange={(e) => setQualityChecks({ ...qualityChecks, flag_sampling_frame: e.target.checked })}
                      className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600 dark:border-gray-600 dark:bg-gray-700"
                    />
                  </div>
                  <div className="ml-3">
                    <label className="text-sm font-medium text-gray-900 dark:text-white">
                      Flag submissions outside the collection targets
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Includes groups missing from the targets file and answers not among the question’s options.
                    </p>
                  </div>
                </div>

                {/* DK Percentage Flag */}
                <div className="space-y-2">
                  <div className="flex items-start">
                    <div className="flex h-5 items-center">
                      <input
                        type="checkbox"
                        disabled={!canEditSurvey}
                        checked={qualityChecks.flag_dk_percentage}
                        onChange={(e) => setQualityChecks({ ...qualityChecks, flag_dk_percentage: e.target.checked })}
                        className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600 dark:border-gray-600 dark:bg-gray-700"
                      />
                    </div>
                    <div className="ml-3">
                      <label className="text-sm font-medium text-gray-900 dark:text-white">
                        Flag submissions with a high percentage of "Don't know" answers
                      </label>
                    </div>
                  </div>

                  {qualityChecks.flag_dk_percentage && (
                    <div className="ml-7 p-3 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                        Threshold (%)
                      </label>
                      {canEditSurvey ? (
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={qualityChecks.dk_percentage_threshold}
                          onChange={(e) =>
                            setQualityChecks({
                              ...qualityChecks,
                              dk_percentage_threshold: Math.max(
                                0,
                                Math.min(100, Number.parseFloat(e.target.value) || 0)
                              ),
                            })
                          }
                          className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        />
                      ) : (
                        <span className="text-sm text-gray-700 dark:text-gray-300">
                          {qualityChecks.dk_percentage_threshold}%
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Empty Answer Percentage Flag */}
                <div className="space-y-2">
                  <div className="flex items-start">
                    <div className="flex h-5 items-center">
                      <input
                        type="checkbox"
                        disabled={!canEditSurvey}
                        checked={qualityChecks.flag_empty_percentage}
                        onChange={(e) => setQualityChecks({ ...qualityChecks, flag_empty_percentage: e.target.checked })}
                        className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600 dark:border-gray-600 dark:bg-gray-700"
                      />
                    </div>
                    <div className="ml-3">
                      <label className="text-sm font-medium text-gray-900 dark:text-white">
                        Flag submissions with a high percentage of empty answers
                      </label>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Questions hidden by skip logic don’t count as empty.
                      </p>
                    </div>
                  </div>

                  {qualityChecks.flag_empty_percentage && (
                    <div className="ml-7 p-3 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                        Threshold (%)
                      </label>
                      {canEditSurvey ? (
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={qualityChecks.empty_percentage_threshold}
                          onChange={(e) =>
                            setQualityChecks({
                              ...qualityChecks,
                              empty_percentage_threshold: Math.max(
                                0,
                                Math.min(100, Number.parseFloat(e.target.value) || 0)
                              ),
                            })
                          }
                          className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        />
                      ) : (
                        <span className="text-sm text-gray-700 dark:text-gray-300">
                          {qualityChecks.empty_percentage_threshold}%
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Survey Duration Limits */}
                <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Interview duration limits</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                        Minimum (minutes)
                      </label>
                      {canEditSurvey ? (
                        <input
                          type="number"
                          value={globalParameters.min_survey_duration_minutes || ''}
                          onChange={(e) => setGlobalParameters({ ...globalParameters, min_survey_duration_minutes: e.target.value ? parseInt(e.target.value) : null })}
                          className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md shadow-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          placeholder="e.g., 10"
                        />
                      ) : (
                        <div className="px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md text-gray-700 dark:text-gray-300">
                          {globalParameters.min_survey_duration_minutes ?? '—'}
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                        Maximum (minutes)
                      </label>
                      {canEditSurvey ? (
                        <input
                          type="number"
                          value={globalParameters.max_survey_duration_minutes || ''}
                          onChange={(e) => setGlobalParameters({ ...globalParameters, max_survey_duration_minutes: e.target.value ? parseInt(e.target.value) : null })}
                          className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md shadow-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          placeholder="e.g., 240"
                        />
                      ) : (
                        <div className="px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md text-gray-700 dark:text-gray-300">
                          {globalParameters.max_survey_duration_minutes ?? '—'}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                {!isGeneralFlagsDirty && <SavedNote at={savedAt.generalFlags} className="pt-4" />}
                {canEditSurvey && isGeneralFlagsDirty && (
                  <SectionActions controls={sections.controls('generalFlags')} className="pt-4" />
                )}
              </div>
            </section>

            <OutlierChecksSection
              checks={qualityChecks}
              setChecks={setQualityChecks}
              numericVariables={numericVariables}
              questionLabel={questionLabel}
              canEdit={canEditSurvey}
              controls={sections.controls('outlier')}
              savedAt={savedAt.outlier}
            />

            <AiReviewSection
              surveyId={selectedSurvey.survey_id}
              isOwner={userPermission === 'owner'}
              checks={qualityChecks}
              setChecks={setQualityChecks}
              reviewableVariables={reviewableVariables}
              canEdit={canEditSurvey}
              controls={sections.controls('llm')}
              savedAt={savedAt.llm}
              onError={setError}
              onSuccess={setSuccess}
            />

            {/* Custom checks */}
            {selectedSurvey && (
              <CustomChecks
                key={selectedSurvey.survey_id}
                surveyId={selectedSurvey.survey_id}
                rules={stagedRules}
                isLoading={isLoadingRules}
                canEdit={canEditSurvey}
                koboToolData={koboToolData}
                onSave={handleSaveCustomCheck}
                onDelete={handleDeleteRule}
                onAddMany={handleAISuggestedRulesAdded}
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
