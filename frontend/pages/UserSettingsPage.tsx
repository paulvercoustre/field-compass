import React, { useState } from 'react';
import { useAuth, User } from '../contexts/AuthContext';

const UserSettingsPage: React.FC = () => {
  const {
    user,
    updateUser,
    setKoboApiKey,
    deleteKoboApiKey,
    testKoboApiKey,
    changePassword,
    logout,
  } = useAuth();

  // Profile form state
  const [username, setUsername] = useState(user?.username || '');
  const [fullName, setFullName] = useState(user?.full_name || '');
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);

  // Kobo API key state
  const [newApiKey, setNewApiKey] = useState('');
  const [koboApiUrl, setKoboApiUrl] = useState(user?.kobo_api_url || 'https://kf.kobotoolbox.org/api/v2');
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [apiKeySuccess, setApiKeySuccess] = useState<string | null>(null);
  const [isUpdatingApiKey, setIsUpdatingApiKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ status: string; kobo_user?: { username: string; email: string } } | null>(null);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError(null);
    setProfileSuccess(null);
    setIsUpdatingProfile(true);

    try {
      await updateUser({
        username: username !== user?.username ? username : undefined,
        full_name: fullName,
        kobo_api_url: koboApiUrl,
      });
      setProfileSuccess('Profile updated successfully');
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  const handleSetApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiKeyError(null);
    setApiKeySuccess(null);
    setIsUpdatingApiKey(true);

    try {
      await setKoboApiKey(newApiKey);
      setNewApiKey('');
      setApiKeySuccess('Kobo API key saved successfully');
      setTestResult(null);
    } catch (err) {
      setApiKeyError(err instanceof Error ? err.message : 'Failed to save API key');
    } finally {
      setIsUpdatingApiKey(false);
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
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">User Settings</h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1">Manage your account and Kobo API configuration</p>
          </div>
          <button
            onClick={logout}
            className="px-4 py-2 text-sm font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors"
          >
            Sign Out
          </button>
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
                className="w-full px-4 py-2.5 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-500 dark:text-gray-400 cursor-not-allowed"
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
                className="w-full px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
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
                className="w-full px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
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

            <button
              type="submit"
              disabled={isUpdatingProfile}
              className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-medium rounded-lg transition-colors"
            >
              {isUpdatingProfile ? 'Saving...' : 'Save Changes'}
            </button>
          </form>
        </section>

        {/* Kobo API Key Section */}
        <section className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Kobo API Configuration</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Configure your KoboToolbox API credentials for data fetching
              </p>
            </div>
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
              user.has_kobo_api_key
                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
            }`}>
              {user.has_kobo_api_key ? '✓ Configured' : '⚠ Not Configured'}
            </span>
          </div>

          <div className="space-y-4">
            {/* API URL */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Kobo API URL
              </label>
              <input
                type="url"
                value={koboApiUrl}
                onChange={(e) => setKoboApiUrl(e.target.value)}
                className="w-full px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder="https://kf.kobotoolbox.org/api/v2"
              />
              <p className="text-xs text-gray-500 mt-1">
                For self-hosted Kobo, use your server's API URL
              </p>
            </div>

            {/* API Key Input */}
            <form onSubmit={handleSetApiKey} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {user.has_kobo_api_key ? 'Replace API Token' : 'API Token'}
                </label>
                <input
                  type="password"
                  value={newApiKey}
                  onChange={(e) => setNewApiKey(e.target.value)}
                  className="w-full px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder={user.has_kobo_api_key ? 'Enter new token to replace' : 'Paste your Kobo API token'}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Find your token at{' '}
                  <a
                    href="https://kf.kobotoolbox.org/token/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-600 hover:text-indigo-500"
                  >
                    kf.kobotoolbox.org/token
                  </a>
                </p>
              </div>

              {apiKeyError && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <p className="text-sm text-red-600 dark:text-red-400">{apiKeyError}</p>
                </div>
              )}

              {apiKeySuccess && (
                <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                  <p className="text-sm text-green-600 dark:text-green-400">{apiKeySuccess}</p>
                </div>
              )}

              {testResult && (
                <div className={`p-3 rounded-lg ${
                  testResult.status === 'success'
                    ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
                    : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
                }`}>
                  {testResult.status === 'success' && testResult.kobo_user ? (
                    <div className="text-sm text-green-600 dark:text-green-400">
                      <p className="font-medium">✓ API key is valid</p>
                      <p className="mt-1">
                        Connected as: {testResult.kobo_user.username} ({testResult.kobo_user.email})
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-red-600 dark:text-red-400">
                      ✗ API key validation failed
                    </p>
                  )}
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  disabled={isUpdatingApiKey || !newApiKey}
                  className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-medium rounded-lg transition-colors"
                >
                  {isUpdatingApiKey ? 'Saving...' : user.has_kobo_api_key ? 'Update Token' : 'Save Token'}
                </button>

                {user.has_kobo_api_key && (
                  <>
                    <button
                      type="button"
                      onClick={handleTestApiKey}
                      disabled={isTesting}
                      className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-lg transition-colors"
                    >
                      {isTesting ? 'Testing...' : 'Test Connection'}
                    </button>

                    <button
                      type="button"
                      onClick={handleDeleteApiKey}
                      className="px-4 py-2.5 text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-medium transition-colors"
                    >
                      Remove Token
                    </button>
                  </>
                )}
              </div>
            </form>
          </div>
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
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                className="w-full px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                New Password
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                className="w-full px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder="At least 8 characters"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Confirm New Password
              </label>
              <input
                type="password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                required
                className="w-full px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
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

