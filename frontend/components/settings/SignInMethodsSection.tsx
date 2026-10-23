import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import Banner from '../ui/Banner';
import { ProviderMark } from '../auth/ProviderButtons';
import { requestPasswordReset } from '../../services/accountApi';
import { PROVIDER_LABELS, removeSignInMethod, SignInProvider, signInStartUrl } from '../../services/signInApi';

/**
 * Account settings › Sign-in methods: the password, and Google or Microsoft.
 * An account always keeps one way in: the last can't be removed. Connecting
 * a provider is signing in with it; it links when the provider vouches for
 * the account's address. Hidden when the server offers no provider and none
 * is linked.
 */
const SignInMethodsSection: React.FC = () => {
  const { user, signInProviders, emailEnabled, refreshUser } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  if (!user) return null;

  const linked = user.sign_in_methods ?? [];
  const hasPassword = user.has_password !== false;
  const providers = Array.from(new Set<SignInProvider>([...signInProviders, ...linked]));
  if (providers.length === 0) return null;
  const onlyWayIn = (provider: SignInProvider) => !hasPassword && linked.length === 1 && linked[0] === provider;

  const remove = async (provider: SignInProvider) => {
    setBusy(provider);
    setError(null);
    try {
      await removeSignInMethod(provider);
      await refreshUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove it');
    } finally {
      setBusy(null);
    }
  };

  const emailPasswordLink = async () => {
    setBusy('password');
    setError(null);
    try {
      await requestPasswordReset(user.email);
      setNotice(`We've emailed ${user.email} a link to set a password.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the link');
    } finally {
      setBusy(null);
    }
  };

  const row = 'flex items-center justify-between gap-4 py-3';
  const action =
    'text-sm font-medium text-indigo-600 hover:text-indigo-500 disabled:opacity-50 dark:text-indigo-400 dark:hover:text-indigo-300';
  return (
    <section className="bg-white dark:bg-gray-900 rounded-xl shadow-card border border-gray-200 dark:border-gray-800 p-6">
      <h2 className="text-base font-semibold tracking-tight text-gray-900 dark:text-white mb-2">Sign-in methods</h2>
      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
        <li className={row}>
          <span className="text-sm text-gray-900 dark:text-white">Password</span>
          {hasPassword ? (
            <span className="text-sm text-gray-500 dark:text-gray-400">Set</span>
          ) : emailEnabled ? (
            <button type="button" className={action} disabled={busy !== null} onClick={emailPasswordLink}>
              {busy === 'password' ? 'Sending…' : 'Email me a link to set one'}
            </button>
          ) : (
            <span className="text-sm text-gray-500 dark:text-gray-400">Not set</span>
          )}
        </li>
        {providers.map((provider) => (
          <li key={provider} className={row}>
            <span className="flex items-center gap-2.5 text-sm text-gray-900 dark:text-white">
              <ProviderMark provider={provider} />
              {PROVIDER_LABELS[provider]}
            </span>
            {linked.includes(provider) ? (
              <button
                type="button"
                className={action}
                disabled={busy !== null || onlyWayIn(provider)}
                title={onlyWayIn(provider) ? 'Set a password first: it is your only way to sign in.' : undefined}
                onClick={() => remove(provider)}
              >
                {busy === provider ? 'Removing…' : 'Remove'}
              </button>
            ) : (
              <a href={signInStartUrl(provider, '/account')} className={action}>
                Connect
              </a>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        Connecting works with an account that uses {user.email}.
      </p>
      {error && (
        <Banner tone="error" className="mt-3">
          {error}
        </Banner>
      )}
      {notice && (
        <Banner tone="success" className="mt-3">
          {notice}
        </Banner>
      )}
    </section>
  );
};

export default SignInMethodsSection;
