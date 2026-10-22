# Signing in with Google or Microsoft

Besides an email address and a password, people can sign in with a Google account or a Microsoft account, personal or work (Microsoft 365). Each provider's "Continue with …" button shows once its client ID and secret are in `.env`; without them, nothing changes.

The code is `backend/services/sign_in.py` (the protocol) and `backend/routers/oauth.py` (the endpoints). It is the standard OpenID Connect sign-in, with PKCE, state and nonce; the ID token is checked against the provider's published keys.

## What happens

1. **Someone signs in for the first time.** They see a page asking them to accept the terms and the data processing agreement, then their account is created without a password. The username comes from their address; they can change it in settings.
2. **The provider's address already has an account.** If the provider vouches for the address, the two are linked and they're in. Otherwise they're asked to sign in with their password (the "nOAuth" attack: a Microsoft work account's address is whatever its organisation typed in).
3. **They come back later.** The provider's ID for them (never their address) finds the account, even if their address changed.

Google vouches for its addresses; Microsoft for personal accounts, and for work accounts only through the optional `xms_edov` claim (step 4 below). A new account whose address isn't vouched for gets the usual confirmation email.

In **Settings → Sign-in methods**, people connect or remove a provider. An account without a password can get one through "Email me a link to set one"; the last way in can't be removed.

The privacy notice already lists Google and Microsoft under "Not sub-processors", and what is kept: which provider, its ID for the person, and the address it gave.

## Google

In the [Google Cloud console](https://console.cloud.google.com), signed in with an account Fieldcompass.org keeps (such as `tech@fieldcompass.org`):

1. **Create a project** named `Field Compass`.
2. **Google Auth Platform → Branding**: app name `Field Compass`, support email `support@fieldcompass.org`, home page `https://fieldcompass.org`, privacy policy `https://fieldcompass.org/privacy/`, terms `https://fieldcompass.org/terms/`, authorised domain `fieldcompass.org`, developer contact `tech@fieldcompass.org`. Leave the logo out for now: a logo needs Google to verify the brand first (a few days, from **Verification Center**), and sign-in works without it.
3. **Audience**: user type **External**, then **Publish app**. While it says "Testing", only listed test users can sign in. The app asks only for `openid`, `email` and `profile`, so publishing needs no review.
4. **Clients → Create client**: type **Web application**, name `Field Compass (production)`, **Authorised redirect URIs**: `https://app.fieldcompass.org/api/auth/oauth/google/callback`. No JavaScript origins are needed.
5. Copy the **Client ID** and the **Client secret** into the VM's `.env` (below) and your password manager.

## Microsoft

Many organisations, UN agencies included, let their staff approve only apps from **verified publishers**. Without step 5, those people see "Need admin approval" and must use their email and password instead. Verification costs nothing but takes some days, so start it first.

Partner Center, where publishers are verified, accepts only work accounts: a user in a Microsoft Entra tenant, with an address on `fieldcompass.org`. A personal Microsoft account won't do, whatever its address. The Azure subscription that runs the VM already came with a tenant ("Default Directory"), of which the account that opened it is administrator; use that one. The VM isn't affected.

In the [Microsoft Entra admin center](https://entra.microsoft.com), signed in with the account that owns the Azure subscription:

1. **Identity → Settings → Domain names → Add custom domain**: `fieldcompass.org`. Add the TXT record it shows in Cloudflare, then **Verify**. Add only that TXT record, not Microsoft's MX: mail keeps arriving through Cloudflare Email Routing.
   Then **Users → New user → Create new user**: `tech@fieldcompass.org`, with the **Global Administrator** role. Sign in as it once, in a private window, to set its password and its two-step sign-in (Microsoft Authenticator). Use this account for everything below.
2. **Applications → App registrations → New registration**:
   - name `Field Compass`;
   - supported account types: **Accounts in any organizational directory (any Microsoft Entra ID tenant, multitenant) and personal Microsoft accounts**;
   - redirect URI: platform **Web**, `https://app.fieldcompass.org/api/auth/oauth/microsoft/callback`.

   The **Application (client) ID** on the overview page is `MICROSOFT_CLIENT_ID`.
3. **Certificates & secrets → New client secret**, expiring in 24 months. Copy its **Value** (not its ID) into the VM's `.env` and your password manager, and put its expiry date in a calendar with a month's warning: once it expires, the Microsoft button stops working.
4. **Token configuration → Add optional claim**, token type **ID**: tick `email` and `xms_edov`, and accept adding the Microsoft Graph `email` permission. If `xms_edov` isn't in the list, add it in **Manifest** under `optionalClaims.idToken` as `{"name": "xms_edov", "essential": false}`. Without it, work accounts still sign in, but their address must be confirmed by email and can't be linked to an existing account.
5. **Publisher verification**:
   - **Branding & properties → Publisher domain**: `fieldcompass.org`; there, also fill in home page, terms and privacy links as for Google, and upload the logo;
   - join the [Microsoft AI Cloud Partner Program](https://partner.microsoft.com/dashboard/account/v3/enrollment/introduction/partnership) with a `@fieldcompass.org` address, and complete its verification of Fieldcompass.org (it may ask for proof of registration). Note the **Partner ID** (the "PartnerGlobal" one);
   - back in **Branding & properties**, **Add Partner One ID to verify publisher**. The person doing this needs to be Application Administrator in the tenant and Account Administrator in Partner Center, with two-factor sign-in.

   Once it shows the blue "verified" badge, staff of most organisations can sign in without asking their IT team.

Some organisations block every app their IT team hasn't approved. Their staff keep using email and password, or their IT team approves Field Compass for everyone at `https://login.microsoftonline.com/<their tenant>/adminconsent?client_id=<MICROSOFT_CLIENT_ID>`.

## The VM

In the VM's `.env`:

```bash
GOOGLE_CLIENT_ID=<the client ID from Google step 5>
GOOGLE_CLIENT_SECRET=<the client secret from Google step 5>
MICROSOFT_CLIENT_ID=<the Application (client) ID from Microsoft step 2>
MICROSOFT_CLIENT_SECRET=<the secret's Value from Microsoft step 3>
```

`API_URL` stays empty: Caddy serves the API on the app's address, so the providers send people back to `APP_URL/api/auth/oauth/…`. Then recreate the API:

```bash
docker compose -f docker-compose.prod.yml up -d backend
```

Check it: the sign-in page shows both buttons; signing in with a new Gmail address asks for the terms, then opens the app; signing out and in again goes straight in. In the API log, a refused sign-in reads `Sign-in with <provider> refused: <reason>`, never naming the person.

## Development

Make separate development clients, so production's secrets never sit on a laptop: the same steps, with redirect URIs `http://localhost:8000/api/auth/oauth/google/callback` and `http://localhost:8000/api/auth/oauth/microsoft/callback` (both providers allow plain `http` for `localhost`). In `.env`, set their IDs and secrets and `API_URL=http://localhost:8000`, where the API runs during development.

## Running it

- **The Microsoft secret expires.** Make a new one before then (step 3), put it in `MICROSOFT_CLIENT_SECRET`, recreate `backend`, then delete the old one.
- **Turning a provider off:** empty its two variables and recreate `backend`. Its button disappears; people who signed in only with it get in with "Forgot password?", which sets a password for their account.
- **"Need admin approval" from Microsoft:** the person's organisation doesn't let staff approve apps themselves; see the end of the Microsoft section.
