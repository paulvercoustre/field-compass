# Email (Brevo)

Field Compass sends six kinds of email: address confirmations, password resets, notices that a password was changed, a welcome once the address is confirmed, survey invitations, and notices that a survey was shared with someone. Production sends them through [Brevo](https://www.brevo.com)'s SMTP relay. The code speaks plain SMTP (`backend/services/mailer.py`), so nothing in it is specific to Brevo.

| Without `SMTP_HOST` | |
|---|---|
| Development | Each email is printed to the API's log, link included, instead of being sent. |
| Production | Nothing is sent: no password resets or invitations, and surveys are shared with existing accounts only. |

Brevo is on the sub-processor list in [`site/privacy/`](../site/privacy/index.html). It keeps data in the EU, on Google Cloud in Belgium and OVH in France and Germany. Moving to another provider means adding it to that list first, with the 30 days' notice the data processing agreement promises.

## One-time setup

### 1. The account

First, give `fieldcompass.org` addresses that receive mail. In Cloudflare, **fieldcompass.org → Email → Email Routing**: accept the records it adds (three MX, a DKIM record on `cf2024-1._domainkey`, and the SPF record at `fieldcompass.org`), then forward `tech@`, `support@` and `privacy@fieldcompass.org` to an inbox someone reads. `support@` and `privacy@` are named in the terms and the privacy notice. Email Routing only receives: replies go out from that inbox's own address.

1. Sign up at brevo.com with an address Fieldcompass.org keeps, such as `tech@fieldcompass.org`, not a personal one. The account owns the sending domain and its logs.
2. Fill in the organisation's profile: name Fieldcompass.org, its address in Paris, a phone number. Brevo may review a new account before it can send, and an incomplete profile holds that up.
3. The free plan sends up to 300 emails a day, enough for the beta and the founding cohort. Move to a paid plan before a launch or a training session could pass that: 30 people who sign up and each invite two colleagues send about 90.
4. Turn on two-factor authentication for the account.

### 2. The data processing agreement

Download Brevo's data processing agreement from the account (or from its legal pages) and keep it with the other sub-processors' agreements. Check the Brevo company it names: the privacy notice says **Sendinblue SAS**, Brevo's French company. If yours names another, correct the privacy notice.

### 3. Tracking off

Brevo adds open tracking and rewrites the links in transactional emails by default, so that clicks go through its servers first. One-time password-reset and invitation links would then pass through Brevo, and some organisations' mail filters distrust rewritten links.

The privacy notice says Brevo logs each email's delivery, and nothing about opens or clicks, so tracking must be off. There is no setting for it: open a support ticket asking Brevo to deactivate open and click tracking on transactional email, giving the reason (the links carry one-time tokens, and the privacy notice promises minimal processing). Step 8 checks that it is off.

If Brevo ever turns it back on, put "and whether it is opened and its links clicked" back after "Brevo logs each email's delivery" in Brevo's row in `site/privacy/`.

### 4. The domain

Emails go out from `no-reply@fieldcompass.org`, so `fieldcompass.org` must be authenticated in Brevo. Otherwise Brevo sends under its own domain and the emails land in spam.

1. In Brevo: **Senders, Domains & Dedicated IPs → Domains → Add a domain**, enter `fieldcompass.org`.
2. If Brevo offers a **Branded subdomain**, enter `mail`, making `mail.fieldcompass.org`. Bounces then come back to that subdomain rather than to Brevo's own domain. That lines the emails up with `fieldcompass.org` (SPF alignment), so the DMARC policy can be made strict later, and keeps any deliverability trouble off the root domain. Emails still come from `no-reply@fieldcompass.org`. Brevo is rolling this out gradually; if the field isn't there, carry on without it.
3. Brevo shows the DNS records to add. Copy their values from that page; they differ between accounts:
   - a `brevo-code` TXT record on `fieldcompass.org`, which proves you own the domain;
   - DKIM: two CNAME records, or one TXT record on older accounts. They sit beside Cloudflare's `cf2024-1._domainkey` without trouble;
   - with the branded subdomain, records for `mail.fieldcompass.org`, its own SPF record among them;
   - DMARC: a TXT record on `_dmarc.fieldcompass.org`. There can be only one. If `_dmarc` already exists, keep it and leave Brevo's out.
4. Add them in Cloudflare (**fieldcompass.org → DNS → Records**). Set every CNAME to **DNS only** (grey cloud): Cloudflare's proxy breaks DKIM and the subdomain's records.
5. Back in Brevo, click **Authenticate this email domain**. It can take a few hours, up to 48, for the records to be seen.

The SPF record at `fieldcompass.org` itself belongs to Cloudflare Email Routing (step 1). A domain has one SPF record only: never add a second. Brevo's sending needs none there, either through its own domain or through `mail.fieldcompass.org`'s record. If Brevo's page ever asks for one at the root, add `include:spf.brevo.com` to the existing record instead.

Brevo's suggested DMARC record starts with `p=none`, which only reports. Once a few weeks of reports show every email passing, tighten it to `p=quarantine`.

### 5. The sender

**Senders, Domains & Dedicated IPs → Senders → Add a sender**: name `Field Compass`, address `no-reply@fieldcompass.org`. Replies go to `EMAIL_REPLY_TO` (`support@fieldcompass.org`), so that mailbox must exist and be read.

### 6. The SMTP key

**SMTP & API → SMTP**:
- **Login** is shown at the top. It is the SMTP username, often an address ending in `@smtp-brevo.com`, not the account's email.
- **Generate a new SMTP key**, named `field-compass-production`. It is shown once: put it straight into the VM's `.env` and your password manager. An API key from the next tab does not work for SMTP.

### 7. The VM

In the VM's `.env`:

```bash
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_SECURITY=starttls
SMTP_USERNAME=<the Login from step 6>
SMTP_PASSWORD=<the SMTP key from step 6>
EMAIL_FROM=Field Compass <no-reply@fieldcompass.org>
EMAIL_REPLY_TO=support@fieldcompass.org
APP_URL=https://app.fieldcompass.org
```

Then recreate the API, which sends them:

```bash
docker compose -f docker-compose.prod.yml up -d backend
```

Azure blocks outgoing port 25, not 587, so nothing needs opening on the VM.

### 8. Check it

```bash
docker compose -f docker-compose.prod.yml exec backend \
  python scripts/send_test_email.py you@example.org
```

"Accepted by the server." means Brevo took it. Then:

- it arrives, and not in spam;
- in the received email's headers, DKIM and DMARC say `pass` for `fieldcompass.org`;
- **Transactional → Logs** in Brevo lists it as delivered;
- tracking is off (step 3): in the real emails below, the link points straight to `https://app.fieldcompass.org/…`, not to `brevolinks.com` or `r.mail.fieldcompass.org`, and the HTML holds no tracking image.

Then send yourself all six emails with sample data, and look at them in Gmail, Outlook and on a phone: the logo shows without downloading pictures, the button keeps its shape in Outlook, nothing appears as an attachment.

```bash
docker compose -f docker-compose.prod.yml exec backend \
  python scripts/preview_emails.py --send you@example.org
```

Finally, go through the real thing once: sign up with a fresh address, confirm it, invite a second address, and reset a password.

### 9. The sender's picture in Gmail

Gmail shows the profile photo of a Google account next to emails sent from its address, when they pass DKIM. A free Google account for `no-reply@fieldcompass.org` puts the logo there:

1. In Cloudflare Email Routing, forward `no-reply@fieldcompass.org` to an inbox you read, for the verification code.
2. Create a Google account at accounts.google.com, choosing "Use your existing email" and entering `no-reply@fieldcompass.org`.
3. Give it the Field Compass logo as its profile photo, visible to everyone.

Other mail apps show the logo only through BIMI, which needs the DMARC policy at `p=quarantine` and a paid mark certificate: one for later.

## The emails

Six: confirm the address ("Complete your registration"), reset a password, the password was changed, welcome (after the first confirmation), an invitation, and a survey shared with an existing account. Their words and data are in `backend/services/account_emails.py`; how they look, as HTML and plain text, in `backend/services/email_layout.py`. After changing either, look at the result:

```bash
cd backend && python scripts/preview_emails.py /tmp/emails
```

It writes each email as an `.html` file to open in a browser and a `.txt` file with the plain-text version.

## Running it

- **Bounces:** Brevo stops sending to addresses that hard-bounce. **Transactional → Logs** shows what happened to each email.
- **Failures in the app:** a send that fails is logged by the API as `Email about user <id> failed: <error> (<SMTP code>)`. Logs never name people by address. The person can ask again: "Send a new link", "Forgot password?", or Resend on an invitation.
- **Rotating the key:** generate a new SMTP key, update `SMTP_PASSWORD`, recreate `backend` as in step 7, then delete the old key in Brevo.
