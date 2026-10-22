import { API_BASE_URL, request } from './apiBase';

/**
 * Signing in with Google or Microsoft (backend routers/oauth.py). The browser
 * leaves for the provider and comes back to /signed-in or /finish-sign-up;
 * who signed in travels in short-lived cookies the API set, so these calls
 * send cookies along (`credentials: 'include'`), never a token in a URL.
 */

export type SignInProvider = 'google' | 'microsoft';

export const PROVIDER_LABELS: Record<SignInProvider, string> = {
  google: 'Google',
  microsoft: 'Microsoft',
};

/** Where to land after signing in: a path in the app, never another site. */
export const safeNext = (path: string | null | undefined): string =>
  path && path.startsWith('/') && !path.startsWith('//') && !path.includes('\\') ? path : '/';

/** The address that leaves for the provider, coming back to `next`. */
export const signInStartUrl = (provider: SignInProvider, next = '/') =>
  `${API_BASE_URL}/api/auth/oauth/${provider}/start?next=${encodeURIComponent(safeNext(next))}`;

/** The token for a sign-in that just came back from the provider. */
export const exchangeSignIn = () =>
  request<{ access_token: string }>('/api/auth/oauth/session', { method: 'POST', credentials: 'include' });

export interface PendingSignUp {
  provider: SignInProvider;
  provider_label: string;
  email: string;
  name: string | null;
}

/** Someone new who signed in with a provider, before they accept the terms. */
export const getPendingSignUp = () => request<PendingSignUp>('/api/auth/oauth/pending', { credentials: 'include' });

export const finishSignUp = (body: {
  accept_terms: boolean;
  full_name?: string;
  signup_source?: Record<string, string> | null;
  invite_token?: string;
}) =>
  request<{ access_token: string }>('/api/auth/oauth/finish', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify(body),
  });

/** Stop signing in with a provider; the server keeps at least one way in. */
export const removeSignInMethod = (provider: SignInProvider) =>
  request<unknown>(`/api/users/me/sign-in/${provider}`, { method: 'DELETE' });

/** What the sign-in page says when the provider sent someone back with ?sign_in_error=. */
export const signInErrorMessage = (reason: string | null): string | null => {
  if (!reason) return null;
  const messages: Record<string, string> = {
    cancelled: 'Sign-in was cancelled.',
    expired: 'That sign-in took too long or was started in another window. Try again.',
    account_exists: 'An account already uses this email address. Sign in with your password.',
    no_email: "The account you chose didn't share an email address. Create an account with your email instead.",
    disabled: 'This account is disabled.',
  };
  return messages[reason] ?? "Signing in didn't work. Try again.";
};
