const { launch, loginUI } = require('./lib');
(async () => {
  const j = await launch({ viewport: { width: 1440, height: 900 } }); const p = j.page;
  await loginUI(j, 'newuser@example.org', 'synthetic-pass-123');
  await p.click('aside >> text=Household Resilience 2026'); await p.waitForTimeout(1500);
  for (const id of ['300193', '300236']) {
    await p.locator(`main ul li button:has-text("${id}")`).scrollIntoViewIfNeeded();
    await p.locator(`main ul li button:has-text("${id}")`).click(); await p.waitForTimeout(1500);
    const col = p.locator('div.flex-1.hidden').first();
    await col.evaluate((el) => { el.querySelectorAll('.overflow-y-auto, .h-full').forEach((e) => { e.style.overflow = 'visible'; e.style.height = 'auto'; }); el.style.height = 'auto'; });
    await p.waitForTimeout(300);
    await col.screenshot({ path: require("path").resolve(__dirname, "../../screenshots", `state-detail-${id}.png`) });
    await p.reload(); await p.waitForTimeout(1500);
    await p.click('aside >> text=Household Resilience 2026').catch(() => {}); await p.waitForTimeout(1200);
  }
  await j.browser.close();
})();
