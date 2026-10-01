import React, { useEffect, useRef, useState } from 'react';

interface SessionExpiredDialogProps {
  email: string;
  onSignIn: (password: string) => Promise<void>;
  onSignOut: () => void;
}

/**
 * Shown over the current page when the session expires mid-task.
 *
 * Signing in here keeps the user exactly where they were: the page underneath
 * is never unmounted, and the request that hit the expiry is retried once the
 * new token arrives. The email is fixed because the page's state belongs to
 * this account; anyone else signs out and starts fresh.
 */
const SessionExpiredDialog: React.FC<SessionExpiredDialogProps> = ({ email, onSignIn, onSignOut }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    passwordRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await onSignIn(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-expired-title"
        aria-describedby="session-expired-description"
        className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full border border-gray-200 dark:border-gray-700 shadow-xl"
      >
        <h2 id="session-expired-title" className="text-lg font-semibold text-gray-900 dark:text-white">
          Your session expired
        </h2>
        <p id="session-expired-description" className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          Sign in again to carry on. Nothing on this page has been lost, and what you were doing will finish once you're signed in.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label htmlFor="session-expired-email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Email
            </label>
            <input
              id="session-expired-email"
              type="email"
              value={email}
              readOnly
              autoComplete="username"
              className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 border border-gray-500 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-300"
            />
          </div>
          <div>
            <label htmlFor="session-expired-password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Password
            </label>
            <input
              id="session-expired-password"
              ref={passwordRef}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-500 dark:border-gray-600 rounded-md text-gray-900 dark:text-white"
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-300">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onSignOut}
              disabled={isSubmitting}
              className="text-sm text-gray-600 dark:text-gray-300 underline hover:no-underline"
            >
              Sign in as someone else
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !password}
              className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-indigo-400 text-sm font-medium"
            >
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SessionExpiredDialog;
