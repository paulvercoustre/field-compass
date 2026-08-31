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

ALLOW_INSECURE=0
ARGS=()
for a in "$@"; do
  case "$a" in
    --allow-insecure) ALLOW_INSECURE=1 ;;
    *) ARGS+=("$a") ;;
  esac
done

if [ ${#ARGS[@]} -ne 1 ]; then
  echo "usage: $(basename "$0") [--allow-insecure] <app-url>" >&2
  echo "example: $(basename "$0") https://app.fieldcompass.org" >&2
  exit 64
fi

NEW="${ARGS[0]%/}"   # tolerate a trailing slash

case "$NEW" in
  https://*|http://localhost*|http://127.0.0.1*) ;;
  http://*)
    if [ "$ALLOW_INSECURE" -eq 1 ]; then
      echo "WARNING: $NEW is plain HTTP." >&2
      echo "  These buttons carry people to a login form. Over HTTP every" >&2
      echo "  password typed there crosses the network in clear, and any" >&2
      echo "  network in between can read it." >&2
      echo "  Let's Encrypt cannot issue a certificate for a bare IP, so the" >&2
      echo "  fix is a domain pointed at the VM -- then Caddy gets a cert on" >&2
      echo "  its own. Acceptable meanwhile only for a demo with throwaway" >&2
      echo "  accounts and no real users." >&2
      echo >&2
    else
      echo "refusing: $NEW is plain HTTP. Passwords would cross the network in" >&2
      echo "clear. Use https:// (or localhost for development)." >&2
      echo "If this is a throwaway demo, re-run with --allow-insecure." >&2
      exit 1
    fi ;;
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
