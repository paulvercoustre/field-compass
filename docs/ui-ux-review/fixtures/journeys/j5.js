// J5 Data Quality drill-down, J6 Field Team follow-up, J7 progress vs targets.
const { launch, loginUI } = require('./lib');
const OUT = '' + (process.env.REVIEW_OUT || '/tmp/fc-review') + '/j5.json';
(async () => {
  const j = await launch();
  const { page } = j;
  const sec = async (name, fn) => { j.note('=== ' + name); try { await fn(); } catch (e) { j.note('ERROR ' + name + ': ' + e.message.split('\n')[0]); } };
  await loginUI(j, 'newuser@example.org', 'synthetic-pass-123');
  await page.click('aside >> text=Household Resilience 2026');
  await page.waitForTimeout(1500);

  await sec('J5', async () => {
    await j.act('click Data Quality nav', () => page.click('header >> text=Data Quality'));
    await page.waitForTimeout(2500);
    await j.shot('j5-01-data-quality', true);
    const yLabels = await page.locator('.recharts-yAxis .recharts-cartesian-axis-tick-value').allTextContents();
    j.note('issue frequency y-axis labels (top 5): ' + yLabels.join(', '));
    j.note('status cards: ' + (await page.locator('h3:has-text("Submission Status") + div').first().innerText()).replace(/\n/g, ' '));
    j.note('metrics: ' + (await page.locator('h3:has-text("Quality Metrics") + div').first().innerText()).replace(/\n/g, ' '));
    // Click the top issue bar
    await j.act('click top issue bar', () => page.locator('.recharts-bar-rectangle').first().click());
    await page.waitForTimeout(2000);
    j.note('after bar click, view: ' + (await page.locator('header nav button.bg-indigo-600').innerText()) + '; ' + (await page.locator('text=/Showing \\d+ submission/').innerText()) + '; filter badge: ' + (await page.locator('button:has-text("Filters") span').allInnerTexts()).join(','));
    await j.shot('j5-02-after-issue-bar-click');
    // Back and click "Not Approved" card
    await j.act('click Data Quality nav', () => page.click('header >> text=Data Quality'));
    await page.waitForTimeout(2000);
    await j.act('click "Not Approved" status card', () => page.locator('div.cursor-pointer:has-text("Not Approved")').click());
    await page.waitForTimeout(2000);
    j.note('after status card click: ' + (await page.locator('text=/Showing \\d+ submission/').innerText()) + '; filter badge: ' + (await page.locator('button:has-text("Filters") span').allInnerTexts()).join(','));
    await j.shot('j5-03-after-status-card');
    // Keyboard reachability of status card
    const tabbable = await page.evaluate(() => Array.from(document.querySelectorAll('div.cursor-pointer')).map((d) => d.tabIndex));
    j.note('status card tabIndex values (on Submissions now, checking DQ later)');
    await page.click('header >> text=Data Quality');
    await page.waitForTimeout(1500);
    j.note('Data Quality clickable cards tabIndex: ' + JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll('div.cursor-pointer')).map((d) => d.tabIndex + ':' + (d.getAttribute('role') || 'no-role')))));
    // date preset
    await j.act('choose Last 7 Days', () => page.selectOption('select >> nth=0', 'last7'));
    await page.waitForTimeout(1500);
    j.note('status after Last 7 Days: ' + (await page.locator('h3:has-text("Submission Status") + div').first().innerText()).replace(/\n/g, ' '));
    await j.shot('j5-04-last7', true);
  });

  if (0) await sec('J6', async () => {
    await j.act('click Field Team nav', () => page.click('header >> text=Field Team'));
    await page.waitForTimeout(2500);
    await j.shot('j6-01-field-team', true);
    j.note('summary cards: ' + (await page.locator('.grid.grid-cols-2').first().innerText()).replace(/\n/g, ' | '));
    j.note('leaderboard: ' + (await page.locator('h3:has-text("Performers")').locator('..').locator('..').innerText()).replace(/\n/g, ' | ').slice(0, 400));
    // Sort collected table by % Needs Review
    await j.act('sort by % Needs Review', () => page.click('th:has-text("% Needs Review")'));
    await page.waitForTimeout(300);
    const firstRow = await page.locator('tbody tr').first().innerText();
    j.note('top row after sort: ' + firstRow.replace(/\s+/g, ' '));
    await j.shot('j6-02-sorted');
    // Quality tab
    await j.act('click Survey Quality sub-tab', () => page.click('button:has-text("Survey Quality")'));
    await page.waitForTimeout(300);
    j.note('quality table first rows: ' + (await page.locator('tbody').last().innerText()).split('\n').slice(0, 6).join(' / '));
    await j.shot('j6-03-quality-tab', true);
    // Info icon keyboard/semantics
    j.note('info icons are: ' + JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll('th span.cursor-pointer')).slice(0, 2).map((s) => s.tagName + ' tabIndex=' + s.tabIndex))));
    await j.act('click row enum_07', () => page.locator('tbody tr:has-text("enum_07")').last().click());
    await page.waitForTimeout(2500);
    j.note('after row click: ' + (await page.locator('text=/Showing \\d+ submission/').innerText()) + '; filter badge: ' + (await page.locator('button:has-text("Filters") span').allInnerTexts()).join(','));
    await j.shot('j6-04-enum07-submissions');
    const t = await page.locator('main ul li button').allInnerTexts();
    j.note(`enum_07 list: ${t.length} items, ${t.filter((x) => /Issues/.test(x)).length} with issues`);
  });

  if (0) await sec('J7', async () => {
    await j.act('click Data Collection Progress nav', () => page.click('header >> text=Data Collection Progress'));
    await page.waitForTimeout(2500);
    await j.shot('j7-01-progress-overall', true);
    j.note('overall: ' + (await page.locator('table').first().innerText()).replace(/\s+/g, ' '));
    await j.act('click "By district" sub-tab', () => page.click('button:has-text("By district")'));
    await page.waitForTimeout(500);
    j.note('by district: ' + (await page.locator('table').first().innerText()).replace(/\s+/g, ' '));
    await j.shot('j7-02-by-district', true);
    await j.act('toggle Approved surveys only', () => page.click('button[role=switch]'));
    await page.waitForTimeout(2500);
    j.note('sub-tab after toggle, and table: ' + (await page.locator('table').first().innerText()).replace(/\s+/g, ' '));
    await j.shot('j7-03-approved-only', true);
    const hasDetailed = await page.locator('button:has-text("Detailed")').count();
    j.note('Detailed tab present: ' + hasDetailed);
    const badge = page.locator('span:has-text("Approved surveys only")');
    j.note('approved-only badge color: ' + JSON.stringify(await badge.evaluate((el) => { const cs = getComputedStyle(el); return { color: cs.color, bg: cs.backgroundColor }; }).catch(() => null)));
  });

  j.dump(OUT);
  console.log(JSON.stringify({ steps: j.steps, log: j.log }, null, 1));
  await j.browser.close();
})();
