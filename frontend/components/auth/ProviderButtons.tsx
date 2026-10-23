import React from 'react';
import { PROVIDER_LABELS, SignInProvider, signInStartUrl } from '../../services/signInApi';

/** Google's "G", in its own colours, as its branding guidelines ask. */
const GoogleMark = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path
      fill="#EA4335"
      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
    />
    <path
      fill="#4285F4"
      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
    />
    <path
      fill="#FBBC05"
      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
    />
    <path
      fill="#34A853"
      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
    />
  </svg>
);

/** Microsoft's four squares. */
const MicrosoftMark = () => (
  <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
    <rect x="1" y="1" width="9" height="9" fill="#F25022" />
    <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
    <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
    <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
  </svg>
);

const MARKS: Record<SignInProvider, React.FC> = { google: GoogleMark, microsoft: MicrosoftMark };

/** The provider's logo, 18px. */
export const ProviderMark: React.FC<{ provider: SignInProvider }> = ({ provider }) => {
  const Mark = MARKS[provider];
  return <Mark />;
};

/**
 * "Continue with Google / Microsoft": links that leave for the provider and
 * come back to `next`. Only the providers the server has set up are passed.
 */
const ProviderButtons: React.FC<{ providers: SignInProvider[]; next?: string }> = ({ providers, next = '/' }) => (
  <div className="space-y-2.5">
    {providers.map((provider) => {
      const Mark = MARKS[provider];
      return (
        <a
          key={provider}
          href={signInStartUrl(provider, next)}
          className="flex h-10 w-full items-center justify-center gap-2.5 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-800 shadow-xs transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
        >
          <Mark />
          <span>Continue with {PROVIDER_LABELS[provider]}</span>
        </a>
      );
    })}
  </div>
);

export default ProviderButtons;
