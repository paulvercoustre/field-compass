import React, { useState, useEffect, useCallback } from 'react';
import { useSurvey } from '../contexts/SurveyContext';
import { getSurveyConfig, updateSurvey, deleteSurvey, SurveyConfig, getValidationRules, createValidationRule, updateValidationRule, deleteValidationRule, ValidationRule } from '../services/progressApi';
import { parseKoboTool, KoboToolData } from '../services/koboParser';
import { parseSamplingFrame, validateSamplingFrameColumns } from '../utils/samplingFrameParser';
import { reconstructKoboToolData } from '../utils/koboDataUtils';
import { stagedRuleToDbFormat, dbFormatToStagedRule } from '../utils/ruleConverter';
import { generateUUID } from '../utils/uuid';
import { StagedRule } from '../types';
import RuleEditor from '../components/rule-builder/RuleEditor';
import StagedRulesList from '../components/rule-builder/StagedRulesList';
import { Spinner } from '../components/Spinner';

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
      
      if (!koboToolData || !koboToolData.variableMap) {
        throw new Error('Please upload Kobo tool first to validate sampling frame columns');
      }
      
      const toolVars = Array.from(koboToolData.variableMap.keys());
      const validation = validateSamplingFrameColumns(headers, toolVars);
      
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
        ? headers.filter(h => h !== validation.targetColumn)
        : headers;
      
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

  const renderVariableDropdown = (
    value: string,
    onChange: (value: string) => void,
    label: string
  ) => {
    return (
      <div>
        <label className="block text-sm font-medium text-gray-400 mb-1">{label}</label>
        {isEditing && availableVariables.length > 0 ? (
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">-- Select variable --</option>
            {availableVariables.map((varName) => (
              <option key={varName} value={varName}>
                {varName}
              </option>
            ))}
          </select>
        ) : (
          <div className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-300">
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
          <p className="text-gray-400 text-lg mb-2">No survey selected</p>
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

  return (
    <div className="h-full overflow-y-auto p-4 md:p-8 text-gray-300">
      <div className="bg-gray-850 rounded-xl shadow-2xl p-4 md:p-6 mx-auto max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl md:text-3xl font-bold text-white">Survey Settings</h1>
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
                  className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-sm font-medium"
                >
                  {isSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-900/50 border border-red-700 rounded-md text-red-200">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-4 p-4 bg-green-900/50 border border-green-700 rounded-md text-green-200">
            {success}
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 border border-gray-700">
              <h2 className="text-xl font-bold text-white mb-4">Delete Survey</h2>
              <p className="text-gray-300 mb-6">
                Are you sure you want to delete <strong className="text-white">{surveyName}</strong>?
                <br />
                <br />
                This action cannot be undone. This will permanently delete the survey configuration and all associated data.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={handleDeleteCancel}
                  disabled={isDeleting}
                  className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteConfirm}
                  disabled={isDeleting}
                  className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-red-700 disabled:cursor-not-allowed text-sm font-medium"
                >
                  {isDeleting ? 'Deleting...' : 'Delete Survey'}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-6">
          {/* Basic Information */}
          <section className="bg-gray-900/50 p-4 rounded-lg border border-gray-700">
            <h2 className="text-xl font-semibold mb-4 text-white">Basic Information</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  Survey Name *
                </label>
                {isEditing ? (
                  <input
                    type="text"
                    value={surveyName}
                    onChange={(e) => setSurveyName(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    required
                  />
                ) : (
                  <div className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-300">
                    {surveyName}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  Kobo Asset ID
                </label>
                {isEditing ? (
                  <input
                    type="text"
                    value={koboAssetId}
                    onChange={(e) => setKoboAssetId(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="e.g., a3wCWjYRXo46cSygF8gQAc"
                  />
                ) : (
                  <div className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-300">
                    {koboAssetId || '—'}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Kobo Tool */}
          <section className="bg-gray-900/50 p-4 rounded-lg border border-gray-700">
            <h2 className="text-xl font-semibold mb-4 text-white">Kobo Tool</h2>
            {isEditing ? (
              <div className="space-y-2">
                {koboToolData && (
                  <div className="mb-2 p-2 bg-gray-800 rounded-md text-sm text-gray-300">
                    {koboToolFileName && (
                      <div className="text-green-400 mb-1">
                        ✓ {koboToolFileName} ({availableVariables.length} variables)
                      </div>
                    )}
                    <p className="text-xs text-gray-400">
                      You can upload a new tool to replace the existing one, or keep the current tool.
                    </p>
                  </div>
                )}
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleKoboToolUpload}
                  className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-indigo-600 file:text-white hover:file:bg-indigo-700"
                  disabled={isLoadingTool}
                />
                {isLoadingTool && (
                  <div className="flex items-center gap-2 text-sm text-gray-400">
                    <Spinner />
                    <span>Parsing Kobo tool...</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-gray-300">
                {koboToolData ? (
                  <div>
                    <div className="text-green-400 mb-1">
                      ✓ Tool configured ({availableVariables.length} variables)
                    </div>
                    {koboToolFileName && (
                      <div className="text-xs text-gray-400">
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

          {/* Core Identifiers */}
          <section className="bg-gray-900/50 p-4 rounded-lg border border-gray-700">
            <h2 className="text-xl font-semibold mb-4 text-white">Core Identifiers</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {renderVariableDropdown(
                coreIdentifiers.uuid,
                (value) => setCoreIdentifiers({ ...coreIdentifiers, uuid: value }),
                'UUID'
              )}
              {renderVariableDropdown(
                coreIdentifiers.enumerator,
                (value) => setCoreIdentifiers({ ...coreIdentifiers, enumerator: value }),
                'Enumerator'
              )}
              {renderVariableDropdown(
                coreIdentifiers.date_interview,
                (value) => setCoreIdentifiers({ ...coreIdentifiers, date_interview: value }),
                'Date Interview'
              )}
              {renderVariableDropdown(
                coreIdentifiers.start_time,
                (value) => setCoreIdentifiers({ ...coreIdentifiers, start_time: value }),
                'Start Time'
              )}
              {renderVariableDropdown(
                coreIdentifiers.end_time,
                (value) => setCoreIdentifiers({ ...coreIdentifiers, end_time: value }),
                'End Time'
              )}
              {renderVariableDropdown(
                coreIdentifiers.consent,
                (value) => setCoreIdentifiers({ ...coreIdentifiers, consent: value }),
                'Consent'
              )}
              {renderVariableDropdown(
                coreIdentifiers.audit,
                (value) => setCoreIdentifiers({ ...coreIdentifiers, audit: value }),
                'Audit URL'
              )}
            </div>
          </section>

          {/* Sampling Frame */}
          <section className="bg-gray-900/50 p-4 rounded-lg border border-gray-700">
            <h2 className="text-xl font-semibold mb-4 text-white">Sampling Frame</h2>
            {isEditing ? (
              <div className="space-y-4">
                {samplingFrameData && (
                  <div className="mb-2 p-2 bg-gray-800 rounded-md text-sm text-gray-300">
                    {samplingFrameFileName && (
                      <div className="text-green-400 mb-1">
                        ✓ {samplingFrameFileName} ({samplingFrameData.length} rows)
                      </div>
                    )}
                    <p className="text-xs text-gray-400">
                      You can upload a new CSV/XLSX to replace the existing sampling frame, or keep the current one.
                    </p>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">
                    Upload Sampling Frame (CSV or XLSX)
                  </label>
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    onChange={handleSamplingFrameUpload}
                    className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-indigo-600 file:text-white hover:file:bg-indigo-700"
                    disabled={isLoadingFrame || !koboToolData}
                  />
                  {frameValidationError && (
                    <div className="mt-2 p-3 bg-red-900/50 border border-red-700 rounded-md text-red-200 text-sm">
                      {frameValidationError}
                    </div>
                  )}
                  {samplingFrameFileName && !frameValidationError && !samplingFrameData && (
                    <div className="mt-2 text-sm text-green-400">
                      ✓ {samplingFrameFileName}
                    </div>
                  )}
                  {!koboToolData && (
                    <p className="mt-2 text-sm text-yellow-400">
                      ⚠ Please ensure Kobo tool is loaded first to validate sampling frame
                    </p>
                  )}
                </div>
                {samplingFrame.sampling_cols.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">
                      Sampling Columns
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {samplingFrame.sampling_cols.map((col) => (
                        <span
                          key={col}
                          className="inline-flex items-center px-3 py-1 bg-gray-700 rounded-md text-sm"
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
                  <div className="text-green-400 mb-2">
                    ✓ Sampling frame configured ({samplingFrameData.length} rows)
                  </div>
                ) : null}
                <div>
                  <span className="text-sm font-medium text-gray-400">Sampling Columns: </span>
                  <span className="text-gray-300">
                    {samplingFrame.sampling_cols.length > 0
                      ? samplingFrame.sampling_cols.join(', ')
                      : '—'}
                  </span>
                </div>
                <div>
                  <span className="text-sm font-medium text-gray-400">Admin Level for Label: </span>
                  <span className="text-gray-300">{samplingFrame.admin_level_for_label || '—'}</span>
                </div>
              </div>
            )}
          </section>

          {/* Special Values */}
          <section className="bg-gray-900/50 p-4 rounded-lg border border-gray-700">
            <h2 className="text-xl font-semibold mb-4 text-white">Special Values (Don't Know)</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">DK Numeric Value</label>
                {isEditing ? (
                  <input
                    type="number"
                    value={specialValues.dk_value}
                    onChange={(e) => setSpecialValues({ ...specialValues, dk_value: parseInt(e.target.value) || -99 })}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                ) : (
                  <div className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-300">
                    {specialValues.dk_value}
                  </div>
                )}
              </div>
              {renderVariableDropdown(
                specialValues.dk_string_value,
                (value) => setSpecialValues({ ...specialValues, dk_string_value: value }),
                'DK String Value'
              )}
            </div>
          </section>

          {/* Global Parameters */}
          <section className="bg-gray-900/50 p-4 rounded-lg border border-gray-700">
            <h2 className="text-xl font-semibold mb-4 text-white">Global Parameters</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  Data Collection Start Date
                </label>
                {isEditing ? (
                  <input
                    type="date"
                    value={globalParameters.data_collection_start_date}
                    onChange={(e) => setGlobalParameters({ ...globalParameters, data_collection_start_date: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                ) : (
                  <div className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-300">
                    {globalParameters.data_collection_start_date || '—'}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  Data Collection End Date
                </label>
                {isEditing ? (
                  <input
                    type="date"
                    value={globalParameters.data_collection_end_date}
                    onChange={(e) => setGlobalParameters({ ...globalParameters, data_collection_end_date: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                ) : (
                  <div className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-300">
                    {globalParameters.data_collection_end_date || '—'}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  Min Survey Duration (minutes)
                </label>
                {isEditing ? (
                  <input
                    type="number"
                    value={globalParameters.min_survey_duration_minutes || ''}
                    onChange={(e) => setGlobalParameters({ ...globalParameters, min_survey_duration_minutes: e.target.value ? parseInt(e.target.value) : null })}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="e.g., 10"
                  />
                ) : (
                  <div className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-300">
                    {globalParameters.min_survey_duration_minutes ?? '—'}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  Max Survey Duration (minutes)
                </label>
                {isEditing ? (
                  <input
                    type="number"
                    value={globalParameters.max_survey_duration_minutes || ''}
                    onChange={(e) => setGlobalParameters({ ...globalParameters, max_survey_duration_minutes: e.target.value ? parseInt(e.target.value) : null })}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="e.g., 240"
                  />
                ) : (
                  <div className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-300">
                    {globalParameters.max_survey_duration_minutes ?? '—'}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Data Quality Rules */}
          <section className="bg-gray-900/50 p-4 rounded-lg border border-gray-700">
            <h2 className="text-xl font-semibold mb-4 text-white">Data Quality Rules</h2>
            {isEditing ? (
              <div className="space-y-6">
                {!koboToolData ? (
                  <p className="text-sm text-gray-400">
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
                    <div className="border-t border-gray-700 pt-4">
                      <h3 className="text-lg font-semibold mb-3 text-white">Saved Rules</h3>
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
                      <div key={rule.id} className="p-3 bg-gray-800 border border-gray-700 rounded-md">
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="font-semibold text-white">{rule.description}</p>
                            <p className="text-sm font-mono text-gray-400 mt-1">{rule.issue_message}</p>
                            {rule.roster_name && (
                              <p className="text-xs text-blue-400 mt-1">Context: {rule.roster_name}</p>
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
      </div>
    </div>
  );
};

export default SurveySettingsPage;

