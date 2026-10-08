const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { test, before, after } = require('node:test');
const { chromium } = require('playwright');

const repo = path.join(__dirname, '..');
const assets = ['index.html', 'sw.js', 'manifest.webmanifest', 'icons/apple-touch-icon.png',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'];
let browser;
before(async () => {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true });
});
after(async () => { await browser?.close(); });

async function fixture(legacy = false) {
  let oldVersion = legacy;
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const name = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!assets.includes(name)) { response.writeHead(404); response.end(); return; }
    let data = fs.readFileSync(path.join(repo, name));
    if (oldVersion && /\.(html|js|webmanifest)$/.test(name)) {
      data = Buffer.from(data.toString().replaceAll('v1.26', 'v1.25'));
    }
    response.writeHead(200, {
      'Content-Type': name.endsWith('.html') ? 'text/html; charset=utf-8'
        : name.endsWith('.js') ? 'text/javascript' : name.endsWith('.webmanifest') ? 'application/manifest+json' : 'image/png',
      'Cache-Control': 'no-cache',
    });
    response.end(data);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/index.html`,
    upgrade: () => { oldVersion = false; },
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

function runtimeErrors(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'warning') errors.push(message.text()); });
  page.on('dialog', async dialog => { errors.push(dialog.message()); await dialog.dismiss(); });
  return errors;
}

test('detail labels sit next to rank and PB values on desktop and landscape touch screens', async () => {
  const app = await fixture();
  try {
    for (const mobile of [false, true]) {
      const context = await browser.newContext({ viewport: mobile ? { width: 844, height: 390 } : { width: 1440, height: 900 },
        isMobile: mobile, hasTouch: mobile });
      try {
        const page = await context.newPage();
        const errors = runtimeErrors(page);
        await page.goto(app.url);
        await page.locator('#nav button[data-page="roster"]').click();
        await page.locator('#rosterTable [data-detail]').first().click();
        await page.locator('.modal-player-detail').waitFor({ state: 'visible' });
        const rows = await page.evaluate(() => [...document.querySelectorAll('.stat-detail-row, .pb-detail-row')].map(row => {
          const label = row.firstElementChild.getBoundingClientRect();
          const value = row.lastElementChild.getBoundingClientRect();
          return { pb: row.classList.contains('pb-detail-row'), gap: value.left - label.right,
            overflow: row.scrollWidth - row.clientWidth };
        }));
        assert.equal(rows.length, 26);
        for (const row of rows) {
          assert.ok(Math.abs(row.gap - (row.pb ? 8 : 6)) < 1, JSON.stringify(row));
          assert.ok(row.overflow <= 1, JSON.stringify(row));
        }
        if (mobile && process.env.SWIM_SCREENSHOT_DIR) {
          fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR, { recursive: true });
          await page.screenshot({ path: path.join(process.env.SWIM_SCREENSHOT_DIR, 'v1.26-player-detail.png') });
        }
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
  } finally { await app.close(); }
});

test('a training turn can enter and finish a record meet through the UI', async () => {
  const app = await fixture();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const page = await context.newPage();
    const errors = runtimeErrors(page);
    await page.goto(app.url);
    await page.evaluate(() => { state.slot = 8; renderAll(); });
    await page.locator('#advanceBtn').click();
    await page.locator('#modalRoot #next').click();
    await page.locator('#entryMatrix input[data-event="fr100"]').first().check();
    await page.locator('#confirmEntry').click();
    await page.locator('#goRace').click();
    await page.locator('#skipEvent').click();
    await page.locator('#modalRoot #nextEv').click();
    await page.locator('#modalRoot #x').click();
    const result = await page.evaluate(() => ({ slot: state.slot, history: state.meetHistory.length,
      meet: state.meetHistory.at(-1).meet, active: state.activeCompetitionSlot,
      records: state.players[0].raceHistory.filter(r => r.meet === 'team_trial' && r.event === 'fr100').length }));
    assert.equal(result.slot, 9);
    assert.equal(result.history, 1);
    assert.equal(result.meet, 'team_trial');
    assert.equal(result.active, null);
    assert.ok(result.records > 0);
    await page.locator('#saveBtn').click();
    await page.reload();
    assert.equal(await page.evaluate(() => state.meetHistory.length), 1);
    assert.deepEqual(errors, []);
  } finally { await context.close(); await app.close(); }
});

test('PWA upgrades its v1.25 cache to v1.26 and retains saved progress offline', async () => {
  const app = await fixture(true);
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const errors = runtimeErrors(page);
    await page.goto(app.url);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    assert.ok((await page.evaluate(() => caches.keys())).includes('swim-manager-pwa-v1.25'));
    await page.evaluate(() => {
      delete state.balanceModelVersion;
      state.slot = 15; state.points = 123; state.players[0].stats.fr_speed = 182;
      saveLocal();
    });
    app.upgrade();
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await page.waitForFunction(async () => {
      const keys = await caches.keys();
      return keys.includes('swim-manager-pwa-v1.26') && !keys.includes('swim-manager-pwa-v1.25');
    });
    // Load the newly published HTML before validating that its cached copy is usable.
    await page.reload();
    assert.match(await page.title(), /v1\.26/);
    assert.equal(await page.evaluate(() => state.version), 'pwa-v1.26');
    assert.equal(await page.evaluate(() => state.slot), 15);
    assert.equal(await page.evaluate(() => state.points), 123);
    assert.equal(await page.evaluate(() => state.players[0].stats.fr_speed), 182);
    await context.setOffline(true);
    const response = await page.reload({ waitUntil: 'load' });
    assert.equal(response.fromServiceWorker(), true);
    assert.match(await page.title(), /v1\.26/);
    assert.equal(await page.evaluate(() => state.slot), 15);
    assert.equal(await page.evaluate(() => state.points), 123);
    assert.deepEqual(errors, []);
  } finally { await context.close(); await app.close(); }
});
