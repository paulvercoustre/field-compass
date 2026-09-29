# W3 — First run and Kobo connection (F-18, F-19, F-23)

## A. Empty state for a signed-in user with no surveys (replaces `App.tsx:45-54` copy)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Set up your first survey                                    Step 1 of 3 │
│                                                                          │
│  ① Connect KoboToolbox            ✓ Connected as synthetic_reviewer      │
│     Server: [ kf.kobotoolbox.org (Global)  ▾ ]   Token: ••••••  [Change] │
│  ② Add a survey                   [ + Add a survey from a Kobo link ]    │
│  ③ Choose quality checks          Recommended set · 6 checks · [Review]  │
│                                                                          │
│  Then pull submissions and start reviewing.                              │
└──────────────────────────────────────────────────────────────────────────┘
```
When surveys exist but none is selected: "Choose a survey from the list on the left." — and the text must not
say "to view its settings" on the Submissions/Data Quality/Progress/Field team views (today it does on all).

## B. Kobo connection card (Account settings → Kobo; also embedded in step ①)

```
┌ KoboToolbox connection ──────────────────────────────── ● Connected ┐
│ Server   (•) Global — kf.kobotoolbox.org                              │
│          ( ) EU — eu.kobotoolbox.org                                  │
│          ( ) Humanitarian — kobo.humanitarianresponse.info            │
│          ( ) Other: [ https://…/api/v2                    ]           │
│ API token [ ••••••••••••••••              ]  Where do I find this? ↗  │
│                                                                       │
│ [ Save and test connection ]                        Remove connection │
│ ✓ Saved. Connected as synthetic_reviewer (reviewer@example.org).      │
└───────────────────────────────────────────────────────────────────────┘
```
- One button saves **server + token together** (`PUT /users/me` for `kobo_api_url`, then `PUT /users/me/kobo-api-key`) and runs the existing test endpoint — replacing today's split where the URL is only persisted by the *Profile* form's Save button, which only appears when username/full name change (`UserSettingsPage.tsx:22-23, 57, 245`).
- The "Where do I find this?" link must follow the selected server (`https://eu.kobotoolbox.org/token/` etc.), not always `kf.kobotoolbox.org/token`.
- Server list values must be confirmed by the owner (open question Q3).

## C. Create survey — keep the draft and fix the prerequisite inline

```
Kobo project link *  [ https://kf.kobotoolbox.org/#/forms/aSynth… ]  ✓ Project ID aSynth…
┌ ⚠ Field Compass can't read this project yet: no Kobo connection. ──────────┐
│   [ Connect Kobo here ]  (opens the card from B in a dialog; the form stays) │
└──────────────────────────────────────────────────────────────────────────────┘
```
- Today the message is plain red text (`CreateSurveyPage.tsx` "Add your Kobo API key in user settings…") and going to settings discards everything typed (observed: survey name empty after a round trip).
- Persist the draft to `sessionStorage` (name, link, dates, targets) as a fallback.

## D. After "Create survey"

Replace the yes/no modal (`QualityCheckPromptModal.tsx`) with the step ③ panel: a pre-ticked **recommended set**
the owner defines (see F-23 options), a "Pull submissions now" primary button, and a secondary "Customise checks".
