import React, { useState } from 'react';
import { useAuth, KoboUser } from '../../contexts/AuthContext';

/**
 * The public KoboToolbox servers. The humanitarian server
 * (kobo.humanitarianresponse.info) now redirects to EU, so it is not offered;
 * an account there is an EU account.
 */
const SERVERS = [
  { id: 'global', label: 'Global', host: 'kf.kobotoolbox.org' },
  { id: 'eu', label: 'EU', host: 'eu.kobotoolbox.org' },
] as const;

type ServerChoice = (typeof SERVERS)[number]['id'] | 'other';

const hostOf = (apiUrl: string | undefined): string => {
  if (!apiUrl) return SERVERS[0].host;
  try {
    return new URL(apiUrl).host;
  } catch {
    return apiUrl;
  }
};

/** Where Kobo shows the API key: Account settings → Security. Kobo asks to sign in first if needed. */
const apiKeyPageFor = (host: string) => `https://${host}/#/account/security`;

const inputClass =
  'w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md shadow-xs text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent';
const secondaryButton =
  'h-8 px-3 text-sm font-medium rounded-md border shadow-xs disabled:opacity-50 bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800';

/**
 * Connect (or change) the user's KoboToolbox account.
 *
 * Pasting the key connects straight away -- Kobo checks it and the server and
 * key are saved together -- so the whole job is: open Kobo, copy, paste.
 * Used in Account Settings and in the first-run setup checklist.
 */
const KoboConnection: React.FC = () => {
  const { user, connectKobo, deleteKoboApiKey, testKoboApiKey } = useAuth();

  const savedHost = hostOf(user?.kobo_api_url);
  const savedPreset = SERVERS.find((s) => s.host === savedHost);

  const [isEditing, setIsEditing] = useState(false);
  const [server, setServer] = useState<ServerChoice>(savedPreset ? savedPreset.id : 'other');
  const [otherServer, setOtherServer] = useState(savedPreset ? '' : savedHost);
  const [apiKey, setApiKey] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [koboUser, setKoboUser] = useState<KoboUser | null>(null);
  const [justConnected, setJustConnected] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  if (!user) return null;

  const typedServer = otherServer.trim();
  const chosenHost =
    server === 'other'
      ? hostOf(typedServer.includes('://') ? typedServer : `https://${typedServer}`)
      : SERVERS.find((s) => s.id === server)!.host;
  const serverAddress = server === 'other' ? otherServer : `https://${chosenHost}`;
  const canOpenKobo = server !== 'other' || Boolean(typedServer);

  const connect = async (key: string) => {
    if (!key.trim()) return;
    setIsConnecting(true);
    setError(null);
    setTestMessage(null);
    try {
      setKoboUser(await connectKobo(serverAddress, key.trim()));
      setApiKey('');
      setIsEditing(false);
      setJustConnected(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect to Kobo.');
    } finally {
      setIsConnecting(false);
    }
  };

  /** Pasting is the whole gesture: connect without waiting for a button. */
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text').trim();
    if (!pasted) return;
    e.preventDefault();
    setApiKey(pasted);
    connect(pasted);
  };

  /** A small window keeps Field Compass in view; a blocked pop-up falls back to a new tab. */
  const openKobo = (e: React.MouseEvent<HTMLAnchorElement>) => {
    const popup = window.open(apiKeyPageFor(chosenHost), 'kobo-api-key', 'popup,width=960,height=760');
    if (popup) {
      popup.opener = null;
      e.preventDefault();
    }
  };

  const handleTest = async () => {
    setIsTesting(true);
    setTestMessage(null);
    setError(null);
    try {
      const result = await testKoboApiKey();
      setKoboUser(result.kobo_user ?? null);
      setTestMessage('Kobo accepted the key.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach Kobo.');
    } finally {
      setIsTesting(false);
    }
  };

  const handleRemove = async () => {
    setIsRemoving(true);
    setRemoveError(null);
    try {
      await deleteKoboApiKey();
      setConfirmingRemove(false);
      setKoboUser(null);
      setJustConnected(false);
      setTestMessage(null);
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : 'Could not remove the connection.');
    } finally {
      setIsRemoving(false);
    }
  };

  const startEditing = () => {
    setIsEditing(true);
    setError(null);
    setTestMessage(null);
    setJustConnected(false);
    // Restore the saved server selection when changing the connection
    setServer(savedPreset ? savedPreset.id : 'other');
    setOtherServer(savedPreset ? '' : savedHost);
  };

  // --- Connected -----------------------------------------------------------
  if (user.has_kobo_api_key && !isEditing) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-gray-900 dark:text-white">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 mr-2 align-middle" aria-hidden="true" />
              Connected to <strong>{savedHost}</strong>
              {koboUser?.username && (
                <>
                  {' '}as <strong>{koboUser.username}</strong>
                  {koboUser.email && <span className="text-gray-500 dark:text-gray-400"> ({koboUser.email})</span>}
                </>
              )}
            </p>
            {justConnected && (
              <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400 mt-1">
                ✓ Kobo accepted your key. Field Compass can now read your projects.
              </p>
            )}
            {testMessage && (
              <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400 mt-1">
                ✓ {testMessage}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={handleTest} disabled={isTesting} className={secondaryButton}>
              {isTesting ? 'Testing…' : 'Test connection'}
            </button>
            <button type="button" onClick={startEditing} className={secondaryButton}>
              Change
            </button>
            <button
              type="button"
              onClick={() => {
                setRemoveError(null);
                setConfirmingRemove(true);
              }}
              className="h-8 px-3 text-sm font-medium rounded-md border text-red-600 border-red-200 dark:text-red-400 dark:border-red-900/60 hover:bg-red-50 dark:hover:bg-red-500/10"
            >
              Disconnect
            </button>
          </div>
        </div>
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        {/* Same dialog style as deleting a survey */}
        {confirmingRemove && (
          <div className="fixed inset-0 bg-gray-950/40 backdrop-blur-[2px] flex items-center justify-center z-50">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="disconnect-kobo-title"
              className="bg-white dark:bg-gray-900 rounded-xl p-6 max-w-md w-full mx-4 border border-gray-200 dark:border-gray-800 shadow-popover animate-fade-in"
            >
              <h2 id="disconnect-kobo-title" className="text-base font-semibold tracking-tight text-gray-900 dark:text-white mb-4">
                Disconnect KoboToolbox
              </h2>
              <p className="text-gray-700 dark:text-gray-300 mb-4">
                Field Compass will delete your stored Kobo API key. You won't be able to pull new submissions or add
                surveys until you connect again. Your surveys and their data stay as they are.
              </p>
              {removeError && (
                <div className="p-3 bg-red-50 dark:bg-red-500/10 ring-1 ring-inset ring-red-600/15 dark:ring-red-400/20 rounded-lg mb-4">
                  <p className="text-sm text-red-600 dark:text-red-400">{removeError}</p>
                </div>
              )}
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setConfirmingRemove(false)}
                  disabled={isRemoving}
                  className="px-4 py-2 bg-white text-gray-900 border border-gray-300 shadow-xs rounded-md hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRemove}
                  disabled={isRemoving}
                  className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                >
                  {isRemoving ? 'Disconnecting...' : 'Disconnect'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- Not connected, or changing ------------------------------------------
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        connect(apiKey);
      }}
    >
      <fieldset>
        <legend className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Which Kobo server is your account on?
        </legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {SERVERS.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
              <input
                type="radio"
                name="kobo-server"
                checked={server === s.id}
                onChange={() => setServer(s.id)}
                className="h-4 w-4 border-gray-300 text-indigo-600 focus:ring-indigo-600 dark:border-gray-600 dark:bg-gray-800"
              />
              {s.label} <span className="text-gray-500 dark:text-gray-400">— {s.host}</span>
            </label>
          ))}
          <label className="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
            <input
              type="radio"
              name="kobo-server"
              checked={server === 'other'}
              onChange={() => setServer('other')}
              className="h-4 w-4 border-gray-300 text-indigo-600 focus:ring-indigo-600 dark:border-gray-600 dark:bg-gray-800"
            />
            Your organisation's own server
          </label>
        </div>
        {server === 'other' && (
          <div className="mt-2">
            <label htmlFor="kobo-other-server" className="sr-only">
              Server address
            </label>
            <input
              id="kobo-other-server"
              type="text"
              inputMode="url"
              autoComplete="url"
              spellCheck={false}
              value={otherServer}
              onChange={(e) => setOtherServer(e.target.value)}
              placeholder="https://kobo.your-organisation.org"
              className={inputClass}
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              The address you use to open Kobo in your browser.
            </p>
          </div>
        )}
      </fieldset>

      <ol className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
        <li className="flex gap-3">
          <span className="flex-shrink-0 font-semibold text-gray-900 dark:text-white">a.</span>
          <div>
            <a
              href={canOpenKobo ? apiKeyPageFor(chosenHost) : undefined}
              target="_blank"
              rel="noopener noreferrer"
              onClick={canOpenKobo ? openKobo : (e) => e.preventDefault()}
              aria-disabled={!canOpenKobo}
              className={`inline-flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-md ${
                canOpenKobo
                  ? 'text-white bg-indigo-600 hover:bg-indigo-500'
                  : 'text-white bg-indigo-300 dark:bg-indigo-900 cursor-not-allowed'
              }`}
            >
              Open my Kobo API key ↗
            </a>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Sign in to Kobo if asked. Under <strong>API key</strong>, click <strong>Copy</strong>.
            </p>
          </div>
        </li>
        <li className="flex gap-3">
          <span className="flex-shrink-0 font-semibold text-gray-900 dark:text-white">b.</span>
          <div className="flex-1 min-w-0">
            <label htmlFor="kobo-api-key" className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
              Paste it here
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                id="kobo-api-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onPaste={handlePaste}
                disabled={isConnecting}
                placeholder="Paste your Kobo API key"
                className={`${inputClass} flex-1 min-w-[12rem]`}
              />
              <button
                type="submit"
                disabled={isConnecting || !apiKey.trim()}
                className="h-8 px-3 text-sm font-medium text-white bg-indigo-600 rounded-md shadow-xs hover:bg-indigo-500 disabled:opacity-50"
              >
                {isConnecting ? 'Checking with Kobo…' : 'Connect'}
              </button>
              {user.has_kobo_api_key && (
                <button
                  type="button"
                  disabled={isConnecting}
                  onClick={() => {
                    setIsEditing(false);
                    setApiKey('');
                    setError(null);
                    // Restore the saved server selection when cancelling
                    setServer(savedPreset ? savedPreset.id : 'other');
                    setOtherServer(savedPreset ? '' : savedHost);
                  }}
                  className={secondaryButton}
                >
                  Cancel
                </button>
              )}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Stored encrypted.
            </p>
          </div>
        </li>
      </ol>

      {error && (
        <div role="alert" className="p-3 bg-red-50 dark:bg-red-500/10 ring-1 ring-inset ring-red-600/15 dark:ring-red-400/20 rounded-lg">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}
    </form>
  );
};

export default KoboConnection;
