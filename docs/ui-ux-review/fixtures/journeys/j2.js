// J2 — create a survey from a Kobo link, configure it, reach first data.
const { launch, loginUI, api } = require('./lib');
(async () => {
  const j = await launch();
  const { page } = j;
  await loginUI(j, 'newuser@example.org', 'synthetic-pass-123');
  await j.shot('j2-00-after-login');

  await j.act('click New survey', () => page.click('text=New survey'));
  await j.act('type survey name', () => page.fill('input[required] >> nth=0', 'Household Resilience 2026'));
  await j.act('paste Kobo link', () => page.fill('input[placeholder^="https://kf.kobotoolbox.org"]', 'https://kf.kobotoolbox.org/#/forms/aSynthHH2026Demo0000001/summary'));
  await page.waitForTimeout(4000);
  await j.shot('j2-01-form-read', true);
  j.note('form read text: ' + (await page.locator('text=/questions\\)/').allInnerTexts()).join(' / '));
  j.note('lint summary: ' + (await page.locator('text=/to fix,|Nothing to fix/').allInnerTexts()).join(' / '));
  const lintCount = await page.locator('li:has(button:has-text("Show details"))').count();
  j.note('lint finding rows: ' + lintCount);

  // Identifiers state after auto-fill
  const selects = page.locator('section:has(h2:has-text("Core Identifiers")) select');
  const n = await selects.count();
  for (let i = 0; i < n; i++) j.note(`core identifier select ${i}: ${await selects.nth(i).inputValue()}`);
  j.note('DK chips: ' + (await page.locator('section:has(h2:has-text("Core Identifiers")) span.inline-flex').allInnerTexts()).join(','));

  // Targets: per answer to district, 40 each
  await j.act('choose "A target per answer to one question"', () => page.click('text=A target per answer to one question'));
  await j.act('pick Group by district', () => page.selectOption('section:has(h2:has-text("Data collection targets")) select', { label: 'District (district)' }));
  await j.act('type per-group 40', () => page.fill('input[placeholder="e.g. 40"]', '40'));
  await j.act('click Apply to every group', () => page.click('text=Apply to every group'));
  await j.act('type start date', () => page.fill('input[type=date] >> nth=0', '2026-09-01'));
  await j.act('type end date', () => page.fill('input[type=date] >> nth=1', '2026-10-15'));
  await j.shot('j2-02-configured', true);

  await j.act('click Create Survey', () => page.click('button:has-text("Create Survey")'));
  await page.waitForTimeout(2000);
  await j.shot('j2-03-post-create-modal');
  j.note('modal text: ' + (await page.locator('.fixed').innerText().catch(() => 'none')).replace(/\n/g, ' | '));
  await j.act('click Configure Now', () => page.click('text=Configure Now'));
  await page.waitForTimeout(2500);
  await j.shot('j2-04-settings-quality-tab', true);
  j.note('active settings tab text top: ' + (await page.locator('main main').innerText()).slice(0, 300).replace(/\n/g, ' | '));

  // Now get data: where is the refresh? Go to Submissions
  await j.act('click Submissions nav', () => page.click('header >> text=Submissions'));
  await page.waitForTimeout(1500);
  await j.shot('j2-05-submissions-empty');
  j.note('submissions empty text: ' + (await page.locator('main').innerText()).replace(/\n/g, ' | ').slice(0, 300));
  const t0 = Date.now();
  await j.act('click Refresh from Kobo', () => page.click('text=Refresh from Kobo'));
  await page.waitForTimeout(1500);
  await j.shot('j2-06-etl-running');
  await page.waitForSelector('text=/ETL completed|Failed|error/i', { timeout: 240000 });
  j.note('ETL wall time ms: ' + (Date.now() - t0));
  await page.waitForTimeout(1500);
  await j.shot('j2-07-etl-done');
  j.note('ETL banner: ' + (await page.locator('text=/ETL completed/').innerText().catch(() => '')));

  const tok = await page.evaluate(() => localStorage.getItem('field_compass_token'));
  const surveys = await api(tok, 'GET', '/api/surveys');
  const arr = Array.isArray(surveys.json) ? surveys.json : (surveys.json.surveys || []);
  const cfg = await api(tok, 'GET', '/api/surveys/' + arr[0].survey_id);
  j.note('saved core_identifiers: ' + JSON.stringify(cfg.json.config_data.core_identifiers));
  j.note('saved quality_checks: ' + JSON.stringify(cfg.json.config_data.quality_checks || null));
  j.dump('' + (process.env.REVIEW_OUT || '/tmp/fc-review') + '/j2.json');
  console.log(JSON.stringify({ steps: j.steps, log: j.log }, null, 1));
  await j.browser.close();
})();
