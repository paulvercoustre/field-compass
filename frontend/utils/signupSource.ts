// Where a new account came from, for the admin usage figures. The marketing
// site forwards its campaign tags (?utm_source=...) on its links to the app;
// we keep the first ones seen in this browser and send them with the signup.

const STORAGE_KEY = 'field_compass_signup_source';
const KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'ref'] as const;

type SignupSource = Partial<Record<(typeof KEYS)[number], string>>;

/** Run once on load. First touch wins: a later visit never overwrites it. */
export const captureSignupSource = (): void => {
  try {
    if (localStorage.getItem(STORAGE_KEY)) return;
    const params = new URLSearchParams(window.location.search);
    const source: SignupSource = {};
    for (const key of KEYS) {
      const value = params.get(key)?.trim();
      if (value) source[key] = value.slice(0, 100);
    }
    if (!source.ref && document.referrer) {
      const host = new URL(document.referrer).hostname;
      if (host && host !== window.location.hostname) source.ref = host;
    }
    if (Object.keys(source).length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(source));
    }
  } catch {
    // Storage refused (private window) or a malformed referrer: no source.
  }
};

export const readSignupSource = (): SignupSource | undefined => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? (JSON.parse(stored) as SignupSource) : undefined;
  } catch {
    return undefined;
  }
};
