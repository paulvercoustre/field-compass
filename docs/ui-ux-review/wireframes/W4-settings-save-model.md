# W4 — One save model for Survey Settings (F-15, F-21, F-22)

Today the page mixes four models (see `00-inventory.md` §4): always-editable with Save-when-dirty
(Profile, Core identifiers, General checks), read-only-until-Edit (Kobo tool, Targets, Outliers, AI),
Edit/Done with immediate per-rule saves (Custom checks), and immediate saves (Access). Every section's Save
calls one `persistSurveyConfig()` (`SurveySettingsPage.tsx:648`) that writes the whole config — observed:
an unsaved "weekend" tick in *General checks* was saved when the *Outlier* section was saved. Success
messages are cleared by the reload that follows every save (`:290-292`), so no confirmation is ever seen.

## Proposed: section cards, each self-contained

```
┌ Outlier checks ─────────────────────────────────────────────── Edited ● ┐
│ ☑ Flag outlier values  (label is clickable)                              │
│   Variables  ☑ monthly_income  ☑ hh_size  ☑ livestock_count  ☐ …          │
│   Method [IQR ▾]   Threshold [1.5]                                        │
│                                                  [ Cancel ]  [ Save ]     │
│ ✓ Saved 14:41 — applies from the next pull.   ← inline, stays until next edit │
└──────────────────────────────────────────────────────────────────────────┘
```

Rules
1. **Always editable** for owners/admins (drop the Edit buttons); read-only text for viewers/editors, with one
   line at the top: "You can view these settings. Ask the owner (amina@…) to change them."
2. A section is **dirty** when its own fields differ from saved; the card shows "Edited ●" and its own
   Save/Cancel. Other sections' dirtiness never travels with it.
3. Save sends **only that section's keys**: merge the section into the *last saved* `config_data`, not into the
   page's in-memory state (smallest code change: build `configData` from `config.config_data` + the section's
   slice instead of from all page state).
4. Confirmation renders **inside the card** (`role=status`) and does not auto-hide; errors render inside the
   card (`role=alert`) and never auto-hide.
5. Leaving the page (nav click, survey switch) with any dirty card → confirm dialog: "You have unsaved changes
   in Outlier checks. Discard / Keep editing".
6. Custom checks: keep immediate saves, but label the button "Save check" (not "Add Rule to List"), and give
   delete an **Undo** toast instead of instant deletion.

The saved-state line "applies from the next pull" matters: changing checks does not re-flag existing data until
someone presses Refresh. Offer "Re-check existing submissions now" next to it (calls the existing ETL endpoint).
