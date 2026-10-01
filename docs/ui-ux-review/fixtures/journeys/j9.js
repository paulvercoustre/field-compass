// J9 — share with a colleague, viewer experience, session expiry.
const { launch, loginUI, API, api } = require('./lib');
(async () => {
  // Throwaway colleague account (registered through the API)
  await fetch(API + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'viewer@example.org', username: 'omar', password: 'synthetic-pass-456', full_name: 'Omar Viewer' }) });

  const j = await launch();
  const { page } = j;
  try {
    await loginUI(j, 'newuser@example.org', 'synthetic-pass-123');
    await page.click('aside >> text=Household Resilience 2026');
    await j.act('click Survey Settings', () => page.click('header >> text=Survey Settings'));
    await page.waitForTimeout(1200);
    await j.act('click Access tab', () => page.click('nav >> text=Access'));
    await page.waitForTimeout(800);
    await j.shot('j9-01-access-empty', true);
    // Unknown email
    await j.act('type unknown email', () => page.fill('input[type=email]', 'nobody@example.org'));
    await j.act('click Share', () => page.click('button:has-text("Share")'));
    await page.waitForTimeout(1200);
    j.note('share unknown email feedback: ' + (await page.locator('[role=alert], [role=status]').allInnerTexts()).join(' / '));
    const alertBox = await page.locator('[role=alert]').first().boundingBox().catch(() => null);
    j.note('error box position: ' + JSON.stringify(alertBox));
    await j.shot('j9-02-share-unknown');
    await page.waitForTimeout(5500);
    j.note('error still visible after 5.5s: ' + (await page.locator('[role=alert]').count()));
    // Real colleague as viewer
    await j.act('type colleague email', () => page.fill('input[type=email]', 'viewer@example.org'));
    await j.act('click Share', () => page.click('button:has-text("Share")'));
    await page.waitForTimeout(1500);
    await j.shot('j9-03-shared', true);
    j.note('access list: ' + (await page.locator('section:has(h2:has-text("Who has access"))').innerText()).replace(/\n/g, ' | '));
  } catch (e) { j.note('ERROR owner part: ' + e.message.split('\n')[0]); }
  await j.context.close();

  // Viewer experience
  const v = await launch();
  const vp = v.page;
  try {
    await loginUI(v, 'viewer@example.org', 'synthetic-pass-456');
    await vp.waitForTimeout(800);
    await v.shot('j9-04-viewer-landing');
    await v.act('select shared survey', () => vp.click('aside >> text=Household Resilience 2026'));
    await vp.waitForTimeout(2000);
    v.note('viewer sees Refresh button enabled: ' + (await vp.locator('button:has-text("Refresh from Kobo")').isEnabled()));
    const items = vp.locator('main ul li button');
    await v.act('open a submission', () => items.nth(2).click());
    await vp.waitForTimeout(1500);
    v.note('viewer sees status dropdown enabled: ' + (await vp.locator('div:has(> span:has-text("Actions:")) button').last().isEnabled()));
    v.note('viewer sees notes Save enabled: ' + (await vp.locator('button:has-text("Save notes")').isEnabled()));
    await v.act('open status menu', () => vp.locator('div:has(> span:has-text("Actions:")) button').last().click());
    await v.act('choose Approve', () => vp.click('[role=menuitem]:has-text("Approve")'));
    await vp.waitForTimeout(1500);
    v.note('viewer approve feedback: ' + (await vp.locator('[role=alert], [role=status]').allInnerTexts()).join(' / '));
    await v.shot('j9-05-viewer-approve-attempt');
    await v.act('click Refresh from Kobo', () => vp.click('text=Refresh from Kobo'));
    await vp.waitForTimeout(3000);
    v.note('viewer refresh feedback: ' + (await vp.locator('.bg-red-50, .bg-green-50').allInnerTexts()).join(' / '));
    await v.shot('j9-06-viewer-refresh');
    await v.act('click Survey Settings', () => vp.click('header >> text=Survey Settings'));
    await vp.waitForTimeout(1200);
    await v.shot('j9-07-viewer-settings', true);
    // Session expiry: corrupt the token, then navigate
    await vp.evaluate(() => localStorage.setItem('field_compass_token', 'expired.token.value'));
    await v.act('click Submissions nav (expired token)', () => vp.click('header >> text=Submissions'));
    await vp.waitForTimeout(2500);
    v.note('expired-token Submissions view: ' + (await vp.locator('main').innerText()).replace(/\n/g, ' | ').slice(0, 300));
    await v.shot('j9-08-expired-token');
    await v.act('click Data Quality nav (expired token)', () => vp.click('header >> text=Data Quality'));
    await vp.waitForTimeout(2000);
    v.note('expired-token Data Quality view: ' + (await vp.locator('main').innerText()).replace(/\n/g, ' | ').slice(0, 300));
    await v.shot('j9-09-expired-token-dq');
  } catch (e) { v.note('ERROR viewer part: ' + e.message.split('\n')[0]); }
  const out = { owner: j.steps, viewer: v.steps, log: [...j.log, ...v.log].map((l) => l.slice(0, 200)) };
  require('fs').writeFileSync('' + (process.env.REVIEW_OUT || '/tmp/fc-review') + '/j9.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 1));
  await j.browser.close();
  await v.browser.close();
})();
