import { request } from './apiBase';

/**
 * Email-backed account steps: resetting a password, confirming an address,
 * and survey invitations from the invited person's side. All but the last
 * two work signed out, from a link in an email.
 */

/** Whether the server can send email: a password reset needs it. */
export const getAuthOptions = () => request<{ email_enabled: boolean }>('/api/auth/options');

export const requestPasswordReset = (email: string) =>
  request<{ message: string }>('/api/auth/password-reset', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });

export const confirmPasswordReset = (token: string, newPassword: string) =>
  request<{ message: string }>('/api/auth/password-reset/confirm', {
    method: 'POST',
    body: JSON.stringify({ token, new_password: newPassword }),
  });

export const verifyEmail = (token: string) =>
  request<{ email: string; surveys_added: number }>('/api/auth/verify-email', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });

/** Signed in: email a new link to confirm the account's address. */
export const sendVerificationEmail = () =>
  request<{ email_verified: boolean; sent_to?: string }>('/api/users/me/verification-email', { method: 'POST' });

export interface InvitationOffer {
  email: string;
  survey_name: string;
  invited_by: string;
  permission_level: 'editor' | 'viewer';
  status: 'open' | 'accepted' | 'expired';
  /** An account uses the address: sign in rather than create one. */
  account_exists: boolean;
}

export const getInvitation = (token: string) =>
  request<InvitationOffer>(`/api/invitations/${encodeURIComponent(token)}`);

/** Signed in with the invited address: accept, and learn where the survey is. */
export const acceptInvitation = (token: string) =>
  request<{ survey_id: string; survey_name: string }>(`/api/invitations/${encodeURIComponent(token)}/accept`, {
    method: 'POST',
  });
