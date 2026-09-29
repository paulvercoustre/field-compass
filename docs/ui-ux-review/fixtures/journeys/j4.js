// J4 — daily review loop: find flagged submissions, understand, decide, move on.
const { launch, loginUI } = require('./lib');
(async () => {
  const j = await launch();
  const { page } = j;
  try {
  await loginUI(j, 'newuser@example.org', 'synthetic-pass-123');
  await j.act('select survey in sidebar', () => page.click('aside >> text=Household Resilience 2026'));
  await page.waitForTimeout(2500);
  await j.shot('j4-01-queue');

  const items = page.locator('main ul li button');
  const n = await items.count();
  const texts = await items.allInnerTexts();
  const flaggedIdx = texts.map((t, i) => (/Issues/.test(t) && /Not Reviewed/.test(t) ? i : -1)).filter((i) => i >= 0);
  const allFlagged = texts.filter((t) => /Issues/.test(t)).length;
  const h = (await items.first().boundingBox()).height;
  const listBox = await page.locator('main ul').first().evaluate((el) => el.parentElement.getBoundingClientRect().toJSON());
  j.note(`queue: ${n} items, ${allFlagged} with issues (${flaggedIdx.length} of them Not Reviewed); item height ${h}px; list viewport ${Math.round(listBox.height)}px → ${Math.floor(listBox.height / h)} items visible`);
  j.note('positions of flagged items in list (0-based): ' + flaggedIdx.join(','));
  j.note('first list item text: ' + texts[0].replace(/\n/g, ' | '));
  j.note('first flagged item text: ' + texts[flaggedIdx[0]].replace(/\n/g, ' | '));

  // Is there a way to filter to flagged?
  await j.act('open Filters', () => page.click('button:has-text("Filters")'));
  await page.waitForTimeout(300);
  await j.shot('j4-02-filters-open');
  const filterLabels = await page.locator('main label.text-sm').allInnerTexts();
  j.note('filter controls available: ' + filterLabels.join(' / '));
  await j.act('close Filters', () => page.click('button:has-text("Filters")'));

  // Open the first flagged submission
  await j.act('scroll list & click first flagged submission', () => items.nth(flaggedIdx[0]).click());
  await page.waitForTimeout(1500);
  await j.shot('j4-03-detail-top');
  await j.shot('j4-04-detail-full', true);
  const detail = page.locator('main .flex-1.p-4.overflow-y-auto').first();
  const detailScrollH = await detail.evaluate((el) => el.scrollHeight);
  const detailClientH = await detail.evaluate((el) => el.clientHeight);
  // Where is the first failed check card relative to the top of the scroll area?
  const firstFlagY = await detail.evaluate((el) => {
    const flagged = Array.from(el.querySelectorAll('span')).find((s) => /^(Flagged|Outlier Detected)$/.test(s.textContent.trim()));
    if (!flagged) return null;
    return Math.round(flagged.getBoundingClientRect().top - el.getBoundingClientRect().top);
  });
  j.note(`detail scroll area: ${detailScrollH}px content in ${detailClientH}px viewport (${(detailScrollH / detailClientH).toFixed(1)} screens); first "Flagged" marker at ${firstFlagY}px from top of scroll area`);
  const headings = await detail.locator('h3').allInnerTexts();
  j.note('detail section order: ' + headings.join(' → '));
  const statusBtn = page.locator('div:has(> span:has-text("Actions:")) button').last();
  j.note('status control box: ' + JSON.stringify(await statusBtn.boundingBox()));

  // Decide: approve via dropdown
  await j.act('open status menu', () => statusBtn.click());
  await page.waitForTimeout(200);
  await j.shot('j4-05-status-menu');
  await j.act('choose "Approve"', () => page.click('[role=menuitem]:has-text("Approve")'));
  await page.waitForTimeout(1500);
  await j.shot('j4-06-after-approve');
  const sel = await page.locator('main h2:has-text("Submission #")').innerText();
  j.note('after approve: detail still shows ' + sel + '; list badge of that item: ' + (await items.nth(flaggedIdx[0]).innerText()).replace(/\n/g, ' | '));
  j.note('warning shown after approving flagged: ' + (await page.locator('text=/quality issue.*but is marked as approved/').count()));

  // Keyboard: press ArrowDown after using the menu (focus is back on the menu button)
  const focusedBefore = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80));
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(600);
  const menuOpen = await page.locator('[role=menu]').count();
  const selAfter = await page.locator('main h2:has-text("Submission #")').innerText();
  j.note(`ArrowDown after decision: focused=${focusedBefore}; status menu opened=${menuOpen > 0}; detail now ${selAfter}`);
  await page.keyboard.press('Escape');
  await j.shot('j4-07-arrowdown-after-decision');

  // Reviewer notes
  await j.act('type reviewer note', () => page.fill('textarea', 'Called enumerator; income confirmed as a data-entry slip.'));
  await j.act('click Save notes', () => page.click('button:has-text("Save notes")'));
  await page.waitForTimeout(1000);
  j.note('notes feedback: ' + (await page.locator('[role=status]').allInnerTexts()).join(' / '));

  // Move to the next flagged item: must scroll/scan the list
  await j.act('click next flagged submission in list', () => items.nth(flaggedIdx[1]).click());
  await page.waitForTimeout(1000);
  await j.act('open status menu', () => page.locator('div:has(> span:has-text("Actions:")) button').last().click());
  await j.act('choose "Not Approved"', () => page.click('[role=menuitem]:has-text("Not Approved")'));
  await page.waitForTimeout(1200);
  await j.shot('j4-08-second-decision');

  // Filter to Not Reviewed and decide: does the decided item leave the queue?
  await j.act('open Filters', () => page.click('button:has-text("Filters")'));
  await j.act('open Validation Status dropdown', () => page.click('button:has-text("Select validation statuses...")'));
  await j.act('tick Not Reviewed', () => page.click('label:has-text("Not Reviewed") input'));
  await page.keyboard.press('Escape');
  await page.mouse.click(1000, 600);
  await page.waitForTimeout(1500);
  const countText = await page.locator('text=/Showing \\d+ submission/').innerText();
  j.note('Not Reviewed filter: ' + countText);
  await j.shot('j4-09-not-reviewed-filter');
  const items2 = page.locator('main ul li button');
  const t2 = await items2.allInnerTexts();
  const fi = t2.findIndex((t) => /Issues/.test(t));
  await j.act('click a flagged Not Reviewed item', () => items2.nth(fi).click());
  await page.waitForTimeout(800);
  const idText = (await items2.nth(fi).innerText()).split('\n')[0];
  await j.act('open status menu', () => page.locator('div:has(> span:has-text("Actions:")) button').last().click());
  await j.act('choose "On Hold"', () => page.click('[role=menuitem]:has-text("On Hold")'));
  await page.waitForTimeout(1500);
  const stillInList = (await page.locator('main ul li button').allInnerTexts()).some((t) => t.startsWith(idText));
  j.note(`after putting ${idText} On Hold under a "Not Reviewed" filter: still in list=${stillInList}; count text=${await page.locator('text=/Showing \\d+ submission/').innerText()}`);
  await j.shot('j4-10-onhold-in-not-reviewed');

  } catch (e) { j.note('ERROR: ' + e.message.split('\n')[0]); }
  j.dump('' + (process.env.REVIEW_OUT || '/tmp/fc-review') + '/j4.json');
  console.log(JSON.stringify({ steps: j.steps, log: j.log }, null, 1));
  await j.browser.close();
})();
