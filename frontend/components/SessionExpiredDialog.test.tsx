import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SessionExpiredDialog from './SessionExpiredDialog';

describe('SessionExpiredDialog', () => {
  afterEach(cleanup);

  it('asks for the password', () => {
    const page = render(<SessionExpiredDialog email="ann@example.org" onSignIn={vi.fn()} onSignOut={vi.fn()} />);

    expect(page.getByLabelText('Password')).toBeTruthy();
    expect(page.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  it('offers the providers of an account without a password', () => {
    const page = render(
      <SessionExpiredDialog
        email="ann@example.org"
        hasPassword={false}
        providers={['google']}
        onSignIn={vi.fn()}
        onSignOut={vi.fn()}
      />
    );

    expect(page.queryByLabelText('Password')).toBeNull();
    expect(page.getByRole('link', { name: 'Continue with Google' })).toBeTruthy();
    expect(page.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });
});
