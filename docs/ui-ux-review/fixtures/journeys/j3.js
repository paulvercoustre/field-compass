// J3 — pull new data: freshness cues, and what a Kobo outage looks like.
const { launch, loginUI } = require('./lib');
(async () => {
  const j = await launch();
  const { page } = j;
  try {
    await loginUI(j, 'newuser@example.org', 'synthetic-pass-123');
    await page.click('aside >> text=Household Resilience 2026');
    await page.waitForTimeout(1500);
    j.note('freshness cues on Submissions before any pull: ' + JSON.stringify(await page.locator('text=/Last run|last pulled|Updated|ago/i').allInnerTexts()));
    const t0 = Date.now();
    await j.act('click Refresh from Kobo (Kobo unreachable)', () => page.click('text=Refresh from Kobo'));
    await page.waitForSelector('text=/ETL completed|Failed|error|Could not/i', { timeout: 180000 });
    j.note('time to outcome ms: ' + (Date.now() - t0));
    await page.waitForTimeout(800);
    j.note('banner: ' + (await page.locator('.bg-green-50, .bg-red-50').allInnerTexts()).join(' / '));
    j.note('list after: ' + (await page.locator('text=/Showing \\d+ submission/').innerText().catch(() => 'n/a')));
    await j.shot('j3-01-refresh-kobo-down');
    // Same from Data Quality
    await j.act('click Data Quality nav', () => page.click('header >> text=Data Quality'));
    await page.waitForTimeout(1500);
    await j.act('click Refresh from Kobo on Data Quality', () => page.click('text=Refresh from Kobo'));
    await page.waitForSelector('text=/ETL completed|Failed|error|Could not/i', { timeout: 180000 });
    await page.waitForTimeout(800);
    j.note('DQ banner: ' + (await page.locator('.bg-green-50, .bg-red-50').allInnerTexts()).join(' / '));
    await j.shot('j3-02-dq-refresh-kobo-down');
  } catch (e) { j.note('ERROR ' + e.message.split('\n')[0]); }
  j.dump('' + (process.env.REVIEW_OUT || '/tmp/fc-review') + '/j3.json');
  console.log(JSON.stringify({ steps: j.steps, log: j.log.map((l) => l.slice(0, 200)) }, null, 1));
  await j.browser.close();
})();
