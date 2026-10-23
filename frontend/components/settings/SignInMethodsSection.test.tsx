import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SignInMethodsSection from './SignInMethodsSection';

const auth = vi.hoisted(() => ({
  user: null as null | Record<string, unknown>,
  emailEnabled: true,
  refreshUser: vi.fn(),
}));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => auth }));
const api = vi.hoisted(() => ({ removeSignInMethod: vi.fn(), requestPasswordReset: vi.fn() }));
vi.mock('../../services/signInApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/signInApi')>()),
  removeSignInMethod: api.removeSignInMethod,
}));
vi.mock('../../services/accountApi', () => ({ requestPasswordReset: api.requestPasswordReset }));

const person = (overrides: Record<string, unknown>) => ({ email: 'ann@example.org', ...overrides });

describe('SignInMethodsSection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });
  afterEach(cleanup);

  it('keeps the only way in, and offers to set a password by email', async () => {
    auth.user = person({ has_password: false, sign_in_methods: ['google'] });
    api.requestPasswordReset.mockResolvedValue({ message: 'ok' });
    const page = render(<SignInMethodsSection />);

    expect(page.getByText('How you sign in to Field Compass.')).toBeTruthy();
    expect((page.getByRole('button', { name: 'Remove' }) as HTMLButtonElement).disabled).toBe(true);
    // Only what is linked: Microsoft links by signing in with it, under the same address.
    expect(page.queryByText('Microsoft')).toBeNull();
    expect(page.queryByRole('link')).toBeNull();

    fireEvent.click(page.getByRole('button', { name: 'Email me a link to set one' }));
    expect(await page.findByText("We've emailed ann@example.org a link to set a password.")).toBeTruthy();
    expect(api.requestPasswordReset).toHaveBeenCalledWith('ann@example.org');
  });

  it('removes a provider when a password remains', async () => {
    auth.user = person({ has_password: true, sign_in_methods: ['google'] });
    api.removeSignInMethod.mockResolvedValue({});
    const page = render(<SignInMethodsSection />);

    fireEvent.click(page.getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(api.removeSignInMethod).toHaveBeenCalledWith('google'));
    expect(auth.refreshUser).toHaveBeenCalled();
  });

  it('is hidden for an account with a password and nothing linked', () => {
    auth.user = person({ has_password: true, sign_in_methods: [] });
    const page = render(<SignInMethodsSection />);

    expect(page.container.innerHTML).toBe('');
  });
});
