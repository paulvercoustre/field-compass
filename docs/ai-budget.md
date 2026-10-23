# The monthly AI budget

`AI_MONTHLY_BUDGET_USD` caps what the whole service spends on Field Compass's own AI keys (OpenAI for reviews, translations and rule writing, ElevenLabs for transcription) in a calendar month, all accounts together. The per-account limits (`AI_ALLOWANCE_*`, `TRANSCRIPTION_ALLOWANCE_*`) cap one account; this caps the total, so a launch spike, or accounts made to farm the included usage, can't run up an open-ended bill.

The code is `backend/services/ai_budget.py`.

## What happens

| Spend this month | |
|---|---|
| 80% of the budget | The addresses in `USAGE_ADMIN_EMAILS` get an email. |
| 100% | They get a second email, and the included AI pauses for everyone until the 1st (UTC). |

While it is paused:

- AI reviews, translations and transcriptions on Field Compass's keys are held as "not run", with a message saying until when. The first pull after the 1st, or after the budget is raised, runs them.
- AI rule requests are refused with the same message.
- Account settings → AI integration → Usage says the included AI is paused.
- Surveys on an organisation's own AI keys carry on: they cost Field Compass nothing.

Work already queued when the budget is reached still runs, usually a few minutes' worth. The providers' own limits (below) are the hard stop.

Each email goes out once a month per level, checked every five minutes. Without `USAGE_ADMIN_EMAILS` or a working SMTP setup ([email.md](email.md)), the pause still happens but nobody is told.

## How spend is counted

Each AI call's cost is worked out when it is made, from the tokens or the seconds of audio at list price (`backend/services/ai_prices.json`), and stored with it. The budget adds up this month's calls on Field Compass's keys that the provider billed. They are estimates: close to the bill, not to the cent.

- **A price change** never rewrites past calls. Until the price table is updated, new calls are estimated at the old price. Update `ai_prices.json` when OpenAI or ElevenLabs change their prices (the file says when it was last checked).
- **A model missing from the price table**, for example after changing `OPENAI_MODEL`, counts at the table's highest price, so it is never free to the budget. The alert emails and **Settings → App usage** name it: add it to `ai_prices.json`.

## Setting it

1. Choose the number. Compare last month on **Settings → App usage** ("AI budget") with the OpenAI and ElevenLabs dashboards: if they're close, the estimates are good enough to cap on. Set the budget a little below the providers' own limits.
2. In the VM's `.env`:

   ```bash
   AI_MONTHLY_BUDGET_USD=150
   USAGE_ADMIN_EMAILS=you@fieldcompass.org
   ```

3. Recreate the API and the worker, which both read it:

   ```bash
   docker compose -f docker-compose.prod.yml up -d backend worker
   ```

To end a pause before the 1st, raise `AI_MONTHLY_BUDGET_USD` and recreate both again. Empty, there is no ceiling beyond the per-account limits.

## The providers' own limits

The budget is an estimate kept by Field Compass. Keep a hard stop at the providers too:

- **OpenAI:** pay with prepaid credits and leave auto-recharge off, so spending can't pass the balance. Set an email alert in the billing settings.
- **ElevenLabs:** leave usage-based billing off, so transcription stops at the plan's allowance.

When one of them stops first, AI calls fail with the provider's quota error until it is topped up.
