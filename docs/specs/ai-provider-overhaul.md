# Design: AI provider overhaul

Status: draft for review · Branch: `claude/ai-provider-overhaul`

## 1. Summary

Field Compass calls an LLM for three features: writing a rule from a
sentence, suggesting rules for a form, and the per-submission qualitative
checks. All three run on one operator-paid OpenAI key read from the
environment, and the qualitative checks report a failed call as a clean
result.

This design does three things:

1. **Bring your own provider, per survey.** A survey owner can connect any
   OpenAI-compatible endpoint (OpenAI, Azure OpenAI, OpenRouter, Mistral,
   Groq, a self-hosted Ollama or vLLM, and others) with their own key.
2. **A capped free allowance.** Surveys without their own provider run on the
   operator's key, up to a monthly allowance. Usage is recorded, so the cap
   is enforceable and visible.
3. **Honest status.** A failed, skipped or stalled AI check says so in plain
   language, is retried when that can help, and is never shown as "No issues
   detected".

It also folds in the AI findings of the UI/UX review (F-10, F-12, F-13,
F-17, F-24).

## 2. Why

### 2.1 Cost has no ceiling

The qualitative checks make one call per submission, and repeat it whenever
the submission's monitored text or the AI check settings change. Measured on
RFS Market Assessment (512 submissions, 18 monitored fields):

| | Value |
|---|---|
| Submissions needing a call | 512 / 512 |
| Input per call | ~1,300 tokens median, ~2,700 max |
| One full pass | ~0.7M input tokens |
| Output per call | up to 2,500 tokens allowed; `gpt-5-mini` bills its reasoning as output |

One pass over one survey is cheap. The problem is that nothing bounds the
total: it grows with users × surveys × re-runs, and all of it lands on the
operator's account. Rule writing and suggestions are user-triggered,
rate-limited to 20/hour per IP, and small in comparison.

### 2.2 Data protection

Survey answers can contain personal data. Today every monitored answer is
sent to OpenAI under the operator's account, which makes the operator the
data processor for every organisation using the app. Many UN agencies and
NGOs may only send data to a provider they hold a contract with — often
Azure OpenAI in their own tenant and region — or to a model they host.
Bringing their own provider makes that possible and puts the responsibility
where the contract is.

### 2.3 Failures look like success

`AIService.check_qualitative_responses` catches every OpenAI error and
returns `[]` (`services/ai_service.py:741-746`). The worker cannot tell that
from "no issues" and stores `llm_check_status = "success"`
(`services/qualitative_worker_runtime.py:153`). The detail page then says
"No qualitative issues detected in the latest AI check." With a revoked key,
an outage, or a rate limit, every submission looks checked and clean, and
none is retried: their inputs and rules have not changed.

Observed locally: all 512 RFS Market Assessment submissions are in this
state after the configured key started returning 401.

### 2.4 Related UI/UX review findings

| Finding | Problem | Addressed in |
|---|---|---|
| F-10 B | AI findings never update `qa_status`, so AI-only issues are never "needs review" | §7.3 |
| F-12 | "AI qualitative checks queued" and other jargon | §8.4 |
| F-13 B | LLM queue errors not isolated from deterministic results (the list/str crash part shipped in #64) | §7.2 |
| F-17 | A check that never finishes shows "in progress" forever; the AI section shows when AI is off | §7.4, §8.3 |
| F-24 | "Add to Editor" saves AI rules live, with no review | §8.5 |

## 3. Goals and non-goals

**Goals**
- Any OpenAI-compatible endpoint works for all three AI features.
- The operator's spend is bounded by configuration, not by user behaviour.
- Every AI check ends in a state a reviewer can understand and act on.
- No stored key is ever returned to a browser or written to a log.

**Non-goals (this design)**
- Providers without an OpenAI-compatible API (no native Anthropic or Gemini
  SDKs). Both offer OpenAI-compatible endpoints; native SDKs can come later
  behind the same interface.
- Billing or payments. The allowance is a cap, not a plan.
- Organisations or workspaces. A connection belongs to a user (§5.1); sharing
  across an organisation is future work.
- Changing what the qualitative checks look for.

## 4. Approach: OpenAI-compatible endpoints

A connection is three values: a **base URL**, an **API key**, and a **model
name**. The existing `openai` Python SDK accepts a `base_url`, so the call
site barely changes. Presets fill in the base URL:

| Preset | Base URL | Notes |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | Default |
| Azure OpenAI | `https://{resource}.openai.azure.com/openai/v1/` | Azure's v1 endpoint; the model name is the deployment name |
| OpenRouter | `https://openrouter.ai/api/v1` | Many vendors' models behind one key |
| Mistral | `https://api.mistral.ai/v1` | |
| Groq | `https://api.groq.com/openai/v1` | |
| Self-hosted (Ollama, vLLM, LM Studio) | e.g. `http://ollama:11434/v1` | Private addresses need operator opt-in (§9.2) |
| Custom | anything | |

Presets are a convenience in the UI only; the backend stores the URL.

### 4.1 What varies between endpoints

The current code assumes OpenAI's newest behaviour. Three request details
differ across compatible endpoints, and one hard-codes a model name:

| Detail | Today | Variation |
|---|---|---|
| JSON output | `response_format: json_schema` with `strict: true` | Some endpoints/models support only `json_object`, some neither |
| Output limit | `max_completion_tokens` | Older and self-hosted servers accept only `max_tokens` |
| Temperature | Sent unless the model name starts with `gpt-5` | Reasoning models reject it; others need it |

Rather than branching on model names, each connection stores a **capability
profile** measured by its connection test (§6.2):

```json
{
  "structured_output": "json_schema",   // json_schema | json_object | prompt_only
  "token_param": "max_completion_tokens", // max_completion_tokens | max_tokens
  "temperature": false                   // whether a temperature is accepted
}
```

The profile is also **learned from rejections**: it starts at the most
capable setting, and when an endpoint rejects a request because of one of
these details (its error names `temperature`, the token parameter, or
`response_format`), the client steps that detail down and retries, at most
three times. The operator key keeps what it learned per model for the life
of the process; connections will persist it (phase 2).

Every response is still validated against the feature's schema, whatever the
mode (§7.2), and parsed leniently — some endpoints accept `response_format`
and still wrap the JSON in prose or code fences. With `json_object` or `prompt_only`, the schema is included in
the prompt and the reply is parsed leniently (first JSON object in the text).

## 5. Data model

Three changes, as one Alembic revision plus `models.py` and `schema.sql`
(the parity test enforces the last two agree).

### 5.1 `ai_connections` (new)

A user's saved provider. Owned by a user so that one key can serve all the
surveys that user owns, without pasting it into each.

| Column | Type | Notes |
|---|---|---|
| `connection_id` | UUID PK | |
| `owner_user_id` | FK `users` | Only the owner can view, edit, attach or delete it |
| `label` | text | "WFP Azure — East Africa" |
| `preset` | text | `openai`, `azure`, `openrouter`, `mistral`, `groq`, `self_hosted`, `custom` |
| `base_url` | text | Validated (§9.2) |
| `api_key_encrypted` | text | Fernet, as Kobo tokens are; nullable for keyless self-hosted servers |
| `api_key_hint` | text | Last 4 characters, for display |
| `check_model` | text | Model for qualitative checks |
| `rule_model` | text, nullable | Model for rule writing; falls back to `check_model` |
| `capabilities` | JSONB | §4.1, written by the connection test |
| `status` | text | `untested`, `ok`, `failing` |
| `last_tested_at`, `last_error` | timestamptz, text | Last test or last circuit-breaker trip (§7.5) |
| `created_at`, `updated_at` | timestamptz | |

### 5.2 `survey_configs.ai_connection_id` (new column)

Nullable FK to `ai_connections`. `NULL` means the survey uses the operator's
allowance. Only the survey owner can set it, and only to a connection they
own; editors and viewers see the label and status, never the key.

If the survey changes owner, or the connection's owner deletes it, the column
is cleared and the survey falls back to the allowance. The settings page says
so.

### 5.3 `ai_usage` (new)

One row per AI call. This is what the allowance counts and what the usage
display reads.

| Column | Type | Notes |
|---|---|---|
| `usage_id` | bigserial PK | |
| `survey_id` | FK `survey_configs` | |
| `connection_id` | FK, nullable | `NULL` = operator key. Added in phase 2, with `ai_connections` |
| `feature` | text | `qualitative_check`, `rule_generation`, `rule_suggestion` |
| `submission_id` | bigint, nullable | Qualitative checks only |
| `model` | text | |
| `input_tokens`, `output_tokens` | int, nullable | From the response's `usage`, when the endpoint reports it |
| `outcome` | text | `ok` or an error category (§7.1) |
| `created_at` | timestamptz | Indexed with `survey_id` for the monthly count |

No prompt or response text is stored.

### 5.4 `submissions_current` statuses

`llm_check_status` gains values; no schema change (it is free text):

| Status | Meaning | Re-queued on next pull? |
|---|---|---|
| `pending`, `running` | Queued or in progress | No |
| `success` | Checked; findings (possibly none) stored | Only if inputs or rules change |
| `failed` | Last attempt failed; `llm_last_error` holds the category and message | Yes, unless the connection is `failing` (§7.5) |
| `not_run_allowance` | Free allowance used up this month | Yes, once allowance is available or a connection is attached |
| `skipped` | AI checks off, or no monitored fields | No |

`llm_last_error` keeps the human-readable message; a new prefix
`<category>: ` (e.g. `auth: Incorrect API key provided`) lets the UI pick
copy without parsing provider messages.

## 6. Backend design

### 6.1 `AIClient`: one place that talks to providers

A new module, `services/ai_client.py`, replaces the direct `OpenAI(...)`
construction in `AIService`:

```python
@dataclass(frozen=True)
class ResolvedProvider:
    base_url: str
    api_key: str | None
    model: str
    capabilities: Capabilities
    connection_id: UUID | None   # None = operator key

class AIClient:
    def complete_json(self, provider, *, system, user, schema, max_output) -> AIResult
```

- `resolve_provider(survey, feature) -> ResolvedProvider | AllowanceExhausted`
  picks the survey's connection, or the operator key while allowance remains.
- `complete_json` builds the request from the capability profile, sends it,
  validates the reply against `schema`, records an `ai_usage` row, and returns
  `AIResult(data, usage)` — or raises a typed `AIError` (§7.1). It never
  returns a default value on failure.
- `AIService` keeps the prompts and schemas for the three features and calls
  `complete_json`. The `gpt-5` name checks go away.

The operator key keeps its existing environment variables (`OPENAI_API_KEY`,
`OPENAI_MODEL`, `OPENAI_QUAL_CHECK_MODEL`, …) plus an optional
`OPENAI_BASE_URL`, so an operator can point the allowance at Azure too.

### 6.2 Connection test

`POST /api/ai/connections/{id}/test` sends a tiny structured request (a
two-field schema) and probes, in order: `json_schema` → `json_object` →
prompt only; `max_completion_tokens` → `max_tokens`; with and without a
temperature. The first combination that returns a valid object is saved as
the capability profile, with `status = ok`. A 401/403 or an unreachable host
ends the probe early with a plain message.

It costs a few hundred tokens on the user's key and runs on save and on
demand.

### 6.3 Endpoints

| Method | Path | Who |
|---|---|---|
| `GET` | `/api/ai/connections` | Current user's connections (key never included; `api_key_hint` only) |
| `POST` | `/api/ai/connections` | Create; runs the test |
| `PATCH` | `/api/ai/connections/{id}` | Edit label, URL, models; a new key replaces the old one, an omitted key keeps it |
| `DELETE` | `/api/ai/connections/{id}` | Detaches it from every survey first |
| `POST` | `/api/ai/connections/{id}/test` | Re-run the test |
| `PUT` | `/api/surveys/{id}/ai-connection` | Owner attaches one of their connections, or `null` for the allowance |
| `GET` | `/api/ai/usage` | For each survey the user owns: provider, allowance used and remaining, and calls and tokens this month by feature; plus today's free rule requests |

`/api/ai/generate-rule` and `/api/ai/suggest-rules` keep their contracts and
resolve the provider from the survey.

## 7. Making AI checks honest

### 7.1 Error categories

`AIClient` maps every failure to one of:

| Category | From | Retry? |
|---|---|---|
| `auth` | 401, 403 | No — trips the connection breaker (§7.5) |
| `provider_quota` | 429 with an insufficient-quota code, 402 | No — trips the breaker |
| `rate_limited` | Other 429 | Yes, backoff honouring `Retry-After` |
| `unavailable` | 5xx, connection error | Yes, backoff |
| `timeout` | Request timeout | Yes, backoff |
| `bad_response` | Unparseable or schema-invalid reply | Once, then fail |
| `bad_request` | Other 4xx (wrong model name, context too long) | No |

### 7.2 Qualitative check flow

```
pipeline (per submission)
  ├─ deterministic checks → stored, independent of anything below (F-13 B)
  └─ AI check wanted?
       ├─ survey has a connection, connection failing → status failed (auth/provider_quota), not queued
       ├─ no connection, allowance used up → status not_run_allowance, not queued
       └─ otherwise → queue (status pending)

worker
  ├─ AIClient.complete_json(...)
  │    ├─ ok → store findings, status success, recompute qa_status (§7.3)
  │    ├─ retryable → Celery retry, exponential backoff + jitter, max 4 attempts
  │    └─ not retryable / retries exhausted → status failed, llm_last_error "<category>: message"
  └─ (never) a failure stored as success
```

A failure in the AI queue cannot roll back or alter deterministic results,
and a pull's summary counts AI outcomes separately from deterministic ones.

### 7.3 AI findings update `qa_status` (F-10 B)

After storing findings, the worker recomputes `qa_status` with
`HFCEngine.determine_qa_status` over deterministic + AI issues, so AI-only
issues appear in "needs review" counts. The Kobo validation status keeps its
existing precedence (Approved or Not Approved in Kobo wins).

### 7.4 No check stays "in progress" forever (F-17 B)

A Celery beat task runs every 5 minutes and marks as `failed`
(`timeout: The AI check did not finish.`):
- `running` checks started more than 15 minutes ago — a call times out after
  120 s and at most four are made, so the worker is gone;
- `pending` checks queued more than 6 hours ago — the queue message is lost.
  A shorter limit would fail checks that a large pull legitimately keeps
  queued.

They are re-queued on the next pull. Beat runs inside the worker (`-B`); the
sweep is an idempotent UPDATE, so a second beat from a scaled-out worker only
repeats it.

### 7.5 Connection circuit breaker

Three consecutive `auth` or `provider_quota` failures on one connection set
its `status = failing` and `last_error`. While failing:
- no new checks are queued for its surveys (they are marked `failed` with the
  connection's error, so nobody waits on doomed calls);
- the settings page and submission detail say why and link to the fix;
- a successful connection test sets it back to `ok`, and the next pull
  re-queues the failed checks.

The operator key gets the same breaker, surfaced to the operator in logs and
to users as "AI checks are temporarily unavailable".

## 8. UI design

### 8.1 Account Settings › AI providers

Providers are managed in one place, Account Settings, not per survey. Each
provider shows its status, the reason when it is not working, and the last
four characters of its key, with **Surveys**, **Test**, **Edit** and
**Delete**:

```
AI providers                                              [ Add a provider ]
Test OpenAI  [Not working]
OpenAI · api.openai.com · gpt-4o-mini · key ••••2222
The provider rejected the key. AI checks on its surveys are paused until it
passes a test.
Used by: RFS Market Assessment
[ Surveys ] [ Test ] [ Edit ] [ Delete ]
  ┌ Surveys that use Test OpenAI ─────────────────────────────┐
  │ [x] RFS Market Assessment                                  │
  │ [ ] MCBP Market Assessment - LLA   (uses WFP Azure)        │
  │ For these surveys, the answers to the questions selected   │
  │ for AI checks are sent, with their question labels, to     │
  │ Test OpenAI (api.openai.com).                              │
  └────────────────────────────────────────────────────────────┘
```

**Surveys** lists the surveys the user owns; ticking one moves it onto this
provider, unticking puts it back on the allowance. **Delete** uses the same
in-app confirmation dialog as deleting a survey and names the surveys that
go back to the allowance.

### 8.2 Add / edit a provider (dialog)

Fields: Provider (preset list) → Base URL (pre-filled, editable for Azure,
self-hosted and custom) → API key (write-only; shows `••••abcd` once saved) →
Model for checks → Model for rule writing (optional) → **Save and test**.

The test result is shown in place: "Connected · structured output supported ·
replied in 1.2 s", or the plain-language error and what to check. Saving
with a failing test is allowed (an endpoint may be down briefly), with the
status shown as failing; saving again edits that provider rather than
adding a second one.

### 8.3 Submission detail — AI section

Hidden entirely when AI checks are off (F-17). Otherwise one of:

| State | Copy | Action |
|---|---|---|
| `success`, no findings | "Checked — no problems found in the selected answers." | — |
| `success`, findings | Findings, as today | — |
| `pending` / `running` | "Checking…" | — |
| `failed` / `auth` | "Couldn't check: the AI provider rejected the key." | Owner: "Update the key" |
| `failed` / `provider_quota` | "Couldn't check: the AI provider account is out of credit." | Owner: "Open provider settings" |
| `failed` / other | "Couldn't check this time. It will be retried on the next pull." | — |
| `not_run_allowance` | "Not checked: this survey has used its free AI allowance for October." | Owner: "Use your own provider" |

### 8.4 Pull summary (F-12)

The pull banner reports AI outcomes in words, separately from the
deterministic checks: "AI checks: 120 started · 30 not run (free allowance
used)". When the connection is failing: "AI checks paused — the provider
rejected the key." in amber, never green.

### 8.5 AI rule builder (F-24 B)

"Add to Editor" loads the generated rule into the manual rule editor; it is
saved only when the user saves it there. Suggestions get "Review" instead of
an immediate save. Both use the survey's provider, so they count against the
allowance when on the operator key.

### 8.6 Usage

Account Settings › **AI use in <month>**, below AI providers: today's free
AI rule requests ("1 of 30"), then one row per survey the user owns: what it
runs on (the allowance or a provider), AI checks ("143 of 200" with a bar
that turns amber when used up, or a count and "no Field Compass limit"),
rules written, failures, and tokens in / out. Served by `GET /api/ai/usage`.
Tokens are as reported by the provider; no cost is computed, since prices
differ by provider and change.

## 9. Security

### 9.1 Keys

- Encrypted with the existing Fernet helper (`services/auth.encrypt_api_key`).
- Never returned by any endpoint; responses carry `api_key_hint` only.
- Never logged: `AIClient` logs the connection id, host, model and category,
  not headers or bodies.
- Providers echo part of a rejected key in their error text
  (`sk-inval****ting`); stored errors replace any key fragment with
  `[key hidden]`, since they are shown to everyone with access to the survey.
- **Production must set `ENCRYPTION_KEY`.** Without it, the key is derived
  from `JWT_SECRET_KEY`, and rotating the JWT secret would make every stored
  AI and Kobo key unreadable. Startup should log an error when
  `ENCRYPTION_KEY` is unset outside development.

### 9.2 Base URL validation (server-side request forgery)

A user-supplied URL makes the server send requests on the user's behalf. To
stop it reaching internal services or cloud metadata:
- `https` only, unless the operator sets `AI_ALLOW_PRIVATE_ENDPOINTS=true`.
- Resolve the host and reject loopback, link-local (incl. `169.254.169.254`),
  and private ranges unless that same flag is set — checked at save time and
  again at request time (DNS can change).
- No redirects followed.

Self-hosted models on a private network therefore need the operator's
opt-in, which is the right default for a shared deployment and a one-line
change for a single-organisation one.

### 9.3 Authorisation

Connections are visible only to their owner. Attaching one to a survey
requires owning both. A shared survey's editors use the attached connection
through the survey without being able to read or reuse it elsewhere.

## 10. Free allowance

Configured by the operator; proposed defaults:

| Variable | Default | Meaning |
|---|---|---|
| `AI_ALLOWANCE_CHECKS_PER_SURVEY_MONTH` | 200 | Qualitative checks per survey per calendar month (UTC) on the operator key |
| `AI_ALLOWANCE_RULE_REQUESTS_PER_USER_DAY` | 30 | Rule generations + suggestions per user per day on the operator key. The per-IP 20/hour limit stays as abuse protection |
| `AI_ALLOWANCE_ENABLED` | `true` if `OPENAI_API_KEY` is set | With it off, AI features require a connection |

Counting reads `ai_usage` (`connection_id IS NULL`), and only calls that
cost credit: `ok` and `bad_response`. A timeout or a rejected key spent
nothing. Checks already queued or running are reserved against the
allowance, so one large pull cannot overshoot it. When a pull would exceed
the allowance, the first submissions in pull order are queued up to the
limit and the rest are marked `not_run_allowance`; a later pull queues them
once there is allowance again. Rule requests record the user
(`ai_usage.user_id`, revision `0004`) and are refused with 429 once the
daily limit is reached. A survey with its own connection has no Field
Compass limit; its provider's limits apply.

## 11. Delivery plan

Each phase is shippable on its own, in this order.

| Phase | Scope | Notes |
|---|---|---|
| **0. Honest status** | §7.1 categories inside the current `AIService`; failures stored as `failed`; retry with backoff; `qa_status` recompute (§7.3); stalled-check sweep (§7.4); hide AI section when off; detail copy for `failed` (§8.3) | Fixes today's misleading results before anything else. No schema change |
| **1. Provider layer** | `AIClient`, capability profile, schema validation for every mode, `ai_usage` table, `OPENAI_BASE_URL` for the operator key | Behaviour unchanged for users; removes the `gpt-5` name checks |
| **2. Bring your own provider** | `ai_connections`, `survey_configs.ai_connection_id`, endpoints (§6.3), connection test, URL validation, circuit breaker, Settings card and dialog | The core of option C |
| **3. Allowance** | Allowance counting and enforcement, `not_run_allowance`, usage view, pull summary copy | Turns the operator cost into a configured ceiling |
| **4. Rule builder review step** | F-24 B | Independent; can move earlier |

**Status:** phases 0–3 are implemented on `claude/ai-provider-overhaul`.

**Direction after phase 3.** Per-user keys stay, but as the option for
advanced users rather than the main answer to cost. Most target users (field
teams at agencies and NGOs) have no personal API key, and organisations buy
AI centrally, often as Azure OpenAI run by IT. The next step is providers
owned by an **organisation**, configured once by an admin, which needs an
organisation concept in Field Compass first; large organisations can already
self-host with their own `OPENAI_API_KEY` and `OPENAI_BASE_URL`. Users who
bring their own key should use a dedicated key with a spending limit.

## 12. Testing

- **Contract tests against a fake OpenAI-compatible server** (extend the
  review's `docs/ui-ux-review/fixtures/mock_services.py`), one per capability
  mode: `json_schema`, `json_object`, prompt-only; `max_tokens` vs
  `max_completion_tokens`; temperature rejected.
- **Error mapping:** each status code and body in §7.1 → category → stored
  status and retry decision. A regression test that no `AIError` ever results
  in `success`.
- **Breaker and allowance:** three auth failures pause queueing; a successful
  test resumes it; a pull over the allowance queues exactly the remainder.
- **URL validation:** loopback, metadata IP, private ranges, `http`, a host
  that resolves to a private address, redirects — rejected unless the flag is
  set.
- **Key handling:** no endpoint response or log line contains a stored key
  (assert on captured logs).
- **Real-provider smoke test** (manual, before release): OpenAI, Azure
  OpenAI v1, OpenRouter, and Ollama, each through the connection test and one
  qualitative check.

## 13. Rollout

- Existing surveys start on the allowance (`ai_connection_id = NULL`); nothing
  changes for them until the allowance applies, from the first full month
  after release.
- Submissions already marked `success` by a swallowed failure cannot be told
  apart from real successes: no usage was recorded and the error only went to
  the logs. Phase 0 therefore adds an owner-only **Re-run AI checks** button
  in Survey Settings › Qualitative Quality Checks, which clears
  `llm_rules_hash` for the survey so the next pull re-queues every
  submission. Release notes point operators to it for surveys that had AI
  checks on while the key was failing.
- The per-IP rate limit on the rule endpoints stays alongside the per-user
  allowance, as protection against abuse.

## 14. Open questions

1. **Allowance size.** 200 checks per survey per month is a placeholder. Is the
   unit right (per survey, not per user or per organisation), and should the
   operator be able to raise it for specific surveys?
2. **Rule writing on the operator key.** Keep it free within a daily limit
   (proposed), or require a connection for it too once the allowance is used?
3. **Self-hosted endpoints in the hosted deployment.** Leave
   `AI_ALLOW_PRIVATE_ENDPOINTS` off (proposed), or allow it for named hosts?
4. **Where providers are managed.** Proposed: both in Account Settings (a list)
   and inline from the survey card. Is one place enough?
5. **Default models.** Rule writing uses `gpt-5` today and checks use
   `gpt-5-mini`. Should the allowance use a cheaper model for checks, or turn
   reasoning effort down?
6. **Data-processing notice.** Does the "What is sent" text in §8.1 need sign-off
   (legal/DPO) before release, and should enabling AI checks on the
   allowance require an explicit acknowledgement?
