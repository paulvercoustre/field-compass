import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../services/apiBase';
import {
  emailLinkFrom,
  FinishSignUpPage,
  InvitePage,
  ResetPasswordPage,
  SignedInPage,
  VerifyEmailPage,
} from './EmailLinkPages';

const auth = vi.hoisted(() => ({
  user: null as null | { email: string },
  logout: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
}));
const session = vi.hoisted(() => ({ startSession: vi.fn() }));
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ ...auth, emailEnabled: true, signInProviders: [], isLoading: false }),
  startSession: session.startSession,
}));
const account = vi.hoisted(() => ({
  acceptInvitation: vi.fn(),
  confirmPasswordReset: vi.fn(),
  getInvitation: vi.fn(),
  requestPasswordReset: vi.fn(),
  verifyEmail: vi.fn(),
}));
vi.mock('../services/accountApi', () => account);
const signIn = vi.hoisted(() => ({ exchangeSignIn: vi.fn(), getPendingSignUp: vi.fn(), finishSignUp: vi.fn() }));
vi.mock('../services/signInApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/signInApi')>()),
  ...signIn,
}));

const offer = {
  email: 'carol@example.org',
  survey_name: 'Household survey',
  invited_by: 'Alice',
  permission_level: 'viewer' as const,
  status: 'open' as const,
  account_exists: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  auth.user = null;
});
afterEach(cleanup);

describe('emailLinkFrom', () => {
  it('reads the page and the token', () => {
    expect(emailLinkFrom({ pathname: '/verify-email', search: '?token=abc' })).toEqual({
      page: 'verify-email',
      token: 'abc',
      next: '/',
    });
    expect(emailLinkFrom({ pathname: '/invite/', search: '?token=x-y_z' })).toMatchObject({
      page: 'invite',
      token: 'x-y_z',
    });
    expect(emailLinkFrom({ pathname: '/surveys/1/submissions', search: '' })).toBeNull();
  });

  it('reads where a sign-in goes next, never another site', () => {
    expect(emailLinkFrom({ pathname: '/signed-in', search: '?next=%2Fsurveys%2Fs-1' })).toMatchObject({
      page: 'signed-in',
      next: '/surveys/s-1',
    });
    for (const next of ['https://evil.example.org', '//evil.example.org']) {
      expect(emailLinkFrom({ pathname: '/finish-sign-up', search: `?next=${encodeURIComponent(next)}` })).toMatchObject(
        {
          page: 'finish-sign-up',
          next: '/',
        }
      );
    }
  });
});

describe('Confirming an address', () => {
  it('says it is confirmed, and how many surveys came with it', async () => {
    account.verifyEmail.mockResolvedValue({ email: 'carol@example.org', surveys_added: 2 });
    const page = render(<VerifyEmailPage token="abc" />);

    expect(await page.findByText(/carol@example.org is confirmed/)).toBeTruthy();
    expect(page.getByText(/2 shared surveys were added to your list/)).toBeTruthy();
    expect(account.verifyEmail).toHaveBeenCalledWith('abc');
  });

  it('says no more than that when no survey came with it', async () => {
    account.verifyEmail.mockResolvedValue({ email: 'carol@example.org', surveys_added: 0 });
    const page = render(<VerifyEmailPage token="abc" />);

    expect(await page.findByText('carol@example.org is confirmed.')).toBeTruthy();
  });

  it("says why when the link doesn't work", async () => {
    account.verifyEmail.mockRejectedValue(new ApiError('This link has expired. Sign in to get a new one.', 400, {}));
    const page = render(<VerifyEmailPage token="old" />);

    expect(await page.findByText('This link has expired. Sign in to get a new one.')).toBeTruthy();
  });
});

describe('Resetting a password', () => {
  it('checks the two passwords match before sending', async () => {
    const page = render(<ResetPasswordPage token="abc" />);
    const field = (id: string, value: string) =>
      fireEvent.change(page.container.querySelector(`#${id}`) as HTMLInputElement, { target: { value } });

    field('new-password', 'Str0ngPassw0rd!23');
    field('confirm-new-password', 'Different!23');
    fireEvent.submit(page.getByRole('button', { name: 'Change password' }));
    expect(await page.findByText('Passwords do not match')).toBeTruthy();
    expect(account.confirmPasswordReset).not.toHaveBeenCalled();

    account.confirmPasswordReset.mockResolvedValue({ message: 'ok' });
    field('confirm-new-password', 'Str0ngPassw0rd!23');
    fireEvent.submit(page.getByRole('button', { name: 'Change password' }));
    expect(await page.findByText('Sign in with your new password.')).toBeTruthy();
    expect(account.confirmPasswordReset).toHaveBeenCalledWith('abc', 'Str0ngPassw0rd!23');
  });
});

describe('An invitation', () => {
  it('asks someone signed out to create their account', async () => {
    account.getInvitation.mockResolvedValue(offer);
    const page = render(<InvitePage token="tok" />);

    expect(await page.findByText(/Alice invited you to/)).toBeTruthy();
    expect(page.getByRole('heading', { name: 'Create your account' })).toBeTruthy();
    expect(account.acceptInvitation).not.toHaveBeenCalled();
  });

  it('is accepted for someone signed in with the invited address', async () => {
    auth.user = { email: 'Carol@example.org' };
    account.getInvitation.mockResolvedValue(offer);
    account.acceptInvitation.mockReturnValue(new Promise(() => {}));
    const page = render(<InvitePage token="tok" />);

    await waitFor(() => expect(account.acceptInvitation).toHaveBeenCalledWith('tok'));
    expect(page.getByText('Opening Household survey…')).toBeTruthy();
  });

  it('asks someone signed in with another address to switch', async () => {
    auth.user = { email: 'bob@example.org' };
    account.getInvitation.mockResolvedValue(offer);
    const page = render(<InvitePage token="tok" />);

    expect(await page.findByText(/This invitation is for carol@example.org/)).toBeTruthy();
    fireEvent.click(page.getByRole('button', { name: 'Sign out and continue' }));
    expect(auth.logout).toHaveBeenCalled();
    expect(account.acceptInvitation).not.toHaveBeenCalled();
  });

  it('says who to ask when it has expired', async () => {
    account.getInvitation.mockResolvedValue({ ...offer, status: 'expired' });
    const page = render(<InvitePage token="tok" />);

    expect(await page.findByText(/Ask Alice to send it again/)).toBeTruthy();
  });
});

describe('Back from Google or Microsoft', () => {
  it('swaps the sign-in for a session', async () => {
    signIn.exchangeSignIn.mockResolvedValue({ access_token: 'the-token' });
    render(<SignedInPage next="/surveys/s-1/submissions" />);

    await waitFor(() => expect(session.startSession).toHaveBeenCalledWith('the-token'));
    expect(signIn.exchangeSignIn).toHaveBeenCalledTimes(1);
  });

  it('says so when the sign-in has expired', async () => {
    signIn.exchangeSignIn.mockRejectedValue(new ApiError('This sign-in has expired. Try again.', 401, {}));
    const page = render(<SignedInPage next="/" />);

    expect(await page.findByText('This sign-in has expired. Try again.')).toBeTruthy();
    expect(page.getByRole('button', { name: 'Back to sign in' })).toBeTruthy();
    expect(session.startSession).not.toHaveBeenCalled();
  });

  it('asks someone new to accept the terms, then creates the account', async () => {
    signIn.getPendingSignUp.mockResolvedValue({
      provider: 'microsoft',
      provider_label: 'Microsoft',
      email: 'bo@contoso.org',
      name: 'Bo Lind',
    });
    signIn.finishSignUp.mockResolvedValue({ access_token: 'new-token' });
    const page = render(<FinishSignUpPage next="/invite?token=inv-1" />);

    expect(await page.findByText('bo@contoso.org')).toBeTruthy();
    expect(page.getByText(/signing up with Microsoft/)).toBeTruthy();
    expect((page.container.querySelector('#full-name') as HTMLInputElement).value).toBe('Bo Lind');

    fireEvent.submit(page.getByRole('button', { name: 'Create account' }));
    expect(await page.findByText(/Accept the terms of service/)).toBeTruthy();
    expect(signIn.finishSignUp).not.toHaveBeenCalled();

    fireEvent.click(page.getByRole('checkbox'));
    fireEvent.submit(page.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(session.startSession).toHaveBeenCalledWith('new-token'));
    expect(signIn.finishSignUp).toHaveBeenCalledWith(
      expect.objectContaining({ accept_terms: true, full_name: 'Bo Lind', invite_token: 'inv-1' })
    );
  });

  it('says so when the sign-up has expired', async () => {
    signIn.getPendingSignUp.mockRejectedValue(
      new ApiError('This sign-up has expired. Start again from the sign-in page.', 404, {})
    );
    const page = render(<FinishSignUpPage next="/" />);

    expect(await page.findByText(/This sign-up has expired/)).toBeTruthy();
  });
});
