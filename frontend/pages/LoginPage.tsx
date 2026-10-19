import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { LogoTile } from '../components/ui/Logo';
import { Spinner } from '../components/Spinner';
import Banner from '../components/ui/Banner';
import { DPA_URL, PRIVACY_NOTICE_URL, TERMS_URL } from '../constants/links';
import { InvitationOffer, requestPasswordReset } from '../services/accountApi';

type Mode = 'login' | 'register' | 'forgot';

interface LoginPageProps {
  /** Opened from a survey invitation: the address is the invited one. */
  invitation?: { token: string; offer: InvitationOffer };
}

const LoginPage: React.FC<LoginPageProps> = ({ invitation }) => {
  const { login, register, emailEnabled, isLoading: authLoading } = useAuth();

  // The marketing site links straight here with #register on its "Create an
  // account" buttons, so that CTA opens the registration form rather than
  // dropping people on Sign In with an extra click to find. Any other entry
  // opens on Sign In as before. An invitation opens on whichever its address
  // needs: signing in to the account it has, or creating one.
  const [mode, setMode] = useState<Mode>(() => {
    if (invitation) return invitation.offer.account_exists ? 'login' : 'register';
    return ['#register', '#signup'].includes(window.location.hash.toLowerCase()) ? 'register' : 'login';
  });
  const isLogin = mode === 'login';
  const [email, setEmail] = useState(invitation?.offer.email ?? '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      if (mode === 'forgot') {
        setResetSent((await requestPasswordReset(email)).message);
      } else if (isLogin) {
        await login(email, password);
      } else {
        // Validate registration
        if (password !== confirmPassword) {
          throw new Error('Passwords do not match');
        }
        if (password.length < 8) {
          throw new Error('Password must be at least 8 characters');
        }
        if (!acceptTerms) {
          throw new Error('Accept the terms of service and the data processing agreement to create an account');
        }
        await register(email, username, password, fullName || undefined, acceptTerms, invitation?.token);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  const switchMode = (to: Mode) => {
    setMode(to);
    setError(null);
    setResetSent(null);
  };

  const title = { login: 'Sign in to Field Compass', register: 'Create your account', forgot: 'Reset your password' }[
    mode
  ];
  const linkClass = 'font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300';

  const inputClass =
    'block w-full h-10 px-3 text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg shadow-xs text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 transition-shadow';
  const labelClass = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5';

  return (
    <div className="relative min-h-screen overflow-hidden bg-gray-50 dark:bg-gray-950 flex flex-col items-center justify-center px-4 py-10">
      {/* A soft glow and a faint grid that fades out: depth without noise. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(ellipse_60%_60%_at_50%_0%,rgba(99,102,241,0.16),transparent_70%)] dark:bg-[radial-gradient(ellipse_60%_60%_at_50%_0%,rgba(99,102,241,0.22),transparent_70%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.5] dark:opacity-[0.25] [background-image:linear-gradient(to_right,rgb(0_0_0/0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgb(0_0_0/0.04)_1px,transparent_1px)] dark:[background-image:linear-gradient(to_right,rgb(255_255_255/0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.06)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_70%_55%_at_50%_0%,black,transparent_75%)]"
      />

      <div className="relative w-full max-w-sm animate-fade-in">
        {/* Logo/Title */}
        <div className="flex flex-col items-center text-center mb-8">
          <LogoTile size="lg" />
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-gray-900 dark:text-white">{title}</h1>
          <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">Data quality for KoboToolbox surveys</p>
        </div>

        {invitation && (
          <Banner tone="info" className="mb-4">
            {invitation.offer.invited_by} invited you to <strong>{invitation.offer.survey_name}</strong>.{' '}
            {invitation.offer.account_exists
              ? 'Sign in to open it.'
              : 'Create your account to open it: the invitation confirms your address.'}
          </Banner>
        )}

        {/* Card */}
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_32px_-12px_rgb(0_0_0/0.12)] dark:border-gray-800 dark:bg-gray-900/80 dark:shadow-none sm:p-7">
          {/* Error message */}
          {error && (
            <div
              role="alert"
              className="mb-5 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-inset ring-red-600/15 dark:bg-red-500/10 dark:text-red-200 dark:ring-red-400/20"
            >
              {error}
            </div>
          )}

          {resetSent && (
            <Banner tone="success" className="mb-5">
              {resetSent} The link works for one hour.
            </Banner>
          )}

          {mode === 'forgot' && !resetSent && (
            <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
              Enter the address you sign in with, and we'll email you a link to choose a new password.
            </p>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className={labelClass}>
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                readOnly={!!invitation}
                className={`${inputClass} read-only:bg-gray-50 read-only:text-gray-600 dark:read-only:bg-gray-800/60 dark:read-only:text-gray-400`}
                placeholder="you@example.com"
              />
            </div>

            {mode === 'register' && (
              <>
                <div>
                  <label htmlFor="username" className={labelClass}>
                    Username
                  </label>
                  <input
                    id="username"
                    type="text"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    className={inputClass}
                    placeholder="Choose a username"
                  />
                </div>

                <div>
                  <label htmlFor="fullName" className={labelClass}>
                    Full name <span className="font-normal text-gray-400 dark:text-gray-500">(optional)</span>
                  </label>
                  <input
                    id="fullName"
                    type="text"
                    autoComplete="name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className={inputClass}
                    placeholder="Your full name"
                  />
                </div>
              </>
            )}

            {mode !== 'forgot' && (
              <div>
                <div className="flex items-baseline justify-between">
                  <label htmlFor="password" className={labelClass}>
                    Password
                  </label>
                  {isLogin && emailEnabled && (
                    <button type="button" onClick={() => switchMode('forgot')} className={`text-sm ${linkClass}`}>
                      Forgot password?
                    </button>
                  )}
                </div>
                <input
                  id="password"
                  type="password"
                  autoComplete={isLogin ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  className={inputClass}
                  placeholder={isLogin ? '••••••••' : 'At least 8 characters'}
                />
              </div>
            )}

            {mode === 'register' && (
              <div>
                <label htmlFor="confirmPassword" className={labelClass}>
                  Confirm password
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className={inputClass}
                  placeholder="••••••••"
                />
              </div>
            )}

            {mode === 'register' && (
              <div className="flex items-start gap-2.5">
                <input
                  id="acceptTerms"
                  type="checkbox"
                  checked={acceptTerms}
                  onChange={(e) => setAcceptTerms(e.target.checked)}
                  required
                  className="mt-0.5 h-4 w-4 flex-none rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900"
                />
                <label htmlFor="acceptTerms" className="text-sm text-gray-600 dark:text-gray-400">
                  I accept the{' '}
                  <a
                    href={TERMS_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
                  >
                    terms of service
                  </a>{' '}
                  and, for my organisation, the{' '}
                  <a
                    href={DPA_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
                  >
                    data processing agreement
                  </a>
                  .
                </label>
              </div>
            )}

            {!(mode === 'forgot' && resetSent) && (
              <button
                type="submit"
                disabled={isSubmitting || authLoading}
                className="mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white shadow-xs transition-colors hover:bg-indigo-500 disabled:opacity-60 dark:bg-indigo-500 dark:hover:bg-indigo-400"
              >
                {isSubmitting ? (
                  <>
                    <Spinner size="sm" className="text-current" />
                    <span>{{ login: 'Signing in…', register: 'Creating account…', forgot: 'Sending…' }[mode]}</span>
                  </>
                ) : (
                  <span>{{ login: 'Sign in', register: 'Create account', forgot: 'Email me a link' }[mode]}</span>
                )}
              </button>
            )}

            {mode === 'register' && (
              <p className="text-center text-xs text-gray-500 dark:text-gray-400">
                Read how we handle your data in our{' '}
                <a
                  href={PRIVACY_NOTICE_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
                >
                  privacy notice
                </a>
                .
              </p>
            )}
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
          {{ login: 'New to Field Compass?', register: 'Already have an account?', forgot: 'Remembered it?' }[mode]}{' '}
          <button type="button" onClick={() => switchMode(isLogin ? 'register' : 'login')} className={linkClass}>
            {isLogin ? 'Create an account' : 'Sign in'}
          </button>
        </p>
      </div>

      {/* Footer */}
      <p className="relative mt-12 text-xs text-gray-400 dark:text-gray-500">
        Field Compass © {new Date().getFullYear()} ·{' '}
        <a
          href={PRIVACY_NOTICE_URL}
          target="_blank"
          rel="noreferrer"
          className="hover:text-gray-600 dark:hover:text-gray-300"
        >
          Privacy
        </a>{' '}
        ·{' '}
        <a href={TERMS_URL} target="_blank" rel="noreferrer" className="hover:text-gray-600 dark:hover:text-gray-300">
          Terms
        </a>
      </p>
    </div>
  );
};

export default LoginPage;
