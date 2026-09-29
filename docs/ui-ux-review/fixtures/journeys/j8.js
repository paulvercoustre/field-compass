// J8 — configure/tune quality checks and see the effect on flags.
const { launch, loginUI, api } = require('./lib');
(async () => {
  const j = await launch();
  const { page } = j;
  await loginUI(j, 'newuser@example.org', 'synthetic-pass-123');
  const tok = await page.evaluate(() => localStorage.getItem('field_compass_token'));
  const surveys = await api(tok, 'GET', '/api/surveys');
  const sid = (Array.isArray(surveys.json) ? surveys.json : surveys.json.surveys)[0].survey_id;

  await j.act('select survey in sidebar', () => page.click('aside >> text=Household Resilience 2026'));
  await j.act('click Survey Settings', () => page.click('header >> text=Survey Settings'));
  await page.waitForTimeout(1200);
  await j.shot('j8-01-settings-general', true);
  await j.act('click Data Quality Checks tab', () => page.click('text=Data Quality Checks'));
  await page.waitForTimeout(600);
  await j.shot('j8-02-quality-tab-initial', true);

  // --- Leakage test: tick "weekend" (General, dirty, unsaved), then edit+save Outlier section.
  await j.act('tick weekend flag (not saved)', () => page.locator('input[type=checkbox]').nth(1).check());
  const qc = page.locator('section:has(h2:has-text("Outlier Checks"))');
  await j.act('click Outlier Edit', () => qc.locator('button:has-text("Edit")').click());
  await j.act('tick Flag outlier values', () => qc.locator('input[type=checkbox]').first().check());
  for (const v of ['monthly_income', 'hh_size', 'livestock_count']) {
    await j.act('tick outlier var ' + v, () => qc.locator(`label:has-text("${v}") input`).first().check());
  }
  await j.act('click Outlier Save Changes', () => qc.locator('button:has-text("Save Changes")').click());
  await page.waitForTimeout(1500);
  const vp = page.viewportSize();
  const sm = page.locator('[role=status]').first();
  const box = await sm.boundingBox().catch(() => null);
  const scrollY = await page.evaluate(() => document.querySelector('main main')?.closest('.overflow-y-auto')?.scrollTop ?? window.scrollY);
  j.note('after Outlier save: success message box=' + JSON.stringify(box) + ' viewport=' + JSON.stringify(vp) + ' scrollTop=' + scrollY);
  await j.shot('j8-03-after-outlier-save');
  let cfg = await api(tok, 'GET', '/api/surveys/' + sid);
  j.note('LEAK TEST saved flag_weekend (never saved in its own section): ' + cfg.json.config_data.quality_checks.flag_weekend);
  j.note('saved outlier vars: ' + JSON.stringify(cfg.json.config_data.quality_checks.outlier_variables));
  // what does the General section show now?
  j.note('General section dirty Save visible now: ' + await page.locator('section:has(h2:has-text("General Quality Checks")) button:has-text("Save Changes")').count());

  // --- Normal configuration of general checks
  const gen = page.locator('section:has(h2:has-text("General Quality Checks"))');
  await j.act('tick out-of-period', () => gen.locator('input[type=checkbox]').nth(0).check());
  await j.act('tick office hours', () => gen.locator('input[type=checkbox]').nth(2).check());
  await j.act('tick DK percentage', () => gen.locator('input[type=checkbox]').nth(4).check());
  await j.act('type min duration 15', () => gen.locator('input[placeholder="e.g., 10"]').fill('15'));
  await j.shot('j8-04-general-dirty', true);
  // Label click test: does clicking the label text toggle the checkbox?
  const before = await gen.locator('input[type=checkbox]').nth(3).isChecked();
  await gen.locator('text=Flag submissions outside the collection targets').click();
  const after = await gen.locator('input[type=checkbox]').nth(3).isChecked();
  j.note('clicking checkbox label text toggles it? ' + (before !== after));
  await j.act('click General Save Changes', () => gen.locator('button:has-text("Save Changes")').click());
  await page.waitForTimeout(1500);
  j.note('success box after General save: ' + JSON.stringify(await page.locator('[role=status]').first().boundingBox().catch(() => null)));

  // --- Qualitative (AI) checks
  const ql = page.locator('section:has(h2:has-text("Qualitative Quality Checks"))');
  await j.act('click Qualitative Edit', () => ql.locator('button:has-text("Edit")').click());
  await j.act('tick Enable AI analysis', () => ql.locator('input[type=checkbox]').first().check());
  await j.act('tick main_challenge', () => ql.locator('label:has-text("main_challenge") input').check());
  await j.act('click Qualitative Save', () => ql.locator('button:has-text("Save Changes")').click());
  await page.waitForTimeout(1200);

  // --- Custom rule via AI
  const cu = page.locator('section:has(h2:has-text("Custom Quality Checks"))');
  await j.act('click Custom Edit', () => cu.locator('button:has-text("Edit")').click());
  await page.waitForTimeout(400);
  await j.shot('j8-05-custom-edit', true);
  await j.act('type AI prompt', () => page.fill('#ai-prompt', 'Flag households with more than 20 members'));
  await j.act('click Generate Rule with AI', () => page.click('text=Generate Rule with AI'));
  await page.waitForTimeout(2000);
  await j.shot('j8-06-ai-generated');
  await j.act('click Accept & Add to Editor', () => page.click('text=Accept & Add to Editor'));
  await page.waitForTimeout(1500);
  j.note('editor fields after "Add to Editor": name="' + await page.inputValue('#rule-description') + '"');
  j.note('saved rules on server: ' + JSON.stringify((await api(tok, 'GET', `/api/surveys/${sid}/rules`)).json).slice(0, 300));
  await j.act('click Analyze Form & Suggest Rules', () => page.click('text=Analyze Form & Suggest Rules'));
  await page.waitForTimeout(2000);
  await j.shot('j8-07-ai-suggestions', true);
  await j.act('click Add Selected', () => page.click('text=/Add Selected/'));
  await page.waitForTimeout(1500);
  await j.act('click Done', () => cu.locator('button:has-text("Done")').click());
  await page.waitForTimeout(500);
  await j.shot('j8-08-custom-done', true);

  // --- See the effect: back to Submissions, refresh
  await j.act('click Submissions nav', () => page.click('header >> text=Submissions'));
  await j.act('click Refresh from Kobo', () => page.click('text=Refresh from Kobo'));
  await page.waitForSelector('text=/ETL completed|Failed/', { timeout: 240000 });
  await page.waitForTimeout(1000);
  j.note('ETL banner after config: ' + (await page.locator('text=/ETL completed/').innerText().catch(() => '')));
  await j.shot('j8-09-after-reflag');

  cfg = await api(tok, 'GET', '/api/surveys/' + sid);
  j.note('final quality_checks: ' + JSON.stringify(cfg.json.config_data.quality_checks));
  j.dump('' + (process.env.REVIEW_OUT || '/tmp/fc-review') + '/j8.json');
  console.log(JSON.stringify({ steps: j.steps, log: j.log }, null, 1));
  await j.browser.close();
})();
