import React, { useState } from 'react';
import {
  AI_PRESETS,
  AIConnection,
  AIKeyKind,
  AIPreset,
  createAIConnection,
  describeAIError,
  KEY_KINDS,
  TRANSCRIPTION_PRESETS,
  updateAIConnection,
} from '../../services/aiConnectionsApi';
import Button from '../ui/Button';
import FieldLabel from '../ui/FieldLabel';

interface AIKeyDialogProps {
  /** Editing this key; omit to add one. */
  connection?: AIConnection;
  /** Adding: start on this kind. */
  initialKind?: AIKeyKind;
  onClose: () => void;
  onSaved: (connection: AIConnection) => void;
}

const inputClass =
  'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white';

/**
 * Add or edit a key: the same dialog for both kinds. An AI review key is any
 * OpenAI-compatible provider (a failing test still saves it, marked failing:
 * an endpoint can be down briefly); a transcription key is checked with
 * ElevenLabs first and only saved if accepted.
 */
const AIKeyDialog: React.FC<AIKeyDialogProps> = ({ connection, initialKind = 'review', onClose, onSaved }) => {
  const [kind, setKind] = useState<AIKeyKind>(connection?.kind ?? initialKind);
  const [preset, setPreset] = useState<AIPreset>(
    connection && connection.kind === 'review' ? (connection.preset as AIPreset) : 'openai'
  );
  const [label, setLabel] = useState(connection?.label ?? '');
  const [baseUrl, setBaseUrl] = useState(connection?.base_url ?? AI_PRESETS.openai.baseUrl);
  const [apiKey, setApiKey] = useState('');
  const [checkModel, setCheckModel] = useState(connection?.check_model ?? '');
  const [ruleModel, setRuleModel] = useState(connection?.rule_model ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<AIConnection | null>(null);

  // After a first save that failed its test, further saves edit that key.
  const target = saved ?? connection;
  const isReview = kind === 'review';
  const presetInfo = AI_PRESETS[preset];
  const defaultName = isReview ? presetInfo.name : TRANSCRIPTION_PRESETS.elevenlabs.name;
  const needsKey = !target?.has_api_key && !(isReview && preset === 'self_hosted');

  const choosePreset = (next: AIPreset) => {
    setPreset(next);
    setBaseUrl(AI_PRESETS[next].baseUrl);
    if (!label || Object.values(AI_PRESETS).some((p) => p.name === label)) setLabel(AI_PRESETS[next].name);
  };

  const canSave = isReview
    ? Boolean(baseUrl.trim() && checkModel.trim() && (!needsKey || apiKey.trim()))
    : Boolean(target || apiKey.trim().length >= 20);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    const name = label.trim() || defaultName;
    const input = isReview
      ? {
          kind,
          label: name,
          preset,
          base_url: baseUrl.trim(),
          check_model: checkModel.trim(),
          rule_model: ruleModel.trim() || null,
          ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
        }
      : { kind, label: name, preset: 'elevenlabs' as const, ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}) };
    try {
      const result = target ? await updateAIConnection(target.connection_id, input) : await createAIConnection(input);
      setSaved(result);
      setApiKey('');
      onSaved(result);
      if (result.status !== 'failing') onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the key.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/40 p-4 backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-key-dialog-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-gray-200 bg-white p-6 shadow-popover animate-fade-in dark:border-gray-800 dark:bg-gray-900"
      >
        <h2 id="ai-key-dialog-title" className="mb-4 text-base font-semibold tracking-tight text-gray-900 dark:text-white">
          {target ? `Edit ${KEY_KINDS[kind].name.toLowerCase()} key` : 'Add a key'}
        </h2>

        <div className="space-y-4">
          {!target && (
            <fieldset>
              <legend className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">For</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {(Object.keys(KEY_KINDS) as AIKeyKind[]).map((option) => (
                  <label
                    key={option}
                    className={`cursor-pointer rounded-lg border px-3 py-2.5 text-sm ${
                      kind === option
                        ? 'border-indigo-500 bg-indigo-50/60 ring-1 ring-indigo-500 dark:bg-indigo-500/10'
                        : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'
                    }`}
                  >
                    <input
                      type="radio"
                      name="key-kind"
                      value={option}
                      checked={kind === option}
                      onChange={() => setKind(option)}
                      className="sr-only"
                    />
                    <span className="block font-medium text-gray-900 dark:text-white">{KEY_KINDS[option].name}</span>
                    <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">{KEY_KINDS[option].does}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <div>
            <FieldLabel htmlFor="ai-key-provider" hint={isReview ? presetInfo.note : TRANSCRIPTION_PRESETS.elevenlabs.note}>
              Provider
            </FieldLabel>
            {isReview ? (
              <select
                id="ai-key-provider"
                value={preset}
                onChange={(e) => choosePreset(e.target.value as AIPreset)}
                className={inputClass}
                disabled={!!target}
              >
                {(Object.keys(AI_PRESETS) as AIPreset[]).map((key) => (
                  <option key={key} value={key}>
                    {AI_PRESETS[key].name}
                  </option>
                ))}
              </select>
            ) : (
              <select id="ai-key-provider" value="elevenlabs" className={inputClass} onChange={() => undefined}>
                <option value="elevenlabs">ElevenLabs</option>
              </select>
            )}
          </div>

          <div>
            <FieldLabel htmlFor="ai-key-name">Name</FieldLabel>
            <input id="ai-key-name" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={defaultName} className={inputClass} />
          </div>

          {isReview && (
            <div>
              <FieldLabel htmlFor="ai-key-base-url">Address (base URL)</FieldLabel>
              <input
                id="ai-key-base-url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://…/v1"
                className={inputClass}
              />
            </div>
          )}

          <div>
            <FieldLabel htmlFor="ai-key-secret">
              API key{isReview && preset === 'self_hosted' ? ' (if your server needs one)' : ''}
            </FieldLabel>
            <input
              id="ai-key-secret"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={target?.api_key_hint ? `••••${target.api_key_hint} (leave empty to keep)` : isReview ? '' : 'sk_…'}
              className={`${inputClass} font-mono`}
            />
          </div>

          {isReview && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="ai-key-check-model">Model for reviews</FieldLabel>
                <input
                  id="ai-key-check-model"
                  value={checkModel}
                  onChange={(e) => setCheckModel(e.target.value)}
                  placeholder={presetInfo.modelHint}
                  className={inputClass}
                />
              </div>
              <div>
                <FieldLabel htmlFor="ai-key-rule-model">Model for rule writing</FieldLabel>
                <input
                  id="ai-key-rule-model"
                  value={ruleModel}
                  onChange={(e) => setRuleModel(e.target.value)}
                  placeholder="Same as reviews"
                  className={inputClass}
                />
              </div>
            </div>
          )}

          <p className="text-xs text-gray-500 dark:text-gray-400">
            The key is checked with the provider, stored encrypted, and never shown again. Your provider bills you for what
            the surveys you choose use.
          </p>
        </div>

        <div role="status" aria-live="polite" className="mt-4 space-y-2">
          {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">{error}</p>}
          {saved && saved.status === 'failing' && (
            <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
              Saved, but the check failed: {describeAIError(saved.last_error)}
              {saved.test?.error && <span className="mt-1 block text-xs">Provider message: {saved.test.error}</span>}
            </p>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            {saved ? 'Close' : 'Cancel'}
          </Button>
          <Button variant="primary" onClick={handleSave} loading={isSaving} disabled={!canSave}>
            {isSaving ? 'Checking…' : 'Save and check'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default AIKeyDialog;
