const { launch, loginUI } = require('./lib');
(async () => {
  const j = await launch(); const p = j.page;
  await loginUI(j, 'newuser@example.org', 'synthetic-pass-123');
  await p.click('aside >> text=Household Resilience 2026'); await p.waitForTimeout(1500);
  await p.locator('main ul li button').first().focus();
  await p.keyboard.press('Enter'); await p.waitForTimeout(1200);
  let n = 0, hit = null;
  for (let i = 1; i <= 400; i++) {
    await p.keyboard.press('Tab');
    const inActions = await p.evaluate(() => !!document.activeElement.closest('div') && !!document.activeElement.closest('div').querySelector(':scope > span') && document.activeElement.closest('div').innerText.startsWith('ACTIONS') || (document.activeElement.parentElement && document.activeElement.parentElement.closest('[class*="relative inline-block"]') && document.activeElement.closest('.p-4.border-b') !== null));
    if (inActions) { hit = i; break; }
  }
  const total = await p.locator('main ul li button').count();
  console.log(JSON.stringify({ tabsFromSelectedItemToStatusControl: hit, queueLength: total }));
  await j.browser.close();
})();
