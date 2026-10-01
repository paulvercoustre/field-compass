const { launch, loginUI } = require('./lib');
(async () => {
  const j = await launch({ viewport: { width: 1440, height: 900 } }); const p = j.page;
  await loginUI(j, 'newuser@example.org', 'synthetic-pass-123');
  await p.click('aside >> text=Household Resilience 2026'); await p.waitForTimeout(1500);
  for (const id of ['300193', '300236']) {
    await p.locator(`main ul li button:has-text("${id}")`).scrollIntoViewIfNeeded();
    await p.locator(`main ul li button:has-text("${id}")`).click(); await p.waitForTimeout(1500);
    const area = p.locator('main .flex-1.p-4.overflow-y-auto').first();
    // Take the scroll content as a tall image by expanding the container temporarily
    await area.evaluate((el) => { el.dataset.h = el.style.height; el.style.overflow = 'visible'; el.style.height = 'auto'; });
    await p.evaluate(() => { document.querySelectorAll('.h-full, .min-h-0, .overflow-hidden').forEach((e) => { e.style.height = 'auto'; e.style.overflow = 'visible'; }); });
    await p.waitForTimeout(300);
    await j.shot(`state-detail-${id}-full`, true);
    await p.reload(); await p.waitForTimeout(1500);
    await p.click('aside >> text=Household Resilience 2026').catch(() => {}); await p.waitForTimeout(1200);
  }
  // Field team full page incl. scatter and tables
  await p.click('header >> text=Field Team'); await p.waitForTimeout(2000);
  await p.evaluate(() => { document.querySelectorAll('.h-full, .overflow-y-auto, .overflow-hidden, .min-h-0').forEach((e) => { e.style.height = 'auto'; e.style.overflow = 'visible'; }); });
  await j.shot('state-field-team-full', true);
  // Data quality full page
  await p.reload(); await p.waitForTimeout(1500);
  await p.click('header >> text=Data Quality'); await p.waitForTimeout(2000);
  await p.evaluate(() => { document.querySelectorAll('.h-full, .overflow-auto, .overflow-hidden, .min-h-0').forEach((e) => { e.style.height = 'auto'; e.style.overflow = 'visible'; }); });
  await j.shot('state-data-quality-full', true);
  // Settings general full
  await p.reload(); await p.waitForTimeout(1500);
  await p.click('header >> text=Survey Settings'); await p.waitForTimeout(1500);
  await p.evaluate(() => { document.querySelectorAll('.h-full, .overflow-y-auto, .overflow-hidden, .min-h-0').forEach((e) => { e.style.height = 'auto'; e.style.overflow = 'visible'; }); });
  await j.shot('state-settings-general-full', true);
  await j.browser.close();
})();
