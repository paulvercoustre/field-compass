import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSurvey } from '../contexts/SurveyContext';
import { useNavigation } from '../contexts/NavigationContext';
import { createSurvey, Survey, SurveyCreate } from '../services/progressApi';
import { KoboToolData } from '../types';
import { Spinner } from '../components/Spinner';
import ErrorMessage from '../components/ui/ErrorMessage';
import SuccessMessage from '../components/ui/SuccessMessage';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { parseKoboAssetId, labelColumnFor } from '../utils/koboUrl';
import { getKoboProjectForm, KoboProject } from '../services/api';
import KoboProjectPicker from '../components/ui/KoboProjectPicker';
import CollectionTargetsEditor from '../components/ui/CollectionTargetsEditor';
import { useCollectionTargets } from '../hooks/useCollectionTargets';
import VariableDropdown from '../components/ui/VariableDropdown';
import { autoFillIdentifier } from '../utils/identifierSuggestions';
import DkStringValues from '../components/ui/DkStringValues';
import DkNumericCodes from '../components/ui/DkNumericCodes';
import { findDkValues } from '../services/lintApi';
import FormLintPanel from '../components/linter/FormLintPanel';
import { koboToolPayload, projectFormToKoboTool } from '../utils/koboForm';

const CreateSurveyPage: React.FC = () => {
  const { refreshSurveys, setSelectedSurvey } = useSurvey();
  const { navigate } = useNavigation();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showQualityCheckPrompt, setShowQualityCheckPrompt] = useState(false);
  const [createdSurvey, setCreatedSurvey] = useState<Survey | null>(null);

  // Kobo tool state
  const [koboToolData, setKoboToolData] = useState<KoboToolData | null>(null);
  const targets = useCollectionTargets(koboToolData);
  const [availableVariables, setAvailableVariables] = useState<string[]>([]);
  // The form's choice rows, carrying names and their label columns.
  const choiceRows: Array<Record<string, any>> = (koboToolData?.choices as any[]) || [];
  const surveyRows: Array<Record<string, any>> = (koboToolData?.survey as any[]) || [];

  // Sampling frame CSV state

  // Form state
  const [surveyName, setSurveyName] = useState('');
  // The user picks their project from a list, or pastes the link to it; the
  // identifier is derived either way. Kobo's own interface never shows the
  // term "asset ID", so asking for one asks people to know a word they have
  // never seen.
  const [koboLink, setKoboLink] = useState('');
  const koboAssetId = parseKoboAssetId(koboLink);
  // The name last filled in from a picked project. Picking another project
  // replaces it, but never a name the user typed.
  const autoFilledName = useRef<string | null>(null);

  const handleProjectChange = (value: string, project?: KoboProject) => {
    setKoboLink(value);
    if (project && (!surveyName.trim() || surveyName === autoFilledName.current)) {
      setSurveyName(project.name);
      autoFilledName.current = project.name;
    }
  };

  const [isLoadingProjectForm, setIsLoadingProjectForm] = useState(false);
  const [projectFormError, setProjectFormError] = useState<string | null>(null);
  const [projectFormName, setProjectFormName] = useState<string | null>(null);
  // Which translation to show. The form tells us which exist, so this is a
  // choice between real languages rather than a spreadsheet column name.
  const [formLanguages, setFormLanguages] = useState<string[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState<string>('');
  const [coreIdentifiers, setCoreIdentifiers] = useState({
    uuid: '_uuid', // always supplied by Kobo as submission metadata
    // Form-dependent: never pre-fill a field the user did not choose. A form
    // may name these anything, or not have them at all. These stay empty until
    // a form is read and a conventional name is found in it -- see the effect
    // below. Filling them here would save a guess made before the app had seen
    // the form it claims to describe.
    enumerator: '',
    date_interview: '',
    start_time: '',
    end_time: '',
    consent: '',
  });
  const [specialValues, setSpecialValues] = useState({
    // The common convention, pre-filled; removable, as a form may have none.
    dk_value: [-99] as number[],
    // Empty until a form is read: `dk` was a blind default like the identifier
    // ones, set whether or not the form had such an option.
    dk_string_value: [] as string[],
  });
  const [globalParameters, setGlobalParameters] = useState({
    data_collection_start_date: '',
    data_collection_end_date: '',
    min_survey_duration_minutes: null as number | null,
    max_survey_duration_minutes: null as number | null,
  });

  useEffect(() => {
    // Update available variables when tool is loaded
    if (koboToolData && koboToolData.variableMap) {
      // `variableMap` is loosely typed, so its keys arrive as `unknown`. They
      // are question names and nothing else.
      const vars = Array.from(koboToolData.variableMap.keys()) as string[];
      setAvailableVariables(vars);

      // Pre-select a conventional name only when the form actually contains a
      // question by that name, and only when exactly one candidate matches.
      // That is a verified, unambiguous match rather than a guess -- unlike a
      // blind default, which silently points the config at a question that may
      // not exist.
      //
      // Where several candidates match there is no basis for choosing, so the
      // field stays empty and the dropdown shows them all under "Suggested".
      // A field that already looks answered is one nobody re-reads.
      //
      // Only fields the user has not already touched are filled, so re-reading
      // the form does not overwrite a deliberate choice.
      setCoreIdentifiers((prev) => {
        const updated = { ...prev };
        (['enumerator', 'consent', 'date_interview', 'start_time', 'end_time'] as const).forEach((field) => {
          if (prev[field]) {
            return;
          }
          const match = autoFillIdentifier(vars, field);
          if (match) {
            updated[field] = match;
          }
        });
        return updated;
      });

      // Don't-know codings differ from identifiers in one way: several matches
      // are not an ambiguity. A form can genuinely carry both `dk` and
      // `dont_know` for the same answer, and counting only one understates the
      // DK rate, so every match is selected rather than none. Found by the
      // same rules the form check uses, so the two never disagree.
      let cancelled = false;
      findDkValues((koboToolData.survey as any[]) || [], (koboToolData.choices as any[]) || [])
        .then((found) => {
          if (cancelled || found.length === 0) return;
          setSpecialValues((prev) =>
            prev.dk_string_value.length > 0 ? prev : { ...prev, dk_string_value: found.map((value) => value.name) }
          );
        })
        .catch(() => {
          // Leave the field empty; the user can still pick options by hand.
        });
      return () => {
        cancelled = true;
      };
    }
  }, [koboToolData]);

  // Required to create a survey that can actually run: without a project the
  // ETL has nothing to fetch.
  //
  // Collection dates are NOT required, deliberately reversing part of #44.
  // They are often not fixed when the survey is set up, and blocking creation
  // on them pushes people to type a placeholder date -- which is worse than an
  // empty one, because `date_out_of_range` would then flag real submissions
  // against a date nobody meant. Unset simply means that check does not run.
  const canCreate = Boolean(surveyName.trim() && koboAssetId);
  const lintFormPayload = useMemo(() => koboToolPayload(koboToolData), [koboToolData]);

  // The project the form on screen was read for, and the one being read now,
  // so a link edited mid-read cannot land the wrong project's form.
  const readForAssetId = useRef<string | null>(null);

  const handleLoadProjectForm = useCallback(
    async (assetId: string | null = koboAssetId) => {
      if (!assetId) return;

      readForAssetId.current = assetId;
      setIsLoadingProjectForm(true);
      setProjectFormError(null);
      try {
        const form = await getKoboProjectForm(assetId);
        if (readForAssetId.current !== assetId) return;
        const language = form.languages[0] || 'default';
        setFormLanguages(form.languages);
        setSelectedLanguage(language);
        setKoboToolData(projectFormToKoboTool(form, language));
        setProjectFormName(form.asset_name || assetId);
      } catch (err) {
        if (readForAssetId.current !== assetId) return;
        setProjectFormError(err instanceof Error ? err.message : 'Could not read the form.');
        setProjectFormName(null);
      } finally {
        if (readForAssetId.current === assetId) setIsLoadingProjectForm(false);
      }
    },
    [koboAssetId]
  );

  // Read the form as soon as the link names a project -- no button needed.
  // Short pause so typing a link character by character does not fire a
  // request per keystroke; the button stays for retrying after an error.
  useEffect(() => {
    if (!koboAssetId || koboAssetId === readForAssetId.current) return;
    const timer = setTimeout(() => handleLoadProjectForm(koboAssetId), 500);
    return () => clearTimeout(timer);
  }, [koboAssetId, handleLoadProjectForm]);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const configData: SurveyCreate['config_data'] = {
        core_identifiers: coreIdentifiers,
        sampling_frame: targets.toConfig(),
        special_values: specialValues,
        global_parameters: globalParameters,
        pii_cols: null,
        roster_processing: {
          roster_uuid: '_submission__uuid',
          roster_configs: {},
        },
        kobo_tool: koboToolData
          ? {
              survey: koboToolData.survey,
              choices: koboToolData.choices,
              has_audit: koboToolData.has_audit ?? null,
              label_column_survey: labelColumnFor(selectedLanguage),
              label_column_choices: labelColumnFor(selectedLanguage),
            }
          : undefined,
      };

      const newSurvey = await createSurvey({
        survey_name: surveyName,
        kobo_asset_id: koboAssetId,
        config_data: configData,
      });

      setSuccess('Survey created successfully!');

      // Select the new survey, then ask whether to set up its checks now.
      const surveys = await refreshSurveys();
      const created = surveys.find((s) => s.survey_id === newSurvey.survey_id);
      if (created) {
        setSelectedSurvey(created);
        setCreatedSurvey(created);
        setShowQualityCheckPrompt(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create survey');
    } finally {
      setIsSaving(false);
    }
  };

  /** Leave for the new survey's quality checks, or for its submissions. */
  const leaveFor = (view: 'settings' | 'dashboard') => {
    setShowQualityCheckPrompt(false);
    navigate({
      view,
      survey: createdSurvey ?? undefined,
      tab: view === 'settings' ? 'quality' : undefined,
    });
  };
  const handleConfigureNow = () => leaveFor('settings');
  const handleConfigureLater = () => leaveFor('dashboard');

  return (
    <div className="h-full overflow-y-auto p-4 md:p-8 text-gray-700 dark:text-gray-300">
      <div className="mx-auto max-w-3xl py-2">
        <h1 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-white mb-6">New survey</h1>

        <div className="mb-4 space-y-2">
          <ErrorMessage error={error} className="text-base" />
          <SuccessMessage message={success} onDismiss={() => setSuccess(null)} autoHide={true} autoHideDelay={5000} />
        </div>

        <div className="space-y-6">
          {/* Basic Information */}
          <section className="bg-white dark:bg-gray-900 p-5 rounded-xl border border-gray-200 dark:border-gray-800 shadow-card">
            <h2 className="text-base font-semibold tracking-tight mb-4 text-gray-900 dark:text-white">
              Basic information
            </h2>
            <div className="space-y-4">
              <KoboProjectPicker value={koboLink} onChange={handleProjectChange} />
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Survey name *
                </label>
                <input
                  type="text"
                  value={surveyName}
                  onChange={(e) => setSurveyName(e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md shadow-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  required
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Collection start date
                  </label>
                  <input
                    type="date"
                    value={globalParameters.data_collection_start_date}
                    onChange={(e) =>
                      setGlobalParameters({ ...globalParameters, data_collection_start_date: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md shadow-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Collection end date
                  </label>
                  <input
                    type="date"
                    value={globalParameters.data_collection_end_date}
                    onChange={(e) =>
                      setGlobalParameters({ ...globalParameters, data_collection_end_date: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md shadow-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Survey form */}
          <section className="bg-white dark:bg-gray-900 p-5 rounded-xl border border-gray-200 dark:border-gray-800 shadow-card">
            <h2 className="text-base font-semibold tracking-tight mb-4 text-gray-900 dark:text-white">Survey form</h2>

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => handleLoadProjectForm(koboAssetId)}
                disabled={!koboAssetId || isLoadingProjectForm}
                className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium flex items-center gap-2"
              >
                {isLoadingProjectForm ? (
                  <>
                    <Spinner size="sm" className="text-current" />
                    <span>Reading form...</span>
                  </>
                ) : (
                  <span>{projectFormName ? 'Read form again' : 'Read form from project'}</span>
                )}
              </button>
              {!koboAssetId && (
                <p className="text-xs text-gray-600 dark:text-gray-400">Choose your Kobo project above first.</p>
              )}
              {projectFormName && (
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{projectFormName}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{availableVariables.length} questions</p>
                </div>
              )}
              {formLanguages.length > 1 && (
                <div className="pt-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Show question labels in
                  </label>
                  <select
                    value={selectedLanguage}
                    onChange={(e) => setSelectedLanguage(e.target.value)}
                    className="w-full sm:w-64 px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md shadow-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {formLanguages.map((language) => (
                      <option key={language} value={language}>
                        {language}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {projectFormError && <p className="text-sm text-red-600 dark:text-red-400">{projectFormError}</p>}
            </div>
          </section>

          {lintFormPayload && (
            <FormLintPanel
              form={lintFormPayload}
              autoRunKey
              labelColumn={selectedLanguage ? labelColumnFor(selectedLanguage) : null}
            />
          )}

          {/* Collection Targets */}
          <section className="bg-white dark:bg-gray-900 p-5 rounded-xl border border-gray-200 dark:border-gray-800 shadow-card">
            <h2 className="text-base font-semibold tracking-tight mb-4 text-gray-900 dark:text-white">
              Data collection targets
            </h2>
            <div className="space-y-4">
              <CollectionTargetsEditor targets={targets} koboToolData={koboToolData} />
            </div>
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
              />
              <VariableDropdown
                value={coreIdentifiers.consent}
                onChange={(value) => setCoreIdentifiers({ ...coreIdentifiers, consent: value })}
                label="Consent"
                helpKey="consent"
                availableVariables={availableVariables}
              />
              <VariableDropdown
                value={coreIdentifiers.start_time}
                onChange={(value) => setCoreIdentifiers({ ...coreIdentifiers, start_time: value })}
                label="Start time"
                helpKey="start_time"
                availableVariables={availableVariables}
              />
              <VariableDropdown
                value={coreIdentifiers.end_time}
                onChange={(value) => setCoreIdentifiers({ ...coreIdentifiers, end_time: value })}
                label="End time"
                helpKey="end_time"
                availableVariables={availableVariables}
              />
              <VariableDropdown
                value={coreIdentifiers.date_interview}
                onChange={(value) => setCoreIdentifiers({ ...coreIdentifiers, date_interview: value })}
                label="Interview date"
                helpKey="date_interview"
                availableVariables={availableVariables}
              />
              <DkNumericCodes
                codes={specialValues.dk_value}
                onChange={(codes) => setSpecialValues({ ...specialValues, dk_value: codes })}
              />
              <DkStringValues
                values={specialValues.dk_string_value}
                onChange={(values) => setSpecialValues({ ...specialValues, dk_string_value: values })}
                survey={surveyRows}
                choices={choiceRows}
              />
            </div>
          </section>

          {/* Save Button */}
          <div className="flex justify-end gap-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={handleSave}
              disabled={isSaving || !canCreate}
              className="px-6 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? 'Creating...' : 'Create survey'}
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={showQualityCheckPrompt}
        title="Set up quality checks"
        tone="primary"
        confirmLabel="Set up now"
        cancelLabel="Later"
        onConfirm={handleConfigureNow}
        onCancel={handleConfigureLater}
      >
        <p>Survey created. Set up its quality checks now?</p>
      </ConfirmDialog>
    </div>
  );
};

export default CreateSurveyPage;
