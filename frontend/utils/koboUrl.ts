/**
 * Pull a Kobo project identifier out of whatever the user pastes.
 *
 * Asking for an "asset ID" asks people to know a term Kobo's own interface
 * never shows them. The link to their project is right there in the address
 * bar, so accept that instead and take the identifier out of it.
 *
 * Handles the shapes a project link actually takes:
 *   https://kf.kobotoolbox.org/#/forms/aXXXX
 *   https://kf.kobotoolbox.org/#/forms/aXXXX/summary
 *   https://kf.kobotoolbox.org/#/forms/aXXXX/data/table
 *   https://eu.kobotoolbox.org/#/forms/aXXXX          (regional servers)
 *   https://kf.kobotoolbox.org/api/v2/assets/aXXXX/   (API URLs)
 *   aXXXX                                             (the bare identifier)
 */

/** Kobo identifiers are an "a" followed by base62, typically 22 characters. */
const ASSET_UID = /^a[A-Za-z0-9]{6,40}$/;

/** `/forms/<uid>` or `/assets/<uid>`, anywhere in the string. */
const IN_PATH = /\/(?:forms|assets)\/(a[A-Za-z0-9]{6,40})/;

export function parseKoboAssetId(input: string): string | null {
  const text = (input || '').trim();
  if (!text) return null;

  const inPath = text.match(IN_PATH);
  if (inPath) return inPath[1];

  return ASSET_UID.test(text) ? text : null;
}

/**
 * Whether the input looks like an attempt at a link rather than an identifier.
 *
 * Lets the UI say "that link does not contain a project ID" instead of the
 * less helpful "that is not a project ID".
 */
export function looksLikeUrl(input: string): boolean {
  return /^https?:\/\//i.test((input || '').trim());
}
