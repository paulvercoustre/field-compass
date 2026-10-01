const { launch, loginUI, api } = require('./lib');
(async () => {
  const j = await launch(); const p = j.page; const notes = [];
  await loginUI(j, 'newuser@example.org', 'synthetic-pass-123');
  const tok = await p.evaluate(() => localStorage.getItem('field_compass_token'));
  // Lead: Create form state survives leaving the page?
  await p.click('text=New survey');
  await p.fill('input[required] >> nth=0', 'Market Price Monitor');
  await p.fill('input[placeholder^="https://kf.kobotoolbox.org"]', 'https://kf.kobotoolbox.org/#/forms/aSynthMarket2026Demo002');
  await p.waitForTimeout(1500);
  await p.click('aside button[title="newuser@example.org"]'); await p.click('text=Account Settings'); await p.waitForTimeout(500);
  await p.click('text=New survey'); await p.waitForTimeout(500);
  notes.push('create form name after round-trip: "' + await p.inputValue('input[required] >> nth=0') + '"');
  // Throwaway survey to delete
  await p.fill('input[required] >> nth=0', 'Throwaway two');
  await p.fill('input[placeholder^="https://kf.kobotoolbox.org"]', 'https://kf.kobotoolbox.org/#/forms/aSynthMarket2026Demo002');
  await p.waitForTimeout(2500);
  await p.click('button:has-text("Create Survey")'); await p.waitForTimeout(2000);
  await j.shot('lead-01-created-modal');
  await p.click('button:has-text("Later")'); await p.waitForTimeout(1500);
  notes.push('after Later, view header: ' + (await p.locator('header').innerText()).replace(/\n/g, ' | '));
  await p.click('header >> text=Survey Settings'); await p.waitForTimeout(1500);
  await p.click('button:has-text("Delete Survey")'); await p.waitForTimeout(300);
  await p.fill('input[placeholder="Survey name"]', 'Throwaway two');
  await p.click('.fixed button:has-text("Delete Survey")'); await p.waitForTimeout(2000);
  notes.push('after delete, main text: ' + (await p.locator('main').innerText()).replace(/\n/g, ' | '));
  notes.push('success message visible: ' + (await p.locator('text=Survey deleted successfully').count()));
  await j.shot('lead-02-after-delete');
  console.log(notes.join('\n'));
  await j.browser.close();
})();
