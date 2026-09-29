const { launch, loginUI } = require('./lib');
(async () => {
  const j = await launch(); const p = j.page;
  await loginUI(j, 'newuser@example.org', 'synthetic-pass-123');
  let reqs = [];
  p.on('request', (r) => { if (r.url().includes('/api/')) reqs.push(r.url().replace('http://localhost:8000', '').replace(/survey_id=[^&]+/, 'survey_id=…')); });
  await p.click('aside >> text=Household Resilience 2026'); await p.waitForTimeout(3000);
  const onSelect = reqs.slice(); reqs = [];
  await p.locator('main ul li button').nth(3).click(); await p.waitForTimeout(2000);
  const onOpenSubmission = reqs.slice(); reqs = [];
  await p.click('button:has-text("Filters")'); await p.click('button:has-text("Select validation statuses...")');
  await p.click('label:has-text("Approved") input'); await p.waitForTimeout(2000);
  const onFilter = reqs.slice();
  console.log(JSON.stringify({ onSelect: onSelect.length, submissionsPagesOnSelect: onSelect.filter((u) => u.includes('/api/submissions?')).length, onSelectList: onSelect, onOpenSubmission, onFilter }, null, 1));
  await j.browser.close();
})();
