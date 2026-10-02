import React, { useState } from 'react';
import {
  AI_PRESETS,
  AIConnection,
  AIPreset,
  createAIConnection,
  describeAIError,
  updateAIConnection,
} from '../../services/aiConnectionsApi';

interface AIProviderDialogProps {
  /** Editing this one; omit to add a new provider. */
  connection?: AIConnection;
  onClose: () => void;
  /** Called after a save, passing or failing its test. */
  onSaved: (connection: AIConnection) => void;
}

const inputClass =
  'w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500';
const labelClass = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1';

/**
 * Add or edit an OpenAI-compatible AI provider. Saving tests it in place; a
 * failing provider is still saved (an endpoint can be down briefly) and is
 * shown as failing.
 */
const AIProviderDialog: React.FC<AIProviderDialogProps> = ({ connection, onClose, onSaved }) => {
  const [preset, setPreset] = useState<AIPreset>(connection?.preset ?? 'openai');
  const [label, setLabel] = useState(connection?.label ?? '');
  const [baseUrl, setBaseUrl] = useState(connection?.base_url ?? AI_PRESETS.openai.baseUrl);
  const [apiKey, setApiKey] = useState('');
  const [checkModel, setCheckModel] = useState(connection?.check_model ?? '');
  const [ruleModel, setRuleModel] = useState(connection?.rule_model ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<AIConnection | null>(null);

  // After a first save (say, with a failing test), further saves edit that
  // provider instead of adding a second one.
  const target = saved ?? connection;
  const presetInfo = AI_PRESETS[preset];
  const needsKey = !target?.has_api_key && preset !== 'self_hosted';

  const choosePreset = (next: AIPreset) => {
    setPreset(next);
    setBaseUrl(AI_PRESETS[next].baseUrl);
    if (!label || Object.values(AI_PRESETS).some((p) => p.name === label)) {
      setLabel(AI_PRESETS[next].name);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    const input = {
      label: label.trim() || presetInfo.name,
      preset,
      base_url: baseUrl.trim(),
      check_model: checkModel.trim(),
      rule_model: ruleModel.trim() || null,
      ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
    };
    try {
      const result = target
        ? await updateAIConnection(target.connection_id, input)
        : await createAIConnection(input);
      setSaved(result);
      setApiKey('');
      onSaved(result);
      if (result.status === 'ok') onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the provider.');
    } finally {
      setIsSaving(false);
    }
  };

  const canSave = Boolean(baseUrl.trim() && checkModel.trim() && (!needsKey || apiKey.trim()));

  return (
    <div className="fixed inset-0 bg-gray-950/40 backdrop-blur-[2px] flex items-center justify-center z-50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-provider-dialog-title"
        className="bg-white dark:bg-gray-900 rounded-xl p-6 max-w-lg w-full border border-gray-200 dark:border-gray-800 shadow-popover animate-fade-in max-h-[90vh] overflow-y-auto"
      >
        <h2 id="ai-provider-dialog-title" className="text-base font-semibold tracking-tight text-gray-900 dark:text-white mb-1">
          {target ? 'Edit AI provider' : 'Add an AI provider'}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Any OpenAI-compatible service. AI checks on surveys that use it are billed to this account.
        </p>

        <div className="space-y-4">
          <div>
            <label htmlFor="ai-preset" className={labelClass}>Provider</label>
            <select
              id="ai-preset"
              value={preset}
              onChange={(e) => choosePreset(e.target.value as AIPreset)}
              className={inputClass}
            >
              {(Object.keys(AI_PRESETS) as AIPreset[]).map((key) => (
                <option key={key} value={key}>{AI_PRESETS[key].name}</option>
              ))}
            </select>
            {presetInfo.note && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{presetInfo.note}</p>}
          </div>

          <div>
            <label htmlFor="ai-label" className={labelClass}>Name</label>
            <input
              id="ai-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={presetInfo.name}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="ai-base-url" className={labelClass}>Address (base URL)</label>
            <input
              id="ai-base-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://…/v1"
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="ai-key" className={labelClass}>
              API key{preset === 'self_hosted' ? ' (if your server needs one)' : ''}
            </label>
            <input
              id="ai-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={target?.api_key_hint ? `••••${target.api_key_hint} — leave empty to keep` : ''}
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="ai-check-model" className={labelClass}>Model for checks</label>
              <input
                id="ai-check-model"
                value={checkModel}
                onChange={(e) => setCheckModel(e.target.value)}
                placeholder={presetInfo.modelHint}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="ai-rule-model" className={labelClass}>Model for rule writing</label>
              <input
                id="ai-rule-model"
                value={ruleModel}
                onChange={(e) => setRuleModel(e.target.value)}
                placeholder="Same as checks"
                className={inputClass}
              />
            </div>
          </div>
        </div>

        <div role="status" aria-live="polite" className="mt-4 space-y-2">
          {error && (
            <p className="p-3 text-sm rounded-md bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400">{error}</p>
          )}
          {saved && saved.status !== 'ok' && (
            <p className="p-3 text-sm rounded-md bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300">
              Saved, but the test failed: {describeAIError(saved.last_error)}
              {saved.test?.error && <span className="block mt-1 text-xs">Provider message: {saved.test.error}</span>}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="px-4 py-2 text-sm font-medium bg-white text-gray-900 border border-gray-300 shadow-xs rounded-md hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            {saved ? 'Close' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || !canSave}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? 'Saving and testing…' : 'Save and test'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIProviderDialog;
