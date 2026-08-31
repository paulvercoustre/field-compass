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

```bash
./site/set-app-url.sh https://app.YOURDOMAIN.org
```

That rewrites every CTA and prints what it changed. It refuses plain HTTP
(passwords would cross the network in clear), works on both macOS and Linux,
and is safe to re-run — it rewrites whatever origin is currently in place.

The two CTA shapes are deliberate:

| Link | Goes to | Why |
| --- | --- | --- |
| Log in | `<app>/` | The app opens on Sign In by default. |
| Get started / Create an account | `<app>/#register` | `LoginPage.tsx` reads that fragment on mount and opens the registration form, so the CTA lands where it says it will. |

If you change the sign-up links, keep the `#register` fragment or that second
behaviour is lost silently — nothing breaks, people just arrive on Sign In.

Still to update by hand before launch, because they are the *site's* own
address rather than the app's: `<link rel="canonical">` and the two `og:url`
tags in `<head>`, which still say `https://example.com/`.

## 2. Preview locally

```bash
npx --yes serve site -l 4321
```

Then open <http://localhost:4321>.

## 3. Deploy

### Current deployment: the Azure VM, IP only

The CTAs point at `http://20.107.221.180`, and the site is served alongside the
app on the same VM:

| | Address |
| --- | --- |
| App | `http://20.107.221.180/` (`SITE_ADDRESS=:80`) |
| Marketing site | `http://20.107.221.180:8080/` (`WWW_ADDRESS=:8080`) |

Two ports rather than two hostnames, because with no domain there is no way to
tell the sites apart on port 80. `docker-compose.prod.yml` publishes 8080 for
this.

**This is a demo topology, not a launch one.** There is no HTTPS — Let's
Encrypt cannot certify a bare IP — so every password typed into the login form
crosses the network in clear. The site links people to that form, and the page
now carries partner logos. Point a domain at the VM before real accounts exist;
Caddy then obtains certificates on its own and the split below applies.

### With a domain (recommended for launch)

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
- **The quality-loop animation** (`#flow`) is CSS only. Each stage runs the
  same 7s keyframe track offset by a `--i` custom property, so stages fade in
  one after another, light up as the record reaches them, then clear out for
  the next cycle; a dot crosses each connector to arrive exactly as the next
  stage lights up. `animation-fill-mode: backwards` keeps a stage hidden
  during its delay instead of showing it fully drawn and then popping. Under
  `prefers-reduced-motion` the animations are switched off entirely rather
  than collapsed to their end frame -- that frame is "cleared out", so
  collapsing would empty the section. Retiming is two numbers: the `7s`
  duration and the `1.4s` step in the `calc()` delays.
- **The partner carousel** (`#audience`) is a CSS marquee: two identical
  `.marquee__group` lists inside one track, animated to `translateX(-50%)`, so
  the copy lands exactly where the original began and the loop has no seam.
  Both groups must stay identical or the seam appears -- the second is
  `aria-hidden` and its `alt` attributes are empty. It pauses on hover and on
  keyboard focus, and under `prefers-reduced-motion` the animation is switched
  off and the row becomes manually scrollable (collapsing it to its end frame
  would park it half a track to the left).
- **Logo sizing.** These marks range from 0.49 to 4.16 in aspect ratio, so a
  single height would turn the tall ones into slivers. Each `<li>` sets a `--h`
  tuned by eye for equal visual weight; set one when adding a logo rather than
  copying a neighbour's. To resize the whole strip, change `--logo-scale` on
  `.marquee` (mobile already drops it to 0.7) and the row height on
  `.marquee__group li` -- never the individual `--h` values, or the balance
  goes. The strip uses `.container--wide` so it runs past the prose column.
- **Logo files** live in `site/logos/`. Three things to check on any new SVG,
  each of which silently breaks an `<img>`-loaded file:
  1. `xmlns="http://www.w3.org/2000/svg"` must be present. Inline in HTML the
     parser infers it; a standalone file is parsed as XML and fails without it.
     IOM's file shipped without it.
  2. Numeric `width`/`height` on the root element. Missing values, or
     percentages, leave no intrinsic aspect ratio, so `width: auto` collapses
     to zero. Six of these needed it added from their viewBox.
  3. No `<script>` or `on*` handlers.
  Logos render at their real colours -- no grayscale filter -- because most of
  these organisations' brand guidelines forbid recolouring. That is also why
  the strip sits on a light sheet in *both* themes: several marks are black or
  navy and would vanish on the dark theme, so the surface adapts, not the mark.
- **`care.svg` is 236KB**, about 40% of the 560KB logo payload, from very
  high-precision path data. Running the folder through SVGO would cut it
  sharply. Everything is `loading="lazy"` and below the fold, so it is not
  urgent.
- **Only add a logo with the organisation's agreement**, and keep the lead line
  honest as those relationships change. It currently reads "Trusted by teams at
  the world's leading humanitarian and development organisations".
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
