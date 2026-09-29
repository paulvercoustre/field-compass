// J1 — first run: register, land, connect Kobo (token + self-hosted URL), test.
const { launch, api, APP } = require('./lib');
const MOCK_URL = 'http://127.0.0.1:8765/api/v2';

(async () => {
  const j = await launch();
  const { page } = j;
  const email = 'newuser@example.org', pw = 'synthetic-pass-123';

  await page.goto(APP);
  await page.waitForTimeout(800);
  await j.shot('j1-01-login');

  await j.act('click Register tab', () => page.click('text=Register'));
  await j.act('type email', () => page.fill('#email', email));
  await j.act('type username', () => page.fill('#username', 'amina'));
  await j.act('type full name', () => page.fill('#fullName', 'Amina Reviewer'));
  await j.act('type password', () => page.fill('#password', pw));
  await j.act('type confirm', () => page.fill('#confirmPassword', pw));
  await j.shot('j1-02-register-filled');
  await j.act('click Create Account', () => page.click('button[type=submit]'));
  await page.waitForTimeout(2000);
  await j.shot('j1-03-first-landing');
  j.note('landing text: ' + (await page.locator('main').innerText()).replace(/\n/g, ' | '));
  j.note('sidebar text: ' + (await page.locator('aside').innerText()).replace(/\n/g, ' | '));

  // Try to create a survey before a Kobo key exists
  await j.act('click New survey', () => page.click('text=New survey'));
  await page.waitForTimeout(500);
  await j.act('type survey name', () => page.fill('input[required] >> nth=0', 'Household Resilience 2026'));
  await j.act('paste Kobo link', () => page.fill('input[placeholder^="https://kf.kobotoolbox.org"]', 'https://kf.kobotoolbox.org/#/forms/aSynthHH2026Demo0000001/summary'));
  await page.waitForTimeout(2500);
  await j.shot('j1-04-create-without-key', true);
  j.note('create page error text: ' + (await page.locator('text=/API key|Kobo API/').allInnerTexts()).join(' / '));
  j.note('Create Survey enabled? ' + (await page.locator('button:has-text("Create Survey")').isEnabled()));

  // Go to account settings via user menu
  await j.act('open user menu', () => page.click('aside button[title="' + email + '"]'));
  await j.act('click Account Settings', () => page.click('text=Account Settings'));
  await page.waitForTimeout(600);
  await j.shot('j1-05-account-settings', true);

  // Self-hosted server: change URL, then save token (the only visible save in the Kobo section)
  await j.act('edit Kobo API URL', () => page.fill('input[type=url]', MOCK_URL));
  const profileSaveVisibleAfterUrlEdit = await page.locator('form >> text=Save Changes').count();
  j.note('Profile "Save Changes" buttons visible after editing only the URL: ' + profileSaveVisibleAfterUrlEdit);
  await j.act('paste API token', () => page.fill('input[type=password] >> nth=0', 'synthetic-token-not-real'));
  await j.act('click Save Token', () => page.click('button:has-text("Save Token")'));
  await page.waitForTimeout(1200);
  await j.shot('j1-06-token-saved', true);

  const token = await page.evaluate(() => localStorage.getItem('field_compass_token'));
  let me = await api(token, 'GET', '/api/users/me');
  j.note('server kobo_api_url after Save Token: ' + me.json.kobo_api_url);

  await j.act('click Test Connection', () => page.click('button:has-text("Test Connection")'));
  await page.waitForTimeout(12000);
  await j.shot('j1-07-test-connection', true);
  j.note('test result text: ' + (await page.locator('section').nth(1).innerText()).replace(/\n/g, ' | ').slice(0, 400));

  // Reload: does the URL field still show what was typed?
  await page.reload();
  await page.waitForTimeout(1500);
  j.note('URL field after reload: ' + (await page.inputValue('input[type=url]')));

  // The only way to persist the URL: also edit username/full name so the profile Save appears
  await j.act('edit Kobo API URL again', () => page.fill('input[type=url]', MOCK_URL));
  await j.act('edit full name (workaround)', () => page.fill('input[placeholder="Your full name"]', 'Amina Reviewer.'));
  await j.act('click profile Save Changes', () => page.click('button:has-text("Save Changes")'));
  await page.waitForTimeout(1000);
  me = await api(token, 'GET', '/api/users/me');
  j.note('server kobo_api_url after profile save workaround: ' + me.json.kobo_api_url);
  await j.act('click Test Connection', () => page.click('button:has-text("Test Connection")'));
  await page.waitForTimeout(1500);
  await j.shot('j1-08-test-connection-mock', true);
  j.note('test result 2: ' + (await page.locator('text=/API key is valid|failed|Could not/').allInnerTexts()).join(' / '));

  j.dump('' + (process.env.REVIEW_OUT || '/tmp/fc-review') + '/j1.json');
  console.log(JSON.stringify({ steps: j.steps, log: j.log }, null, 1));
  await j.browser.close();
})();
