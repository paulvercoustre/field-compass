// Keyboard, focus, modal, reflow, zoom and dark-mode checks.
const { launch, loginUI } = require('./lib');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('fs');
const OUT = '' + (process.env.REVIEW_OUT || '/tmp/fc-review') + '/kbd.json';
const R = {};
const focusInfo = () => {
  const el = document.activeElement;
  if (!el || el === document.body) return { tag: 'BODY' };
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return { tag: el.tagName, text: (el.innerText || el.getAttribute('aria-label') || el.value || '').replace(/\s+/g, ' ').slice(0, 40),
    outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`, boxShadow: cs.boxShadow.slice(0, 60), inView: r.top >= 0 && r.bottom <= innerHeight };
};

(async () => {
  // 1. Login autocomplete + tab order
  let j = await launch();
  let p = j.page;
  await p.goto('http://127.0.0.1:3000');
  await p.waitForTimeout(600);
  R.loginAutocomplete = await p.evaluate(() => Array.from(document.querySelectorAll('input')).map((i) => `${i.id}:${i.getAttribute('autocomplete')}`));
  await loginUI(j, 'newuser@example.org', 'synthetic-pass-123');
  await p.click('aside >> text=Household Resilience 2026');
  await p.waitForTimeout(1500);
  // Tab from the top of the document until we reach the first queue item, then to the status control.
  await p.evaluate(() => document.activeElement && document.activeElement.blur());
  const seq = [];
  let reachedItem = -1, reachedStatus = -1;
  for (let i = 1; i <= 60; i++) {
    await p.keyboard.press('Tab');
    const f = await p.evaluate(focusInfo);
    seq.push(f);
    if (reachedItem < 0 && /^ID:/.test(f.text)) {
      reachedItem = i;
      R.queueItemFocusStyle = f;
      await p.keyboard.press('Enter');
      await p.waitForTimeout(1200);
    }
    if (reachedItem > 0 && /Not Reviewed|Approved|On Hold|Not Approved/.test(f.text) && f.tag === 'BUTTON' && i > reachedItem) { reachedStatus = i; break; }
  }
  R.tabsToFirstQueueItem = reachedItem;
  R.tabsToStatusControlAfterSelecting = reachedStatus;
  R.tabSequenceSample = seq.slice(0, 16).map((f) => `${f.tag}:${f.text}|${f.outline}|${f.boxShadow.slice(0, 20)}`);
  await j.shot('kbd-01-queue-item-focused');
  // focus style of top nav button, sidebar survey button
  await p.focus('header nav button >> nth=1');
  R.navFocusStyle = await p.evaluate(focusInfo);

  // 2. Filters dropdown with keyboard
  await p.focus('button:has-text("Filters")');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(300);
  await p.focus('button:has-text("Select validation statuses...")');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(300);
  R.multiSelectOpen = await p.locator('label:has-text("Not Reviewed") input').count();
  R.multiSelectAria = await p.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.includes('Select validation statuses')); return b ? { expanded: b.getAttribute('aria-expanded'), haspopup: b.getAttribute('aria-haspopup') } : null; });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  R.multiSelectClosesOnEscape = (await p.locator('label:has-text("Not Reviewed") input').count()) === 0;

  // 3. Settings delete modal: focus + escape
  await p.click('header >> text=Survey Settings');
  await p.waitForTimeout(1200);
  await p.click('button:has-text("Delete Survey")');
  await p.waitForTimeout(400);
  R.deleteModal = { focusAfterOpen: await p.evaluate(focusInfo), role: await p.evaluate(() => document.querySelector('.fixed')?.getAttribute('role')) };
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  R.deleteModal.closesOnEscape = (await p.locator('text=Type').count()) === 0;
  // tab 15 times: does focus leave the modal?
  let left = false;
  for (let i = 0; i < 15; i++) { await p.keyboard.press('Tab'); if (!(await p.evaluate(() => !!document.activeElement.closest('.fixed')))) { left = true; break; } }
  R.deleteModal.focusEscapesModal = left;
  await j.shot('kbd-02-delete-modal');
  await p.click('button:has-text("Cancel")');

  // 4. Page title per view
  const titles = {};
  for (const v of ['Submissions', 'Data Quality', 'Field Team', 'Survey Settings']) { await p.click(`header >> text=${v}`); await p.waitForTimeout(500); titles[v] = await p.title(); }
  R.titles = titles;
  // 5. Non-text contrast of input borders
  R.inputBorders = await p.evaluate(() => Array.from(document.querySelectorAll('input[type=text], input[type=number], input[type=date], select')).slice(0, 4).map((i) => getComputedStyle(i).borderTopColor));
  await j.browser.close();

  // 6. Reflow at 320 CSS px and 200% zoom (720x450 at 2x)
  for (const [name, vp, dsf] of [['w320', { width: 320, height: 720 }, 1], ['w390', { width: 390, height: 844 }, 1], ['zoom200', { width: 720, height: 450 }, 2], ['w1024', { width: 1024, height: 768 }, 1]]) {
    const k = await launch({ viewport: vp });
    await loginUI(k, 'newuser@example.org', 'synthetic-pass-123');
    await k.page.click('aside >> text=Household Resilience 2026').catch(() => {});
    await k.page.waitForTimeout(1500);
    const m = await k.page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth, sidebarW: document.querySelector('aside')?.getBoundingClientRect().width, mainW: document.querySelector('main')?.getBoundingClientRect().width }));
    await k.shot(`reflow-${name}-queue`);
    await k.page.locator('main ul li button').nth(1).click().catch(() => {});
    await k.page.waitForTimeout(1200);
    m.detailVisible = await k.page.locator('h2:has-text("Submission #")').isVisible().catch(() => false);
    await k.shot(`reflow-${name}-after-select`);
    await k.page.click('header >> text=Field Team').catch(() => {});
    await k.page.waitForTimeout(1500);
    m.fieldTeamScrollW = await k.page.evaluate(() => document.querySelector('main')?.scrollWidth);
    await k.shot(`reflow-${name}-field-team`);
    R['reflow_' + name] = m;
    await k.browser.close();
  }

  // 7. Dark mode: screenshots + axe contrast
  const d = await launch({ colorScheme: 'dark' });
  await loginUI(d, 'newuser@example.org', 'synthetic-pass-123');
  await d.page.click('aside >> text=Household Resilience 2026');
  await d.page.waitForTimeout(1500);
  await d.page.locator('main ul li button').nth(1).click();
  await d.page.waitForTimeout(1200);
  await d.shot('dark-01-submissions');
  const dark = {};
  for (const [name, nav] of [['submissions', null], ['data-quality', 'Data Quality'], ['progress', 'Data Collection Progress'], ['field-team', 'Field Team'], ['settings', 'Survey Settings']]) {
    if (nav) { await d.page.click(`header >> text=${nav}`); await d.page.waitForTimeout(1500); await d.shot('dark-' + name); }
    const axe = await new AxeBuilder({ page: d.page }).withRules(['color-contrast']).analyze();
    dark[name] = axe.violations.flatMap((v) => v.nodes.map((n) => (n.failureSummary.match(/contrast of ([\d.]+) \(foreground color: (#\w+), background color: (#\w+)/) || []).slice(1).join(' '))).filter(Boolean);
  }
  R.darkContrast = dark;
  await d.browser.close();

  fs.writeFileSync(OUT, JSON.stringify(R, null, 1));
  console.log(JSON.stringify(R, null, 1).slice(0, 9000));
})();
