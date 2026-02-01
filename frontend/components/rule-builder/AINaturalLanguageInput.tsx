import React, { useState } from 'react';
import { StagedRule } from '../../types';
import { generateRuleFromNaturalLanguage } from '../../services/aiApi';
import { generateUUID } from '../../utils/uuid';
import ErrorMessage from '../ui/ErrorMessage';
import SuccessMessage from '../ui/SuccessMessage';

interface AINaturalLanguageInputProps {
  surveyId: string;
  onRuleGenerated: (rule: StagedRule) => void;
}

const EXAMPLE_PROMPTS = [
  "Flag if respondent age is greater than 100",
  "Flag any survey completed in under 10 minutes",
  "Check if consent is not given",
  "Flag if income is negative or over 1 million",
  "Flag interviews conducted on weekends",
];

const AINaturalLanguageInput: React.FC<AINaturalLanguageInputProps> = ({
  surveyId,
  onRuleGenerated,
}) => {
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedRule, setGeneratedRule] = useState<StagedRule | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError('Please enter a rule description');
      return;
    }

    setIsGenerating(true);
    setError(null);
    setGeneratedRule(null);
    setShowSuccess(false);

    try {
      const ruleData = await generateRuleFromNaturalLanguage(surveyId, prompt);
      const ruleWithId: StagedRule = {
        ...ruleData,
        id: generateUUID(),
      };
      setGeneratedRule(ruleWithId);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to generate rule';
      // Check for specific error types and provide better messages
      if (errorMessage.includes('Not authenticated')) {
        setError('Authentication error. Please try refreshing the page and logging in again.');
      } else if (errorMessage.includes('AI service is not available')) {
        setError('AI service is not configured. Please contact your administrator to set up the OpenAI API key.');
      } else {
        setError(errorMessage);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAccept = () => {
    if (generatedRule) {
      onRuleGenerated(generatedRule);
      setShowSuccess(true);
      setGeneratedRule(null);
      setPrompt('');
      
      setTimeout(() => setShowSuccess(false), 3000);
    }
  };

  const handleReject = () => {
    setGeneratedRule(null);
  };

  const handleUseExample = (example: string) => {
    setPrompt(example);
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleGenerate();
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="ai-prompt" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Describe your rule in plain English
        </label>
        <textarea
          id="ai-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyPress}
          placeholder="Example: Flag if respondent age is greater than 100"
          disabled={isGenerating}
          className="w-full h-24 px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Press Cmd/Ctrl+Enter to generate, or click the button below
        </p>
      </div>

      <div>
        <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Quick examples:</p>
        <div className="flex flex-wrap gap-2">
          {EXAMPLE_PROMPTS.map((example, index) => (
            <button
              key={index}
              onClick={() => handleUseExample(example)}
              disabled={isGenerating}
              className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {example}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={handleGenerate}
        disabled={isGenerating || !prompt.trim()}
        className="w-full px-4 py-2 font-bold text-white bg-indigo-600 rounded-md hover:bg-indigo-500 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-gray-900"
      >
        {isGenerating ? (
          <span className="flex items-center justify-center">
            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Generating...
          </span>
        ) : (
          '✨ Generate Rule with AI'
        )}
      </button>

      {error && <ErrorMessage error={error} />}

      {showSuccess && (
        <SuccessMessage message="Rule added to editor successfully!" />
      )}

      {generatedRule && (
        <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md space-y-3">
          <div className="flex items-start justify-between">
            <h4 className="font-semibold text-blue-900 dark:text-blue-100">Generated Rule</h4>
            <span className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-800 text-blue-700 dark:text-blue-200 rounded">
              AI Generated
            </span>
          </div>

          <div className="space-y-2">
            <div>
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400">Name:</p>
              <p className="text-sm text-gray-900 dark:text-gray-100">{generatedRule.description}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400">Issue Message:</p>
              <p className="text-sm text-gray-900 dark:text-gray-100">{generatedRule.issue_message}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400">Conditions:</p>
              <div className="text-xs font-mono bg-white dark:bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-700">
                {generatedRule.conditions.map((condition, idx) => {
                  if ('joiner' in condition) {
                    return (
                      <span key={idx} className="text-purple-600 dark:text-purple-400 font-bold mx-1">
                        {condition.joiner === '&' ? 'AND' : 'OR'}
                      </span>
                    );
                  }
                  return (
                    <span key={idx}>
                      <span className="text-blue-600 dark:text-blue-400">{condition.variable}</span>
                      <span className="text-gray-500 dark:text-gray-400"> {condition.operator} </span>
                      <span className="text-green-600 dark:text-green-400">{condition.value}</span>
                    </span>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex space-x-3 pt-2">
            <button
              onClick={handleAccept}
              className="flex-1 px-4 py-2 font-medium text-white bg-green-600 rounded-md hover:bg-green-500 transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-gray-900"
            >
              ✓ Accept & Add to Editor
            </button>
            <button
              onClick={handleReject}
              className="flex-1 px-4 py-2 font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-gray-900"
            >
              ✗ Reject
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AINaturalLanguageInput;
