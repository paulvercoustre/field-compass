import React, { useState } from 'react';
import { useAuth, User } from '../contexts/AuthContext';

const DEFAULT_KOBO_API_URL = 'https://kf.kobotoolbox.org/api/v2';

// The public KoboToolbox servers. Anything else (self-hosted) goes in "Other".
const KOBO_SERVERS = [
  { id: 'global', label: 'Global', host: 'kf.kobotoolbox.org' },
  { id: 'eu', label: 'EU', host: 'eu.kobotoolbox.org' },
  { id: 'humanitarian', label: 'Humanitarian', host: 'kobo.humanitarianresponse.info' },
] as const;

type KoboServerChoice = (typeof KOBO_SERVERS)[number]['id'] | 'other';

const apiUrlFor = (host: string) => `https://${host}/api/v2`;
const normalizeUrl = (url: string) => url.trim().replace(/\/+$/, '');

const serverChoiceFor = (apiUrl: string): KoboServerChoice =>
  KOBO_SERVERS.find((server) => normalizeUrl(apiUrlFor(server.host)) === normalizeUrl(apiUrl))?.id ?? 'other';

/** Where the user finds their token on the chosen server, if it can be told. */
const tokenPageFor = (apiUrl: string): string | null => {
  try {
    return `${new URL(apiUrl).origin}/token/`;
  } catch {
    return null;
  }
};

const UserSettingsPage: React.FC = () => {
  const {
    user,
    updateUser,
    setKoboApiKey,
    deleteKoboApiKey,
    testKoboApiKey,
    changePassword,
    deleteAccount,
  } = useAuth();

  // Profile form state
  const [username, setUsername] = useState(user?.username || '');
  const [fullName, setFullName] = useState(user?.full_name || '');
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);

  const isProfileDirty =
    username !== (user?.username || '') || fullName !== (user?.full_name || '');

  // Kobo connection state. The server and the token are saved together, by
  // this section's own button. The server address used to be saved only by
  // the Profile form's Save -- which appears only when the name changes -- so
  // anyone on the EU or humanitarian server could not connect at all.
  const savedKoboApiUrl = user?.kobo_api_url || DEFAULT_KOBO_API_URL;
  const [serverChoice, setServerChoice] = useState<KoboServerChoice>(() => serverChoiceFor(savedKoboApiUrl));
  const [otherServerUrl, setOtherServerUrl] = useState(() =>
    serverChoiceFor(savedKoboApiUrl) === 'other' ? savedKoboApiUrl : ''
  );
  const [newApiKey, setNewApiKey] = useState('');
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [apiKeySuccess, setApiKeySuccess] = useState<string | null>(null);
  const [isUpdatingApiKey, setIsUpdatingApiKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ status: string; kobo_user?: { username: string; email: string } } | null>(null);

  const chosenServer = KOBO_SERVERS.find((server) => server.id === serverChoice);
  const koboApiUrl = chosenServer ? apiUrlFor(chosenServer.host) : otherServerUrl.trim();
  const isServerDirty = normalizeUrl(koboApiUrl) !== normalizeUrl(savedKoboApiUrl);
  const isOtherUrlValid = serverChoice !== 'other' || /^https?:\/\/\S+$/i.test(koboApiUrl);
  const tokenPage = tokenPageFor(koboApiUrl);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  // Delete account state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError(null);
    setProfileSuccess(null);
    setIsUpdatingProfile(true);

    try {
      await updateUser({
        username: username !== user?.username ? username : undefined,
        full_name: fullName,
      });
      setProfileSuccess('Profile updated successfully');
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  const handleCancelProfile = () => {
    setUsername(user?.username || '');
    setFullName(user?.full_name || '');
    setProfileError(null);
    setProfileSuccess(null);
  };

  const handleDeleteAccountConfirm = async () => {
    setDeleteError(null);
    setIsDeletingAccount(true);

    try {
      await deleteAccount();
      setShowDeleteConfirm(false);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete account');
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const handleDeleteAccountCancel = () => {
    setShowDeleteConfirm(false);
    setDeleteError(null);
  };

  /** Save the server and/or token, then test the connection straight away. */
  const handleSaveConnection = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiKeyError(null);
    setApiKeySuccess(null);
    setTestResult(null);
    setIsUpdatingApiKey(true);

    try {
      if (isServerDirty) {
        await updateUser({ kobo_api_url: koboApiUrl });
      }
      if (newApiKey) {
        await setKoboApiKey(newApiKey);
        setNewApiKey('');
      }
    } catch (err) {
      setApiKeyError(err instanceof Error ? err.message : 'Failed to save the Kobo connection');
      setIsUpdatingApiKey(false);
      return;
    }
    setIsUpdatingApiKey(false);

    const hasToken = Boolean(newApiKey) || user?.has_kobo_api_key;
    if (!hasToken) {
      setApiKeySuccess('Server saved. Add your API token to connect.');
      return;
    }

    setApiKeySuccess('Saved. Testing the connection…');
    setIsTesting(true);
    try {
      const result = await testKoboApiKey();
      setTestResult(result);
      setApiKeySuccess('Saved.');
    } catch (err) {
      setApiKeySuccess(null);
      setApiKeyError(
        `Saved, but the connection test failed: ${err instanceof Error ? err.message : 'unknown error'}`
      );
    } finally {
      setIsTesting(false);
    }
  };

  const handleDeleteApiKey = async () => {
    if (!confirm('Are you sure you want to remove your Kobo API key? You will not be able to fetch data until you add a new one.')) {
      return;
    }

    setApiKeyError(null);
    setApiKeySuccess(null);

    try {
      await deleteKoboApiKey();
      setApiKeySuccess('Kobo API key removed');
      setTestResult(null);
    } catch (err) {
      setApiKeyError(err instanceof Error ? err.message : 'Failed to remove API key');
    }
  };

  const handleTestApiKey = async () => {
    setIsTesting(true);
    setApiKeyError(null);
    setApiKeySuccess(null);
    setTestResult(null);

    try {
      const result = await testKoboApiKey();
      setTestResult(result);
    } catch (err) {
      setApiKeyError(err instanceof Error ? err.message : 'Failed to test API key');
    } finally {
      setIsTesting(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (newPassword !== confirmNewPassword) {
      setPasswordError('New passwords do not match');
      return;
    }

    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters');
      return;
    }

    setIsChangingPassword(true);

    try {
      await changePassword(currentPassword, newPassword);
      setPasswordSuccess('Password changed successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setIsChangingPassword(false);
    }
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-500">Please log in to view settings</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">User Settings</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Manage your account and Kobo API configuration</p>
        </div>

        {/* Profile Section */}
        <section className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Profile</h2>
          
          <form onSubmit={handleUpdateProfile} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Email
              </label>
              <input
                type="email"
                value={user.email}
                disabled
                className="w-full px-4 py-2.5 bg-gray-100 dark:bg-gray-700 border border-gray-500 dark:border-gray-600 rounded-lg text-gray-500 dark:text-gray-400 cursor-not-allowed"
              />
              <p className="text-xs text-gray-500 mt-1">Email cannot be changed</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-500 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Full Name
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-500 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder="Your full name"
              />
            </div>

            {profileError && (
              <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-sm text-red-600 dark:text-red-400">{profileError}</p>
              </div>
            )}

            {profileSuccess && (
              <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                <p className="text-sm text-green-600 dark:text-green-400">{profileSuccess}</p>
              </div>
            )}

            {isProfileDirty && (
              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={isUpdatingProfile}
                  className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-medium rounded-lg transition-colors"
                >
                  {isUpdatingProfile ? 'Saving...' : 'Save Changes'}
                </button>
                <button
                  type="button"
                  onClick={handleCancelProfile}
                  disabled={isUpdatingProfile}
                  className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </form>
        </section>

        {/* Kobo connection: server and token, saved together */}
        <section className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">KoboToolbox connection</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                The Kobo server your projects live on, and your API token for it
              </p>
            </div>
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
              user.has_kobo_api_key
                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
            }`}>
              {user.has_kobo_api_key ? '✓ Token saved' : '⚠ Not connected'}
            </span>
          </div>

          <form onSubmit={handleSaveConnection} className="space-y-4">
            <fieldset>
              <legend className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Server</legend>
              <div className="space-y-2">
                {KOBO_SERVERS.map((server) => (
                  <label key={server.id} className="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
                    <input
                      type="radio"
                      name="kobo-server"
                      value={server.id}
                      checked={serverChoice === server.id}
                      onChange={() => setServerChoice(server.id)}
                      className="h-4 w-4 border-gray-500 text-indigo-600"
                    />
                    <span>
                      {server.label} <span className="text-gray-600 dark:text-gray-400">— {server.host}</span>
                    </span>
                  </label>
                ))}
                <label className="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
                  <input
                    type="radio"
                    name="kobo-server"
                    value="other"
                    checked={serverChoice === 'other'}
                    onChange={() => setServerChoice('other')}
                    className="h-4 w-4 border-gray-500 text-indigo-600"
                  />
                  <span>Other (self-hosted)</span>
                </label>
                {serverChoice === 'other' && (
                  <div className="ml-6">
                    <label htmlFor="kobo-other-url" className="sr-only">Kobo server API address</label>
                    <input
                      id="kobo-other-url"
                      type="url"
                      value={otherServerUrl}
                      onChange={(e) => setOtherServerUrl(e.target.value)}
                      aria-describedby="kobo-other-url-help"
                      className="w-full px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-500 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white"
                      placeholder="https://kobo.example.org/api/v2"
                    />
                    <p id="kobo-other-url-help" className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                      Your server's API address, usually ending in /api/v2
                    </p>
                  </div>
                )}
              </div>
            </fieldset>

            <div>
              <label htmlFor="kobo-api-token" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {user.has_kobo_api_key ? 'Replace API token' : 'API token'}
              </label>
              <input
                id="kobo-api-token"
                type="password"
                autoComplete="off"
                value={newApiKey}
                onChange={(e) => setNewApiKey(e.target.value)}
                aria-describedby="kobo-api-token-help"
                className="w-full px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-500 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white"
                placeholder={
                  user.has_kobo_api_key
                    ? 'Leave empty to keep your saved token'
                    : 'Paste your Kobo API token'
                }
              />
              <p id="kobo-api-token-help" className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                {tokenPage ? (
                  <>
                    Find your token at{' '}
                    <a
                      href={tokenPage}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-700 dark:text-indigo-400 underline hover:no-underline"
                    >
                      {tokenPage.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                    </a>
                  </>
                ) : (
                  'Find your token on your Kobo server, under Account settings → Security → API key.'
                )}
              </p>
            </div>

            {apiKeyError && (
              <div role="alert" className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-sm text-red-700 dark:text-red-400">{apiKeyError}</p>
              </div>
            )}

            {(apiKeySuccess || testResult) && (
              <div
                role="status"
                className={`p-3 rounded-lg ${
                  !testResult || testResult.status === 'success'
                    ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
                    : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
                }`}
              >
                {testResult && testResult.status !== 'success' ? (
                  <p className="text-sm text-red-700 dark:text-red-400">✗ Kobo did not accept this token</p>
                ) : (
                  <div className="text-sm text-green-700 dark:text-green-400">
                    <p className="font-medium">
                      {apiKeySuccess}
                      {testResult && ' ✓ Connected to Kobo.'}
                    </p>
                    {testResult?.kobo_user && (
                      <p className="mt-1">
                        Signed in to Kobo as {testResult.kobo_user.username} ({testResult.kobo_user.email})
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={isUpdatingApiKey || isTesting || (!isServerDirty && !newApiKey) || !isOtherUrlValid}
                className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-medium rounded-lg transition-colors"
              >
                {isUpdatingApiKey ? 'Saving…' : isTesting ? 'Testing…' : 'Save and test connection'}
              </button>

              {user.has_kobo_api_key && (
                <>
                  <button
                    type="button"
                    onClick={handleTestApiKey}
                    disabled={isTesting || isUpdatingApiKey}
                    className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-lg transition-colors"
                  >
                    {isTesting ? 'Testing…' : 'Test connection'}
                  </button>

                  <button
                    type="button"
                    onClick={handleDeleteApiKey}
                    className="px-4 py-2.5 text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 font-medium transition-colors"
                  >
                    Remove token
                  </button>
                </>
              )}
            </div>
            {isServerDirty && (
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Server changed — not saved yet. The connection test uses the saved server.
              </p>
            )}
          </form>
        </section>

        {/* Change Password Section */}
        <section className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Change Password</h2>
          
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Current Password
              </label>
              <input
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                className="w-full px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-500 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                New Password
              </label>
              <input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                className="w-full px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-500 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder="At least 8 characters"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Confirm New Password
              </label>
              <input
                type="password"
                autoComplete="new-password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                required
                className="w-full px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-500 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>

            {passwordError && (
              <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-sm text-red-600 dark:text-red-400">{passwordError}</p>
              </div>
            )}

            {passwordSuccess && (
              <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                <p className="text-sm text-green-600 dark:text-green-400">{passwordSuccess}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isChangingPassword}
              className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-medium rounded-lg transition-colors"
            >
              {isChangingPassword ? 'Changing...' : 'Change Password'}
            </button>
          </form>
        </section>

        {/* Delete Account Section */}
        <section className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-red-200 dark:border-red-900/50 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Delete Account</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            Permanently delete your account and all associated data. This action cannot be undone.
          </p>

          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            disabled={isDeletingAccount}
            className="px-4 py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white font-medium rounded-lg transition-colors"
          >
            Delete Account
          </button>
        </section>

        {/* Delete Account Confirmation Modal */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 border border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Delete Account</h2>
              <p className="text-gray-700 dark:text-gray-300 mb-6">
                Are you sure you want to delete your account?
                <br />
                <br />
                This action cannot be undone. This will permanently delete your account and all associated data.
              </p>
              {deleteError && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg mb-4">
                  <p className="text-sm text-red-600 dark:text-red-400">{deleteError}</p>
                </div>
              )}
              <div className="flex justify-end gap-3">
                <button
                  onClick={handleDeleteAccountCancel}
                  disabled={isDeletingAccount}
                  className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteAccountConfirm}
                  disabled={isDeletingAccount}
                  className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-red-300 dark:disabled:bg-red-700 disabled:cursor-not-allowed text-sm font-medium"
                >
                  {isDeletingAccount ? 'Deleting...' : 'Delete Account'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Account Info */}
        <section className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Account Information</h2>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500 dark:text-gray-400">Account created</dt>
              <dd className="text-gray-900 dark:text-white">
                {new Date(user.created_at).toLocaleDateString()}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500 dark:text-gray-400">Last login</dt>
              <dd className="text-gray-900 dark:text-white">
                {user.last_login_at
                  ? new Date(user.last_login_at).toLocaleString()
                  : 'Never'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500 dark:text-gray-400">Account status</dt>
              <dd className={`font-medium ${user.is_active ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                {user.is_active ? 'Active' : 'Inactive'}
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
};

export default UserSettingsPage;

