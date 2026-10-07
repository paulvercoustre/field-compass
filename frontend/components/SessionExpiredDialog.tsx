import React, { useEffect, useRef, useState } from 'react';
import Button from './ui/Button';

interface SessionExpiredDialogProps {
  email: string;
  onSignIn: (password: string) => Promise<void>;
  onSignOut: () => void;
}

/**
 * Shown over the page when the session runs out mid-work. Signing in again
 * here retries whatever was being saved or loaded, so nothing typed on the
 * page is lost. It cannot be dismissed by Escape or a click outside: the only
 * ways out are signing in or choosing to sign out.
 */
const SessionExpiredDialog: React.FC<SessionExpiredDialogProps> = ({ email, onSignIn, onSignOut }) => {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    passwordRef.current?.focus();
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      await onSignIn(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in.');
      setBusy(false);
      passwordRef.current?.select();
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-gray-950/40 backdrop-blur-[2px]">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-expired-title"
        aria-describedby="session-expired-text"
        onSubmit={submit}
        className="mx-4 w-full max-w-sm rounded-xl border border-gray-200 bg-white p-6 shadow-popover animate-fade-in dark:border-gray-800 dark:bg-gray-900"
      >
        <h2
          id="session-expired-title"
          className="mb-2 text-base font-semibold tracking-tight text-gray-900 dark:text-white"
        >
          Sign in to continue
        </h2>
        <p id="session-expired-text" className="mb-4 text-sm text-gray-700 dark:text-gray-300">
          Your session has expired. Sign in again and Field Compass carries on where you were; nothing on this page is
          lost.
        </p>

        {/* For password managers: the account being signed in to. */}
        <input type="email" name="email" autoComplete="username" value={email} readOnly hidden />
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">{email}</p>

        <label
          htmlFor="session-expired-password"
          className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          Password
        </label>
        <input
          ref={passwordRef}
          id="session-expired-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={!!error || undefined}
          aria-describedby={error ? 'session-expired-error' : undefined}
          className="block h-10 w-full rounded-lg border border-gray-400 bg-white px-3 text-sm text-gray-900 shadow-xs focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/15 dark:border-gray-600 dark:bg-gray-950 dark:text-white"
        />
        {error && (
          <p id="session-expired-error" role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-3">
          <Button variant="secondary" onClick={onSignOut} disabled={busy}>
            Sign out
          </Button>
          <Button variant="primary" type="submit" loading={busy} disabled={!password}>
            Sign in
          </Button>
        </div>
      </form>
    </div>
  );
};

export default SessionExpiredDialog;
