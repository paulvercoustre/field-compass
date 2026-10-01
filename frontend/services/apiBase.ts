/**
 * API base URL, shared by every API client.
 *
 * VITE_API_URL is the API's ORIGIN (e.g. https://api.example.org). Request
 * paths already carry the /api prefix, so an empty value means "same origin",
 * which is what the bundled Caddy proxy serves.
 *
 * A value of "/api" is a path prefix, not an origin: older deploy docs
 * recommended it, and combined with the /api already in every request path it
 * produced /api/api/... and a 404 on every call. Strip a trailing /api so
 * those existing deployments keep working without editing their .env.
 */
const configured = (import.meta.env.VITE_API_URL ?? '')
  .trim()
  .replace(/\/api\/?$/, '')
  .replace(/\/$/, '');

export const API_BASE_URL =
  configured || (import.meta.env.DEV ? 'http://localhost:8000' : '');

/**
 * Asks the user to sign in again and resolves with the new token, or rejects
 * if they chose to sign out instead. Registered by AuthProvider.
 */
type SessionExpiredHandler = () => Promise<string>;

let sessionExpiredHandler: SessionExpiredHandler | null = null;
// One prompt answers every request that hit the expiry at the same time.
let pendingReauth: Promise<string> | null = null;

export const setSessionExpiredHandler = (handler: SessionExpiredHandler | null) => {
  sessionExpiredHandler = handler;
};

const TOKEN_KEY = 'field_compass_token';

const sentAuthorization = (headers: HeadersInit | undefined): string | null =>
  headers === undefined ? null : new Headers(headers).get('Authorization');

const retryWithToken = (input: string, init: RequestInit, token: string) => {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
};

/**
 * fetch() for every authenticated API call.
 *
 * An expired token used to surface as whatever each page made of a 401 --
 * "Failed to fetch submissions.", or "Could not validate credentials" with a
 * Try again that ran a whole Kobo pull -- while the app still looked signed
 * in. Here a 401 instead holds the request open, asks the user to sign in
 * again, and retries it with the new token. Nothing on the page unmounts, so
 * a half-typed note or unsaved setting is still there afterwards, and the
 * action the user took simply completes.
 *
 * Requests sent without a token (login, register) are left alone: their 401
 * means "wrong password", not "session expired".
 */
export const apiFetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
  const response = await fetch(input, init);

  const sent = sentAuthorization(init.headers);
  if (response.status !== 401 || !sessionExpiredHandler || !sent) {
    return response;
  }

  // Sent with a token that has since been replaced (the user signed in again
  // while this request was in flight): just retry with the current one.
  const current = localStorage.getItem(TOKEN_KEY);
  if (current && sent !== `Bearer ${current}`) {
    return retryWithToken(input, init, current);
  }

  if (!pendingReauth) {
    pendingReauth = sessionExpiredHandler().finally(() => {
      pendingReauth = null;
    });
  }

  let token: string;
  try {
    token = await pendingReauth;
  } catch {
    // Signed out instead. The caller handles the 401 as it always has; the
    // login page replaces the app regardless.
    return response;
  }

  return retryWithToken(input, init, token);
};
