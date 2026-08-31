# Field Compass — marketing site

A single static landing page. No build step, no dependencies: `index.html`,
`styles.css`, `main.js`. Copy the three files anywhere that serves static
files and it works.

```
site/
├── index.html   # the page
├── styles.css   # hand-written, mirrors the app's dark indigo palette
└── main.js      # one listener that borders the nav on scroll
```

## 1. Point it at your app

Every "Log in" / "Create an account" link uses the placeholder host
`https://app.example.com`. Replace it with your real app URL:

```bash
sed -i '' 's|https://app.example.com|https://app.YOURDOMAIN.org|g' site/index.html
```

(On Linux, drop the `''` after `-i`.) Verify nothing was missed:

```bash
grep -c "app.example.com" site/index.html
```

Also worth updating before launch:

- `<link rel="canonical">` and the two `og:url` tags in `<head>` — they still
  say `https://example.com/`.
- The GitHub links in the nav, CTA and footer, if the repository moves.

## 2. Preview locally

```bash
npx --yes serve site -l 4321
```

Then open <http://localhost:4321>.

## 3. Deploy

### On the existing VM (recommended)

The site and the app are served by the same Caddy, on two hostnames. This keeps
the app's session cookies and its strict CSP on an origin the public page can't
touch, and it needs no change to the app bundle.

1. Point two A records at the VM:
   - `fieldcompass.example.org` → VM IP
   - `app.fieldcompass.example.org` → VM IP
2. In `.env` on the VM:
   ```env
   WWW_ADDRESS=https://fieldcompass.example.org
   SITE_ADDRESS=https://app.fieldcompass.example.org
   CORS_ORIGINS=https://app.fieldcompass.example.org
   ```
3. Redeploy:
   ```bash
   docker compose -f docker-compose.prod.yml up -d caddy
   ```

Caddy requests Let's Encrypt certificates for both names on first start.
`site/` is bind-mounted read-only, so subsequent content edits are a `git pull`
plus `docker compose -f docker-compose.prod.yml restart caddy`.

`WWW_ADDRESS` defaults to `:8081`, which the compose file does not publish —
leaving it unset keeps the deployment exactly as it was.

### Anywhere else

Netlify, Vercel, GitHub Pages, S3 + CloudFront, or any web server: publish the
contents of `site/` as the document root. There is nothing to build.

## Notes

- **Fonts.** Inter loads from Google Fonts, with a system-font fallback stack,
  so the page still reads correctly if that request is blocked. To go fully
  self-contained, drop the two `<link rel="preconnect">` tags and the
  stylesheet link, and remove `fonts.googleapis.com` / `fonts.gstatic.com`
  from the site's CSP in `deploy/caddy/Caddyfile`.
- **The quality-loop animation** (`#flow`) is four CSS keyframe tracks offset
  by a `--i` custom property on each stage, so the highlight walks the
  pipeline and a dot crosses each connector exactly as the next stage lights
  up. Every track starts and ends on the resting state, because the
  reduced-motion rule at the bottom of `styles.css` collapses animations to
  their end state -- with motion off the section is a clean static diagram.
  Retiming is one number: the `7s` duration and the `1.4s` step in the
  `calc()` delays.
- **The dashboard illustration** in the hero is HTML and CSS, not a
  screenshot — no image assets to re-export when the UI changes, but it also
  won't update on its own. The figures in it are illustrative.
- **Light and dark.** The page follows the visitor's OS setting via
  `prefers-color-scheme`, the same mechanism as the app's `darkMode: 'media'`.
  Light is the default. The dashboard mock, the code sample and the CTA band
  stay dark in both themes -- they opt into a set of inverted tokens defined in
  one block in `styles.css`, so a dark screenshot sits on a light page. To
  change a colour, edit the tokens at the top of `styles.css`; nothing below
  hardcodes a palette value.
