const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SHOTS = path.resolve(__dirname, '../../screenshots');
const APP = 'http://127.0.0.1:3000';
const API = 'http://127.0.0.1:8000';
fs.mkdirSync(SHOTS, { recursive: true });

async function launch(opts = {}) {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  const context = await browser.newContext({
    viewport: opts.viewport || { width: 1440, height: 900 },
    colorScheme: opts.colorScheme || 'light',
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const log = [];
  page.on('console', (m) => { if (m.type() === 'error') log.push('console.error: ' + m.text().slice(0, 300)); });
  page.on('pageerror', (e) => log.push('pageerror: ' + e.message.slice(0, 300)));
  let steps = [];
  const j = {
    browser, context, page, log, steps,
    // an interaction the user performs (click, type into field, select)
    async act(label, fn) {
      const t0 = Date.now();
      await fn();
      steps.push({ n: steps.length + 1, label, ms: Date.now() - t0 });
    },
    async shot(name, full = false) {
      const p = path.join(SHOTS, name + '.png');
      await page.screenshot({ path: p, fullPage: full });
      return p;
    },
    note(label) { steps.push({ n: '-', label }); },
    dump(file) {
      fs.writeFileSync(file, JSON.stringify({ steps, log }, null, 2));
    },
  };
  return j;
}

async function apiLogin(email, password) {
  const r = await fetch(API + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: email, password }),
  });
  return (await r.json()).access_token;
}

async function api(token, method, p, body) {
  const r = await fetch(API + p, {
    method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
}

async function loginUI(j, email, password) {
  const { page } = j;
  await page.goto(APP);
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type=submit]');
  await page.waitForTimeout(1500);
}

module.exports = { launch, apiLogin, api, loginUI, APP, API, SHOTS };
