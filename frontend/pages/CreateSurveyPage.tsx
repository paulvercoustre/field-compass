import React, { useState, useEffect, useCallback } from 'react';
import { useSurvey } from '../contexts/SurveyContext';
import { createSurvey, SurveyCreate } from '../services/progressApi';
import { KoboToolData } from '../services/koboParser';
import { parseSamplingFrame, validateSamplingFrameColumns } from '../utils/samplingFrameParser';
import { generateUUID } from '../utils/uuid';
import { StagedRule } from '../types';
import { stagedRuleToDbFormat } from '../utils/ruleConverter';
import { createValidationRule, ValidationRuleCreate } from '../services/progressApi';
import RuleEditor from '../components/rule-builder/RuleEditor';
import StagedRulesList from '../components/rule-builder/StagedRulesList';
import { Spinner } from '../components/Spinner';
import ErrorMessage from '../components/ui/ErrorMessage';
import SuccessMessage from '../components/ui/SuccessMessage';
import QualityCheckPromptModal from '../components/QualityCheckPromptModal';
import InfoTip from '../components/ui/InfoTip';
import { parseKoboAssetId, looksLikeUrl, labelColumnFor } from '../utils/koboUrl';
import { getKoboProjectForm, KoboProjectForm } from '../services/api';
import { CORE_IDENTIFIER_HELP, KOBO_LINK_HELP } from '../constants/coreIdentifiers';

const CreateSurveyPage: React.FC = () => {
  const { refreshSurveys, setSelectedSurvey, selectedSurvey } = useSurvey();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showQualityCheckPrompt, setShowQualityCheckPrompt] = useState(false);
  const [newlyCreatedSurveyId, setNewlyCreatedSurveyId] = useState<string | null>(null);

  // Kobo tool state
  const [koboToolData, setKoboToolData] = useState<KoboToolData | null>(null);
  const [availableVariables, setAvailableVariables] = useState<string[]>([]);

  // Sampling frame CSV state
  const [samplingFrameData, setSamplingFrameData] = useState<Record<string, any>[] | null>(null);
  const [samplingFrameFileName, setSamplingFrameFileName] = useState<string>('');
  const [isLoadingFrame, setIsLoadingFrame] = useState(false);
  const [frameValidationError, setFrameValidationError] = useState<string | null>(null);
  const [frameValidationWarning, setFrameValidationWarning] = useState<string | null>(null);
  const [showSamplingFrameHelp, setShowSamplingFrameHelp] = useState(false);

  // Form state
  const [surveyName, setSurveyName] = useState('');
  // The user pastes the link to their project; the identifier is derived from
  // it. Kobo's own interface never shows the term "asset ID", so asking for one
  // asks people to know a word they have never seen.
  const [koboLink, setKoboLink] = useState('');
  const koboAssetId = parseKoboAssetId(koboLink);

  const [isLoadingProjectForm, setIsLoadingProjectForm] = useState(false);
  const [projectFormError, setProjectFormError] = useState<string | null>(null);
  const [projectFormName, setProjectFormName] = useState<string | null>(null);
  // Which translation to show. The form tells us which exist, so this is a
  // choice between real languages rather than a spreadsheet column name.
  const [formLanguages, setFormLanguages] = useState<string[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState<string>('');
  const [coreIdentifiers, setCoreIdentifiers] = useState({
    uuid: '_uuid',  // always supplied by Kobo as submission metadata
    // Form-dependent: never pre-fill a field the user did not choose. A form
    // may name these anything, or not have them at all.
    enumerator: '',
    date_interview: 'today',
    start_time: 'start',
    end_time: 'end',
    consent: '',
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

  // Rule builder state
  const [stagedRules, setStagedRules] = useState<StagedRule[]>([]);
  const [currentlyEditing, setCurrentlyEditing] = useState<StagedRule | null>(null);

  useEffect(() => {
    // Update available variables when tool is loaded
    if (koboToolData && koboToolData.variableMap) {
      const vars = Array.from(koboToolData.variableMap.keys());
      setAvailableVariables(vars);
      
      // Pre-select a conventional name only when the form actually contains a
      // question by that name. That is a verified match, not a guess -- unlike a
      // blind default, which silently points the config at a question that may
      // not exist. Anything not matched is left for the user to choose.
      const defaults = {
        uuid: '_uuid',
        date_interview: 'today',
        start_time: 'start',
        end_time: 'end',
        enumerator: 'enumerator_id',
        consent: 'consent',
      };
      
      setCoreIdentifiers(prev => {
        const updated = { ...prev };
        Object.entries(defaults).forEach(([key, defaultValue]) => {
          if (vars.includes(defaultValue)) {
            updated[key as keyof typeof updated] = defaultValue;
          }
        });
        return updated;
      });
    }
  }, [koboToolData]);

  const handleSamplingFrameUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoadingFrame(true);
    setFrameValidationError(null);
    setFrameValidationWarning(null);
    setSamplingFrameFileName('');
    
    try {
      const { headers, rows } = await parseSamplingFrame(file);
      
      // Validate that all headers (except target column) exist in the Kobo tool variables
      if (!koboToolData || !koboToolData.variableMap) {
        throw new Error('Read the form from your Kobo project first, so sampling frame columns can be validated');
      }
      
      const toolVars = Array.from(koboToolData.variableMap.keys());
      const validation = validateSamplingFrameColumns(headers, toolVars);
      
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
      event.target.value = ''; // Reset file input
    }
  };

  const handleSaveRule = useCallback((rule: Omit<StagedRule, 'id'>) => {
    if (currentlyEditing) {
      setStagedRules(rules => rules.map(r => r.id === currentlyEditing.id ? { ...r, ...rule } : r));
    } else {
      setStagedRules(rules => [...rules, { ...rule, id: generateUUID() }]);
    }
    setCurrentlyEditing(null);
  }, [currentlyEditing]);

  const handleEditRule = useCallback((ruleId: string) => {
    const ruleToEdit = stagedRules.find(r => r.id === ruleId);
    if (ruleToEdit) {
      setCurrentlyEditing(ruleToEdit);
    }
  }, [stagedRules]);

  const handleDeleteRule = useCallback((ruleId: string) => {
    setStagedRules(rules => rules.filter(r => r.id !== ruleId));
    if (currentlyEditing?.id === ruleId) {
      setCurrentlyEditing(null);
    }
  }, [currentlyEditing]);

  const handleCancelEdit = useCallback(() => {
    setCurrentlyEditing(null);
  }, []);

  /**
   * Reshape a fetched project form into the stored `kobo_tool` shape.
   *
   * Everything downstream -- the rule builder, DK eligibility, label lookups --
   * reads the sheet-row format the XLSX parser produces, so a fetched form is
   * adapted rather than introducing a second shape those consumers would each
   * need to learn.
   */
  const toKoboToolData = (form: KoboProjectForm, language: string): KoboToolData => {
    // One column per translation, exactly as the XLSForm sheet has them, so a
    // fetched form is stored in the same shape an uploaded one produces and the
    // existing label machinery needs no special case.
    const labelColumns = (labels: Record<string, string>) =>
      Object.fromEntries(
        Object.entries(labels).map(([lang, text]) => [labelColumnFor(lang), text])
      );

    const survey = form.questions.map((q) => ({
      type: q.type,
      name: q.name,
      ...labelColumns(q.labels),
      roster_name: q.repeat_name,
      list_name: q.list_name,
    }));

    const choices = Object.entries(form.choice_lists).flatMap(([list_name, options]) =>
      options.map((option) => ({
        list_name,
        name: option.name,
        ...labelColumns(option.labels),
      }))
    );

    const variableMap = new Map(
      form.questions.map((q) => [
        q.name,
        {
          type: q.type,
          label: q.labels[language] || q.name,
          choiceListName: q.list_name,
          roster_name: q.repeat_name,
        },
      ])
    );

    return { survey, choices, variableMap } as KoboToolData;
  };

  // Required to create a survey that can actually run: without a project the
  // ETL has nothing to fetch, and without dates the survey has no period.
  const canCreate = Boolean(
    surveyName.trim() &&
      koboAssetId &&
      globalParameters.data_collection_start_date &&
      globalParameters.data_collection_end_date
  );

  const handleLoadProjectForm = async () => {
    if (!koboAssetId) return;

    setIsLoadingProjectForm(true);
    setProjectFormError(null);
    try {
      const form = await getKoboProjectForm(koboAssetId);
      const language = form.languages[0] || 'default';
      setFormLanguages(form.languages);
      setSelectedLanguage(language);
      setKoboToolData(toKoboToolData(form, language));
      setProjectFormName(form.asset_name || koboAssetId);
    } catch (err) {
      setProjectFormError(err instanceof Error ? err.message : 'Could not read the form.');
      setProjectFormName(null);
    } finally {
      setIsLoadingProjectForm(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const configData: SurveyCreate['config_data'] = {
        core_identifiers: coreIdentifiers,
        sampling_frame: {
          ...samplingFrame,
          frame_data: samplingFrameData,
        },
        special_values: specialValues,
        global_parameters: globalParameters,
        pii_cols: null,
        roster_processing: {
          roster_uuid: '_submission__uuid',
          roster_configs: {},
        },
        kobo_tool: koboToolData ? {
          survey: koboToolData.survey,
          choices: koboToolData.choices,
          label_column_survey: labelColumnFor(selectedLanguage),
          label_column_choices: labelColumnFor(selectedLanguage),
        } : undefined,
      };

      const newSurvey = await createSurvey({
        survey_name: surveyName,
        kobo_asset_id: koboAssetId,
        config_data: configData,
      });
      
      // Save validation rules
      if (stagedRules.length > 0) {
        try {
          for (const rule of stagedRules) {
            const dbRule = stagedRuleToDbFormat(rule);
            await createValidationRule(newSurvey.survey_id, {
              rule_name: rule.description,
              rule_data: dbRule,
              is_active: true,
            });
          }
        } catch (err) {
          console.error('Error saving validation rules:', err);
          // Don't fail the whole operation if rules fail to save
        }
      }
      
      setSuccess('Survey created successfully!');
      
      // Refresh surveys and select the new one
      const surveys = await refreshSurveys();
      const createdSurvey = surveys.find(s => s.survey_id === newSurvey.survey_id);
      if (createdSurvey) {
        // Set the selected survey first
        setSelectedSurvey(createdSurvey);
        setNewlyCreatedSurveyId(newSurvey.survey_id);
        // Show the quality check prompt modal
        // Use a small delay to ensure context state is updated
        setTimeout(() => {
          setShowQualityCheckPrompt(true);
        }, 50);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create survey');
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfigureNow = () => {
    setShowQualityCheckPrompt(false);
    // Set flag in localStorage to open quality tab in settings
    // Also store the survey ID to ensure we're editing the correct survey
    if (newlyCreatedSurveyId) {
      localStorage.setItem('openQualityTab', 'true');
      localStorage.setItem('openQualityTabForSurveyId', newlyCreatedSurveyId);

      // Ensure the survey is properly selected and persisted
      const ensureSurveySelected = async () => {
        try {
          // Refresh surveys to make sure we have the latest list
          const surveyList = await refreshSurveys();
          const targetSurvey = surveyList.find(s => s.survey_id === newlyCreatedSurveyId);

          if (targetSurvey) {
            // Force select the survey multiple times to ensure it sticks
            setSelectedSurvey(targetSurvey);
            localStorage.setItem('selectedSurveyId', newlyCreatedSurveyId);

            // Wait a bit and verify the selection is still correct
            await new Promise(resolve => setTimeout(resolve, 50));

            // Double-check that the survey is still selected
            if (!selectedSurvey || selectedSurvey.survey_id !== newlyCreatedSurveyId) {
              setSelectedSurvey(targetSurvey);
              localStorage.setItem('selectedSurveyId', newlyCreatedSurveyId);
            }

            // Navigate after ensuring selection is stable
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent('navigateToSettings'));
            }, 100);
          } else {
            console.warn('Newly created survey not found in refreshed list');
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent('navigateToSettings'));
            }, 100);
          }
        } catch (err) {
          console.error('Error ensuring survey selection:', err);
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('navigateToSettings'));
          }, 100);
        }
      };

      ensureSurveySelected();
    }
  };

  const handleConfigureLater = () => {
    setShowQualityCheckPrompt(false);

    // Clear flags first
    localStorage.removeItem('openQualityTab');
    localStorage.removeItem('openQualityTabForSurveyId');

    // Ensure the survey is selected before navigating to dashboard
    if (newlyCreatedSurveyId) {
      const ensureSurveySelected = async () => {
        try {
          const surveyList = await refreshSurveys();
          const targetSurvey = surveyList.find(s => s.survey_id === newlyCreatedSurveyId);

          if (targetSurvey) {
            setSelectedSurvey(targetSurvey);
            localStorage.setItem('selectedSurveyId', newlyCreatedSurveyId);

            // Wait and verify
            await new Promise(resolve => setTimeout(resolve, 50));

            if (!selectedSurvey || selectedSurvey.survey_id !== newlyCreatedSurveyId) {
              setSelectedSurvey(targetSurvey);
              localStorage.setItem('selectedSurveyId', newlyCreatedSurveyId);
            }

            setTimeout(() => {
              window.dispatchEvent(new CustomEvent('navigateToDashboard'));
            }, 100);
          } else {
            console.warn('Newly created survey not found in list for dashboard navigation');
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent('navigateToDashboard'));
            }, 100);
          }
        } catch (err) {
          console.error('Error ensuring survey selection for dashboard:', err);
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('navigateToDashboard'));
          }, 100);
        }
      };

      ensureSurveySelected();
    } else {
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('navigateToDashboard'));
      }, 100);
    }

    setNewlyCreatedSurveyId(null);
  };

  const renderVariableDropdown = (
    value: string,
    onChange: (value: string) => void,
    label: string,
    helpKey?: string
  ) => {
    return (
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-400 mb-1">
          {label}
          {helpKey && CORE_IDENTIFIER_HELP[helpKey] && (
            <InfoTip help={CORE_IDENTIFIER_HELP[helpKey]} />
          )}
        </label>
        {availableVariables.length > 0 ? (
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
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Enter variable name"
          />
        )}
      </div>
    );
  };

  const renderAnswerOptionDropdown = (
    value: string,
    onChange: (value: string) => void,
    label: string,
    helpKey?: string
  ) => {
    // Get all unique answer options from choices
    const answerOptions = koboToolData?.choices 
      ? Array.from(new Set(koboToolData.choices.map(choice => choice.name))).sort()
      : [];

    return (
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-400 mb-1">
          {label}
          {helpKey && CORE_IDENTIFIER_HELP[helpKey] && (
            <InfoTip help={CORE_IDENTIFIER_HELP[helpKey]} />
          )}
        </label>
        {answerOptions.length > 0 ? (
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
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Enter answer option"
          />
        )}
      </div>
    );
  };

  return (
    <div className="h-full overflow-y-auto p-4 md:p-8 text-gray-700 dark:text-gray-300">
      <div className="bg-gray-100 dark:bg-gray-850 rounded-xl shadow-2xl p-4 md:p-6 mx-auto max-w-4xl">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white mb-6">Create New Survey</h1>

        <div className="mb-4 space-y-2">
          <ErrorMessage error={error} className="text-base" />
          <SuccessMessage 
            message={success} 
            onDismiss={() => setSuccess(null)}
            autoHide={true}
            autoHideDelay={5000}
          />
        </div>

        <div className="space-y-6">
          {/* Basic Information */}
          <section className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
            <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">Basic Information</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-400 mb-1">
                  Survey Name *
                </label>
                <input
                  type="text"
                  value={surveyName}
                  onChange={(e) => setSurveyName(e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-400 mb-1">
                  Kobo project link *
                  <InfoTip help={KOBO_LINK_HELP} />
                </label>
                <input
                  type="text"
                  value={koboLink}
                  onChange={(e) => setKoboLink(e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="https://kf.kobotoolbox.org/#/forms/aXXXXXXXXXXXXXXXXXXXXX"
                  required
                />
                {koboAssetId ? (
                  <p className="mt-1 text-xs text-green-600 dark:text-green-400">
                    ✓ Project ID: <span className="font-mono">{koboAssetId}</span>
                  </p>
                ) : koboLink.trim() ? (
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                    {looksLikeUrl(koboLink)
                      ? "That link does not contain a project ID. Open your project in Kobo and copy the address bar."
                      : "That is not a Kobo project link or ID."}
                  </p>
                ) : null}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-400 mb-1">
                    Data Collection Start Date *
                  </label>
                  <input
                    type="date"
                    value={globalParameters.data_collection_start_date}
                    onChange={(e) => setGlobalParameters({ ...globalParameters, data_collection_start_date: e.target.value })}
                    className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-400 mb-1">
                    Data Collection End Date *
                  </label>
                  <input
                    type="date"
                    value={globalParameters.data_collection_end_date}
                    onChange={(e) => setGlobalParameters({ ...globalParameters, data_collection_end_date: e.target.value })}
                    className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Survey form */}
          <section className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
            <h2 className="text-xl font-semibold mb-1 text-gray-900 dark:text-white">Survey form</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Field Compass needs your form's questions to fill in the settings below.
            </p>

            <div className="space-y-2">
                <button
                  type="button"
                  onClick={handleLoadProjectForm}
                  disabled={!koboAssetId || isLoadingProjectForm}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed text-sm font-medium flex items-center gap-2"
                >
                  {isLoadingProjectForm ? (
                    <>
                      <Spinner />
                      <span>Reading form...</span>
                    </>
                  ) : (
                    <span>Read form from project</span>
                  )}
                </button>
                {!koboAssetId && (
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    Add your Kobo project link above first.
                  </p>
                )}
                {projectFormName && (
                  <p className="text-sm text-green-600 dark:text-green-400">
                    ✓ {projectFormName} ({availableVariables.length} questions)
                  </p>
                )}
                {projectFormName && formLanguages.length > 0 && (
                  <div className="pt-2">
                    {formLanguages.length > 1 ? (
                      <>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-400 mb-1">
                          Show question labels in
                        </label>
                        <select
                          value={selectedLanguage}
                          onChange={(e) => setSelectedLanguage(e.target.value)}
                          className="w-full sm:w-64 px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                          {formLanguages.map((language) => (
                            <option key={language} value={language}>
                              {language}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                          Your form has {formLanguages.length} translations. This one is used
                          wherever Field Compass shows a question or answer label.
                        </p>
                      </>
                    ) : (
                      // A form with one translation has nothing to choose, but say so --
                      // silence reads as a missing feature. "default" is how Kobo reports
                      // an unnamed translation, which is not a language name to show.
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        {formLanguages[0] === 'default'
                          ? 'Your form has a single, unnamed set of labels.'
                          : `Question labels are shown in ${formLanguages[0]}, the only translation your form carries.`}
                      </p>
                    )}
                  </div>
                )}
                {projectFormError && (
                  <p className="text-sm text-red-600 dark:text-red-400">{projectFormError}</p>
                )}
            </div>
          </section>

          {/* Sampling Frame */}
          <section className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
            <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">Sampling Frame</h2>
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
                    ⚠ Read the form from your Kobo project first, so sampling frame columns can be validated
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
          </section>

          {/* Core Identifiers */}
          <section className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
            <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">Core Identifiers</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {renderVariableDropdown(
                coreIdentifiers.enumerator,
                (value) => setCoreIdentifiers({ ...coreIdentifiers, enumerator: value }),
                'Enumerator ID',
                'enumerator'
              )}
              {renderVariableDropdown(
                coreIdentifiers.consent,
                (value) => setCoreIdentifiers({ ...coreIdentifiers, consent: value }),
                'Consent',
                'consent'
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-400 mb-1">DK Numeric Value
                  <InfoTip help={CORE_IDENTIFIER_HELP.dk_value} />
                </label>
                <input
                  type="number"
                  value={specialValues.dk_value}
                  onChange={(e) => setSpecialValues({ ...specialValues, dk_value: parseInt(e.target.value) || -99 })}
                  className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              {renderAnswerOptionDropdown(
                specialValues.dk_string_value,
                (value) => setSpecialValues({ ...specialValues, dk_string_value: value }),
                'DK String Value',
                'dk_string_value'
              )}
            </div>
          </section>

          {/* Save Button */}
          <div className="flex justify-end gap-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={handleSave}
              disabled={isSaving || !canCreate}
              className="px-6 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed"
            >
              {isSaving ? 'Creating...' : 'Create Survey'}
            </button>
          </div>
        </div>
      </div>
      
      {showQualityCheckPrompt && (
        <QualityCheckPromptModal
          onConfigureNow={handleConfigureNow}
          onConfigureLater={handleConfigureLater}
        />
      )}
    </div>
  );
};

export default CreateSurveyPage;

