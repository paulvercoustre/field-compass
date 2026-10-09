import React, { useCallback, useEffect, useState } from 'react';
import {
  getSurveyAccess,
  revokeSurveyAccess,
  shareSurvey,
  SurveyAccessEntry,
  updateSurveyAccess,
} from '../../services/progressApi';
import { ApiError } from '../../services/apiBase';
import { Spinner } from '../Spinner';

type SharedLevel = 'editor' | 'viewer';

interface SurveyAccessTabProps {
  surveyId: string;
  onError: (message: string | null) => void;
  onSuccess: (message: string) => void;
}

/** Who can open the survey, and, for its owner, sharing it and changing or revoking access. */
const SurveyAccessTab: React.FC<SurveyAccessTabProps> = ({ surveyId, onError, onSuccess }) => {
  const [accessList, setAccessList] = useState<SurveyAccessEntry[]>([]);
  const [isLoadingAccess, setIsLoadingAccess] = useState(false);
  const [shareEmail, setShareEmail] = useState('');
  const [sharePermission, setSharePermission] = useState<SharedLevel>('viewer');
  const [isSharing, setIsSharing] = useState(false);
  const [canManageAccess, setCanManageAccess] = useState(false);

  const loadAccessList = useCallback(async () => {
    setIsLoadingAccess(true);
    try {
      setAccessList(await getSurveyAccess(surveyId));
      setCanManageAccess(true);
    } catch (err) {
      // Only the owner may see the list; anyone else gets a 403.
      setCanManageAccess(false);
      if (!(err instanceof ApiError && err.status === 403)) console.error('Error loading access list:', err);
    } finally {
      setIsLoadingAccess(false);
    }
  }, [surveyId]);

  useEffect(() => {
    loadAccessList();
  }, [loadAccessList]);

  /** Run a change to who has access, then show the list as it now stands. */
  const change = async (action: () => Promise<unknown>, failure: string) => {
    onError(null);
    try {
      await action();
      loadAccessList();
      return true;
    } catch (err) {
      onError(err instanceof Error ? err.message : failure);
      return false;
    }
  };

  const handleShare = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = shareEmail.trim();
    if (!email) return;
    setIsSharing(true);
    if (await change(() => shareSurvey(surveyId, email, sharePermission), 'Failed to share survey')) {
      onSuccess(`Survey shared with ${email}`);
      setShareEmail('');
    }
    setIsSharing(false);
  };

  const handleUpdateAccess = (userId: string, newLevel: SharedLevel) =>
    change(() => updateSurveyAccess(surveyId, userId, newLevel), 'Failed to update access');

  const handleRevokeAccess = (userId: string, userEmail: string) => {
    if (!confirm(`Are you sure you want to revoke ${userEmail}'s access?`)) return;
    change(() => revokeSurveyAccess(surveyId, userId), 'Failed to revoke access');
  };

  return (
    <div className="space-y-6">
      {/* Who has access */}
      <section className="bg-white dark:bg-gray-900 p-5 rounded-xl border border-gray-200 dark:border-gray-800 shadow-card">
        <h2 className="text-base font-semibold tracking-tight mb-4 text-gray-900 dark:text-white">Who has access</h2>

        {isLoadingAccess ? (
          <div className="flex items-center justify-center py-8">
            <Spinner />
          </div>
        ) : accessList.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 text-sm py-4">
            {canManageAccess ? 'No one else has access to this survey yet.' : 'Unable to load access list.'}
          </p>
        ) : (
          <div className="space-y-3">
            {accessList.map((access) => (
              <div
                key={access.user_id}
                className="flex items-center justify-between py-3 px-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-indigo-500 flex items-center justify-center text-white font-bold">
                    {access.username?.charAt(0).toUpperCase() || access.email?.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="font-medium text-gray-900 dark:text-white">
                      {access.full_name || access.username}
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">{access.email}</div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {access.permission_level === 'owner' ? (
                    <span className="px-3 py-1 text-sm font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300 rounded-full">
                      Owner
                    </span>
                  ) : canManageAccess ? (
                    <>
                      <select
                        value={access.permission_level}
                        onChange={(e) => handleUpdateAccess(access.user_id, e.target.value as SharedLevel)}
                        className="text-sm px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 dark:bg-gray-700 dark:text-white"
                      >
                        <option value="viewer">Viewer</option>
                        <option value="editor">Editor</option>
                      </select>
                      <button
                        onClick={() => handleRevokeAccess(access.user_id, access.email)}
                        className="p-2 text-gray-400 hover:text-red-500 transition-colors rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
                        title="Revoke access"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    </>
                  ) : (
                    <span
                      className={`px-3 py-1 text-sm font-medium rounded-full ${
                        access.permission_level === 'editor'
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                          : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {access.permission_level === 'editor' ? 'Editor' : 'Viewer'}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Share Survey */}
      <section className="bg-white dark:bg-gray-900 p-5 rounded-xl border border-gray-200 dark:border-gray-800 shadow-card">
        <h2 className="text-base font-semibold tracking-tight mb-4 text-gray-900 dark:text-white">Share survey</h2>

        {!canManageAccess ? (
          <div className="p-4 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-md">
            <p className="text-yellow-800 dark:text-yellow-200 text-sm">
              Only the survey owner can manage access permissions.
            </p>
          </div>
        ) : (
          <form onSubmit={handleShare} className="space-y-4">
            <div>
              <label htmlFor="invite-email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Invite by email
              </label>
              <div className="flex gap-2">
                <input
                  id="invite-email"
                  type="email"
                  value={shareEmail}
                  onChange={(e) => setShareEmail(e.target.value)}
                  placeholder="user@example.com"
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 dark:bg-gray-800 dark:text-white text-sm"
                  required
                />
                <select
                  value={sharePermission}
                  onChange={(e) => setSharePermission(e.target.value as SharedLevel)}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 dark:bg-gray-800 dark:text-white text-sm"
                >
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                </select>
                <button
                  type="submit"
                  disabled={isSharing || !shareEmail.trim()}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                >
                  {isSharing ? 'Sharing...' : 'Share'}
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              <strong>Viewer:</strong> Can see the submissions and reports. <strong>Editor:</strong> Can also pull from
              Kobo and review submissions.
            </p>
          </form>
        )}
      </section>
    </div>
  );
};

export default SurveyAccessTab;
