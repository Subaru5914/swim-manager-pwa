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
      data = Buffer.from(data.toString().replaceAll('v1.27', 'v1.26'));
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

test('compact details have close labels, narrow stat boxes and right-aligned numbers on desktop and touch', async () => {
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
        const compact = await page.evaluate(() => ({
          width: document.querySelector('.modal-player-detail').getBoundingClientRect().width,
          stats: [...document.querySelectorAll('.stat-detail-row')].map(row => ({ width: row.getBoundingClientRect().width,
            align: getComputedStyle(row.querySelector('.stat-number')).textAlign })),
        }));
        assert.ok(compact.width <= (mobile ? 740 : 880));
        assert.ok(compact.stats.every(row => row.width <= (mobile ? 140 : 168) && row.align === 'right'));
        if (mobile && process.env.SWIM_SCREENSHOT_DIR) {
          fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR, { recursive: true });
          await page.screenshot({ path: path.join(process.env.SWIM_SCREENSHOT_DIR, 'v1.27-player-detail.png') });
        }
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
  } finally { await app.close(); }
});

test('training requires one item, reset chooses specialty, and specialty popup stays narrow', async () => {
  const app = await fixture();
  try {
    for (const mobile of [false, true]) {
      const context = await browser.newContext({ viewport: mobile ? { width: 844, height: 390 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile });
      try {
        const page = await context.newPage();
        const errors = runtimeErrors(page);
        await page.goto(app.url);
        await page.locator('#nav [data-page="training"]').click();
        await page.locator('#trainingPlan .focus-btn.selected').click();
        assert.equal(await page.locator('#trainingPlan .focus-btn.selected').count(), 1);
        assert.match(await page.locator('#toastRoot').innerText(), /最低1つ/);
        await page.locator('#trainingPlan .focus-btn:not(.selected)').first().click();
        assert.equal(await page.locator('#trainingPlan .focus-btn.selected').count(), 2);
        await page.locator('#clearFocusBtn').click();
        assert.equal(await page.locator('#trainingPlan .focus-btn.selected').count(), 1);
        const gap = await page.evaluate(() => {
          const row = [...document.querySelectorAll('#trainingPlayers tbody tr')].sort((a,b)=>b.querySelector('.athlete-name').getBoundingClientRect().width-a.querySelector('.athlete-name').getBoundingClientRect().width)[0];
          return row.querySelector('.grade-pill').getBoundingClientRect().left-row.querySelector('.athlete-name').getBoundingClientRect().right;
        });
        assert.ok(gap >= 0 && gap < 25, `name/grade gap ${gap}`);
        await page.locator('#nav [data-page="roster"]').click();
        await page.locator('#rosterTable [data-specialty]').first().click();
        const width = await page.locator('.modal-specialty-picker').evaluate(el => el.getBoundingClientRect().width);
        assert.ok(width <= (mobile ? 360 : 400), width);
        await page.locator('.modal-specialty-picker #x').click();
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
  } finally { await app.close(); }
});

test('entry badges expose qualified, unqualified and missing PB in both views; standards preserve entry', async () => {
  const app = await fixture();
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    const errors = runtimeErrors(page);
    await page.goto(app.url);
    await page.evaluate(() => {
      let standard=standardFor('intercollege','fr100');
      state.players[0].bestTimes.fr100=standard-.01;
      state.players[1].bestTimes.fr100=standard+.01;
      state.players[2].bestTimes.fr100=null;
      openMeetEntry('intercollege');
    });
    const cells = page.locator('#entryMatrix input[data-event="fr100"]');
    await cells.nth(0).check();
    for (const [i, word] of [[0, '標準突破'], [1, '未突破'], [2, 'PBなし']]) {
      assert.match(await cells.nth(i).locator('..').innerText(), new RegExp(word));
      assert.equal(await cells.nth(i).isDisabled(), i > 0);
    }
    await page.locator('#entryViewToggle').click();
    assert.match(await cells.nth(1).locator('..').innerText(), /未突破/);
    await page.locator('#std').click();
    assert.equal(await page.locator('.standards-table thead th').count(), 6);
    assert.equal(await page.locator('.standards-table tbody tr').nth(1).locator('td').last().innerText(), '47.64');
    await page.locator('.modal-standards #x').click();
    assert.equal(await cells.nth(0).isChecked(), true);
    assert.match(await page.locator('#entryViewToggle').innerText(), /能力表示 → PB表示/);
    assert.deepEqual(errors, []);
  } finally { await context.close(); await app.close(); }
});

test('world meet automatically animates own swimmers and mixed national relay, exposes all CPU-only results and saves offline', async () => {
  const app = await fixture();
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    const errors = runtimeErrors(page);
    await page.goto(app.url);
    await page.evaluate(() => {
      let own=state.players[0],cpu=state.world.slice(0,4);
      for(let p of [own,...cpu]){p.stats=Object.fromEntries(STATS.map(k=>[k,200]));for(let e of EVENTS)p.bestTimes[e]=expectedTime(p,e)}
      let individuals=Object.fromEntries(EVENTS.map(e=>[e,e==='fr100'?[own.id,cpu[0].id]:[cpu[0].id]]));
      let relays={'4x100fr':cpu.map(p=>p.id),'4x200fr':cpu.map(p=>p.id),'4x100medley':[cpu[1].id,cpu[2].id,cpu[3].id,own.id]};
      state.japanTeam={year:2027,individual:individuals,relays,athletes:[own,...cpu].map(p=>({id:p.id,snapshot:deepClone(p),ownAtSelection:p===own}))};
      state.season=2027;state.slot=36;renderAll();openMeetEntry('world_championship',36,2027);
    });
    assert.equal(await page.locator('#entryMatrix').count(), 0);
    await page.locator('#goRace').click();
    await page.locator('.modal-race-live').waitFor({ timeout: 60000 });
    assert.match(await page.locator('.modal-race-live h2').innerText(), /100mFr/);
    assert.match(await page.locator('.race-entrants .own').innerText(), /PB/);
    await page.locator('#skipEvent').click();
    await page.locator('#nextEv').click();
    await page.locator('.modal-race-live').waitFor();
    assert.match(await page.locator('.modal-race-live h2').innerText(), /メドレーリレー/);
    assert.match(await page.locator('.race-entrants .own').innerText(), /日本/);
    await page.locator('#skipEvent').click();
    await page.locator('#nextEv').click();
    await page.locator('.modal-meet-results').waitFor();
    assert.equal(await page.locator('#resEv option').count(), 12);
    await page.locator('#resEv').selectOption('fr400');
    assert.match(await page.locator('#resBody').innerText(), /自チームの出場なし/);
    assert.match(await page.locator('#resBody').innerText(), /予選総合（全2組/);
    assert.match(await page.locator('#scoreBody').innerText(), /フリーリレー/);
    await page.locator('#x').click();
    await page.locator('#saveBtn').click();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('swimManagerSave')));
    assert.equal(saved.japanTeam.year, 2027);
    assert.equal(saved.internationalWorld.year, 2027);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await context.setOffline(true);
    await page.reload();
    assert.equal(await page.evaluate(() => state.japanTeam.year), 2027);
    assert.equal(await page.evaluate(() => state.meetHistory.at(-1).meet), 'world_championship');
    assert.deepEqual(errors, []);
  } finally { await context.close(); await app.close(); }
});

test('actual March championship selects a graduating swimmer and April/save/reload preserve his automatic world entry', async () => {
  const app = await fixture();
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const errors = runtimeErrors(page);
    await page.goto(app.url);
    const selected = await page.evaluate(() => {
      let p=state.players.find(p=>p.year===4);
      p.stats=Object.fromEntries(STATS.map(k=>[k,200]));p.bestTimes.fr100=expectedTime(p,'fr100');
      state.season=2026;state.slot=94;state.activeCompetitionSeason=2026;state.activeCompetitionSlot=94;
      let entries=Object.fromEntries(EVENTS.map(e=>[e,e==='fr100'?[p.id]:[]]));
      let result=executeMeet('japan_championship',entries,{});
      let selected=result.selection.individual.fr100.includes(p.id),year=state.japanTeam.year;
      state.activeCompetitionSeason=null;state.activeCompetitionSlot=null;newSeason();saveLocal();
      return {id:p.id,name:p.name,selected,year,season:state.season};
    });
    assert.equal(selected.selected, true);
    assert.equal(selected.year, 2027);
    assert.equal(selected.season, 2027);
    await page.reload();
    const retained = await page.evaluate(id => ({ own:ownJapanAthlete(id),ids:worldAutoEntries(2027).individual.fr100 }), selected.id);
    assert.equal(retained.own, true);
    assert.ok(retained.ids.includes(selected.id));
    await page.evaluate(() => openMeetEntry('world_championship',36,2027));
    assert.match(await page.locator('.modal-entry-confirm').innerText(), new RegExp(selected.name));
    assert.deepEqual(errors, []);
  } finally { await context.close(); await app.close(); }
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

test('PWA upgrades its v1.26 cache to v1.27 and retains saved progress offline', async () => {
  const app = await fixture(true);
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const errors = runtimeErrors(page);
    await page.goto(app.url);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    assert.ok((await page.evaluate(() => caches.keys())).includes('swim-manager-pwa-v1.26'));
    await page.evaluate(() => {
      delete state.balanceModelVersion;
      state.slot = 15; state.points = 123; state.players[0].stats.fr_speed = 182;
      saveLocal();
    });
    app.upgrade();
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await page.waitForFunction(async () => {
      const keys = await caches.keys();
      return keys.includes('swim-manager-pwa-v1.27') && !keys.includes('swim-manager-pwa-v1.26');
    });
    // Load the newly published HTML before validating that its cached copy is usable.
    await page.reload();
    assert.match(await page.title(), /v1\.27/);
    assert.equal(await page.evaluate(() => state.version), 'pwa-v1.27');
    assert.equal(await page.evaluate(() => state.slot), 15);
    assert.equal(await page.evaluate(() => state.points), 123);
    assert.equal(await page.evaluate(() => state.players[0].stats.fr_speed), 182);
    await context.setOffline(true);
    const response = await page.reload({ waitUntil: 'load' });
    assert.equal(response.fromServiceWorker(), true);
    assert.match(await page.title(), /v1\.27/);
    assert.equal(await page.evaluate(() => state.slot), 15);
    assert.equal(await page.evaluate(() => state.points), 123);
    assert.deepEqual(errors, []);
  } finally { await context.close(); await app.close(); }
});
