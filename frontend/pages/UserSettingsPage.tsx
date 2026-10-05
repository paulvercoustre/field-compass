import React, { useEffect, useState } from 'react';
import { useAuth, User } from '../contexts/AuthContext';
import KoboConnection from '../components/kobo/KoboConnection';
import AIIntegrationTab from '../components/ai/AIIntegrationTab';
import NotificationSettings from '../components/activity/NotificationSettings';
import SettingsLayout, { SettingsNavItem } from '../components/ui/SettingsLayout';
import UsageTab from '../components/admin/UsageTab';

type AccountTab = 'profile' | 'kobo' | 'ai' | 'notifications' | 'usage';

const NAV_ITEMS: SettingsNavItem<AccountTab>[] = [
  { id: 'profile', label: 'Profile' },
  { id: 'kobo', label: 'Kobo connection' },
  { id: 'ai', label: 'AI integration' },
  { id: 'notifications', label: 'Notifications' },
];

// The people running the instance also see how it is used.
const USAGE_NAV_ITEMS: SettingsNavItem<AccountTab>[] = [...NAV_ITEMS, { id: 'usage', label: 'App usage' }];

interface UserSettingsPageProps {
  /** A tab asked for by a link elsewhere in the app. */
  requestedTab?: { tab: string; at: number };
}

const UserSettingsPage: React.FC<UserSettingsPageProps> = ({ requestedTab }) => {
  const [activeTab, setActiveTab] = useState<AccountTab>(() =>
    NAV_ITEMS.some((item) => item.id === requestedTab?.tab) ? (requestedTab!.tab as AccountTab) : 'profile'
  );

  useEffect(() => {
    if (requestedTab && NAV_ITEMS.some((item) => item.id === requestedTab.tab)) {
      setActiveTab(requestedTab.tab as AccountTab);
    }
  }, [requestedTab]);
  const {
    user,
    updateUser,
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
    <SettingsLayout<AccountTab>
      title="Account settings"
      items={user.can_view_usage ? USAGE_NAV_ITEMS : NAV_ITEMS}
      active={activeTab}
      onSelect={setActiveTab}
    >
      <div className="space-y-6">
        {activeTab === 'profile' && (
          <>
            {/* Profile Section */}
            <section className="bg-white dark:bg-gray-900 rounded-xl shadow-card border border-gray-200 dark:border-gray-800 p-6">
              <h2 className="text-base font-semibold tracking-tight text-gray-900 dark:text-white mb-4">Profile</h2>
          
              <form onSubmit={handleUpdateProfile} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Email
                  </label>
                  <input
                    type="email"
                    value={user.email}
                    disabled
                    className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-800 rounded-lg text-gray-500 dark:text-gray-500 cursor-not-allowed"
                  />
                    </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Username
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg shadow-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Full name
                  </label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg shadow-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    placeholder="Your full name"
                  />
                </div>

                {profileError && (
                  <div className="p-3 text-sm bg-red-50 dark:bg-red-500/10 ring-1 ring-inset ring-red-600/15 dark:ring-red-400/20 rounded-lg">
                    <p className="text-sm text-red-600 dark:text-red-400">{profileError}</p>
                  </div>
                )}

                {profileSuccess && (
                  <div className="p-3 text-sm bg-emerald-50 dark:bg-emerald-500/10 ring-1 ring-inset ring-emerald-600/15 dark:ring-emerald-400/20 rounded-lg">
                    <p className="text-sm text-green-600 dark:text-green-400">{profileSuccess}</p>
                  </div>
                )}

                {isProfileDirty && (
                  <div className="flex gap-3">
                    <button
                      type="submit"
                      disabled={isUpdatingProfile}
                      className="h-9 px-3.5 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium rounded-lg shadow-xs transition-colors"
                    >
                      {isUpdatingProfile ? 'Saving...' : 'Save changes'}
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelProfile}
                      disabled={isUpdatingProfile}
                      className="px-4 py-2.5 bg-white hover:bg-gray-50 border border-gray-300 shadow-xs dark:bg-gray-900 dark:hover:bg-gray-800 dark:border-gray-700 text-gray-900 dark:text-gray-100 font-medium rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </form>
            </section>

            {/* Change Password Section */}
            <section className="bg-white dark:bg-gray-900 rounded-xl shadow-card border border-gray-200 dark:border-gray-800 p-6">
              <h2 className="text-base font-semibold tracking-tight text-gray-900 dark:text-white mb-4">Change password</h2>
          
              <form onSubmit={handleChangePassword} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Current password
                  </label>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                    className="w-full px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg shadow-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    New password
                  </label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={8}
                    className="w-full px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg shadow-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    placeholder="At least 8 characters"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Confirm New password
                  </label>
                  <input
                    type="password"
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    required
                    className="w-full px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg shadow-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>

                {passwordError && (
                  <div className="p-3 text-sm bg-red-50 dark:bg-red-500/10 ring-1 ring-inset ring-red-600/15 dark:ring-red-400/20 rounded-lg">
                    <p className="text-sm text-red-600 dark:text-red-400">{passwordError}</p>
                  </div>
                )}

                {passwordSuccess && (
                  <div className="p-3 text-sm bg-emerald-50 dark:bg-emerald-500/10 ring-1 ring-inset ring-emerald-600/15 dark:ring-emerald-400/20 rounded-lg">
                    <p className="text-sm text-green-600 dark:text-green-400">{passwordSuccess}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isChangingPassword}
                  className="h-9 px-3.5 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium rounded-lg shadow-xs transition-colors"
                >
                  {isChangingPassword ? 'Changing...' : 'Change password'}
                </button>
              </form>
            </section>

            {/* Account Info */}
            <section className="bg-white dark:bg-gray-900 rounded-xl shadow-card border border-gray-200 dark:border-gray-800 p-6">
              <h2 className="text-base font-semibold tracking-tight text-gray-900 dark:text-white mb-4">Account information</h2>
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

            {/* Delete Account Section */}
            <section className="bg-white dark:bg-gray-900 rounded-xl shadow-card border border-red-200 dark:border-red-900/50 p-6">
              <h2 className="text-base font-semibold tracking-tight text-gray-900 dark:text-white mb-2">Delete account</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                Permanently deletes your account and its data. This cannot be undone.
              </p>

              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={isDeletingAccount}
                className="h-9 px-3.5 text-sm bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-medium rounded-lg shadow-xs transition-colors"
              >
                Delete Account
              </button>
            </section>
          </>
        )}

        {activeTab === 'kobo' && (
              <section className="bg-white dark:bg-gray-900 rounded-xl shadow-card border border-gray-200 dark:border-gray-800 p-6">
              <div className="flex items-start justify-between gap-4 mb-4">
                <h2 className="text-base font-semibold tracking-tight text-gray-900 dark:text-white">KoboToolbox connection</h2>
                <span className={`flex-shrink-0 inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                  user.has_kobo_api_key
                    ? 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-600/15 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20'
                    : 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20'
                }`}>
                  {user.has_kobo_api_key ? 'Connected' : 'Not connected'}
                </span>
              </div>
              <KoboConnection />
            </section>
        )}

        {activeTab === 'ai' && (
          <>
            <AIIntegrationTab />
          </>
        )}

        {activeTab === 'notifications' && <NotificationSettings />}

        {activeTab === 'usage' && user.can_view_usage && <UsageTab />}
      </div>

      {/* Delete Account Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-gray-950/40 backdrop-blur-[2px] flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-900 rounded-xl p-6 max-w-md w-full mx-4 border border-gray-200 dark:border-gray-800 shadow-popover animate-fade-in">
            <h2 className="text-base font-semibold tracking-tight text-gray-900 dark:text-white mb-4">Delete Account</h2>
            <p className="text-gray-700 dark:text-gray-300 mb-6">
              Are you sure you want to delete your account?
              <br />
              <br />
              This action cannot be undone. This will permanently delete your account and all associated data.
            </p>
            {deleteError && (
              <div className="p-3 text-sm bg-red-50 dark:bg-red-500/10 ring-1 ring-inset ring-red-600/15 dark:ring-red-400/20 rounded-lg mb-4">
                <p className="text-sm text-red-600 dark:text-red-400">{deleteError}</p>
              </div>
            )}
            <div className="flex justify-end gap-3">
              <button
                onClick={handleDeleteAccountCancel}
                disabled={isDeletingAccount}
                className="px-4 py-2 bg-white text-gray-900 border border-gray-300 shadow-xs rounded-md hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAccountConfirm}
                disabled={isDeletingAccount}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
              >
                {isDeletingAccount ? 'Deleting...' : 'Delete Account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </SettingsLayout>
  );
};

export default UserSettingsPage;

