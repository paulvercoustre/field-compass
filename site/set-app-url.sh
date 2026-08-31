#!/usr/bin/env bash
# Point the marketing site's CTAs at the deployed application.
#
#   ./site/set-app-url.sh https://app.fieldcompass.org
#
# Rewrites every app link in site/index.html. Sign-in CTAs go to the app root;
# sign-up CTAs keep the #register fragment, which opens the app's registration
# form directly instead of dropping people on Sign In.
#
# Safe to run repeatedly -- it rewrites whatever origin is currently in place.
set -euo pipefail

HTML="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/index.html"

if [ $# -ne 1 ]; then
  echo "usage: $(basename "$0") <app-url>" >&2
  echo "example: $(basename "$0") https://app.fieldcompass.org" >&2
  exit 64
fi

NEW="${1%/}"   # tolerate a trailing slash

case "$NEW" in
  https://*|http://localhost*|http://127.0.0.1*) ;;
  http://*)
    echo "refusing: $NEW is plain HTTP. Passwords would cross the network in" >&2
    echo "clear. Use https:// (or localhost for development)." >&2
    exit 1 ;;
  *)
    echo "refusing: $NEW does not start with a scheme (https://...)" >&2
    exit 1 ;;
esac

# Derive the current app origin from a #register link. That fragment appears
# only on the sign-up CTAs, so it can't be confused with the canonical URL,
# the GitHub links, or the font host -- an earlier version of this script
# matched the first https:// href in the file and rewrote <link rel=canonical>.
CURRENT="$(grep -oE 'href="https?://[^"]+#register"' "$HTML" \
           | head -1 | sed -E 's|href="(https?://[^/]+).*|\1|')"

if [ -z "$CURRENT" ]; then
  echo "could not find an app link in $HTML — has it been edited?" >&2
  exit 1
fi

if [ "$CURRENT" = "$NEW" ]; then
  echo "already pointing at $NEW — nothing to do"
  exit 0
fi

# -i takes a mandatory argument on BSD sed and none on GNU; sidestep both.
tmp="$(mktemp)"
sed "s|${CURRENT}|${NEW}|g" "$HTML" > "$tmp" && mv "$tmp" "$HTML"

echo "rewrote ${CURRENT} -> ${NEW}"
echo
grep -oE 'href="'"${NEW}"'[^"]*"[^>]*>[^<]+' "$HTML" \
  | sed -E 's|href="([^"]+)"[^>]*>(.*)|  \2  ->  \1|'
echo
remaining="$(grep -c "$CURRENT" "$HTML" || true)"
[ "$remaining" = "0" ] || { echo "WARNING: $remaining reference(s) to $CURRENT remain" >&2; exit 1; }
echo "Remember:"
echo "  - the app must be reachable at $NEW"
echo "  - CORS_ORIGINS on the backend must list that exact origin"
echo "  - <link rel=canonical> and the og:url tags still point at the SITE's"
echo "    own address; this script deliberately does not touch them"
