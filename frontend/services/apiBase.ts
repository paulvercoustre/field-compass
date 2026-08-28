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
