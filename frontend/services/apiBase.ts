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

const TOKEN_KEY = 'field_compass_token';

/**
 * Asked when a signed-in request comes back 401: resolves true once the
 * person has signed in again (the request is then retried), false if they
 * chose to sign out. Set by the AuthProvider.
 */
type ReauthHandler = () => Promise<boolean>;
let reauthHandler: ReauthHandler | null = null;
let pendingReauth: Promise<boolean> | null = null;

export const setReauthHandler = (handler: ReauthHandler | null) => {
  reauthHandler = handler;
};

/**
 * fetch() for every API client. When a session expires, a request that was
 * sent signed in gets a 401: rather than losing the page (and whatever was
 * typed on it), this asks the person to sign in again over the page, then
 * retries the request with the new token. Requests that fail together share
 * one sign-in. A request sent without a token (signing in, registering) is
 * returned as it is, so a wrong password stays an ordinary error.
 */
export const apiFetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
  const response = await fetch(input, init);
  const headers = new Headers(init.headers);
  if (response.status !== 401 || !headers.has('Authorization') || !reauthHandler) return response;

  pendingReauth ??= reauthHandler().finally(() => {
    pendingReauth = null;
  });
  if (!(await pendingReauth)) return response;

  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return response;
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
};
