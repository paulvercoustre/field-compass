
import React, { useState, useCallback, useContext } from 'react';
import { KoboToolData, StagedRule, GlobalParameters } from '../types';
import { parseKoboTool } from '../services/koboParser';
import { generateUUID } from '../utils/uuid';
import { saveJsonToFile } from '../utils/file';
import RuleEditor from '../components/rule-builder/RuleEditor';
import StagedRulesList from '../components/rule-builder/StagedRulesList';
import GlobalParametersForm from '../components/rule-builder/GlobalParameters';
import AINaturalLanguageInput from '../components/rule-builder/AINaturalLanguageInput';
import AISuggestedRules from '../components/rule-builder/AISuggestedRules';
import ErrorMessage from '../components/ui/ErrorMessage';
import { SurveyContext } from '../contexts/SurveyContext';

const RuleBuilder: React.FC = () => {
  const { selectedSurvey } = useContext(SurveyContext);
  const [koboToolData, setKoboToolData] = useState<KoboToolData | null>(null);
  const [stagedRules, setStagedRules] = useState<StagedRule[]>([]);
  const [currentlyEditing, setCurrentlyEditing] = useState<StagedRule | null>(null);
  const [globalParams, setGlobalParams] = useState<GlobalParameters>({
    data_collection_start_date: '',
    data_collection_end_date: '',
    min_survey_duration_minutes: null,
    max_survey_duration_minutes: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setError(null);
    setKoboToolData(null);
    setStagedRules([]);
    setCurrentlyEditing(null);

    try {
      const data = await parseKoboTool(file);
      setKoboToolData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred during file parsing.');
    } finally {
      setIsLoading(false);
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

  const handleAIRuleGenerated = useCallback((rule: StagedRule) => {
    if (currentlyEditing) {
      setCurrentlyEditing(null);
    }
    setStagedRules(rules => [...rules, rule]);
  }, [currentlyEditing]);

  const handleAISuggestedRulesAdded = useCallback((rules: StagedRule[]) => {
    setStagedRules(existingRules => [...existingRules, ...rules]);
  }, []);

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

  const handleSaveAllRules = () => {
    setSaveError(null);
    if (stagedRules.length === 0) {
      setSaveError("No rules to save. Please create at least one rule.");
      return;
    }
    try {
      saveJsonToFile(globalParams, stagedRules, koboToolData?.variableMap);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save rules');
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 md:p-8 text-gray-700 dark:text-gray-300">
      <div className="mx-auto max-w-screen-2xl">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left Column */}
          <div className="lg:col-span-2 space-y-8">
            <section className="p-6 bg-gray-100 dark:bg-gray-850 rounded-lg border border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Step 1: Load Kobo Tool</h2>
              <p className="text-gray-600 dark:text-gray-400 mb-4">Upload your Kobo tool Excel file (.xlsx) to populate the variable lists.</p>
              <input 
                type="file" 
                id="kobo-tool-upload" 
                accept=".xlsx, .xls"
                onChange={handleFileUpload}
                className="block w-full text-sm text-gray-600 dark:text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-indigo-600 file:text-white hover:file:bg-indigo-500"
              />
              {isLoading && <p className="mt-4 text-blue-600 dark:text-blue-400">Parsing Kobo tool...</p>}
              {error && <p className="mt-4 text-red-600 dark:text-red-400">{error}</p>}
              {koboToolData && <p className="mt-4 text-green-600 dark:text-green-400">Successfully loaded {koboToolData.survey.length} relevant questions.</p>}
            </section>
            
            {koboToolData && (
              <>
                <section className="p-6 bg-gray-100 dark:bg-gray-850 rounded-lg border border-gray-200 dark:border-gray-700">
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Step 2: Set Global Survey Parameters</h2>
                  <GlobalParametersForm params={globalParams} onParamsChange={setGlobalParams} />
                </section>

                {selectedSurvey && (
                  <section className="p-6 bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-gray-850 dark:to-gray-900 rounded-lg border-2 border-indigo-200 dark:border-indigo-800">
                    <div className="flex items-center mb-4">
                      <span className="text-2xl mr-2">✨</span>
                      <h2 className="text-xl font-bold text-gray-900 dark:text-white">AI Rule Builder</h2>
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
                  </section>
                )}

                <section className="p-6 bg-gray-100 dark:bg-gray-850 rounded-lg border border-gray-200 dark:border-gray-700">
                   <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">{currentlyEditing ? 'Edit Rule' : 'Step 3: Define a Rule Manually'}</h2>
                  <RuleEditor 
                    key={currentlyEditing?.id ?? 'new-rule'}
                    koboToolData={koboToolData}
                    onSave={handleSaveRule}
                    onCancel={handleCancelEdit}
                    editingRule={currentlyEditing}
                  />
                </section>
              </>
            )}
          </div>

          {/* Right Column */}
          {koboToolData && (
            <div className="lg:col-span-1 space-y-8">
              {selectedSurvey && (
                <section className="p-6 bg-gradient-to-br from-purple-50 to-pink-50 dark:from-gray-850 dark:to-gray-900 rounded-lg border-2 border-purple-200 dark:border-purple-800 sticky top-8">
                  <div className="flex items-center mb-4">
                    <span className="text-2xl mr-2">💡</span>
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white">AI Suggestions</h2>
                  </div>
                  <AISuggestedRules 
                    surveyId={selectedSurvey.survey_id}
                    onRulesAdded={handleAISuggestedRulesAdded}
                  />
                </section>
              )}

              <section className="p-6 bg-gray-100 dark:bg-gray-850 rounded-lg border border-gray-200 dark:border-gray-700">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Staged Rules</h2>
                <StagedRulesList 
                  rules={stagedRules}
                  onEdit={handleEditRule}
                  onDelete={handleDeleteRule}
                />
                <div className="mt-6">
                  <ErrorMessage error={saveError} className="mb-2" />
                  <button 
                    onClick={handleSaveAllRules}
                    disabled={stagedRules.length === 0}
                    className="w-full px-4 py-2 font-bold text-white bg-green-600 rounded-md disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed hover:bg-green-500 transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-gray-900"
                  >
                    Save All Rules to JSON
                  </button>
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default RuleBuilder;