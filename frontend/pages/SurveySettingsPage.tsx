import React, { useState, useEffect, useCallback } from 'react';
import { useSurvey } from '../contexts/SurveyContext';
import { getSurveyConfig, updateSurvey, deleteSurvey, SurveyConfig, getValidationRules, createValidationRule, updateValidationRule, deleteValidationRule, ValidationRule } from '../services/progressApi';
import { parseKoboTool, KoboToolData } from '../services/koboParser';
import { parseSamplingFrame, validateSamplingFrameColumns } from '../utils/samplingFrameParser';
import { reconstructKoboToolData } from '../utils/koboDataUtils';
import { stagedRuleToDbFormat, dbFormatToStagedRule } from '../utils/ruleConverter';
import { StagedRule } from '../types';
import RuleEditor from '../components/rule-builder/RuleEditor';
import StagedRulesList from '../components/rule-builder/StagedRulesList';
import { Spinner } from '../components/Spinner';
import ErrorMessage from '../components/ui/ErrorMessage';
import SuccessMessage from '../components/ui/SuccessMessage';
import { SubTabButton } from '../components/ui/SubTabButton';

const SurveySettingsPage: React.FC = () => {
  const { selectedSurvey, refreshSurveys, setSelectedSurvey } = useSurvey();
  const [config, setConfig] = useState<SurveyConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'settings' | 'quality'>('settings');

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

  // Sampling frame CSV state
  const [samplingFrameData, setSamplingFrameData] = useState<Record<string, any>[] | null>(null);
  const [samplingFrameFileName, setSamplingFrameFileName] = useState<string>('');
  const [isLoadingFrame, setIsLoadingFrame] = useState(false);
  const [frameValidationError, setFrameValidationError] = useState<string | null>(null);

  // Form state
  const [surveyName, setSurveyName] = useState('');
  const [koboAssetId, setKoboAssetId] = useState('');
  const [coreIdentifiers, setCoreIdentifiers] = useState({
    uuid: '_uuid',
    enumerator: 'enumerator_id',
    date_interview: 'today',
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

  // Quality Checks State
  const [qualityChecks, setQualityChecks] = useState({
    flag_out_of_period: false,
    flag_weekend: false,
    weekend_days: [5, 6], // Default to Sat, Sun
    flag_office_hours: false,
    office_hours_start: '08:00',
    office_hours_end: '17:00',
  });

  useEffect(() => {
    if (selectedSurvey) {
      loadSurveyConfig();
    }
  }, [selectedSurvey]);

  useEffect(() => {
    if (koboToolData && koboToolData.variableMap) {
      const vars = Array.from(koboToolData.variableMap.keys());
      setAvailableVariables(vars);
    }
  }, [koboToolData]);

  const loadSurveyConfig = async () => {
    if (!selectedSurvey) return;
    
    setIsLoading(true);
    setError(null);
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
        setQualityChecks({
          flag_out_of_period: cd.quality_checks.flag_out_of_period ?? false,
          flag_weekend: cd.quality_checks.flag_weekend ?? false,
          weekend_days: cd.quality_checks.weekend_days ?? [5, 6],
          flag_office_hours: cd.quality_checks.flag_office_hours ?? false,
          office_hours_start: cd.quality_checks.office_hours_start ?? '08:00',
          office_hours_end: cd.quality_checks.office_hours_end ?? '17:00',
        });
      }

      if (cd.kobo_tool && cd.kobo_tool.survey && cd.kobo_tool.choices) {
        // Reconstruct KoboToolData from stored tool
        const reconstructed = reconstructKoboToolData(cd.kobo_tool.survey, cd.kobo_tool.choices);
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
        const targetInfo = validation.targetColumn 
          ? ` (Note: "${validation.targetColumn}" is recognized as a target column and doesn't need to match Kobo variables)`
          : '';
        throw new Error(
          `The following columns are not found in the Kobo tool: ${validation.missingColumns.join(', ')}${targetInfo}`
        );
      }
      
      setSamplingFrameData(rows);
      setSamplingFrameFileName(file.name);
      
      // Auto-populate sampling_cols from headers (excluding target column if present)
      const samplingCols = validation.targetColumn 
        ? headerList.filter(h => h !== validation.targetColumn)
        : headerList;
      
      setSamplingFrame(prev => ({
        ...prev,
        sampling_cols: samplingCols,
        admin_level_for_label: samplingCols[0] || prev.admin_level_for_label,
      }));
    } catch (err) {
      setFrameValidationError(err instanceof Error ? err.message : 'Failed to parse sampling frame file');
    } finally {
      setIsLoadingFrame(false);
      event.target.value = '';
    }
  };

  const handleSave = async () => {
    if (!selectedSurvey) return;

    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
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
        } : config?.config_data.kobo_tool,
      };

      await updateSurvey(selectedSurvey.survey_id, {
        survey_name: surveyName,
        kobo_asset_id: koboAssetId || null,
        config_data: configData,
      });
      setSuccess('Survey configuration updated successfully!');
      setIsEditing(false);
      await loadSurveyConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save survey configuration');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    if (config) {
      loadSurveyConfig();
    }
  };

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = async () => {
    if (!selectedSurvey) return;

    setIsDeleting(true);
    setError(null);
    setSuccess(null);

    try {
      await deleteSurvey(selectedSurvey.survey_id);
      setSuccess('Survey deleted successfully!');
      
      // Clear selection and refresh surveys list
      setSelectedSurvey(null);
      await refreshSurveys();
      
      // Close confirmation dialog
      setShowDeleteConfirm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete survey');
      setIsDeleting(false);
    }
  };

  const handleDeleteCancel = () => {
    setShowDeleteConfirm(false);
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
    label: string
  ) => {
    return (
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-400 mb-1">{label}</label>
        {isEditing && availableVariables.length > 0 ? (
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
    label: string
  ) => {
    // Get all unique answer options from choices
    const answerOptions = koboToolData?.choices 
      ? Array.from(new Set(koboToolData.choices.map(choice => choice.name))).sort()
      : [];

    return (
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-400 mb-1">{label}</label>
        {isEditing && answerOptions.length > 0 ? (
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
        <div className="text-center">
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

  return (
    <div className="h-full overflow-y-auto p-4 md:p-8 text-gray-700 dark:text-gray-300">
      <div className="bg-gray-100 dark:bg-gray-850 rounded-xl shadow-2xl p-4 md:p-6 mx-auto max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">Settings</h1>
          <div className="flex gap-2">
            {!isEditing ? (
              <>
                <button
                  onClick={() => setIsEditing(true)}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-sm font-medium"
                >
                  Edit
                </button>
                <button
                  onClick={handleDeleteClick}
                  className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm font-medium"
                >
                  Delete
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleCancel}
                  className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving || !surveyName.trim()}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed text-sm font-medium"
                >
                  {isSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </>
            )}
          </div>
        </div>

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
              <p className="text-gray-700 dark:text-gray-300 mb-6">
                Are you sure you want to delete <strong className="text-gray-900 dark:text-white">{surveyName}</strong>?
                <br />
                <br />
                This action cannot be undone. This will permanently delete the survey configuration and all associated data.
              </p>
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
                  disabled={isDeleting}
                  className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-red-300 dark:disabled:bg-red-700 disabled:cursor-not-allowed text-sm font-medium"
                >
                  {isDeleting ? 'Deleting...' : 'Delete Survey'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex space-x-1 bg-gray-200 dark:bg-gray-800 p-1 rounded-lg mb-6">
          <SubTabButton
            tabId="settings"
            activeTab={activeTab}
            onClick={setActiveTab}
          >
            General
          </SubTabButton>
          <SubTabButton
            tabId="quality"
            activeTab={activeTab}
            onClick={setActiveTab}
          >
            Data Quality Checks
          </SubTabButton>
        </div>

        {activeTab === 'settings' ? (
          <div className="space-y-6">
            {/* Basic Information */}
            <section className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">Basic Information</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-400 mb-1">
                    Survey Name *
                  </label>
                  {isEditing ? (
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
                  {isEditing ? (
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
                    {isEditing ? (
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
                    {isEditing ? (
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
              </div>
            </section>

            {/* Kobo Tool */}
            <section className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">Kobo Tool</h2>
              {isEditing ? (
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
              <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">Sampling Frame</h2>
              {isEditing ? (
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
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-400 mb-1">
                      Upload Sampling Frame (CSV or XLSX)
                    </label>
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
                  'Enumerator ID'
                )}
                {renderVariableDropdown(
                  coreIdentifiers.consent,
                  (value) => setCoreIdentifiers({ ...coreIdentifiers, consent: value }),
                  'Consent'
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-400 mb-1">DK Numeric Value</label>
                  {isEditing ? (
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
                  'DK String Value'
                )}
              </div>
            </section>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Quality Flag Settings */}
            <section className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">General Flags</h2>
              <div className="space-y-6">
                
                {/* Out of Period Flag */}
                <div className="flex items-start">
                  <div className="flex h-5 items-center">
                    <input
                      type="checkbox"
                      disabled={!isEditing}
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
                        disabled={!isEditing}
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
                            onClick={() => isEditing && handleWeekendDayToggle(day.value)}
                            disabled={!isEditing}
                            className={`px-3 py-1 rounded-full text-xs font-medium border ${
                              qualityChecks.weekend_days?.includes(day.value)
                                ? 'bg-indigo-100 text-indigo-800 border-indigo-300 dark:bg-indigo-900 dark:text-indigo-200 dark:border-indigo-700'
                                : 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:border-gray-600'
                            } ${isEditing ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
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
                        disabled={!isEditing}
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
                        {isEditing ? (
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
                        {isEditing ? (
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

                {/* Survey Duration */}
                <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
                  <h3 className="text-md font-medium text-gray-900 dark:text-white mb-3">Survey Duration Limits</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-400 mb-1">
                        Min Survey Duration (minutes)
                      </label>
                      {isEditing ? (
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
                      {isEditing ? (
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

              </div>
            </section>

            {/* Data Quality Rules Builder */}
            <section className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">Data Quality Rules Builder</h2>
              {isEditing ? (
                <div className="space-y-6">
                  {!koboToolData ? (
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Please ensure Kobo tool is loaded first to create validation rules.
                    </p>
                  ) : (
                    <>
                      <RuleEditor
                        koboToolData={koboToolData}
                        onSave={handleSaveRule}
                        onCancel={handleCancelEdit}
                        editingRule={currentlyEditing}
                      />
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
                              <p className="text-sm font-mono text-gray-600 dark:text-gray-400 mt-1">{rule.issue_message}</p>
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
        )}
      </div>
    </div>
  );
};

export default SurveySettingsPage;
