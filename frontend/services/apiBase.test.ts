import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, request, setReauthHandler, TOKEN_KEY } from './apiBase';

const respond = (status: number, body?: unknown, statusText = '') =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, statusText });

describe('request', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem(TOKEN_KEY, 'tok');
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    localStorage.clear();
    setReauthHandler(null);
  });

  it('sends the token and parses the body', async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { ok: 1 }));
    await expect(request<{ ok: number }>('/api/x')).resolves.toEqual({ ok: 1 });
    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  });

  it('resolves undefined for an empty body', async () => {
    fetchMock.mockResolvedValueOnce(respond(204));
    await expect(request('/api/x', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it("rejects with the server's detail, status and body", async () => {
    fetchMock.mockResolvedValueOnce(respond(409, { detail: 'Busy', run: { id: 1 } }));
    const error: ApiError = await request('/api/x').then(
      () => {
        throw new Error('resolved');
      },
      (e: ApiError) => e
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe('Busy');
    expect(error.status).toBe(409);
    expect(error.body.run).toEqual({ id: 1 });
  });

  it('falls back to the status text when the body has no detail', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 502, statusText: 'Bad Gateway' }));
    await expect(request('/api/x')).rejects.toThrow('Bad Gateway');
  });

  it('retries once after signing in again on a 401', async () => {
    setReauthHandler(async () => {
      localStorage.setItem(TOKEN_KEY, 'fresh');
      return true;
    });
    fetchMock.mockResolvedValueOnce(respond(401, { detail: 'Expired' }));
    fetchMock.mockResolvedValueOnce(respond(200, { ok: 2 }));
    await expect(request('/api/x')).resolves.toEqual({ ok: 2 });
    expect(new Headers(fetchMock.mock.calls[1][1].headers).get('Authorization')).toBe('Bearer fresh');
  });
});
