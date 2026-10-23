import React, { useEffect, useRef, useState } from 'react';
import { startSession, useAuth } from '../contexts/AuthContext';
import { LogoTile } from '../components/ui/Logo';
import { Spinner } from '../components/Spinner';
import Banner from '../components/ui/Banner';
import {
  acceptInvitation,
  confirmPasswordReset,
  getInvitation,
  InvitationOffer,
  verifyEmail,
} from '../services/accountApi';
import LoginPage from './LoginPage';
import { DPA_URL, PRIVACY_NOTICE_URL, TERMS_URL } from '../constants/links';
import { exchangeSignIn, finishSignUp, getPendingSignUp, PendingSignUp, safeNext } from '../services/signInApi';
import { readSignupSource } from '../utils/signupSource';

/**
 * The pages a link opens, signed in or not. From an email:
 *
 *   /reset-password?token=…   choose a new password
 *   /verify-email?token=…     confirm the account's address
 *   /invite?token=…           accept a survey invitation
 *
 * And where Google or Microsoft send people back (backend routers/oauth.py):
 *
 *   /signed-in?next=…         swap the sign-in for a session, then go on
 *   /finish-sign-up?next=…    someone new accepts the terms
 */
const PAGES = ['reset-password', 'verify-email', 'invite', 'signed-in', 'finish-sign-up'] as const;
export type EmailLink = { page: (typeof PAGES)[number]; token: string; next: string };

export function emailLinkFrom(location: { pathname: string; search: string }): EmailLink | null {
  const page = location.pathname.replace(/\/+$/, '').slice(1);
  const query = new URLSearchParams(location.search);
  if ((PAGES as readonly string[]).includes(page)) {
    return { page: page as EmailLink['page'], token: query.get('token') ?? '', next: safeNext(query.get('next')) };
  }
  return null;
}

/** Leave the link's page for the app, loading it afresh: the account or its surveys changed. */
const leave = (path = '/') => window.location.replace(path);

const message = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

const Frame: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
  useEffect(() => {
    document.title = `${title} · Field Compass`;
  }, [title]);
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="flex flex-col items-center text-center mb-8">
          <LogoTile size="lg" />
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-gray-900 dark:text-white">{title}</h1>
        </div>
        <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_32px_-12px_rgb(0_0_0/0.12)] dark:border-gray-800 dark:bg-gray-900/80 dark:shadow-none sm:p-7">
          {children}
        </div>
      </div>
    </div>
  );
};

const Waiting: React.FC<{ title: string; words: string }> = ({ title, words }) => (
  <Frame title={title}>
    <div className="flex items-center justify-center gap-2 py-4 text-sm text-gray-500 dark:text-gray-400">
      <Spinner size="sm" />
      <span>{words}</span>
    </div>
  </Frame>
);

/** The sign-in card's button, for the one action on each of these pages. */
const PrimaryButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }> = ({
  loading = false,
  type = 'button',
  children,
  ...rest
}) => (
  <button
    type={type}
    disabled={loading}
    className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white shadow-xs transition-colors hover:bg-indigo-500 disabled:opacity-60 dark:bg-indigo-500 dark:hover:bg-indigo-400"
    {...rest}
  >
    {loading && <Spinner size="sm" className="text-current" />}
    <span>{children}</span>
  </button>
);

const inputClass =
  'block w-full h-10 px-3 text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg shadow-xs text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 transition-shadow';
const labelClass = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5';

export const ResetPasswordPage: React.FC<{ token: string }> = ({ token }) => {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDone, setIsDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError('Password must be at least 8 characters');
    if (password !== confirmation) return setError('Passwords do not match');
    setIsSaving(true);
    try {
      await confirmPasswordReset(token, password);
      setIsDone(true);
    } catch (err) {
      setError(message(err, 'Could not change the password'));
    } finally {
      setIsSaving(false);
    }
  };

  if (isDone) {
    return (
      <Frame title="Password changed">
        <Banner tone="success">Sign in with your new password.</Banner>
        <PrimaryButton onClick={() => leave()}>Sign in</PrimaryButton>
      </Frame>
    );
  }

  return (
    <Frame title="Choose a new password">
      {error && <Banner tone="error">{error}</Banner>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="new-password" className={labelClass}>
            New password
          </label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className={inputClass}
            placeholder="At least 8 characters"
          />
        </div>
        <div>
          <label htmlFor="confirm-new-password" className={labelClass}>
            Confirm new password
          </label>
          <input
            id="confirm-new-password"
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            required
            className={inputClass}
          />
        </div>
        <PrimaryButton type="submit" loading={isSaving}>
          Change password
        </PrimaryButton>
      </form>
    </Frame>
  );
};

export const VerifyEmailPage: React.FC<{ token: string }> = ({ token }) => {
  const [result, setResult] = useState<{ email: string; surveys_added: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    verifyEmail(token)
      .then(setResult)
      .catch((err) => setError(message(err, 'Could not confirm the address')));
  }, [token]);

  if (error) {
    return (
      <Frame title="Link expired">
        <Banner tone="error">{error}</Banner>
        <PrimaryButton onClick={() => leave()}>Go to Field Compass</PrimaryButton>
      </Frame>
    );
  }
  if (!result) return <Waiting title="Confirming your address" words="Confirming…" />;

  const added = result.surveys_added;
  return (
    <Frame title="Address confirmed">
      <Banner tone="success">
        {result.email} is confirmed.
        {added > 0 && ` ${added === 1 ? 'A shared survey was' : `${added} shared surveys were`} added to your list.`}
      </Banner>
      <PrimaryButton onClick={() => leave()}>Continue</PrimaryButton>
    </Frame>
  );
};

export const InvitePage: React.FC<{ token: string }> = ({ token }) => {
  const { user, logout } = useAuth();
  const [offer, setOffer] = useState<InvitationOffer | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getInvitation(token)
      .then(setOffer)
      .catch((err) => setError(message(err, 'This invitation link no longer works')));
  }, [token]);

  const forThisAccount = !!user && !!offer && user.email.toLowerCase() === offer.email;
  const canAccept = forThisAccount && offer?.status !== 'expired';

  // Signed in with the invited address, by arriving so or by signing in or
  // up below: accept, and open the survey. Accepting twice is harmless.
  useEffect(() => {
    if (!canAccept) return;
    acceptInvitation(token)
      .then((survey) => leave(`/surveys/${encodeURIComponent(survey.survey_id)}/submissions`))
      .catch((err) => setError(message(err, 'Could not accept the invitation')));
  }, [canAccept, token]);

  if (error) {
    return (
      <Frame title="Invitation">
        <Banner tone="error">{error}</Banner>
        <PrimaryButton onClick={() => leave()}>Go to Field Compass</PrimaryButton>
      </Frame>
    );
  }
  if (!offer) return <Waiting title="Invitation" words="Opening the invitation…" />;

  if (offer.status === 'expired') {
    return (
      <Frame title="Invitation expired">
        <Banner tone="warning">
          This invitation to {offer.survey_name} has expired. Ask {offer.invited_by} to send it again.
        </Banner>
      </Frame>
    );
  }

  if (!user) return <LoginPage invitation={{ token, offer }} />;

  if (!forThisAccount) {
    return (
      <Frame title="Invitation">
        <Banner tone="warning">
          This invitation is for {offer.email}, but you're signed in as {user.email}.
        </Banner>
        {/* Signing out keeps this address, so the sign-in form opens on the invitation. */}
        <PrimaryButton onClick={logout}>Sign out and continue</PrimaryButton>
      </Frame>
    );
  }

  return <Waiting title="Invitation" words={`Opening ${offer.survey_name}…`} />;
};

/** Back from Google or Microsoft, signed in: swap that for a session, then go on. */
export const SignedInPage: React.FC<{ next: string }> = ({ next }) => {
  const [error, setError] = useState<string | null>(null);
  // Once only: the sign-in can be swapped once.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    exchangeSignIn()
      .then(({ access_token }) => {
        startSession(access_token);
        leave(next);
      })
      .catch((err) => setError(message(err, "Signing in didn't work. Try again.")));
  }, [next]);

  if (error) {
    return (
      <Frame title="Sign-in failed">
        <Banner tone="error">{error}</Banner>
        <PrimaryButton onClick={() => leave()}>Back to sign in</PrimaryButton>
      </Frame>
    );
  }
  return <Waiting title="Signing in" words="Signing you in…" />;
};

/** The invitation a sign-in started from, when it did: `/invite?token=…`. */
const inviteTokenIn = (next: string): string | undefined =>
  next.startsWith('/invite?') ? (new URLSearchParams(next.split('?')[1]).get('token') ?? undefined) : undefined;

/** Someone new, back from Google or Microsoft: accepting the terms creates the account. */
export const FinishSignUpPage: React.FC<{ next: string }> = ({ next }) => {
  const [pending, setPending] = useState<PendingSignUp | null>(null);
  const [expired, setExpired] = useState<string | null>(null);
  const [fullName, setFullName] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    getPendingSignUp()
      .then((offer) => {
        setPending(offer);
        setFullName(offer.name ?? '');
      })
      .catch((err) => setExpired(message(err, 'This sign-up has expired. Start again from the sign-in page.')));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!acceptTerms) {
      return setError('Accept the terms of service and the data processing agreement to create an account');
    }
    setIsSaving(true);
    try {
      const { access_token } = await finishSignUp({
        accept_terms: true,
        full_name: fullName.trim() || undefined,
        signup_source: readSignupSource(),
        invite_token: inviteTokenIn(next),
      });
      startSession(access_token);
      leave(next);
    } catch (err) {
      setError(message(err, 'Could not create the account'));
      setIsSaving(false);
    }
  };

  if (expired) {
    return (
      <Frame title="Sign-up expired">
        <Banner tone="error">{expired}</Banner>
        <PrimaryButton onClick={() => leave()}>Back to sign in</PrimaryButton>
      </Frame>
    );
  }
  if (!pending) return <Waiting title="Create your account" words="Loading…" />;

  const linkClass = 'font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300';
  return (
    <Frame title="Create your account">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        You're signing up with {pending.provider_label} as{' '}
        <strong className="font-medium text-gray-900 dark:text-white">{pending.email}</strong>.
      </p>
      {error && <Banner tone="error">{error}</Banner>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="full-name" className={labelClass}>
            Full name
          </label>
          <input
            id="full-name"
            type="text"
            autoComplete="name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="flex items-start gap-2.5">
          <input
            id="accept-terms"
            type="checkbox"
            checked={acceptTerms}
            onChange={(e) => setAcceptTerms(e.target.checked)}
            className="mt-0.5 h-4 w-4 flex-none rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900"
          />
          <label htmlFor="accept-terms" className="text-sm text-gray-600 dark:text-gray-400">
            I accept the{' '}
            <a href={TERMS_URL} target="_blank" rel="noreferrer" className={linkClass}>
              terms of service
            </a>{' '}
            and, for my organisation, the{' '}
            <a href={DPA_URL} target="_blank" rel="noreferrer" className={linkClass}>
              data processing agreement
            </a>
            .
          </label>
        </div>
        <PrimaryButton type="submit" loading={isSaving}>
          Create account
        </PrimaryButton>
        <p className="text-center text-xs text-gray-500 dark:text-gray-400">
          Read how we handle your data in our{' '}
          <a href={PRIVACY_NOTICE_URL} target="_blank" rel="noreferrer" className={linkClass}>
            privacy notice
          </a>
          .
        </p>
      </form>
    </Frame>
  );
};

/** The page a link opens. */
const EmailLinkPage: React.FC<{ link: EmailLink }> = ({ link }) => {
  if (link.page === 'reset-password') return <ResetPasswordPage token={link.token} />;
  if (link.page === 'verify-email') return <VerifyEmailPage token={link.token} />;
  if (link.page === 'signed-in') return <SignedInPage next={link.next} />;
  if (link.page === 'finish-sign-up') return <FinishSignUpPage next={link.next} />;
  return <InvitePage token={link.token} />;
};

export default EmailLinkPage;
