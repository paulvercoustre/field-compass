import React, { useState, useEffect, useCallback } from 'react';
import { useSurvey } from '../contexts/SurveyContext';
import { getSurveyConfig, updateSurvey, deleteSurvey, SurveyConfig, getValidationRules, createValidationRule, updateValidationRule, deleteValidationRule, ValidationRule, getSurveyAccess, shareSurvey, updateSurveyAccess, revokeSurveyAccess, SurveyAccessEntry } from '../services/progressApi';
import { parseKoboTool, KoboToolData } from '../services/koboParser';
import { parseSamplingFrame, validateSamplingFrameColumns } from '../utils/samplingFrameParser';
import { reconstructKoboToolData } from '../utils/koboDataUtils';
import { stagedRuleToDbFormat, dbFormatToStagedRule } from '../utils/ruleConverter';
import { StagedRule } from '../types';
import RuleEditor from '../components/rule-builder/RuleEditor';
import StagedRulesList from '../components/rule-builder/StagedRulesList';
import AINaturalLanguageInput from '../components/rule-builder/AINaturalLanguageInput';
import AISuggestedRules from '../components/rule-builder/AISuggestedRules';
import { Spinner } from '../components/Spinner';
import ErrorMessage from '../components/ui/ErrorMessage';
import SuccessMessage from '../components/ui/SuccessMessage';

const SurveySettingsPage: React.FC = () => {
  const { selectedSurvey, refreshSurveys, setSelectedSurvey } = useSurvey();
  const [config, setConfig] = useState<SurveyConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false); // Used for Custom Quality Checks only
  const [isEditingOutlier, setIsEditingOutlier] = useState(false);
  const [isEditingLLM, setIsEditingLLM] = useState(false);
  const [isSavingOutlier, setIsSavingOutlier] = useState(false);
  const [isSavingLLM, setIsSavingLLM] = useState(false);
  const [isEditingKoboTool, setIsEditingKoboTool] = useState(false);
  const [isEditingSamplingFrame, setIsEditingSamplingFrame] = useState(false);
  const [isSavingBasicInfo, setIsSavingBasicInfo] = useState(false);
  const [isSavingCoreIdentifiers, setIsSavingCoreIdentifiers] = useState(false);
  const [isSavingKoboTool, setIsSavingKoboTool] = useState(false);
  const [isSavingSamplingFrame, setIsSavingSamplingFrame] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'settings' | 'access' | 'quality'>('settings');

  // Permission-based access control
  const userPermission = selectedSurvey?.permission;
  const canEditSurvey = userPermission === 'owner' || userPermission === 'admin';
  const canDeleteSurvey = userPermission === 'owner' || userPermission === 'admin';

  // Access management state
  const [accessList, setAccessList] = useState<SurveyAccessEntry[]>([]);
  const [isLoadingAccess, setIsLoadingAccess] = useState(false);
  const [shareEmail, setShareEmail] = useState('');
  const [sharePermission, setSharePermission] = useState<'editor' | 'viewer'>('viewer');
  const [isSharing, setIsSharing] = useState(false);
  const [canManageAccess, setCanManageAccess] = useState(false);

  // Validation rules state
  const [validationRules, setValidationRules] = useState<ValidationRule[]>([]);
  const [stagedRules, setStagedRules] = useState<StagedRule[]>([]);
  const [currentlyEditing, setCurrentlyEditing] = useState<StagedRule | null>(null);
  const [isLoadingRules, setIsLoadingRules] = useState(false);

  // Kobo tool state
  const [koboToolData, setKoboToolData] = useState<KoboToolData | null>(null);
  const [koboToolFileName, setKoboToolFileName] = useState<string>('');
  const [isLoadingTool, setIsLoadingTool] = useState(false);
  const [availableVariables, setAvailableVariables] = useState<string[]>([]);
  const [textVariables, setTextVariables] = useState<Array<{ name: string; label: string; type: string }>>([]);
  const [labelColumnSurvey, setLabelColumnSurvey] = useState<string>('label::English (en)');
  const [labelColumnChoices, setLabelColumnChoices] = useState<string>('label::English (en)');

  // Sampling frame CSV state
  const [samplingFrameData, setSamplingFrameData] = useState<Record<string, any>[] | null>(null);
  const [samplingFrameFileName, setSamplingFrameFileName] = useState<string>('');
  const [isLoadingFrame, setIsLoadingFrame] = useState(false);
  const [frameValidationError, setFrameValidationError] = useState<string | null>(null);
  const [frameValidationWarning, setFrameValidationWarning] = useState<string | null>(null);
  const [showSamplingFrameHelp, setShowSamplingFrameHelp] = useState(false);

  // Form state
  const [surveyName, setSurveyName] = useState('');
  const [koboAssetId, setKoboAssetId] = useState('');
  const [coreIdentifiers, setCoreIdentifiers] = useState({
    uuid: '_uuid',  // always supplied by Kobo as submission metadata
    // Form-dependent: never pre-fill a field the user did not choose. A form
    // may name these anything, or not have them at all.
    enumerator: '',
    date_interview: '',
    start_time: 'start',
    end_time: 'end',
    consent: 'consent',
    audit: 'audit_URL',
  });
  const [samplingFrame, setSamplingFrame] = useState({
    sampling_cols: [] as string[],
    admin_level_for_label: '',
    admin_level_choice_name: '',
  });
  const [specialValues, setSpecialValues] = useState({
    dk_value: -99,
    dk_string_value: 'dk',
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
  const savedCoreIdentifiers = config?.config_data?.core_identifiers || { uuid: '_uuid', enumerator: '', date_interview: '', start_time: 'start', end_time: 'end', consent: 'consent', audit: 'audit_URL' };
  const isCoreIdentifiersDirty =
    coreIdentifiers.uuid !== (savedCoreIdentifiers.uuid ?? '_uuid') ||
    coreIdentifiers.enumerator !== (savedCoreIdentifiers.enumerator ?? '') ||
    coreIdentifiers.date_interview !== (savedCoreIdentifiers.date_interview ?? '') ||
    coreIdentifiers.start_time !== (savedCoreIdentifiers.start_time ?? 'start') ||
    coreIdentifiers.end_time !== (savedCoreIdentifiers.end_time ?? 'end') ||
    coreIdentifiers.consent !== (savedCoreIdentifiers.consent ?? 'consent') ||
    coreIdentifiers.audit !== (savedCoreIdentifiers.audit ?? 'audit_URL') ||
    specialValues.dk_value !== (config?.config_data?.special_values?.dk_value ?? -99) ||
    specialValues.dk_string_value !== (config?.config_data?.special_values?.dk_string_value ?? 'dk');

  // Quality Checks State
  const [qualityChecks, setQualityChecks] = useState({
    flag_out_of_period: false,
    flag_weekend: false,
    weekend_days: [5, 6], // Default to Sat, Sun
    flag_office_hours: false,
    office_hours_start: '08:00',
    office_hours_end: '17:00',
    flag_sampling_frame: false,
    flag_outliers: false,
    outlier_variables: [] as string[],
    outlier_log_transform_variables: [] as string[],
    outlier_method: 'iqr' as 'iqr' | 'mad' | 'zscore',
    outlier_threshold: 1.5,
    flag_dk_percentage: false,
    dk_percentage_threshold: 50,
    flag_llm_qualitative: false,
    llm_qualitative_fields: [] as string[],
    llm_check_types: ['content_quality', 'relevance', 'completeness'] as Array<'content_quality' | 'relevance' | 'completeness'>,
  });

  // Dirty flag for General Quality Checks section only (Save/Cancel when user edits)
  const savedQc = config?.config_data?.quality_checks;
  const isGeneralFlagsDirty = savedQc ? (
    qualityChecks.flag_out_of_period !== (savedQc.flag_out_of_period ?? false) ||
    qualityChecks.flag_weekend !== (savedQc.flag_weekend ?? false) ||
    JSON.stringify([...(qualityChecks.weekend_days || [])].sort()) !== JSON.stringify([...(savedQc.weekend_days ?? [5, 6])].sort()) ||
    qualityChecks.flag_office_hours !== (savedQc.flag_office_hours ?? false) ||
    qualityChecks.office_hours_start !== (savedQc.office_hours_start ?? '08:00') ||
    qualityChecks.office_hours_end !== (savedQc.office_hours_end ?? '17:00') ||
    qualityChecks.flag_sampling_frame !== (savedQc.flag_sampling_frame ?? false) ||
    qualityChecks.flag_dk_percentage !== (savedQc.flag_dk_percentage ?? false) ||
    qualityChecks.dk_percentage_threshold !== (savedQc.dk_percentage_threshold ?? 50) ||
    globalParameters.min_survey_duration_minutes !== (config?.config_data?.global_parameters?.min_survey_duration_minutes ?? null) ||
    globalParameters.max_survey_duration_minutes !== (config?.config_data?.global_parameters?.max_survey_duration_minutes ?? null)
  ) : false;

  useEffect(() => {
    if (selectedSurvey) {
      // Clear any success/error messages when switching to a different survey
      setSuccess(null);
      setError(null);
      loadSurveyConfig();

      // Check if we should open the quality tab (set from CreateSurveyPage)
      const shouldOpenQualityTab = localStorage.getItem('openQualityTab');
      const targetSurveyId = localStorage.getItem('openQualityTabForSurveyId');

      // Only open quality tab if this is the survey we just created
      if (shouldOpenQualityTab === 'true' && targetSurveyId === selectedSurvey.survey_id) {
        setActiveTab('quality');
        setIsEditing(true); // Enable edit mode so user can immediately configure quality checks
        // Clear the flags so they don't persist
        localStorage.removeItem('openQualityTab');
        localStorage.removeItem('openQualityTabForSurveyId');
      }
    } else {
      // Reset deletion state when no survey is selected (keep success message visible)
      setIsDeleting(false);
      setShowDeleteConfirm(false);
      setError(null);
      setIsEditingKoboTool(false);
      setIsEditingSamplingFrame(false);
    }
  }, [selectedSurvey]);

  // Reset deletion state when modal is closed
  useEffect(() => {
    if (!showDeleteConfirm) {
      setDeleteConfirmInput('');
      setDeleteError(null);
      setIsDeleting(false);
    }
  }, [showDeleteConfirm]);

  // Load access list when Access tab is selected
  useEffect(() => {
    if (activeTab === 'access' && selectedSurvey) {
      loadAccessList();
    }
  }, [activeTab, selectedSurvey]);

  useEffect(() => {
    if (koboToolData && koboToolData.variableMap) {
      // Filter to only numeric variables (integer, decimal, calculate)
      const numericTypes = ['integer', 'decimal', 'calculate'];
      const vars = Array.from(koboToolData.variableMap.entries())
        .filter(([_, variable]) => numericTypes.includes(variable.type))
        .map(([name, _]) => name);
      setAvailableVariables(vars);

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
        outlier_variables: prev.outlier_variables.filter((v) => vars.includes(v)),
        outlier_log_transform_variables: prev.outlier_log_transform_variables.filter((v) =>
          vars.includes(v) && prev.outlier_variables.includes(v)
        ),
        llm_qualitative_fields: prev.llm_qualitative_fields.filter((v) =>
          textQuestions.some((t) => t.name === v)
        ),
      }));
    }
  }, [koboToolData]);

  const loadSurveyConfig = async () => {
    if (!selectedSurvey) return;
    
    setIsLoading(true);
    setError(null);
    setSuccess(null);
    
    // Reset all state before loading new survey config to prevent stale data from previous survey
    // Sampling frame state
    setSamplingFrameData(null);
    setSamplingFrameFileName('');
    setFrameValidationError(null);
    setFrameValidationWarning(null);
    setSamplingFrame({
      sampling_cols: [],
      admin_level_for_label: '',
      admin_level_choice_name: '',
    });
    
    // Kobo tool state
    setKoboToolData(null);
    setKoboToolFileName('');
    setAvailableVariables([]);
    
    try {
      const data = await getSurveyConfig(selectedSurvey.survey_id);
      setConfig(data);
      setSurveyName(data.survey_name);
      setKoboAssetId(data.kobo_asset_id || '');
      
      const cd = data.config_data;
      if (cd.core_identifiers) {
        setCoreIdentifiers({ ...coreIdentifiers, ...cd.core_identifiers });
      }
      if (cd.sampling_frame) {
        setSamplingFrame({
          sampling_cols: cd.sampling_frame.sampling_cols || [],
          admin_level_for_label: cd.sampling_frame.admin_level_for_label || '',
          admin_level_choice_name: cd.sampling_frame.admin_level_choice_name || '',
        });
        if (cd.sampling_frame.frame_data) {
          setSamplingFrameData(cd.sampling_frame.frame_data);
          setSamplingFrameFileName('(Loaded from saved config)');
        }
      }
      if (cd.special_values) {
        setSpecialValues({ ...specialValues, ...cd.special_values });
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
          flag_llm_qualitative: cd.quality_checks.flag_llm_qualitative ?? false,
          llm_qualitative_fields: cd.quality_checks.llm_qualitative_fields ?? [],
          llm_check_types: cd.quality_checks.llm_check_types ?? ['content_quality', 'relevance', 'completeness'],
        });
      }

      if (cd.kobo_tool && cd.kobo_tool.survey && cd.kobo_tool.choices) {
        // Load label column settings first
        if (cd.kobo_tool.label_column_survey) {
          setLabelColumnSurvey(cd.kobo_tool.label_column_survey);
        }
        if (cd.kobo_tool.label_column_choices) {
          setLabelColumnChoices(cd.kobo_tool.label_column_choices);
        }
        // Reconstruct KoboToolData from stored tool with label column
        const reconstructed = reconstructKoboToolData(
          cd.kobo_tool.survey, 
          cd.kobo_tool.choices,
          cd.kobo_tool.label_column_survey
        );
        setKoboToolData(reconstructed);
        setKoboToolFileName('(Loaded from saved config)');
      }
      
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
      setValidationRules(rules);
      
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

  const loadAccessList = async () => {
    if (!selectedSurvey) return;
    
    setIsLoadingAccess(true);
    try {
      const access = await getSurveyAccess(selectedSurvey.survey_id);
      setAccessList(access);
      setCanManageAccess(true);
    } catch (err: any) {
      // If 403, user doesn't have permission to manage access
      if (err.message?.includes('403') || err.message?.includes('owner')) {
        setCanManageAccess(false);
      } else {
        console.error('Error loading access list:', err);
      }
    } finally {
      setIsLoadingAccess(false);
    }
  };

  const handleShare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSurvey || !shareEmail.trim()) return;

    setIsSharing(true);
    setError(null);

    try {
      await shareSurvey(selectedSurvey.survey_id, shareEmail.trim(), sharePermission);
      setSuccess(`Survey shared with ${shareEmail}`);
      setShareEmail('');
      loadAccessList();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to share survey');
    } finally {
      setIsSharing(false);
    }
  };

  const handleUpdateAccess = async (userId: string, newLevel: 'editor' | 'viewer') => {
    if (!selectedSurvey) return;
    setError(null);
    try {
      await updateSurveyAccess(selectedSurvey.survey_id, userId, newLevel);
      loadAccessList();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update access');
    }
  };

  const handleRevokeAccess = async (userId: string, userEmail: string) => {
    if (!selectedSurvey) return;
    if (!confirm(`Are you sure you want to revoke ${userEmail}'s access?`)) return;

    setError(null);
    try {
      await revokeSurveyAccess(selectedSurvey.survey_id, userId);
      loadAccessList();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke access');
    }
  };

  const handleKoboToolUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoadingTool(true);
    setError(null);
    setKoboToolFileName('');
    
    try {
      const data = await parseKoboTool(file);
      setKoboToolData(data);
      setKoboToolFileName(file.name);
      
      // Auto-detect and set label columns if available
      if (data.survey.length > 0) {
        const surveyLabels = Object.keys(data.survey[0]).filter(key => key.startsWith('label::'));
        if (surveyLabels.length > 0 && !surveyLabels.includes(labelColumnSurvey)) {
          setLabelColumnSurvey(surveyLabels[0]);
        }
      }
      if (data.choices.length > 0) {
        const choiceLabels = Object.keys(data.choices[0]).filter(key => key.startsWith('label::'));
        if (choiceLabels.length > 0 && !choiceLabels.includes(labelColumnChoices)) {
          setLabelColumnChoices(choiceLabels[0]);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse Kobo tool file');
    } finally {
      setIsLoadingTool(false);
      event.target.value = '';
    }
  };

  const handleSamplingFrameUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoadingFrame(true);
    setFrameValidationError(null);
    setFrameValidationWarning(null);
    setSamplingFrameFileName('');
    
    try {
      const { headers, rows } = await parseSamplingFrame(file);
      const headerList = headers as string[];
      
      if (!koboToolData || !koboToolData.variableMap) {
        throw new Error('Please upload Kobo tool first to validate sampling frame columns');
      }
      
      const toolVars: string[] = Array.from(koboToolData.variableMap.keys());
      const validation = validateSamplingFrameColumns(headerList, toolVars);
      
      if (!validation.isValid) {
        throw new Error(
          'No matching columns found in the Kobo tool. Please ensure your sampling frame has at least one column that matches a Kobo variable.'
        );
      }
      
      setSamplingFrameData(rows);
      setSamplingFrameFileName(file.name);
      
      // Show warning if there are unmatched columns
      if (validation.hasUnmatchedColumns) {
        const targetInfo = validation.targetColumn 
          ? ` (Note: "${validation.targetColumn}" is recognized as a target column)`
          : '';
        setFrameValidationWarning(
          `The following columns don't match Kobo variables and won't be used in the sampling frame: ${validation.unmatchedColumns.join(', ')}.${targetInfo} Only matching columns will be used: ${validation.matchingColumns.join(', ')}.`
        );
      }
      
      // Auto-populate sampling_cols with only matching columns
      setSamplingFrame(prev => ({
        ...prev,
        sampling_cols: validation.matchingColumns,
        admin_level_for_label: validation.matchingColumns[0] || prev.admin_level_for_label,
      }));
    } catch (err) {
      setFrameValidationError(err instanceof Error ? err.message : 'Failed to parse sampling frame file');
    } finally {
      setIsLoadingFrame(false);
      event.target.value = '';
    }
  };

  // Persist current state to API (shared by section save handlers)
  const persistSurveyConfig = async () => {
    if (!selectedSurvey) return;
    const configData: SurveyConfig['config_data'] = {
      core_identifiers: coreIdentifiers,
      sampling_frame: {
        ...samplingFrame,
        frame_data: samplingFrameData,
      },
      special_values: specialValues,
      global_parameters: globalParameters,
      quality_checks: qualityChecks,
      pii_cols: config?.config_data.pii_cols || null,
      roster_processing: config?.config_data.roster_processing || {
        roster_uuid: '_submission__uuid',
        roster_configs: {},
      },
      kobo_tool: koboToolData ? {
        survey: koboToolData.survey,
        choices: koboToolData.choices,
        label_column_survey: labelColumnSurvey,
        label_column_choices: labelColumnChoices,
      } : config?.config_data.kobo_tool ? {
        ...config.config_data.kobo_tool,
        label_column_survey: labelColumnSurvey,
        label_column_choices: labelColumnChoices,
      } : undefined,
    };
    await updateSurvey(selectedSurvey.survey_id, {
      survey_name: surveyName,
      kobo_asset_id: koboAssetId || null,
      config_data: configData,
    });
  };

  const handleSaveBasicInfo = async () => {
    if (!selectedSurvey) return;
    setIsSavingBasicInfo(true);
    setError(null);
    try {
      await persistSurveyConfig();
      setSuccess('Basic information updated');
      await loadSurveyConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSavingBasicInfo(false);
    }
  };

  const handleCancelBasicInfo = () => {
    if (config) {
      setSurveyName(config.survey_name);
      setKoboAssetId(config.kobo_asset_id || '');
      setGlobalParameters(prev => ({
        ...prev,
        data_collection_start_date: config.config_data?.global_parameters?.data_collection_start_date || '',
        data_collection_end_date: config.config_data?.global_parameters?.data_collection_end_date || '',
      }));
    }
  };

  const handleSaveCoreIdentifiers = async () => {
    if (!selectedSurvey) return;
    setIsSavingCoreIdentifiers(true);
    setError(null);
    try {
      await persistSurveyConfig();
      setSuccess('Core identifiers updated');
      await loadSurveyConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSavingCoreIdentifiers(false);
    }
  };

  const handleCancelCoreIdentifiers = () => {
    if (config?.config_data?.core_identifiers) {
      setCoreIdentifiers(prev => ({ ...prev, ...config.config_data.core_identifiers }));
    }
    if (config?.config_data?.special_values) {
      setSpecialValues(prev => ({ ...prev, ...config.config_data.special_values }));
    }
  };

  const handleSaveKoboTool = async () => {
    if (!selectedSurvey) return;
    setIsSavingKoboTool(true);
    setError(null);
    try {
      await persistSurveyConfig();
      setSuccess('Kobo tool updated');
      setIsEditingKoboTool(false);
      await loadSurveyConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSavingKoboTool(false);
    }
  };

  const handleCancelKoboTool = () => {
    setIsEditingKoboTool(false);
    loadSurveyConfig();
  };

  const handleSaveSamplingFrame = async () => {
    if (!selectedSurvey) return;
    setIsSavingSamplingFrame(true);
    setError(null);
    try {
      await persistSurveyConfig();
      setSuccess('Sampling frame updated');
      setIsEditingSamplingFrame(false);
      await loadSurveyConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSavingSamplingFrame(false);
    }
  };

  const handleCancelSamplingFrame = () => {
    setIsEditingSamplingFrame(false);
    loadSurveyConfig();
  };

  const handleSaveGeneralFlags = async () => {
    if (!selectedSurvey) return;
    setError(null);
    try {
      await persistSurveyConfig();
      setSuccess('General flags updated');
      await loadSurveyConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    }
  };

  const handleCancelGeneralFlags = () => {
    loadSurveyConfig();
  };

  const handleSaveOutlier = async () => {
    if (!selectedSurvey) return;
    setIsSavingOutlier(true);
    setError(null);
    try {
      await persistSurveyConfig();
      setSuccess('Outlier checks updated');
      setIsEditingOutlier(false);
      await loadSurveyConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSavingOutlier(false);
    }
  };

  const handleCancelOutlier = () => {
    setIsEditingOutlier(false);
    loadSurveyConfig();
  };

  const handleSaveLLM = async () => {
    if (!selectedSurvey) return;
    setIsSavingLLM(true);
    setError(null);
    try {
      await persistSurveyConfig();
      setSuccess('Qualitative quality checks updated');
      setIsEditingLLM(false);
      await loadSurveyConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSavingLLM(false);
    }
  };

  const handleCancelLLM = () => {
    setIsEditingLLM(false);
    loadSurveyConfig();
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
      await refreshSurveys({ allowAutoSelect: false });
      
      // Don't auto-select a survey after deletion - let user choose
      setTimeout(() => {
        setSelectedSurvey(null);
        localStorage.removeItem('selectedSurveyId');
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

  const handleSaveRule = useCallback(async (rule: Omit<StagedRule, 'id'>) => {
    if (!selectedSurvey) return;

    try {
      const dbRule = stagedRuleToDbFormat({ ...rule, id: '' });
      
      if (currentlyEditing) {
        // Update existing rule
        await updateValidationRule(selectedSurvey.survey_id, currentlyEditing.id, {
          rule_name: rule.description,
          rule_data: dbRule,
        });
      } else {
        // Create new rule
        await createValidationRule(selectedSurvey.survey_id, {
          rule_name: rule.description,
          rule_data: dbRule,
          is_active: true,
        });
      }
      
      setCurrentlyEditing(null);
      await loadValidationRules(); // Refresh from server
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save validation rule');
    }
  }, [currentlyEditing, selectedSurvey]);

  const handleEditRule = useCallback((ruleId: string) => {
    const ruleToEdit = stagedRules.find(r => r.id === ruleId);
    if (ruleToEdit) {
      setCurrentlyEditing(ruleToEdit);
    }
  }, [stagedRules]);

  const handleDeleteRule = useCallback(async (ruleId: string) => {
    if (!selectedSurvey) return;

    try {
      await deleteValidationRule(selectedSurvey.survey_id, ruleId);
      setStagedRules(rules => rules.filter(r => r.id !== ruleId));
      if (currentlyEditing?.id === ruleId) {
        setCurrentlyEditing(null);
      }
      await loadValidationRules(); // Refresh from server
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete validation rule');
    }
  }, [currentlyEditing, selectedSurvey]);

  const handleCancelEdit = useCallback(() => {
    setCurrentlyEditing(null);
  }, []);

  const handleAIRuleGenerated = useCallback(async (rule: StagedRule) => {
    if (!selectedSurvey) {
      throw new Error('No survey selected');
    }

    // Clear any currently editing rule
    if (currentlyEditing) {
      setCurrentlyEditing(null);
    }

    try {
      const dbRule = stagedRuleToDbFormat({ ...rule, id: '' });
      
      // Create new rule
      await createValidationRule(selectedSurvey.survey_id, {
        rule_name: rule.description,
        rule_data: dbRule,
        is_active: true,
      });
      
      // Refresh the rules list from server
      await loadValidationRules();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to save validation rule';
      setError(errorMessage);
      throw new Error(errorMessage); // Re-throw so the AI component can catch it
    }
  }, [currentlyEditing, selectedSurvey]);

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
      setSuccess(`${rules.length} rule${rules.length !== 1 ? 's' : ''} added successfully!`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save suggested rules');
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

  const renderVariableDropdown = (
    value: string,
    onChange: (value: string) => void,
    label: string,
    editable?: boolean
  ) => {
    const canEdit = editable ?? isEditing;
    return (
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-400 mb-1">{label}</label>
        {canEdit && availableVariables.length > 0 ? (
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">-- Select variable --</option>
            {availableVariables.map((varName) => (
              <option key={varName} value={varName}>
                {varName}
              </option>
            ))}
          </select>
        ) : (
          <div className="px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md text-gray-700 dark:text-gray-300">
            {value || '—'}
          </div>
        )}
      </div>
    );
  };

  const renderAnswerOptionDropdown = (
    value: string,
    onChange: (value: string) => void,
    label: string,
    editable?: boolean
  ) => {
    const canEdit = editable ?? isEditing;
    // Get all unique answer options from choices
    const answerOptions = koboToolData?.choices 
      ? Array.from(new Set(koboToolData.choices.map(choice => choice.name))).sort()
      : [];

    return (
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-400 mb-1">{label}</label>
        {canEdit && answerOptions.length > 0 ? (
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">-- Select answer option --</option>
            {answerOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : (
          <div className="px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md text-gray-700 dark:text-gray-300">
            {value || '—'}
          </div>
        )}
      </div>
    );
  };

  if (!selectedSurvey) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center max-w-lg w-full px-4">
          <div className="mb-4 space-y-2">
            <ErrorMessage error={error} className="text-base" />
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

  const navItems = [
    { id: 'settings' as const, label: 'General' },
    { id: 'access' as const, label: 'Access' },
    { id: 'quality' as const, label: 'Data Quality Checks' },
  ];

  return (
    <div className="h-full overflow-y-auto p-4 md:p-8 text-gray-700 dark:text-gray-300">
      <div className="w-full max-w-7xl mx-auto">
        <div className="mb-4 space-y-2">
          <ErrorMessage error={error} className="text-base" />
          <SuccessMessage 
            message={success} 
            onDismiss={() => setSuccess(null)}
            autoHide={true}
            autoHideDelay={5000}
          />
        </div>

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 border border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Delete Survey</h2>
              <p className="text-gray-700 dark:text-gray-300 mb-4">
                Are you sure you want to delete <strong className="text-gray-900 dark:text-white">{surveyName}</strong>?
                <br />
                <br />
                This action cannot be undone. This will permanently delete the survey configuration and all associated data.
              </p>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
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
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg mb-4">
                  <p className="text-sm text-red-600 dark:text-red-400">{deleteError}</p>
                </div>
              )}
              <div className="flex justify-end gap-3">
                <button
                  onClick={handleDeleteCancel}
                  disabled={isDeleting}
                  className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteConfirm}
                  disabled={isDeleting || deleteConfirmInput !== surveyName}
                  className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-red-300 dark:disabled:bg-red-700 disabled:cursor-not-allowed text-sm font-medium"
                >
                  {isDeleting ? 'Deleting...' : 'Delete Survey'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Two-column layout: left nav + content */}
        <div className="flex gap-8 items-start">
          {/* Left navigation */}
          <aside className="w-48 flex-shrink-0">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Survey Settings</h2>
            <nav className="space-y-0.5">
              {navItems.map((item) => {
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveTab(item.id)}
                    className={`w-full text-left pl-3 pr-2 py-2.5 rounded-md text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-200 font-semibold'
                        : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50 hover:text-gray-700 dark:hover:text-gray-300'
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* Right content - pt-10 aligns first content with first nav button (matches h2 + mb-4) */}
          <main className="flex-1 min-w-0 pt-10">
            {activeTab === 'settings' && !canEditSurvey && userPermission && (
              <div className="mb-6">
                <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                  View only
                </span>
              </div>
            )}

        {activeTab === 'settings' ? (
          <div className="space-y-6">
            {/* Survey Profile */}
            <section className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">Survey Profile</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-400 mb-1">
                    Survey Name *
                  </label>
                  {canEditSurvey ? (
                    <input
                      type="text"
                      value={surveyName}
                      onChange={(e) => setSurveyName(e.target.value)}
                      className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      required
                    />
                  ) : (
                    <div className="px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md text-gray-700 dark:text-gray-300">
                      {surveyName}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-400 mb-1">
                    Kobo Asset ID
                  </label>
                  {canEditSurvey ? (
                    <input
                      type="text"
                      value={koboAssetId}
                      onChange={(e) => setKoboAssetId(e.target.value)}
                      className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-400 mb-1">
                      Data Collection Start Date
                    </label>
                    {canEditSurvey ? (
                      <input
                        type="date"
                        value={globalParameters.data_collection_start_date}
                        onChange={(e) => setGlobalParameters({ ...globalParameters, data_collection_start_date: e.target.value })}
                        className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    ) : (
                      <div className="px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md text-gray-700 dark:text-gray-300">
                        {globalParameters.data_collection_start_date || '—'}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-400 mb-1">
                      Data Collection End Date
                    </label>
                    {canEditSurvey ? (
                      <input
                        type="date"
                        value={globalParameters.data_collection_end_date}
                        onChange={(e) => setGlobalParameters({ ...globalParameters, data_collection_end_date: e.target.value })}
                        className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    ) : (
                      <div className="px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md text-gray-700 dark:text-gray-300">
                        {globalParameters.data_collection_end_date || '—'}
                      </div>
                    )}
                  </div>
                </div>
                {canEditSurvey && isBasicInfoDirty && (
                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={handleSaveBasicInfo}
                      disabled={isSavingBasicInfo}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-indigo-400 text-sm font-medium"
                    >
                      {isSavingBasicInfo ? 'Saving...' : 'Save Changes'}
                    </button>
                    <button
                      onClick={handleCancelBasicInfo}
                      disabled={isSavingBasicInfo}
                      className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 text-sm font-medium"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </section>

            {/* Kobo Tool */}
            <section className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Kobo Tool</h2>
                {canEditSurvey && !isEditingKoboTool && (
                  <button
                    onClick={() => setIsEditingKoboTool(true)}
                    className="px-3 py-2 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-md"
                  >
                    Edit
                  </button>
                )}
              </div>
              {isEditingKoboTool ? (
                <div className="space-y-2">
                  {koboToolData && (
                    <div className="mb-2 p-2 bg-gray-100 dark:bg-gray-800 rounded-md text-sm text-gray-700 dark:text-gray-300">
                      {koboToolFileName && (
                        <div className="text-green-600 dark:text-green-400 mb-1">
                          ✓ {koboToolFileName} ({availableVariables.length} variables)
                        </div>
                      )}
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        You can upload a new tool to replace the existing one, or keep the current tool.
                      </p>
                    </div>
                  )}
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleKoboToolUpload}
                    className="block w-full text-sm text-gray-600 dark:text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-indigo-600 file:text-white hover:file:bg-indigo-700"
                    disabled={isLoadingTool}
                  />
                  {isLoadingTool && (
                    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                      <Spinner />
                      <span>Parsing Kobo tool...</span>
                    </div>
                  )}
                  
                  {/* Label Column Settings */}
                  {koboToolData && (
                    <div className="mt-4 space-y-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Label Column Settings</h3>
                      <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
                        Select which column to use for displaying question and choice labels. This is useful when your survey has multiple language columns.
                      </p>
                      
                      {/* Detect available label columns */}
                      {(() => {
                        const surveyLabels = new Set<string>();
                        const choiceLabels = new Set<string>();
                        
                        if (koboToolData.survey.length > 0) {
                          Object.keys(koboToolData.survey[0]).forEach(key => {
                            if (key.startsWith('label::')) {
                              surveyLabels.add(key);
                            }
                          });
                        }
                        
                        if (koboToolData.choices.length > 0) {
                          Object.keys(koboToolData.choices[0]).forEach(key => {
                            if (key.startsWith('label::')) {
                              choiceLabels.add(key);
                            }
                          });
                        }
                        
                        const surveyLabelArray = Array.from(surveyLabels);
                        const choiceLabelArray = Array.from(choiceLabels);
                        
                        return (
                          <>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 dark:text-gray-400 mb-1">
                                Survey Question Label Column
                              </label>
                              <select
                                value={labelColumnSurvey}
                                onChange={(e) => setLabelColumnSurvey(e.target.value)}
                                className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              >
                                {surveyLabelArray.length > 0 ? (
                                  surveyLabelArray.map(col => (
                                    <option key={col} value={col}>{col}</option>
                                  ))
                                ) : (
                                  <option value="label::English (en)">label::English (en) (default)</option>
                                )}
                              </select>
                            </div>
                            
                            <div>
                              <label className="block text-sm font-medium text-gray-700 dark:text-gray-400 mb-1">
                                Choice Label Column
                              </label>
                              <select
                                value={labelColumnChoices}
                                onChange={(e) => setLabelColumnChoices(e.target.value)}
                                className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              >
                                {choiceLabelArray.length > 0 ? (
                                  choiceLabelArray.map(col => (
                                    <option key={col} value={col}>{col}</option>
                                  ))
                                ) : (
                                  <option value="label::English (en)">label::English (en) (default)</option>
                                )}
                              </select>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  )}
                  <div className="flex gap-3 mt-4">
                    <button
                      onClick={handleSaveKoboTool}
                      disabled={isSavingKoboTool}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-indigo-400 text-sm font-medium"
                    >
                      {isSavingKoboTool ? 'Saving...' : 'Save Changes'}
                    </button>
                    <button
                      onClick={handleCancelKoboTool}
                      disabled={isSavingKoboTool}
                      className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 text-sm font-medium"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-gray-700 dark:text-gray-300">
                  {koboToolData ? (
                    <div>
                      <div className="text-green-600 dark:text-green-400 mb-1">
                        ✓ Tool configured ({availableVariables.length} variables)
                      </div>
                      {koboToolFileName && (
                        <div className="text-xs text-gray-600 dark:text-gray-400">
                          {koboToolFileName}
                        </div>
                      )}
                    </div>
                  ) : (
                    '—'
                  )}
                </div>
              )}
            </section>

            {/* Sampling Frame */}
            <section className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Sampling Frame</h2>
                {canEditSurvey && !isEditingSamplingFrame && (
                  <button
                    onClick={() => setIsEditingSamplingFrame(true)}
                    className="px-3 py-2 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-md"
                  >
                    Edit
                  </button>
                )}
              </div>
              {isEditingSamplingFrame ? (
                <div className="space-y-4">
                  {samplingFrameData && (
                    <div className="mb-2 p-2 bg-gray-100 dark:bg-gray-800 rounded-md text-sm text-gray-700 dark:text-gray-300">
                      {samplingFrameFileName && (
                        <div className="text-green-600 dark:text-green-400 mb-1">
                          ✓ {samplingFrameFileName} ({samplingFrameData.length} rows)
                        </div>
                      )}
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        You can upload a new CSV/XLSX to replace the existing sampling frame, or keep the current one.
                      </p>
                    </div>
                  )}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-400">
                        Upload Sampling Frame (CSV or XLSX)
                      </label>
                      <button
                        type="button"
                        onClick={() => setShowSamplingFrameHelp(!showSamplingFrameHelp)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        File Format Requirements
                      </button>
                    </div>
                    {showSamplingFrameHelp && (
                      <div className="mb-3 p-3 bg-blue-50 dark:bg-gray-800/50 border border-blue-200 dark:border-gray-700 rounded-md text-xs text-gray-700 dark:text-gray-300 space-y-2">
                        <ul className="list-disc list-inside space-y-1.5 ml-2">
                          <li><strong>Format:</strong> CSV or Excel (.xlsx, .xls)</li>
                          <li><strong>Column Headers:</strong> Must match variable names from your Kobo tool (e.g., <code className="bg-white dark:bg-gray-900 px-1 rounded">district</code>, <code className="bg-white dark:bg-gray-900 px-1 rounded">village</code>, <code className="bg-white dark:bg-gray-900 px-1 rounded">sector</code>)</li>
                          <li>
                            <strong>Target Column (Optional):</strong> A column for interview targets/sample size that doesn't need to match Kobo variables. Recognized names: target, target_interviews, sample_size, interview_target, expected_interviews, etc.
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
                      accept=".csv,.xlsx,.xls"
                      onChange={handleSamplingFrameUpload}
                      className="block w-full text-sm text-gray-600 dark:text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-indigo-600 file:text-white hover:file:bg-indigo-700"
                      disabled={isLoadingFrame || !koboToolData}
                    />
                    {frameValidationError && (
                      <div className="mt-2 p-3 bg-red-50 dark:bg-red-900/50 border border-red-200 dark:border-red-700 rounded-md text-red-800 dark:text-red-200 text-sm">
                        {frameValidationError}
                      </div>
                    )}
                    {frameValidationWarning && !frameValidationError && (
                      <div className="mt-2 p-3 bg-yellow-50 dark:bg-yellow-900/50 border border-yellow-200 dark:border-yellow-700 rounded-md text-yellow-800 dark:text-yellow-200 text-sm">
                        ⚠ {frameValidationWarning}
                      </div>
                    )}
                    {samplingFrameFileName && !frameValidationError && !samplingFrameData && (
                      <div className="mt-2 text-sm text-green-600 dark:text-green-400">
                        ✓ {samplingFrameFileName}
                      </div>
                    )}
                    {!koboToolData && (
                      <p className="mt-2 text-sm text-yellow-600 dark:text-yellow-400">
                        ⚠ Please ensure Kobo tool is loaded first to validate sampling frame
                      </p>
                    )}
                  </div>
                  {samplingFrame.sampling_cols.length > 0 && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-400 mb-1">
                        Sampling Columns
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {samplingFrame.sampling_cols.map((col) => (
                          <span
                            key={col}
                            className="inline-flex items-center px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded-md text-sm text-gray-900 dark:text-white"
                          >
                            {col}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex gap-3 mt-4">
                    <button
                      onClick={handleSaveSamplingFrame}
                      disabled={isSavingSamplingFrame}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-indigo-400 text-sm font-medium"
                    >
                      {isSavingSamplingFrame ? 'Saving...' : 'Save Changes'}
                    </button>
                    <button
                      onClick={handleCancelSamplingFrame}
                      disabled={isSavingSamplingFrame}
                      className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 text-sm font-medium"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {samplingFrameData ? (
                    <div className="text-green-600 dark:text-green-400 mb-2">
                      ✓ Sampling frame configured ({samplingFrameData.length} rows)
                    </div>
                  ) : null}
                  <div>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-400">Sampling Columns: </span>
                    <span className="text-gray-700 dark:text-gray-300">
                      {samplingFrame.sampling_cols.length > 0
                        ? samplingFrame.sampling_cols.join(', ')
                        : '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-400">Admin Level for Label: </span>
                    <span className="text-gray-700 dark:text-gray-300">{samplingFrame.admin_level_for_label || '—'}</span>
                  </div>
                </div>
              )}
            </section>

            {/* Core Identifiers */}
            <section className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">Core Identifiers</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {renderVariableDropdown(
                  coreIdentifiers.enumerator,
                  (value) => setCoreIdentifiers({ ...coreIdentifiers, enumerator: value }),
                  'Enumerator ID',
                  canEditSurvey
                )}
                {renderVariableDropdown(
                  coreIdentifiers.consent,
                  (value) => setCoreIdentifiers({ ...coreIdentifiers, consent: value }),
                  'Consent',
                  canEditSurvey
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-400 mb-1">DK Numeric Value</label>
                  {canEditSurvey ? (
                    <input
                      type="number"
                      value={specialValues.dk_value}
                      onChange={(e) => setSpecialValues({ ...specialValues, dk_value: parseInt(e.target.value) || -99 })}
                      className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  ) : (
                    <div className="px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md text-gray-700 dark:text-gray-300">
                      {specialValues.dk_value}
                    </div>
                  )}
                </div>
                {renderAnswerOptionDropdown(
                  specialValues.dk_string_value,
                  (value) => setSpecialValues({ ...specialValues, dk_string_value: value }),
                  'DK String Value',
                  canEditSurvey
                )}
              </div>
              {canEditSurvey && isCoreIdentifiersDirty && (
                <div className="flex gap-3 pt-4">
                  <button
                    onClick={handleSaveCoreIdentifiers}
                    disabled={isSavingCoreIdentifiers}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-indigo-400 text-sm font-medium"
                  >
                    {isSavingCoreIdentifiers ? 'Saving...' : 'Save Changes'}
                  </button>
                  <button
                    onClick={handleCancelCoreIdentifiers}
                    disabled={isSavingCoreIdentifiers}
                    className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 text-sm font-medium"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </section>

            {/* Delete Survey Section */}
            {canDeleteSurvey && (
              <section className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-red-200 dark:border-red-900/50 p-6">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Delete Survey</h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  Permanently delete this survey and all associated data. This action cannot be undone.
                </p>

                <button
                  type="button"
                  onClick={handleDeleteClick}
                  disabled={isDeleting}
                  className="px-4 py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white font-medium rounded-lg transition-colors"
                >
                  Delete Survey
                </button>
              </section>
            )}
          </div>
        ) : activeTab === 'access' ? (
          <div className="space-y-6">
            {/* Who has access */}
            <section className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">Who has access</h2>
              
              {isLoadingAccess ? (
                <div className="flex items-center justify-center py-8">
                  <Spinner />
                </div>
              ) : accessList.length === 0 ? (
                <p className="text-gray-500 dark:text-gray-400 text-sm py-4">
                  {canManageAccess 
                    ? "No one else has access to this survey yet." 
                    : "Unable to load access list."}
                </p>
              ) : (
                <div className="space-y-3">
                  {accessList.map((access) => (
                    <div
                      key={access.user_id}
                      className="flex items-center justify-between py-3 px-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-indigo-500 flex items-center justify-center text-white font-bold">
                          {access.username?.charAt(0).toUpperCase() || access.email?.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-medium text-gray-900 dark:text-white">
                            {access.full_name || access.username}
                          </div>
                          <div className="text-sm text-gray-500 dark:text-gray-400">
                            {access.email}
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-3">
                        {access.permission_level === 'owner' ? (
                          <span className="px-3 py-1 text-sm font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300 rounded-full">
                            Owner
                          </span>
                        ) : canManageAccess ? (
                          <>
                            <select
                              value={access.permission_level}
                              onChange={(e) => handleUpdateAccess(access.user_id, e.target.value as 'editor' | 'viewer')}
                              className="text-sm px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 dark:bg-gray-700 dark:text-white"
                            >
                              <option value="viewer">Viewer</option>
                              <option value="editor">Editor</option>
                            </select>
                            <button
                              onClick={() => handleRevokeAccess(access.user_id, access.email)}
                              className="p-2 text-gray-400 hover:text-red-500 transition-colors rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
                              title="Revoke access"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </>
                        ) : (
                          <span className={`px-3 py-1 text-sm font-medium rounded-full ${
                            access.permission_level === 'editor' 
                              ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                              : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                          }`}>
                            {access.permission_level === 'editor' ? 'Editor' : 'Viewer'}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Share Survey */}
            <section className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">Share Survey</h2>
              
              {!canManageAccess ? (
                <div className="p-4 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-md">
                  <p className="text-yellow-800 dark:text-yellow-200 text-sm">
                    Only the survey owner can manage access permissions.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleShare} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Invite by email
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="email"
                        value={shareEmail}
                        onChange={(e) => setShareEmail(e.target.value)}
                        placeholder="user@example.com"
                        className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 dark:bg-gray-800 dark:text-white text-sm"
                        required
                      />
                      <select
                        value={sharePermission}
                        onChange={(e) => setSharePermission(e.target.value as 'editor' | 'viewer')}
                        className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 dark:bg-gray-800 dark:text-white text-sm"
                      >
                        <option value="viewer">Viewer</option>
                        <option value="editor">Editor</option>
                      </select>
                      <button
                        type="submit"
                        disabled={isSharing || !shareEmail.trim()}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                      >
                        {isSharing ? 'Sharing...' : 'Share'}
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    <strong>Viewer:</strong> Can view data and reports. <strong>Editor:</strong> Can also run ETL and resolve flags.
                  </p>
                </form>
              )}
            </section>
          </div>
        ) : activeTab === 'quality' ? (
          <div className="space-y-6">
            {/* General Quality Checks - dirty pattern like Survey Profile */}
            <section className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">General Quality Checks</h2>
              <div className="space-y-6">
                
                {/* Out of Period Flag */}
                <div className="flex items-start">
                  <div className="flex h-5 items-center">
                    <input
                      type="checkbox"
                      disabled={!canEditSurvey}
                      checked={qualityChecks.flag_out_of_period}
                      onChange={(e) => setQualityChecks({ ...qualityChecks, flag_out_of_period: e.target.checked })}
                      className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600 dark:border-gray-600 dark:bg-gray-700"
                    />
                  </div>
                  <div className="ml-3">
                    <label className="text-sm font-medium text-gray-900 dark:text-white">
                      Flag submissions out of data collection period
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Create a flag if the interview date is outside the start/end dates defined in Global Parameters.
                    </p>
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
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Create a flag if the interview date falls on selected weekend days.
                      </p>
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
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Create a flag if the interview start time is outside defined office hours.
                      </p>
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

                {/* Sampling Frame Flag */}
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
                      Flag submissions not in sampling frame
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Create a flag if the submission's sampling column combination (e.g., district and actor) is not found in the sampling frame.
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
                        Flag submissions with high Don't know percentage
                      </label>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Create a flag when the percentage of Don't know answers in eligible questions exceeds a threshold.
                      </p>
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

                {/* Survey Duration Limits */}
                <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
                  <h3 className="text-md font-medium text-gray-900 dark:text-white mb-3">Survey Duration Limits</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-400 mb-1">
                        Min Survey Duration (minutes)
                      </label>
                      {canEditSurvey ? (
                        <input
                          type="number"
                          value={globalParameters.min_survey_duration_minutes || ''}
                          onChange={(e) => setGlobalParameters({ ...globalParameters, min_survey_duration_minutes: e.target.value ? parseInt(e.target.value) : null })}
                          className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          placeholder="e.g., 10"
                        />
                      ) : (
                        <div className="px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md text-gray-700 dark:text-gray-300">
                          {globalParameters.min_survey_duration_minutes ?? '—'}
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-400 mb-1">
                        Max Survey Duration (minutes)
                      </label>
                      {canEditSurvey ? (
                        <input
                          type="number"
                          value={globalParameters.max_survey_duration_minutes || ''}
                          onChange={(e) => setGlobalParameters({ ...globalParameters, max_survey_duration_minutes: e.target.value ? parseInt(e.target.value) : null })}
                          className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                {canEditSurvey && isGeneralFlagsDirty && (
                  <div className="flex gap-3 pt-4">
                    <button
                      onClick={handleSaveGeneralFlags}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-sm font-medium"
                    >
                      Save Changes
                    </button>
                    <button
                      onClick={handleCancelGeneralFlags}
                      className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 text-sm font-medium"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </section>

            {/* Outlier Checks Settings */}
            <section className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Outlier Checks</h2>
                {canEditSurvey && !isEditingOutlier && (
                  <button
                    onClick={() => setIsEditingOutlier(true)}
                    className="px-3 py-2 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-md"
                  >
                    Edit
                  </button>
                )}
              </div>
              <div className="space-y-6">
                {/* Outlier Checks Flag */}
                <div className="space-y-2">
                  <div className="flex items-start">
                    <div className="flex h-5 items-center">
                      <input
                        type="checkbox"
                        disabled={!isEditingOutlier}
                        checked={qualityChecks.flag_outliers}
                        onChange={(e) => setQualityChecks({ ...qualityChecks, flag_outliers: e.target.checked })}
                        className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600 dark:border-gray-600 dark:bg-gray-700"
                      />
                    </div>
                    <div className="ml-3">
                      <label className="text-sm font-medium text-gray-900 dark:text-white">
                        Flag outlier values
                      </label>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Create a flag if numeric values in selected variables are statistical outliers.
                      </p>
                    </div>
                  </div>

                  {qualityChecks.flag_outliers && (
                    <div className="ml-7 p-3 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 space-y-4">
                      {/* Variable Selection */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          Select Variables to Check
                        </label>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                          Only numeric variables (integer, decimal, calculate) are shown.
                        </p>
                        {isEditingOutlier ? (
                          <div className="space-y-2 max-h-48 overflow-y-auto border border-gray-200 dark:border-gray-600 rounded p-2">
                            {availableVariables.length > 0 ? (
                              availableVariables.map((variable) => (
                                <label key={variable} className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 p-1 rounded">
                                  <input
                                    type="checkbox"
                                    checked={qualityChecks.outlier_variables.includes(variable)}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setQualityChecks({
                                          ...qualityChecks,
                                          outlier_variables: [...qualityChecks.outlier_variables, variable],
                                        });
                                      } else {
                                        setQualityChecks({
                                          ...qualityChecks,
                                          outlier_variables: qualityChecks.outlier_variables.filter((v) => v !== variable),
                                          outlier_log_transform_variables: qualityChecks.outlier_log_transform_variables.filter((v) => v !== variable),
                                        });
                                      }
                                    }}
                                    className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600 dark:border-gray-600 dark:bg-gray-700"
                                  />
                                  <span className="text-sm text-gray-700 dark:text-gray-300">{variable}</span>
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
                            {qualityChecks.outlier_variables.length > 0 ? (
                              qualityChecks.outlier_variables.map((variable) => (
                                <span
                                  key={variable}
                                  className="inline-block mr-2 mb-1 px-2 py-1 text-xs bg-indigo-100 text-indigo-800 rounded dark:bg-indigo-900 dark:text-indigo-200"
                                >
                                  {variable}
                                </span>
                              ))
                            ) : (
                              <span className="text-xs text-gray-500 dark:text-gray-400">No variables selected</span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Log transform per variable */}
                      {qualityChecks.outlier_variables.length > 0 && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Log transform (signed)
                          </label>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                            Use signed log transform for skewed or mixed-sign variables: sign(x) × log(1 + |x|)
                          </p>
                          {isEditingOutlier ? (
                            <div className="space-y-2">
                              {qualityChecks.outlier_variables.map((variable) => (
                                <label key={variable} className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 p-1 rounded">
                                  <input
                                    type="checkbox"
                                    checked={qualityChecks.outlier_log_transform_variables.includes(variable)}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setQualityChecks({
                                          ...qualityChecks,
                                          outlier_log_transform_variables: [...qualityChecks.outlier_log_transform_variables, variable],
                                        });
                                      } else {
                                        setQualityChecks({
                                          ...qualityChecks,
                                          outlier_log_transform_variables: qualityChecks.outlier_log_transform_variables.filter((v) => v !== variable),
                                        });
                                      }
                                    }}
                                    className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600 dark:border-gray-600 dark:bg-gray-700"
                                  />
                                  <span className="text-sm text-gray-700 dark:text-gray-300">{variable}</span>
                                </label>
                              ))}
                            </div>
                          ) : (
                            <div className="space-y-1">
                              {qualityChecks.outlier_log_transform_variables.length > 0 ? (
                                qualityChecks.outlier_log_transform_variables.map((variable) => (
                                  <span
                                    key={variable}
                                    className="inline-block mr-2 mb-1 px-2 py-1 text-xs bg-amber-100 text-amber-800 rounded dark:bg-amber-900 dark:text-amber-200"
                                  >
                                    {variable} (log)
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
                          Detection Method
                        </label>
                        {isEditingOutlier ? (
                          <select
                            value={qualityChecks.outlier_method}
                            onChange={(e) => {
                              const newMethod = e.target.value as 'iqr' | 'mad' | 'zscore';
                              // Update threshold based on method
                              const defaultThresholds = {
                                iqr: 1.5,
                                mad: 3.0,
                                zscore: 2.0,
                              };
                              setQualityChecks({
                                ...qualityChecks,
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
                            {qualityChecks.outlier_method === 'iqr'
                              ? 'IQR (Interquartile Range)'
                              : qualityChecks.outlier_method === 'mad'
                              ? 'MAD (Median Absolute Deviation)'
                              : 'Z-Score'}
                          </span>
                        )}
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {qualityChecks.outlier_method === 'iqr'
                            ? 'Uses quartiles and IQR. Standard threshold: 1.5'
                            : qualityChecks.outlier_method === 'mad'
                            ? 'Robust method using median and MAD. Standard threshold: 3.0'
                            : 'Uses mean and standard deviation. Standard threshold: 2.0 (moderate) or 3.0 (strict)'}
                        </p>
                      </div>

                      {/* Threshold */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Threshold
                        </label>
                        {isEditingOutlier ? (
                          <input
                            type="number"
                            step="0.1"
                            min="0.1"
                            value={qualityChecks.outlier_threshold}
                            onChange={(e) =>
                              setQualityChecks({
                                ...qualityChecks,
                                outlier_threshold: parseFloat(e.target.value) || 1.5,
                              })
                            }
                            className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                          />
                        ) : (
                          <span className="text-sm text-gray-700 dark:text-gray-300">
                            {qualityChecks.outlier_threshold}
                          </span>
                        )}
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {qualityChecks.outlier_method === 'iqr'
                            ? 'IQR multiplier (e.g., 1.5 = standard, 3.0 = more conservative)'
                            : qualityChecks.outlier_method === 'mad'
                            ? 'Modified Z-score threshold (e.g., 3.0 = standard)'
                            : 'Z-score threshold (e.g., 2.0 = moderate, 3.0 = strict)'}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
                {isEditingOutlier && (
                  <div className="flex gap-3 pt-4">
                    <button
                      onClick={handleSaveOutlier}
                      disabled={isSavingOutlier}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-indigo-400 text-sm font-medium"
                    >
                      {isSavingOutlier ? 'Saving...' : 'Save Changes'}
                    </button>
                    <button
                      onClick={handleCancelOutlier}
                      disabled={isSavingOutlier}
                      className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 text-sm font-medium"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </section>

            {/* Qualitative Quality Checks */}
            <section className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Qualitative Quality Checks</h2>
                {canEditSurvey && !isEditingLLM && (
                  <button
                    onClick={() => setIsEditingLLM(true)}
                    className="px-3 py-2 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-md"
                  >
                    Edit
                  </button>
                )}
              </div>
              <div className="space-y-4">
                <div className="flex items-start">
                  <div className="flex h-5 items-center">
                    <input
                      type="checkbox"
                      disabled={!isEditingLLM}
                      checked={qualityChecks.flag_llm_qualitative}
                      onChange={(e) =>
                        setQualityChecks({
                          ...qualityChecks,
                          flag_llm_qualitative: e.target.checked,
                        })
                      }
                      className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600 dark:border-gray-600 dark:bg-gray-700"
                    />
                  </div>
                  <div className="ml-3">
                    <label className="text-sm font-medium text-gray-900 dark:text-white">
                      Enable AI-powered analysis of qualitative responses
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Uses asynchronous checks and only re-runs when monitored text responses or LLM rules change.
                    </p>
                  </div>
                </div>

                {qualityChecks.flag_llm_qualitative && (
                  <div className="ml-7 p-3 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
                    <h3 className="text-sm font-medium mb-2 text-gray-900 dark:text-white">Text Fields to Analyze</h3>
                    {textVariables.length === 0 ? (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        No text fields found. Upload Kobo tool metadata with text questions to enable field selection.
                      </p>
                    ) : (
                      <div className="max-h-48 overflow-y-auto space-y-1">
                        {textVariables.map((variable) => (
                          <label key={variable.name} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              disabled={!isEditingLLM}
                              checked={qualityChecks.llm_qualitative_fields.includes(variable.name)}
                              onChange={(e) => {
                                const selected = qualityChecks.llm_qualitative_fields;
                                if (e.target.checked) {
                                  setQualityChecks({
                                    ...qualityChecks,
                                    llm_qualitative_fields: [...selected, variable.name],
                                  });
                                } else {
                                  setQualityChecks({
                                    ...qualityChecks,
                                    llm_qualitative_fields: selected.filter((name) => name !== variable.name),
                                  });
                                }
                              }}
                              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600 dark:border-gray-600 dark:bg-gray-700"
                            />
                            <span className="text-gray-900 dark:text-white">{variable.label}</span>
                            <span className="text-xs text-gray-500">({variable.name})</span>
                          </label>
                        ))}
                      </div>
                    )}
                    <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                      Enabled checks: content quality, relevance, and completeness.
                    </div>
                  </div>
                )}
                {isEditingLLM && (
                  <div className="flex gap-3 pt-4">
                    <button
                      onClick={handleSaveLLM}
                      disabled={isSavingLLM}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-indigo-400 text-sm font-medium"
                    >
                      {isSavingLLM ? 'Saving...' : 'Save Changes'}
                    </button>
                    <button
                      onClick={handleCancelLLM}
                      disabled={isSavingLLM}
                      className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 text-sm font-medium"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </section>

            {/* Custom Quality Checks */}
            <section className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Custom Quality Checks</h2>
                {canEditSurvey && (
                  isEditing ? (
                    <button
                      onClick={() => setIsEditing(false)}
                      className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md"
                    >
                      Done
                    </button>
                  ) : (
                    <button
                      onClick={() => setIsEditing(true)}
                      className="px-3 py-2 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-md"
                    >
                      Edit
                    </button>
                  )
                )}
              </div>
              {isEditing ? (
                <div className="space-y-6">
                  {!koboToolData ? (
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Please ensure Kobo tool is loaded first to create validation rules.
                    </p>
                  ) : (
                    <>
                      {/* AI Rule Builder Section */}
                      {selectedSurvey && (
                        <div className="p-6 bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-gray-850 dark:to-gray-900 rounded-lg border-2 border-indigo-200 dark:border-indigo-800">
                          <div className="flex items-center mb-4">
                            <span className="text-2xl mr-2">✨</span>
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">AI Rule Builder</h3>
                            <span className="ml-2 text-xs px-2 py-1 bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 rounded-full">
                              Beta
                            </span>
                          </div>
                          <p className="text-gray-600 dark:text-gray-400 mb-4 text-sm">
                            Describe your rule in plain English, and AI will convert it to a validation rule.
                          </p>
                          <AINaturalLanguageInput 
                            surveyId={selectedSurvey.survey_id}
                            onRuleGenerated={handleAIRuleGenerated}
                          />
                        </div>
                      )}

                      {/* AI Suggestions Section */}
                      {selectedSurvey && (
                        <div className="p-6 bg-gradient-to-br from-purple-50 to-pink-50 dark:from-gray-850 dark:to-gray-900 rounded-lg border-2 border-purple-200 dark:border-purple-800">
                          <div className="flex items-center mb-4">
                            <span className="text-2xl mr-2">💡</span>
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">AI Suggestions</h3>
                          </div>
                          <AISuggestedRules 
                            surveyId={selectedSurvey.survey_id}
                            onRulesAdded={handleAISuggestedRulesAdded}
                          />
                        </div>
                      )}

                      {/* Manual Rule Editor */}
                      <div className="p-6 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700">
                        <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">Create Rule Manually</h3>
                        <RuleEditor
                          koboToolData={koboToolData}
                          onSave={handleSaveRule}
                          onCancel={handleCancelEdit}
                          editingRule={currentlyEditing}
                        />
                      </div>
                      <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                        <h3 className="text-lg font-semibold mb-3 text-gray-900 dark:text-white">Saved Rules</h3>
                        {isLoadingRules ? (
                          <div className="flex items-center justify-center py-4">
                            <Spinner />
                          </div>
                        ) : (
                          <StagedRulesList
                            rules={stagedRules}
                            onEdit={handleEditRule}
                            onDelete={handleDeleteRule}
                            canEdit={canEditSurvey}
                          />
                        )}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {isLoadingRules ? (
                    <div className="flex items-center justify-center py-4">
                      <Spinner />
                    </div>
                  ) : stagedRules.length > 0 ? (
                    <div className="space-y-2">
                      {stagedRules.map((rule) => (
                        <div key={rule.id} className="p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="font-semibold text-gray-900 dark:text-white">{rule.description}</p>
                              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{rule.issue_message}</p>
                              {rule.roster_name && (
                                <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">Context: {rule.roster_name}</p>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500 text-sm">No validation rules configured for this survey.</p>
                  )}
                </div>
              )}
            </section>
          </div>
        ) : null}
          </main>
        </div>
      </div>
    </div>
  );
};

export default SurveySettingsPage;
