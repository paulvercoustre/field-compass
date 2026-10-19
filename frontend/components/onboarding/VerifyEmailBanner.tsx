import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import Banner from '../ui/Banner';
import { sendVerificationEmail } from '../../services/accountApi';

/**
 * Until the account's address is confirmed, surveys shared with it arrive as
 * invitations and it can't invite anyone. Says so on every page, with a way
 * to have the link sent again. Shown only when the server sends email.
 */
const VerifyEmailBanner: React.FC = () => {
  const { user, emailEnabled, refreshUser } = useAuth();
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const refresh = useRef(refreshUser);
  refresh.current = refreshUser;
  const unconfirmed = emailEnabled && user?.email_verified === false;

  // The link is usually opened in another tab: coming back here, check again.
  useEffect(() => {
    if (!unconfirmed) return;
    const onFocus = () => refresh.current().catch(() => undefined);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [unconfirmed]);

  if (!unconfirmed) return null;

  const resend = async () => {
    setState('sending');
    setError(null);
    try {
      await sendVerificationEmail();
      setState('sent');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the link');
      setState('idle');
    }
  };

  return (
    <div className="flex-shrink-0 px-4 pt-3">
      <Banner tone={error ? 'error' : 'warning'}>
        <span>
          {error ??
            `Confirm your email address: we sent a link to ${user.email}. Until then, surveys shared with you arrive as invitations and you can't invite anyone.`}{' '}
          {state === 'sent' ? (
            <span className="font-medium">Sent. Check your inbox.</span>
          ) : (
            <button
              type="button"
              onClick={resend}
              disabled={state === 'sending'}
              className="font-medium underline underline-offset-2 hover:no-underline disabled:opacity-60"
            >
              {state === 'sending' ? 'Sending…' : 'Send a new link'}
            </button>
          )}
        </span>
      </Banner>
    </div>
  );
};

export default VerifyEmailBanner;
