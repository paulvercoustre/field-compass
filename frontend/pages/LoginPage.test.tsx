import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DPA_URL, TERMS_URL } from '../constants/links';
import LoginPage from './LoginPage';

const auth = vi.hoisted(() => ({ login: vi.fn(), register: vi.fn() }));
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ login: auth.login, register: auth.register, isLoading: false }),
}));

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
      expect(auth.register).toHaveBeenCalledWith('alice@example.org', 'alice', 'Str0ngPassw0rd!23', undefined, true)
    );
  });
});
