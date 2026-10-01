// Accessibility + design-system measurement pass across every reachable screen.
const { launch, loginUI } = require('./lib');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('fs');
const OUT = '' + (process.env.REVIEW_OUT || '/tmp/fc-review') + '/audit.json';

// Collect computed styles of visible elements for the design-system inventory.
const DS_JS = () => {
  const out = { colors: {}, bg: {}, fontSize: {}, fontWeight: {}, radius: {}, buttons: {}, headings: {}, spacingPad: {} };
  const inc = (o, k) => { o[k] = (o[k] || 0) + 1; };
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue;
    const cs = getComputedStyle(el);
    const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
    if (hasText) { inc(out.colors, cs.color); inc(out.fontSize, cs.fontSize); inc(out.fontWeight, cs.fontWeight); }
    if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)') inc(out.bg, cs.backgroundColor);
    if (cs.borderTopLeftRadius !== '0px') inc(out.radius, cs.borderTopLeftRadius);
    if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') {
      const k = `${cs.backgroundColor}|${cs.color}|${cs.fontSize}|${cs.fontWeight}|${cs.paddingTop} ${cs.paddingLeft}|${cs.borderTopLeftRadius}|h${Math.round(el.getBoundingClientRect().height)}`;
      inc(out.buttons, k);
    }
    if (/^H[1-6]$/.test(el.tagName)) inc(out.headings, `${el.tagName}|${cs.fontSize}|${cs.fontWeight}|${cs.textTransform}`);
  }
  return out;
};

// Interactive targets smaller than 24x24 (WCAG 2.5.8) — excluding inline links in text.
const TARGETS_JS = () => {
  const res = [];
  for (const el of document.querySelectorAll('button, a[href], input, select, [role=button], [onclick], th.cursor-pointer, span.cursor-pointer, div.cursor-pointer, tr.cursor-pointer')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.width < 24 || r.height < 24) res.push({ tag: el.tagName, text: (el.innerText || el.getAttribute('aria-label') || el.value || '').slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) });
  }
  return res;
};

// Clickable things the keyboard cannot reach.
const UNREACHABLE_JS = () => {
  const res = [];
  for (const el of document.querySelectorAll('div.cursor-pointer, span.cursor-pointer, tr.cursor-pointer, th.cursor-pointer, li.cursor-pointer, .recharts-bar-rectangle, circle[style*="cursor: pointer"]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    if (el.tabIndex < 0 && !el.closest('button,a')) res.push({ tag: el.tagName, cls: (el.getAttribute('class') || '').slice(0, 40), text: (el.textContent || '').trim().slice(0, 30) });
  }
  return res;
};

(async () => {
  const j = await launch();
  const { page } = j;
  const results = {};
  const run = async (name, setup) => {
    try {
      await setup();
      await page.waitForTimeout(1200);
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      results[name] = {
        violations: axe.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, count: v.nodes.length,
          samples: v.nodes.slice(0, 4).map((n) => ({ target: n.target.join(' '), summary: (n.failureSummary || '').split('\n').slice(0, 2).join(' ').slice(0, 220) })) })),
        incomplete: axe.incomplete.map((v) => ({ id: v.id, count: v.nodes.length })),
        ds: await page.evaluate(DS_JS),
        smallTargets: await page.evaluate(TARGETS_JS),
        unreachable: await page.evaluate(UNREACHABLE_JS),
        lang: await page.evaluate(() => document.documentElement.lang),
        title: await page.title(),
        landmarks: await page.evaluate(() => ({ main: document.querySelectorAll('main').length, nav: document.querySelectorAll('nav').length, h1: Array.from(document.querySelectorAll('h1')).map((h) => h.textContent.trim()) })),
      };
    } catch (e) { results[name] = { error: e.message.split('\n')[0] }; }
  };

  await run('S0-login', async () => { await page.goto('http://127.0.0.1:3000'); });
  await loginUI(j, 'newuser@example.org', 'synthetic-pass-123');
  await run('S1-submissions-empty-detail', async () => { await page.click('aside >> text=Household Resilience 2026'); await page.waitForTimeout(1500); });
  await run('S1-submissions-detail', async () => { await page.locator('main ul li button').nth(1).click(); });
  await run('S1-filters-open', async () => { await page.click('button:has-text("Filters")'); await page.click('button:has-text("Select validation statuses...")'); });
  await run('S2-data-quality', async () => { await page.keyboard.press('Escape'); await page.click('header >> text=Data Quality'); });
  await run('S3-progress', async () => { await page.click('header >> text=Data Collection Progress'); });
  await run('S4-field-team', async () => { await page.click('header >> text=Field Team'); });
  await run('S5a-settings-general', async () => { await page.click('header >> text=Survey Settings'); });
  await run('S5b-settings-access', async () => { await page.click('nav >> text=Access'); });
  await run('S5c-settings-quality', async () => { await page.click('text=Data Quality Checks'); });
  await run('S5c-custom-edit', async () => { await page.locator('section:has(h2:has-text("Custom Quality Checks")) button:has-text("Edit")').click(); });
  await run('S6-create', async () => { await page.click('text=New survey'); });
  await run('S7-user-settings', async () => { await page.click('aside button[title="newuser@example.org"]'); await page.click('text=Account Settings'); });

  fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
  const summary = Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.error ? v.error : v.violations.map((x) => `${x.id}(${x.impact}):${x.count}`).join(', ') + ` | small:${v.smallTargets.length} unreachable:${v.unreachable.length}`]));
  console.log(JSON.stringify(summary, null, 1));
  await j.browser.close();
})();
