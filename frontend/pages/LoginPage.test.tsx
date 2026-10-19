import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DPA_URL, TERMS_URL } from '../constants/links';
import LoginPage from './LoginPage';

const auth = vi.hoisted(() => ({ login: vi.fn(), register: vi.fn(), emailEnabled: true }));
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ login: auth.login, register: auth.register, emailEnabled: auth.emailEnabled, isLoading: false }),
}));
const account = vi.hoisted(() => ({ requestPasswordReset: vi.fn() }));
vi.mock('../services/accountApi', () => account);

// The marketing site's "Create an account" buttons open the form this way.
function openSignUp() {
  window.location.hash = '#register';
  const page = render(<LoginPage />);
  const field = (id: string, value: string) =>
    fireEvent.change(page.container.querySelector(`#${id}`) as HTMLInputElement, { target: { value } });
  field('email', 'alice@example.org');
  field('username', 'alice');
  field('password', 'Str0ngPassw0rd!23');
  field('confirmPassword', 'Str0ngPassw0rd!23');
  return page;
}

describe('Sign-up', () => {
  beforeEach(() => {
    auth.register.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    window.location.hash = '';
  });

  it('links the terms of service and the data processing agreement', () => {
    const page = openSignUp();

    expect(page.getByRole('link', { name: 'terms of service' }).getAttribute('href')).toBe(TERMS_URL);
    expect(page.getByRole('link', { name: 'data processing agreement' }).getAttribute('href')).toBe(DPA_URL);
  });

  it('does not create an account until the terms are accepted', async () => {
    const page = openSignUp();

    fireEvent.submit(page.getByRole('button', { name: 'Create account' }));

    expect(await page.findByText(/Accept the terms of service/)).toBeTruthy();
    expect(auth.register).not.toHaveBeenCalled();
  });

  it('sends the acceptance with the account', async () => {
    const page = openSignUp();

    fireEvent.click(page.getByRole('checkbox'));
    fireEvent.submit(page.getByRole('button', { name: 'Create account' }));

    await waitFor(() =>
      expect(auth.register).toHaveBeenCalledWith(
        'alice@example.org',
        'alice',
        'Str0ngPassw0rd!23',
        undefined,
        true,
        undefined
      )
    );
  });
});

describe('Forgotten password', () => {
  beforeEach(() => {
    auth.emailEnabled = true;
    account.requestPasswordReset.mockReset().mockResolvedValue({
      message: "If an account uses that address, we've emailed it a link to choose a new password.",
    });
  });

  afterEach(cleanup);

  it('emails a link to the address given', async () => {
    const page = render(<LoginPage />);

    fireEvent.click(page.getByRole('button', { name: 'Forgot password?' }));
    expect(page.getByRole('heading', { name: 'Reset your password' })).toBeTruthy();
    expect(page.container.querySelector('#password')).toBeNull();
    fireEvent.change(page.container.querySelector('#email') as HTMLInputElement, {
      target: { value: 'alice@example.org' },
    });
    fireEvent.submit(page.getByRole('button', { name: 'Email me a link' }));

    expect(await page.findByText(/we've emailed it a link/)).toBeTruthy();
    expect(account.requestPasswordReset).toHaveBeenCalledWith('alice@example.org');
    expect(page.queryByRole('button', { name: 'Email me a link' })).toBeNull();
  });

  it('is not offered when the server cannot send email', () => {
    auth.emailEnabled = false;
    const page = render(<LoginPage />);

    expect(page.queryByRole('button', { name: 'Forgot password?' })).toBeNull();
  });
});

describe('From an invitation', () => {
  const offer = {
    email: 'carol@example.org',
    survey_name: 'Household survey',
    invited_by: 'Alice',
    permission_level: 'viewer' as const,
    status: 'open' as const,
    account_exists: false,
  };

  beforeEach(() => {
    auth.register.mockReset().mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it('creates the account for the invited address, with the invitation', async () => {
    const page = render(<LoginPage invitation={{ token: 'tok', offer }} />);

    expect(page.getByText(/Alice invited you to/)).toBeTruthy();
    const email = page.container.querySelector('#email') as HTMLInputElement;
    expect(email.value).toBe('carol@example.org');
    expect(email.readOnly).toBe(true);
    const field = (id: string, value: string) =>
      fireEvent.change(page.container.querySelector(`#${id}`) as HTMLInputElement, { target: { value } });
    field('username', 'carol');
    field('password', 'Str0ngPassw0rd!23');
    field('confirmPassword', 'Str0ngPassw0rd!23');
    fireEvent.click(page.getByRole('checkbox'));
    fireEvent.submit(page.getByRole('button', { name: 'Create account' }));

    await waitFor(() =>
      expect(auth.register).toHaveBeenCalledWith(
        'carol@example.org',
        'carol',
        'Str0ngPassw0rd!23',
        undefined,
        true,
        'tok'
      )
    );
  });

  it('opens on signing in when the address has an account', () => {
    const page = render(<LoginPage invitation={{ token: 'tok', offer: { ...offer, account_exists: true } }} />);

    expect(page.getByRole('heading', { name: 'Sign in to Field Compass' })).toBeTruthy();
  });
});
