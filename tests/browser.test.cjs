const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { test, before, after } = require('node:test');
const { chromium } = require('playwright');
const {config:cloudConfig,backend:cloudBackend}=require('./cloud-fixture.cjs');

const repo = path.join(__dirname, '..');
const assets = ['index.html', 'sw.js', 'manifest.webmanifest', 'cloud-sync.js', 'cloud-config.json', 'CLOUD_SYNC_SETUP.md', 'firebase.database.rules.json', 'icons/apple-touch-icon.png',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'];
let browser;
before(async () => {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true });
});
after(async () => { await browser?.close(); });

async function testContext(options) {
  const context=await browser.newContext(options);
  await context.addInitScript(()=>{Object.defineProperty(crypto,'getRandomValues',{configurable:true,value:array=>{array[0]=12345;return array;}});});
  return context;
}

async function fixture(legacy = false, cloudDefaults = {apiKey:'',databaseURL:''}) {
  let oldVersion = legacy;
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const name = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!assets.includes(name)) { response.writeHead(404); response.end(); return; }
    let data = fs.readFileSync(path.join(repo, name));
    if(name==='cloud-config.json')data=Buffer.from(JSON.stringify(cloudDefaults));
    if (oldVersion && /\.(html|js|webmanifest)$/.test(name)) {
      data = Buffer.from(data.toString().replaceAll('v1.65', 'v1.64'));
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

async function cloudContext(server,options){
  const context=await testContext(options);
  await context.addInitScript(config=>localStorage.setItem('swimManagerCloudConfig',JSON.stringify(config)),cloudConfig);
  const handler=async route=>{
    const request=route.request(),headers={'Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'ETag','Access-Control-Allow-Methods':'GET,PUT,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,If-Match,X-Firebase-ETag'};
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
    const response=await server.fetch(request.url(),{method:request.method(),headers:request.headers(),body:request.postData()});
    await route.fulfill({status:response.status,headers:{...Object.fromEntries(response.headers),...headers},body:await response.text()});
  };
  for(const url of ['https://identitytoolkit.googleapis.com/**','https://securetoken.googleapis.com/**',cloudConfig.databaseURL+'/**'])await context.route(url,handler);
  return context;
}

test('PC and iPhone account screens share real game saves, handle offline conflicts and retain login after reload',async()=>{
  const app=await fixture(false,cloudConfig),server=cloudBackend(),pcContext=await cloudContext(server),phoneContext=await cloudContext(server,{viewport:{width:844,height:390},isMobile:true,hasTouch:true});
  try{
    const pc=await pcContext.newPage(),phone=await phoneContext.newPage(),errors=[runtimeErrors(pc),runtimeErrors(phone)];
    await pc.goto(app.url);await pc.waitForFunction(()=>cloudSync?.config);
    const scoutId=await pc.evaluate(()=>{
      state.points=321;state.players[0].stats.fr_speed=111.22;state.players[0].bestTimes.fr100=47.89;
      const a=state.world.find(a=>a.category==='high'&&a.grade===3);a.scoutPreferences={version:3,worldAmbition:true,preferredRegion:'kansai',earlyCompetition:true,prestigeSchool:true};
      saveLocal();return a.id;
    });
    for(const [page,create] of [[pc,true],[phone,false]]){
      if(page===phone){await page.goto(app.url);await page.waitForFunction(()=>cloudSync?.config)}
      await page.locator('.utility-summary').click();await page.locator('#cloudSyncBtn').click();
      await page.locator('#cloudEmail').fill('owner@example.test');await page.locator('#cloudPassword').fill('test-password');
      await page.locator(create?'#cloudRegister':'#cloudLogin').click();
      await page.locator('#cloudLogout').waitFor();
    }
    await phone.locator('#cloudUseRemote').click();await phone.waitForFunction(()=>cloudSync.status.kind==='synced');
    assert.equal(await phone.evaluate(()=>state.points),321);
    assert.equal(await phone.evaluate(()=>state.players[0].stats.fr_speed),111.22);
    assert.equal(await phone.evaluate(()=>state.players[0].bestTimes.fr100),47.89);
    assert.deepEqual(await phone.evaluate(id=>state.world.find(a=>a.id===id).scoutPreferences,scoutId),{version:3,worldAmbition:true,preferredRegion:'kansai',earlyCompetition:true,prestigeSchool:true});
    assert.ok((await phone.locator('.modal-cloud').boundingBox()).width<=620);
    await phone.locator('#cloudClose').click();await pc.locator('#cloudClose').click();
    await pc.evaluate(()=>{state.points=333;saveLocal()});
    await pc.waitForFunction(()=>cloudSync.status.kind==='synced');
    await phone.evaluate(()=>cloudSync.sync());await phone.waitForFunction(()=>state.points===333);
    await phone.evaluate(()=>navigator.serviceWorker.ready);await phoneContext.setOffline(true);
    await phone.evaluate(()=>{state.points=444;saveLocal()});
    assert.equal(await phone.evaluate(()=>JSON.parse(localStorage.getItem('swimManagerSave')).points),444);
    await pc.evaluate(async()=>{state.points=555;saveLocal();await cloudSync.sync()});
    await phoneContext.setOffline(false);await phone.waitForFunction(()=>cloudSync.status.kind==='conflict');
    assert.equal(await phone.evaluate(()=>state.points),444);
    await phone.locator('#cloudSyncChip').click();await phone.locator('#cloudUseRemote').click();
    await phone.waitForFunction(()=>cloudSync.status.kind==='synced');assert.equal(await phone.evaluate(()=>state.points),555);
    await phone.locator('#cloudClose').click();await phone.reload();
    await phone.waitForFunction(()=>cloudSync?.session&&cloudSync.status.kind==='synced');
    assert.equal(await phone.evaluate(()=>state.points),555);
    assert.equal(await phone.evaluate(()=>cloudSync.session.email),'owner@example.test');
    assert.ok(!await phone.evaluate(()=>JSON.stringify(state).includes('test-password')));
    for(const list of errors)assert.deepEqual(list,[]);
  }finally{await pcContext.close();await phoneContext.close();await app.close()}
});

test('a cloud save that fails to render cannot replace the local backup or leave stale game screens',async()=>{
  const app=await fixture(),context=await testContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true});
  try{
    const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);await page.waitForFunction(()=>cloudSync);
    const result=await page.evaluate(()=>{
      state.points=543;renderAll();autoSaveNow();
      const original=JSON.stringify(state),stored=localStorage.getItem('swimManagerSave');
      let damaged=deepClone(state);damaged.points=999;damaged.recordRankings.japan.fr100=[{kind:'relay',event:'fr100',time:45}];
      let rejected=false;try{cloudSync.options.applySave(damaged)}catch(error){rejected=true}
      return{rejected,progressKept:JSON.stringify(state)===original,backupKept:localStorage.getItem('swimManagerSave')===stored,
        points:JSON.parse(localStorage.getItem('swimManagerSave')).points,status:document.getElementById('status').textContent};
    });
    assert.ok(result.rejected&&result.progressKept);assert.equal(result.backupKept,true,JSON.stringify(result));
    assert.equal(result.points,543);assert.match(result.status,/pt 543/);
    await page.reload();assert.equal(await page.evaluate(()=>state.points),543);assert.deepEqual(errors,[]);
  }finally{await context.close();await app.close()}
});

test('unconfigured cloud setup keeps local play working and exposes configuration instructions',async()=>{
  const app=await fixture(),context=await testContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  try{
    const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);
    await page.waitForFunction(()=>cloudSync?.status.kind==='unconfigured');
    await page.locator('#cloudSyncChip').click();
    assert.equal(await page.locator('#cloudLogin').isDisabled(),true);
    assert.equal(await page.locator('#cloudConfigForm').isVisible(),true);
    assert.equal(await page.locator('.modal-cloud a').getAttribute('href'),'https://github.com/Subaru5914/swim-manager-pwa/blob/main/CLOUD_SYNC_SETUP.md');
    await page.locator('#cloudClose').click();await page.locator('#saveBtn').click();
    await page.reload();assert.ok(await page.evaluate(()=>state.players.length===32));
    assert.deepEqual(errors,[]);
  }finally{await context.close();await app.close()}
});

test('relay final entry screens change all three lineups, preserve prelims and use the confirmed swimmers in races and scores',async()=>{
  const app=await fixture(),context=await testContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true});
  try{
    const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);
    const fixtures=await page.evaluate(()=>{
      for(const p of state.players.slice(0,8)){
        p.stats=Object.fromEntries(STATS.map(k=>[k,p===state.players[0]||state.players.indexOf(p)<4?200:145]));
        for(const e of EVENTS)p.bestTimes[e]=expectedTime(p,e);
      }
      const original=state.players.slice(0,4).map(p=>p.id),next=state.players.slice(4,8).map(p=>p.id);
      const execute=executeMeet;executeMeet=(...args)=>{const result=execute(...args);window.relayTestResult=result;return result};
      const play=playRaceCanvas;playRaceCanvas=(event,rows,options)=>{
        const own=rows.find(row=>row.source==='PLAYER');window.relayTestRace={event,final:options.stageLabel.includes('A決勝'),members:own?.members?.map(p=>p.id)};
        return play(event,rows,options);
      };
      const entries=Object.fromEntries(EVENTS.map(e=>[e,[]])),relays=Object.fromEntries(RELAYS.map(k=>[k,[...original]]));
      renderTrainingPlayers();
      openMeetEntry('intercollege',43,2026,entries,relays);
      return {original,next,kinds:RELAYS,labels:RELAY_LABEL,order:[...document.querySelectorAll('#trainingPlayers tbody tr')].map(r=>r.dataset.id)};
    });
    // Leaving the preliminary editor must discard its unconfirmed draft.
    await page.locator('#relayBtn').click();
    assert.deepEqual(await page.locator('#relayEditorBody select').first().locator('option').evaluateAll(options=>options.map(o=>o.value).filter(Boolean)),fixtures.order);
    await page.locator('select[data-kind="4x100fr"][data-i="0"]').selectOption(fixtures.next[0]);
    await page.locator('#relayClose').click();await page.locator('#confirmEntry').click();await page.locator('#goRace').click();
    const seen=[],edited=[];
    for(let step=0;step<100;step++){
      await page.waitForFunction(()=>document.querySelector('#raceCanvas, #startProgramRace, #nextEv, #relayOk, #collegeRankingNext, .modal-meet-results'));
      if(await page.locator('.modal-meet-results').count())break;
      if(await page.locator('#collegeRankingNext').count()){await acceptCollegeRanking(page);continue;}
      if(await page.locator('#relayOk').count()){
        const kind=await page.locator('#relayEditorBody select').first().getAttribute('data-kind');
        assert.equal(await page.locator('#relayEditorBody select').count(),4);
        assert.deepEqual(await page.locator('#relayEditorBody select').first().locator('option').evaluateAll(options=>options.map(o=>o.value).filter(Boolean)),fixtures.order);
        assert.deepEqual(await page.locator('#relayEditorBody select').evaluateAll(selects=>selects.map(s=>s.value)),fixtures.original);
        assert.ok((await page.locator('.modal-relay-editor h2').innerText()).includes(fixtures.labels[kind]));
        const wanted=kind==='4x100medley'?[...fixtures.next].reverse():fixtures.next;
        for(let leg=0;leg<4;leg++)await page.locator(`select[data-kind="${kind}"][data-i="${leg}"]`).selectOption(wanted[leg]);
        edited.push(kind);await page.locator('#relayOk').click();continue;
      }
      if(await page.locator('#startProgramRace').count()){await page.locator('#startProgramRace').click();continue}
      if(await page.locator('#nextEv').count()){await page.locator('#nextEv').click();continue}
      const race=await page.evaluate(()=>window.relayTestRace),wanted=race.final?(race.event==='4x100medley'?[...fixtures.next].reverse():fixtures.next):fixtures.original;
      assert.deepEqual(race.members,wanted);seen.push({event:race.event,final:race.final});
      await page.locator('#skipEvent').click();await page.locator('#nextGroup').click();
    }
    assert.deepEqual([...edited].sort(),[...fixtures.kinds].sort());
    assert.equal(seen.length,6);assert.equal(seen.filter(r=>r.final).length,3);
    const saved=await page.evaluate(()=>{
      const result=window.relayTestResult;
      return {relays:result.relays.map(([kind,finals,meta])=>({kind,prelim:meta.prelim.find(ownsRelayTeam).members.map(p=>p.id),
        final:finals.find(ownsRelayTeam).members.map(p=>p.id),pending:meta.finalEntryPending})),
        actual:result.teamScores[state.playerUniversity],wanted:result.relays.reduce((sum,r)=>sum+[24,20,16,12,8,6,4,2][r[1].find(ownsRelayTeam).rank-1],0),
        history:JSON.parse(localStorage.getItem('swimManagerSave')).teamScoreHistory.at(-1).scores[state.playerUniversity]};
    });
    for(const row of saved.relays){
      assert.deepEqual(row.prelim,fixtures.original);
      assert.deepEqual(row.final,row.kind==='4x100medley'?[...fixtures.next].reverse():fixtures.next);assert.equal(row.pending,false);
    }
    assert.equal(saved.actual,saved.wanted);assert.equal(saved.history,saved.actual);assert.deepEqual(errors,[]);
    await page.locator('.modal-meet-results #x').click();
  }finally{await context.close();await app.close()}
});

test('game reset retains every configured organization name, resets progress and survives reload',async()=>{
  const app=await fixture(),context=await testContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true});
  try{
    const page=await context.newPage(),errors=[],dialogs=[];let acceptReset=false;
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='warning')errors.push(message.text())});
    page.on('dialog',async dialog=>{
      dialogs.push({type:dialog.type(),message:dialog.message()});
      if(dialog.type()==='confirm'&&!acceptReset)await dialog.dismiss();else await dialog.accept();
    });
    await page.goto(app.url);
    const original=await page.evaluate(()=>{
      renamePlayerUniversity('保持した自大学');
      state.universities.forEach((u,i)=>renameOrganization('university',i,`保持した大学${i+1}`));
      for(const cat of ['middle','high','adult'])organizationNames()[cat].forEach((n,i)=>renameOrganization(cat,i,`保持した${cat}${i+1}`));
      state.season=2032;state.slot=59;state.points=888;state.reputation=310;
      STATS.forEach(k=>{state.facilities[k]=75;state.players[0].stats[k]=165});
      state.universities[0].reputation=500;state.players[0].bestTimes.fr100=48.01;
      state.meetHistory=[{season:2031,meet:'intercollege',pointsAfter:888}];
      renderAll();saveLocal();
      return{state:JSON.stringify(state),save:localStorage.getItem('swimManagerSave'),
        names:{player:state.playerUniversity,universities:state.universities.map(u=>({id:u.id,name:u.name})),organizations:deepClone(organizationNames())},
        players:JSON.stringify(state.players)};
    });
    await page.locator('.utility-summary').click();await page.locator('#resetBtn').click();
    assert.equal(await page.evaluate(()=>JSON.stringify(state)),original.state);
    assert.equal(await page.evaluate(()=>localStorage.getItem('swimManagerSave')),original.save);
    acceptReset=true;
    await page.evaluate(()=>Object.defineProperty(crypto,'getRandomValues',{value:array=>{array[0]=24680;return array;}}));
    await page.locator('.utility-summary').click();await page.locator('#resetBtn').click();
    await page.waitForFunction(()=>state.season===2026&&state.points===0);
    const reset=await page.evaluate(()=>({
      names:{player:state.playerUniversity,universities:state.universities.map(u=>({id:u.id,name:u.name})),organizations:deepClone(organizationNames())},
      season:state.season,slot:state.slot,points:state.points,reputation:state.reputation,
      facilities:Object.values(state.facilities),count:state.players.length,players:JSON.stringify(state.players),
      ownAffiliations:state.players.every(p=>p.organization===state.playerUniversity),
      cpuFresh:state.universities.every(u=>u.reputation===initialUniversityReputation(u.strength)),
      worldAffiliations:state.world.every(a=>a.category==='university'?state.universities.some(u=>u.name===a.organization):organizationNames()[a.category].includes(a.organization)),
      everyOrgPopulated:['middle','high','adult'].every(cat=>organizationNames()[cat].every(n=>state.world.some(a=>a.category===cat&&a.organization===n)))&&state.universities.every(u=>state.world.some(a=>a.category==='university'&&a.organization===u.name)),
      history:state.meetHistory.length,savedNames:JSON.parse(localStorage.getItem('swimManagerSave')).organizationNames
    }));
    assert.deepEqual(reset.names,original.names);
    assert.deepEqual([reset.season,reset.slot,reset.points,reset.reputation,reset.count,reset.history],[2026,1,0,35,32,0]);
    assert.ok(reset.facilities.every(v=>v===0));assert.notEqual(reset.players,original.players);
    assert.ok(reset.ownAffiliations&&reset.cpuFresh&&reset.worldAffiliations&&reset.everyOrgPopulated);
    assert.deepEqual(reset.savedNames,original.names.organizations);
    await page.reload();
    assert.deepEqual(await page.evaluate(()=>({player:state.playerUniversity,universities:state.universities.map(u=>({id:u.id,name:u.name})),organizations:deepClone(organizationNames())})),original.names);
    await page.locator('.utility-summary').click();await page.locator('#universitiesBtn').click();
    assert.ok((await page.locator('#settingsPlayerUniversity').innerText()).includes(original.names.player));
    assert.equal(await page.locator('#settingsHigh .org-edit-row').count(),original.names.organizations.high.length);
    assert.deepEqual(dialogs.map(d=>d.type),['confirm','confirm','alert']);
    assert.ok(dialogs.every(d=>d.message.includes('引き継いで')));assert.deepEqual(errors,[]);
  }finally{await context.close();await app.close()}
});


test('failed file imports and local loads preserve playable progress and records on PC and portrait iPhone',async()=>{
  const app=await fixture();
  try{
    for(const options of [{viewport:{width:1280,height:800}},{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]){
      const context=await testContext(options);
      try{
        const page=await context.newPage(),errors=[],dialogs=[];
        page.on('pageerror',error=>errors.push(error.message));
        page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.accept()});
        await page.goto(app.url);
        const original=await page.evaluate(()=>{
          state.points=543;state.players[0].bestTimes.fr100=48.13;
          recordIndividualResult(state.players[0],'fr100',48.13,'intercollege','決勝');renderAll();saveLocal();
          let broken=deepClone(state);broken.recordRankings.japan.fr100=[{kind:'relay',event:'fr100',time:45}];
          return{state:JSON.stringify(state),broken:JSON.stringify(broken)};
        });
        for(const [i,payload] of ['{}',original.broken].entries()){
          const rejected=page.waitForEvent('dialog');
          await page.locator('#importFile').setInputFiles({name:`broken-${i}.json`,mimeType:'application/json',buffer:Buffer.from(payload)});
          await rejected;
          await page.waitForFunction(()=>document.getElementById('importFile').value==='');
          assert.equal(dialogs.length,i+1);assert.match(dialogs.at(-1),/JSONを読み込めませんでした/);
          assert.equal(await page.evaluate(()=>JSON.stringify(state)),original.state);
        }
        await page.evaluate(()=>{localStorage.setItem('swimManagerSave','{"players":null}');loadLocal(true)});
        assert.match(dialogs.at(-1),/セーブデータを読み込めませんでした/);
        assert.equal(await page.evaluate(()=>JSON.stringify(state)),original.state);
        await page.locator('#nav button[data-page="records"]').click();
        assert.ok(await page.locator('#recordRankingBody .record-ranking-own').count());
        await page.evaluate(()=>autoSaveNow());await page.reload();
        assert.equal(await page.evaluate(()=>JSON.stringify(state)),original.state);
        assert.equal(await page.evaluate(()=>state.points),543);assert.deepEqual(errors,[]);
      }finally{await context.close()}
    }
  }finally{await app.close()}
});

async function acceptCollegeRanking(page){
  assert.match(await page.locator('.modal-college-ranking .notice').innerText(),/全4日間/);
  const scores=await page.evaluate(()=>state.teamScoreHistory.at(-1).scores);
  assert.equal(await page.locator('.college-ranking-table tbody tr').count(),Object.keys(scores).length);
  assert.equal(await page.locator('.college-own').count(),1);
  const own=await page.locator('.college-own td').allTextContents(),university=await page.evaluate(()=>state.playerUniversity);
  assert.equal(own[1],'★ '+university);assert.equal(own[2],scores[university]+' pt');
  await page.locator('#collegeRankingNext').click();await page.locator('.modal-meet-results').waitFor();
}

async function advanceToRace(page) {
  for(let steps=0;steps<100;steps++){
    await page.waitForFunction(()=>document.querySelector('#raceCanvas, #startProgramRace, #nextEv, #relayOk, #collegeRankingNext, .modal-meet-results'));
    if(await page.locator('#raceCanvas').count())return;
    if(await page.locator('#relayOk').count()){await page.locator('#relayOk').click();continue;}
    if(await page.locator('.modal-meet-results, .modal-college-ranking').count())throw Error('Meet ended before the expected own race');
    if(await page.locator('#startProgramRace').count())await page.locator('#startProgramRace').click();
    else await page.locator('#nextEv').click();
  }
  throw Error('Own race was not reached');
}

async function drainRaces(page,program=[]) {
  const races=[];
  for(let steps=0;steps<200;steps++) {
    await page.waitForFunction(()=>document.querySelector('#raceCanvas, #startProgramRace, #nextEv, #relayOk, #collegeRankingNext, .modal-meet-results'));
    if(await page.locator('.modal-meet-results').count())return races;
    if(await page.locator('#collegeRankingNext').count()){await acceptCollegeRanking(page);continue;}
    if(await page.locator('#relayOk').count()){await page.locator('#relayOk').click();continue;}
    if(await page.locator('#startProgramRace').count()){
      program.push(await page.locator('.modal-meet-program').evaluate(m=>({day:Number(m.dataset.day),event:m.dataset.event,phase:m.dataset.phase})));
      await page.locator('#startProgramRace').click();continue;
    }
    if(await page.locator('#nextEv').count()){
      assert.ok(await page.locator('.modal-event-result .result-own').count()>0,'CPU-only results must wait until the summary');
      if(/予選総合/.test(await page.locator('.modal-event-result h2').innerText()))assert.equal(await page.locator('.modal-event-result .final-qualifier').count(),8);
      await page.locator('#nextEv').click();continue;
    }
    const title=await page.locator('.modal-race-live h2').innerText();races.push(title);
    const controls=await page.locator('#skipEvent').evaluate(el=>{let a=el.getBoundingClientRect(),m=el.closest('.modal').getBoundingClientRect();return {bottom:a.bottom,limit:m.bottom};});
    assert.ok(controls.bottom<=controls.limit+1,JSON.stringify(controls));
    assert.ok(await page.locator('.race-entrants .own').count()>0,title);
    if(await page.locator('.relay-entrant').count()){
      assert.equal(await page.locator('.relay-member').count(),4*await page.locator('.relay-entrant').count());
      assert.equal(await page.locator('.race-entrants .entrant-team').count(),0);
      assert.doesNotMatch(await page.locator('.race-entrants').innerText(),/PB|\d+歳|選考時/);
    }
    assert.equal(await page.locator('#nextRace').isDisabled(),true);
    await page.locator('#skipEvent').click();
    await page.locator('.modal-race-result').waitFor();
    assert.match(await page.locator('.modal-race-result h2').innerText(), /結果/);
    assert.ok(await page.locator('.modal-race-result .result-own').count()>0);
    await page.locator('#nextGroup').click();
  }
  throw Error('Race sequence did not terminate');
}

test('checkpoint popups, post-intercollege retirement and hidden growth types work on PC and portrait iPhone',async()=>{
  const app=await fixture();
  try{
    for(const mobile of [false,true]){
      const context=await testContext({viewport:mobile?{width:390,height:844}:{width:1280,height:800},isMobile:mobile,hasTouch:mobile});
      try{
        const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);
        const setup=await page.evaluate(()=>{
          const seniors=state.players.filter(p=>p.year===4);seniors.forEach(p=>p.bestTimes={});
          const swimmer=seniors[0],kept=seniors[1];swimmer.name='引退確認 選手';kept.name='継続確認 選手';
          swimmer.stats=Object.fromEntries(STATS.map(k=>[k,40]));swimmer.bestTimes.fr100=(standardFor('intercollege','fr100')+standardFor('japan_open','fr100'))/2;
          kept.bestTimes.fr100=standardFor('japan_open','fr100');selectedTrainingId=swimmer.id;
          state.reputation=75;state.meetParticipationHistory=[{season:2025,meet:'intercollege',counts:{player:0}}];
          const entries=Object.fromEntries(EVENTS.map(e=>[e,e==='fr100'?[swimmer.id]:[]]));
          showEntryConfirmation('intercollege',entries,{},42,2026);
          return {id:swimmer.id,kept:kept.id};
        });
        await page.locator('#goRace').click();await advanceToRace(page);
        assert.ok(await page.evaluate(id=>state.players.some(p=>p.id===id),setup.id));
        assert.equal(await page.evaluate(()=>state.reputation),75);
        assert.ok(await page.evaluate(()=>state.pendingMeetCompletion?.meet==='intercollege'));
        await drainRaces(page);
        assert.equal(await page.evaluate(()=>state.reputation),85);
        assert.equal(await page.locator('#homeRep').innerText(),'中堅');
        assert.ok(await page.evaluate(id=>!state.players.some(p=>p.id===id)&&!state.trainingPlans[id]&&!state.trainingFocus[id],setup.id));
        assert.ok(await page.evaluate(id=>state.players.some(p=>p.id===id&&p.year===4),setup.kept));
        assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('swimManagerSave')).reputation),85);
        await page.locator('.modal-meet-results #x').click();
        await page.locator('.modal-season-notice').waitFor();
        assert.match(await page.locator('.modal-season-notice').innerText(),/発展途上 → 中堅/);
        assert.match(await page.locator('.modal-season-notice').innerText(),/引退確認 選手/);
        if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v1.65-season-${mobile?'iphone':'pc'}.png`)});}
        await page.reload();await page.locator('.modal-season-notice').waitFor();
        assert.equal(await page.evaluate(()=>state.reputation),85);assert.equal(await page.evaluate(()=>state.reputationEvaluations.length),1);
        await page.locator('#seasonNoticeNext').click();await page.reload();
        assert.equal(await page.locator('.modal-season-notice').count(),0);
        await page.locator('#nav [data-page="roster"]').click();
        assert.doesNotMatch(await page.locator('#rosterTable').innerText(),/引退確認 選手|早熟|晩成|通常型|成長タイプ/);
        await page.locator(`#rosterTable [data-detail="${setup.kept}"]`).click();
        assert.doesNotMatch(await page.locator('.modal-player-detail').innerText(),/早熟|晩成|通常型|成長タイプ/);
        await page.locator('.modal-player-detail #x').click();
        const national=await page.evaluate(()=>{
          for(const meet of ['japan_open','japan_championship'])state.meetParticipationHistory.push({season:2025,meet,counts:{player:2}});
          const own=state.players[0];completeMeet({meet:'japan_open',season:2026,events:{fr100:{prelim:[{source:'PLAYER',athlete:own}],final:[]}},relays:[]});const before=state.reputation;
          completeMeet({meet:'japan_championship',season:2026,events:{},relays:[]});saveLocal();showPendingSeasonNotices(()=>renderAll());
          return {before,after:state.reputation};
        });
        assert.deepEqual(national,{before:85,after:22});assert.match(await page.locator('.modal-season-notice').innerText(),/日本選手権終了/);
        assert.match(await page.locator('.modal-season-notice').innerText(),/中堅 → 弱小/);
        await page.locator('#seasonNoticeNext').click();assert.deepEqual(errors,[]);
      }finally{await context.close();}
    }
  }finally{await app.close();}
});

test('college awards and all three historic record categories work on PC and portrait iPhone and survive reload',async()=>{
  const app=await fixture();
  for(const options of [{viewport:{width:1280,height:800}},{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]){
    const context=await testContext(options);
    try{
      const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);
      const names=await page.evaluate(()=>{
        state.recordRankings={};state.teamTop10={};state.world.forEach(a=>a.accolades=[]);
        const own=state.players.find(p=>p.year===2);own.name='記録確認選手';
        recordIndividualResult({...own,id:'school-record',category:'high',grade:3,age:18,year:null,organization:'記録高校'},'fr100',50,'全国高校総体','決勝');
        updateResultHistory(own,'fr100',49,'intercollege','決勝',1);
        recordIndividualResult({id:'adult-record',name:'社会人選手',category:'adult',organization:'記録チーム'},'fr100',48,'japan_championship','決勝');
        recordRelayResult('4x100fr',{organization:state.playerUniversity,members:[1,2,3,4].map(year=>state.players.find(p=>p.year===year)),race:{total:200}},'intercollege','決勝');
        delete state.recordRankings.university.fr100;
        state.recordRankings.japan.fr100=state.recordRankings.japan.fr100.filter(r=>r.athleteId!==own.id);
        const events=Object.fromEntries(EVENTS.map(e=>[e,{prelim:[],final:[],heats:[]} ]));
        const scores={[state.playerUniversity]:90,優勝大学:100,三位大学:80,四位大学:70,五位大学:60,六位大学:50,七位大学:40,八位大学:30,九位大学:20,無得点大学:0};
        showMeetSummary({meet:'intercollege',events,relays:[],teamScores:scores},()=>renderAll());
        return{university:state.playerUniversity};
      });
      assert.equal(await page.locator('.award-1 .college-award').innerText(),'総合優勝');
      assert.equal(await page.locator('.award-2 .college-award').innerText(),'第2位');
      assert.equal(await page.locator('.award-3 .college-award').innerText(),'第3位');
      assert.equal(await page.locator('.award-finalist .college-award').count(),5);
      assert.equal(await page.locator('.college-own td').nth(1).innerText(),'★ '+names.university);
      assert.equal(await page.locator('.college-ranking-table tbody tr').last().locator('.college-award').count(),0);
      const bounds=await page.locator('.modal-college-ranking').evaluate(m=>({height:m.clientHeight,available:Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--game-vh'))*100,
        button:m.querySelector('#collegeRankingNext').getBoundingClientRect(),modal:m.getBoundingClientRect(),scroll:m.querySelector('.college-ranking-wrap').scrollHeight>m.querySelector('.college-ranking-wrap').clientHeight}));
      assert.ok(bounds.height<=bounds.available,JSON.stringify(bounds));
      assert.ok(bounds.button.left>=bounds.modal.left&&bounds.button.right<=bounds.modal.right+1&&bounds.button.bottom<=bounds.modal.bottom+1,JSON.stringify(bounds));
      await page.locator('#collegeRankingNext').click();await page.locator('.modal-meet-results #x').click();
      await page.locator('#nav button[data-page="records"]').click();
      assert.equal(await page.locator('#recordRankingEvent option').count(),18);
      assert.equal(await page.locator('#recordRankingCategory option').count(),3);
      await page.locator('#recordRankingCategory').selectOption('high');
      assert.equal(await page.locator('#recordRankingTitle').innerText(),'高校記録10傑');
      assert.match(await page.locator('#recordRankingBody').innerText(),/記録高校/);
      assert.equal(await page.locator('#recordRankingBody .record-time').innerText(),'50.00');
      assert.equal(await page.locator('#recordRankingBody .record-school-label').innerText(),'高3');
      await page.locator('#recordRankingCategory').selectOption('university');
      assert.match(await page.locator('#recordRankingBody').innerText(),/記録確認選手/);
      assert.equal(await page.locator('#recordRankingBody .record-time').innerText(),'49.00');
      assert.equal(await page.locator('#recordRankingBody .record-school-label').innerText(),'大2');
      await page.locator('#recordRankingEvent').selectOption('4x100fr');
      assert.equal(await page.locator('#recordRankingBody .record-time').innerText(),'3:20.00');
      assert.match(await page.locator('#recordRankingBody').innerText(),/記録確認選手/);
      assert.deepEqual(await page.locator('#recordRankingBody .record-school-label').allTextContents(),['大1','大2','大3','大4']);
      await page.locator('#nav button[data-page="home"]').click();await page.locator('#nav button[data-page="records"]').click();
      assert.equal(await page.locator('#recordRankingCategory').inputValue(),'university');
      assert.equal(await page.locator('#recordRankingEvent').inputValue(),'4x100fr');
      const saved=await page.evaluate(()=>{saveLocal();return JSON.stringify(state.recordRankings)});
      await page.reload();await page.locator('#nav button[data-page="records"]').click();
      assert.equal(await page.evaluate(()=>JSON.stringify(state.recordRankings)),saved);
      await page.locator('#recordRankingCategory').selectOption('japan');await page.locator('#recordRankingEvent').selectOption('fr100');
      assert.deepEqual(await page.locator('#recordRankingBody .record-time').allTextContents(),['48.00','49.00','50.00']);
      assert.deepEqual(await page.locator('#recordRankingBody .record-school-label').allTextContents(),['社会人','大2','高3']);
      assert.equal(await page.locator('#teamTop10Body').isVisible(),false);
      const recordPageWidth=await page.locator('#page-records>.card').first().evaluate(el=>el.clientWidth);
      await page.locator('#showTeamTop10Btn').click();
      await page.locator('#page-team-top10.active').waitFor();
      assert.equal(await page.locator('#page-records.active').count(),0);
      assert.equal(await page.locator('#showTeamTop10Btn').getAttribute('aria-current'),'page');
      assert.equal(await page.locator('#modalRoot .modal').count(),0);
      assert.equal(await page.locator('#page-team-top10>.card').evaluate(el=>el.clientWidth),recordPageWidth);
      assert.equal(await page.locator('#teamTop10Event option').count(),18);
      assert.ok(await page.locator('#teamTop10Body').isVisible());
      assert.match(await page.locator('#teamTop10Body').innerText(),/記録確認選手/);
      assert.equal(await page.locator('#teamTop10Title').innerText(),'100mFr 歴代10傑');
      if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v1.65-team-top10-${options.isMobile?'iphone':'pc'}.png`)});}
      await page.locator('#nav [data-page="records"]').click();
      assert.equal(await page.locator('#page-team-top10').isVisible(),false);
      assert.equal(await page.locator('#page-records.active').count(),1);assert.deepEqual(errors,[]);
    }finally{await context.close()}
  }
  await app.close();
});

test('compact details have close labels, narrow stat boxes and right-aligned numbers on desktop and touch', async () => {
  const app = await fixture();
  try {
    for (const mobile of [false, true]) {
      const context = await testContext({ viewport: mobile ? { width: 844, height: 390 } : { width: 1440, height: 900 },
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
        assert.equal(rows.length, 31);
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
        assert.ok(compact.stats.every(row => row.width <= (mobile ? 152 : 180) && row.align === 'right'));
        if (mobile && process.env.SWIM_SCREENSHOT_DIR) {
          fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR, { recursive: true });
          await page.screenshot({ path: path.join(process.env.SWIM_SCREENSHOT_DIR, 'v1.28-player-detail.png') });
        }
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
  } finally { await app.close(); }
});

test('roster specialty PB groups follow event order and detail/training edits persist together',async()=>{
  const app=await fixture();
  try{
    for(const mobile of [false,true]){
      const context=await testContext({viewport:mobile?{width:390,height:844}:{width:1440,height:900},isMobile:mobile,hasTouch:mobile});
      try{
        const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);
        const fixture=await page.evaluate(()=>{
          const athletes=[];
          SPECIALTY_EVENTS.forEach((e,i)=>{
            for(const suffix of ['slow','fast','missing']){
              const p=deepClone(state.players[i]);p.id='sort-'+e+'-'+suffix;p.name=e+' '+suffix;p.specialty=e;
              p.year=suffix==='fast'?1:suffix==='slow'?2:3;
              if(e==='fr100'&&suffix==='fast')p.bestTimes.im400=250;
              p.bestTimes[e]=suffix==='missing'?null:1000-i*50+(suffix==='slow'?1:0);athletes.push(attachMedleyStats(p));
            }
          });
          state.players=athletes.reverse();renderAll();
          return {expected:SPECIALTY_EVENTS.flatMap(e=>['fast','slow','missing'].map(s=>'sort-'+e+'-'+s)),
            ascending:['fast','slow','missing'].flatMap(s=>SPECIALTY_EVENTS.map(e=>'sort-'+e+'-'+s)),
            descending:['missing','slow','fast'].flatMap(s=>SPECIALTY_EVENTS.map(e=>'sort-'+e+'-'+s)),original:state.players.map(p=>p.id),
            stable:JSON.stringify(state.players.map(p=>({id:p.id,stats:p.stats,bestTimes:p.bestTimes})))};
        });
        await page.locator('#nav [data-page="roster"]').click();
        for(const [mode,key] of [['grade_asc','ascending'],['grade_desc','descending'],['specialty_pb','expected']]){
          await page.locator('#rosterSortMode').selectOption(mode);
          assert.deepEqual(await page.locator('#rosterTable [data-detail]').evaluateAll(buttons=>buttons.map(b=>b.dataset.detail)),fixture[key]);
        }
        assert.deepEqual(await page.locator('#rosterTable [data-detail]').evaluateAll(buttons=>buttons.map(b=>b.dataset.detail)),fixture.expected);
        for(const event of ['fr50','fr400','ba50','br200','fly100','im200','im400']){
          await page.locator('#rosterSortMode').selectOption('event_'+event);
          const shown=await page.locator('#rosterTable tbody tr').evaluateAll(rows=>rows.map(row=>({
            id:row.querySelector('[data-detail]').dataset.detail,keys:[...row.querySelectorAll('.top-stat-chip')].map(c=>c.dataset.stat),
            text:[...row.querySelectorAll('.top-stat-chip')].map(c=>c.textContent)})));
          const expected=await page.evaluate(event=>state.players.map(p=>{
            const s=strokeForEvent(event),keys=s==='im'?DERIVED_STATS:[s+'_speed',s+'_stamina',s+'_turn'];
            return {id:p.id,keys,values:keys.map(k=>Math.round(displayStatValue(p,k)))};
          }),event);
          for(const row of shown){const p=expected.find(p=>p.id===row.id);assert.deepEqual(row.keys,p.keys,event);
            row.text.forEach((text,i)=>assert.match(text,new RegExp(' '+p.values[i]+'$'),event));}
          assert.match(await page.locator('#rosterTable thead').innerText(),/ステータス/);
        }
        await page.locator('#rosterSortMode').selectOption('specialty_pb');
        const specialtyKeys=await page.locator('#rosterTable tbody tr').evaluateAll(rows=>rows.map(row=>({id:row.querySelector('[data-detail]').dataset.detail,keys:[...row.querySelectorAll('.top-stat-chip')].map(c=>c.dataset.stat)})));
        for(const row of specialtyKeys){const event=row.id.split('-')[1],s=event.startsWith('fly')?'fly':event.slice(0,2);
          assert.deepEqual(row.keys,s==='im'?['im_speed','im_stamina']:[s+'_speed',s+'_stamina',s+'_turn']);}
        await page.locator('#rosterSortMode').selectOption('grade_asc');
        assert.match(await page.locator('#rosterTable thead').innerText(),/上位能力/);
        assert.equal(await page.locator('#rosterTable tbody tr').first().locator('.top-stat-chip').count(),3);
        await page.locator('#nav [data-page="training"]').click();
        assert.deepEqual(await page.locator('#trainingPlayers tr[data-id]').evaluateAll(rows=>rows.map(r=>r.dataset.id)),fixture.ascending);
        assert.equal(await page.locator('#trainingPlayers [data-id="sort-fr100-fast"] .training-specialty-pb b').innerText(),'15:50.00');
        const pbFits=await page.locator('#trainingPlayers [data-id="sort-fr100-fast"] .training-specialty-pb b').evaluate(b=>b.getBoundingClientRect().right<=b.closest('td').getBoundingClientRect().right+1);
        assert.ok(pbFits,'training specialty PB fits inside its column');
        assert.equal(await page.locator('#trainingPlayers [data-id="sort-fr100-missing"] .training-specialty-pb b').innerText(),'未記録');
        await page.locator('#nav [data-page="roster"]').click();
        assert.deepEqual(await page.evaluate(()=>state.players.map(p=>p.id)),fixture.original);
        const id='sort-fr100-fast';
        const others=await page.evaluate(id=>JSON.stringify(Object.fromEntries(Object.entries(state.trainingFocus).filter(([key])=>key!==id))),id);
        await page.locator(`#rosterTable [data-detail="${id}"]`).click();
        await page.locator('[data-detail-focus="fly_stamina"]').click();
        assert.equal(await page.locator('[data-detail-focus][aria-checked="true"]').count(),1);
        assert.deepEqual(await page.evaluate(id=>state.trainingFocus[id],id),['fly_stamina']);
        assert.equal(await page.evaluate(()=>selectedTrainingId),id);
        assert.equal(await page.evaluate(id=>JSON.stringify(Object.fromEntries(Object.entries(state.trainingFocus).filter(([key])=>key!==id))),id),others);
        await page.locator('[data-detail-focus="fly_stamina"]').click();
        assert.deepEqual(await page.evaluate(id=>state.trainingFocus[id],id),['fly_stamina']);
        await page.locator('#detailSpecialtyBtn').click();await page.locator('#spec').selectOption('br200');await page.locator('.modal-specialty-picker #ok').click();
        assert.equal(await page.locator('.modal-player-detail .specialty-br').count(),1);
        assert.equal(await page.locator('[data-detail-focus="fly_stamina"][aria-checked="true"]').count(),1);
        await page.locator('#detailSpecialtyBtn').click();await page.locator('#spec').selectOption('fr50');await page.locator('.modal-specialty-picker #x').click();
        assert.equal(await page.locator('.modal-player-detail .specialty-br').count(),1);
        assert.equal(await page.evaluate(id=>state.players.find(p=>p.id===id).specialty,id),'br200');
        await page.locator('.modal-player-detail #x').click();await page.locator('#nav [data-page="training"]').click();
        assert.equal(await page.locator('#trainingSpecialty .specialty-br').count(),1);
        assert.equal(await page.locator('#trainingPlan [data-focus="fly_stamina"].selected').count(),1);
        await page.locator('#trainingSpecialtyBtn').click();await page.locator('#spec').selectOption('im400');await page.locator('.modal-specialty-picker #ok').click();
        assert.equal(await page.locator('#page-training.active').count(),1);
        assert.match(await page.locator('#trainingSpecialty').innerText(),/400mIM/);
        const specialtyPB='4:10.00';
        assert.equal(await page.locator('#trainingSpecialtyPB').innerText(),specialtyPB);
        assert.equal(await page.locator(`#trainingPlayers [data-id="${id}"] .training-specialty-pb b`).innerText(),specialtyPB);
        assert.equal(await page.locator('#trainingPlan [data-focus="fly_stamina"].selected').count(),1);
        assert.equal(await page.locator('#trainingPlayers tr.selected').getAttribute('data-id'),id);
        const trainingOrder=await page.locator('#trainingPlayers tr[data-id]').evaluateAll(rows=>rows.map(r=>r.dataset.id));
        await page.locator('#saveBtn').click();await page.reload();
        assert.equal(await page.evaluate(id=>state.players.find(p=>p.id===id).specialty,id),'im400');
        assert.deepEqual(await page.evaluate(id=>state.trainingFocus[id],id),['fly_stamina']);
        assert.equal(await page.evaluate(()=>JSON.stringify(state.players.map(p=>({id:p.id,stats:p.stats,bestTimes:p.bestTimes})))),fixture.stable);
        await page.locator('#nav [data-page="training"]').click();await page.locator(`#trainingPlayers [data-id="${id}"]`).click();
        assert.equal(await page.locator('#trainingSpecialtyPB').innerText(),specialtyPB);
        assert.equal(await page.locator(`#trainingPlayers [data-id="${id}"] .training-specialty-pb b`).innerText(),specialtyPB);
        await page.locator('#nav [data-page="roster"]').click();await page.locator('#rosterSortMode').selectOption('grade_asc');
        assert.deepEqual(await page.locator('#rosterTable [data-detail]').evaluateAll(buttons=>buttons.map(b=>b.dataset.detail)),trainingOrder);
        await page.locator(`#rosterTable [data-detail="${id}"]`).click();
        assert.equal(await page.locator('[data-detail-focus="fly_stamina"][aria-checked="true"]').count(),1);
        assert.equal(await page.locator('.modal-player-detail .specialty-im').count(),1);
        await page.locator('.modal-player-detail #x').click();
        await page.locator('#nav [data-page="rankings"]').click();
        for(const category of ['all','middle','high','university','adult']){
          await page.locator('#rankCategory').selectOption(category);
          assert.equal(await page.locator('#rankingTable tbody tr').count(),50,category);
          assert.equal(await page.locator('#rankingTable .rank-pill').last().innerText(),'50');
        }
        assert.deepEqual(errors,[]);
      }finally{await context.close();}
    }
  }finally{await app.close();}
});

test('scouting shows every ranked senior, matches wishes to odds and preserves signed recruits on PC and iPhone',async()=>{
  const app=await fixture();
  try{
    for(const mobile of [false,true]){
      const context=await testContext({viewport:mobile?{width:390,height:844}:{width:1280,height:800},isMobile:mobile,hasTouch:mobile});
      try{
        const page=await context.newPage(),errors=[],dialogs=[];
        page.on('pageerror',e=>errors.push(e.message));
        page.on('console',message=>{if(message.type()==='warning')errors.push(message.text())});
        page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.accept()});
        await page.goto(app.url);
        const schoolColors=await page.evaluate(()=>{
          const colors=[1,2,3].map(grade=>getComputedStyle(document.querySelector(`#rosterTable .grade-${grade}`)).backgroundColor);
          window.originalSchoolGradePB=[];
          for(const category of ['middle','high'])for(const grade of [1,2,3]){
            const a=state.world.find(a=>a.category===category&&a.grade===grade&&!a.retired);
            window.originalSchoolGradePB.push({id:a.id,had:Object.hasOwn(a.bestTimes,'fr100'),time:a.bestTimes.fr100});a.bestTimes.fr100=40+grade;
          }
          return colors;
        });
        await page.locator('#nav [data-page="rankings"]').click();await page.locator('#rankEvent').selectOption('fr100');
        for(const [category,prefix] of [['middle','中'],['high','高']]){
          await page.locator('#rankCategory').selectOption(category);
          const badges=page.locator('#rankingTable tbody .grade-pill');
          assert.deepEqual((await badges.allTextContents()).slice(0,3),[1,2,3].map(grade=>`${prefix}${grade}`));
          assert.deepEqual(await badges.evaluateAll(bs=>bs.slice(0,3).map(b=>getComputedStyle(b).backgroundColor)),schoolColors);
          assert.deepEqual(await badges.evaluateAll(bs=>bs.slice(0,3).map(b=>b.className.split(' ').find(c=>c.startsWith('grade-')&&c!=='grade-pill'))),['grade-1','grade-2','grade-3']);
        }
        await page.evaluate(()=>{
          for(const saved of window.originalSchoolGradePB){const a=state.world.find(a=>a.id===saved.id);if(saved.had)a.bestTimes.fr100=saved.time;else delete a.bestTimes.fr100;}
          delete window.originalSchoolGradePB;renderAll();
        });
        const fixture=await page.evaluate(()=>{
          const a=state.world.find(a=>a.category==='high'&&a.grade===3);a.name='希望確認 高校生';a.specialty='fr100';a.accolades=[];
          a.bestTimes.fr100=JAPAN_RECORD.fr100*.99;a.scoutPreferences={version:3,worldAmbition:true,preferredRegion:'kansai',earlyCompetition:true,prestigeSchool:true};
          state.points=50;state.reputation=35;state.facilities=Object.fromEntries(STATS.map(k=>[k,0]));renderAll();
          return {id:a.id,probability:scoutProbability(a),ranked:[...new Set(EVENTS.flatMap(e=>ranking(e,'high',50)).filter(a=>a.grade===3).map(a=>a.id))]};
        });
        await page.locator('#nav [data-page="scout"]').click();
        const displayed=await page.locator('#scoutTable [data-scout]').evaluateAll(buttons=>buttons.map(b=>b.dataset.scout));
        assert.ok(fixture.ranked.every(id=>displayed.includes(id)));
        const row=page.locator('#scoutTable tr').filter({has:page.locator(`[data-scout="${fixture.id}"]`)});
        assert.equal(await row.locator('td').first().locator('.grade-pill.grade-3').innerText(),'高3');
        assert.equal(await row.locator('td').first().locator('.grade-pill').evaluate(b=>getComputedStyle(b).backgroundColor),schoolColors[2]);
        assert.match(await row.innerText(),/高校1位/);assert.match(await row.innerText(),/100mFrで世界を目指す/);assert.match(await row.innerText(),/関西の大学希望/);assert.match(await row.innerText(),/早く大会に出たい/);assert.match(await row.innerText(),/名門・強豪校希望/);
        assert.equal(await row.locator('.prob-pill').innerText(),(fixture.probability*100).toFixed(1)+'%');
        assert.equal(await page.locator('[data-scout-probability], .scout-probability-breakdown, .scout-ranked-tag').count(),0);
        assert.equal(await page.locator('#scoutTable button').filter({hasText:'内訳'}).count(),0);
        assert.doesNotMatch(await row.locator('td').first().innerText(),/50位以内/);
        if(process.env.SWIM_SCREENSHOT_DIR){
          fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});
          await row.scrollIntoViewIfNeeded();
          await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v1.65-scout-${mobile?'iphone':'pc'}.png`)});
        }
        const improved=await page.evaluate(id=>{
          const a=state.world.find(a=>a.id===id);state.facilities.ba_speed=100;state.facilities.mental=100;const unrelated=scoutProbability(a);
          for(const k of ['fr_speed','fr_stamina','fr_turn'])state.facilities[k]=100;
          const facilities=scoutProbability(a);state.reputation=250;const reputation=scoutProbability(a);renderAll();
          return {unrelated,facilities,reputation};
        },fixture.id);
        assert.equal(improved.unrelated,fixture.probability);assert.ok(Math.abs(improved.facilities-fixture.probability-.22)<1e-10);
        assert.ok(improved.reputation>improved.facilities);
        assert.equal(await row.locator('.prob-pill').innerText(),(improved.reputation*100).toFixed(1)+'%');
        await page.locator('#saveBtn').click();await page.reload();await page.locator('#nav [data-page="scout"]').click();
        assert.deepEqual(await page.evaluate(id=>state.world.find(a=>a.id===id).scoutPreferences,fixture.id),{version:3,worldAmbition:true,preferredRegion:'kansai',earlyCompetition:true,prestigeSchool:true});
        assert.equal(await row.locator('.prob-pill').innerText(),(improved.reputation*100).toFixed(1)+'%');
        await page.evaluate(()=>{window.originalScoutingRng=rng;rng=()=>0});
        await row.locator('[data-scout]').click();
        await page.evaluate(()=>{rng=window.originalScoutingRng;delete window.originalScoutingRng});
        assert.ok(dialogs.some(message=>message.includes('スカウトに成功')));
        assert.equal(await page.evaluate(()=>state.points),49);assert.equal(await row.locator('[data-scout]').isDisabled(),true);
        assert.equal(await row.locator('[data-scout]').innerText(),'加入予定');
        await page.locator('#saveBtn').click();await page.reload();await page.locator('#nav [data-page="scout"]').click();
        assert.equal(await row.locator('[data-scout]').isDisabled(),true);
        assert.ok(await page.evaluate(id=>state.recruits.includes(id),fixture.id));
        const enrollment=await page.evaluate(id=>{
          const a=state.world.find(a=>a.id===id),stats=JSON.stringify(a.stats),pb=JSON.stringify(a.bestTimes),candidates=new Set(refreshScoutBoard().map(p=>p.id));
          newSeason();saveLocal();renderAll();showFreshmenWelcome();
          const freshmen=state.players.filter(p=>p.year===1),joined=freshmen.find(p=>p.id===id);
          return {count:freshmen.length,fromCandidates:freshmen.every(p=>candidates.has(p.id)),stats:stats===JSON.stringify(joined.stats),pb:pb===JSON.stringify(joined.bestTimes),queue:state.recruits.length};
        },fixture.id);
        assert.deepEqual(enrollment,{count:8,fromCandidates:true,stats:true,pb:true,queue:0});
        assert.equal(await page.locator('.modal-freshmen-welcome tbody tr').count(),8);
        assert.match(await page.locator('.modal-freshmen-welcome').innerText(),/希望確認 高校生/);
        await page.locator('#freshClose').click();await page.locator('#saveBtn').click();await page.reload();
        assert.equal(await page.evaluate(()=>state.players.filter(p=>p.year===1).length),8);
        assert.ok(await page.evaluate(id=>state.players.some(p=>p.id===id)&&!state.world.some(p=>p.id===id),fixture.id));
        assert.deepEqual(errors,[]);
      }finally{await context.close();}
    }
  }finally{await app.close();}
});

test('record repairs show the same senior PB in historic records, high-school rankings and scouting on PC and iPhone',async()=>{
  const app=await fixture();
  try{
    for(const mobile of [false,true]){
      const context=await testContext({viewport:mobile?{width:390,height:844}:{width:1280,height:800},isMobile:mobile,hasTouch:mobile});
      try{
        const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);
        const target=await page.evaluate(()=>{
          const a=state.world.find(p=>p.category==='high'&&p.grade===3);a.name='PB整合 確認選手';a.specialty='fr100';
          a.accolades=[{competition:'全国高校総体',competitionId:'interhigh_'+state.season,event:'fr100',rank:1,time:49.01,season:state.season,
            organization:a.organization,schoolCategory:'high',gradeAtRecord:3}];
          recordIndividualResult(a,'fr100',49.01,'全国高校総体','決勝');
          // Reproduce an older save whose yearly PB regeneration lost an earned time.
          a.bestTimes.fr100=53.65;saveLocal();
          return {id:a.id,name:a.name,stats:JSON.stringify(a.stats)};
        });
        await page.reload();
        assert.equal(await page.evaluate(id=>state.world.find(a=>a.id===id).bestTimes.fr100,target.id),49.01);
        assert.equal(await page.evaluate(id=>JSON.stringify(state.world.find(a=>a.id===id).stats),target.id),target.stats);
        await page.locator('#nav [data-page="records"]').click();
        await page.locator('#recordRankingCategory').selectOption('high');await page.locator('#recordRankingEvent').selectOption('fr100');
        const historic=page.locator('#recordRankingBody tbody tr').filter({hasText:target.name});
        assert.equal(await historic.locator('.record-time').innerText(),'49.01');assert.equal(await historic.locator('.record-school-label').innerText(),'高3');
        await page.locator('#nav [data-page="rankings"]').click();
        await page.locator('#rankCategory').selectOption('high');await page.locator('#rankEvent').selectOption('fr100');
        const ranked=page.locator('#rankingTable tbody tr').filter({hasText:target.name});
        assert.equal(await ranked.locator('td').last().innerText(),'49.01');
        await page.locator('#nav [data-page="scout"]').click();
        await page.locator('#scoutEventFilter').selectOption('fr100');await page.locator('#scoutSortMode').selectOption('pb');
        const scout=page.locator('#scoutTable tr').filter({has:page.locator('[data-scout="'+target.id+'"]')});
        assert.equal(await scout.locator('td').nth(3).locator('b').innerText(),'49.01');
        const before=await page.evaluate(()=>{saveLocal();return JSON.stringify(state)});await page.reload();
        assert.equal(await page.evaluate(()=>JSON.stringify(state)),before);
        assert.equal(await page.evaluate(id=>state.world.find(a=>a.id===id).bestTimes.fr100,target.id),49.01);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    }
  }finally{await app.close();}
});

test('training rank-ups highlight all fourteen abilities and secondary growth in results and home on PC and iPhone, including old saved turns',async()=>{
  const app=await fixture();
  try{
    for(const options of [{viewport:{width:1440,height:900}},{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]){
      const context=await testContext(options);
      try{
        const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);
        const targets=await page.evaluate(()=>{
          state.slot=1;state.rngSeed=12345;state.facilities=Object.fromEntries(STATS.map(k=>[k,100]));
          state.players.forEach(p=>{p.stats=Object.fromEntries(STATS.map(k=>[k,200]));p.stats.start=80;p.growthProfile={1:1,2:1,3:1,4:1};state.trainingFocus[p.id]=['start']});
          return STATS.map((stat,i)=>{
            const p=state.players[i];p.stats[stat]=25.49+25*(i%7);state.trainingFocus[p.id]=[stat];
            if(stat.includes('_'))for(const sibling of STATS.filter(k=>k.startsWith(stat.split('_')[0]+'_')&&k!==stat))p.stats[sibling]=100.49;
            return{id:p.id,stat,before:['G','F','E','D','C','B','A'][i%7],after:['F','E','D','C','B','A','S'][i%7]};
          });
        });
        await page.locator('#advanceBtn').click();await page.locator('.modal-training-result').waitFor();
        for(const target of targets){
          const cell=page.locator(`.training-growth-table [data-athlete-id="${target.id}"] [data-stat="${target.stat}"]`);
          assert.equal(await cell.locator('.growth-rank-up').textContent(),target.before+'→'+target.after);
          assert.equal(await cell.locator('.growth-rank-up b').getAttribute('class'),'rank-'+target.after.toLowerCase());
          assert.ok((await cell.getAttribute('class')).includes('growth-rank-promoted'));
          assert.match(await cell.locator('.growth-up').innerText(),/^\+\d+$/);
        }
        const growth=await page.evaluate(()=>state.lastTrainingGains),focusById=new Map(targets.map(t=>[t.id,t.stat]));
        const secondary=growth.flatMap(g=>g.changes.filter(c=>c.stat!==(focusById.get(g.id)||'start')&&!c.stat.startsWith('im_')));
        assert.ok(secondary.length>0);
        for(const g of growth)for(const change of g.changes.filter(c=>c.stat!==(focusById.get(g.id)||'start')&&!c.stat.startsWith('im_'))){
          const cell=page.locator(`.training-growth-table [data-athlete-id="${g.id}"] [data-stat="${change.stat}"]`);
          assert.equal(await cell.locator('.growth-rank-up').textContent(),'D→C');
        }
        assert.ok(await page.locator('.training-growth-table .growth-changed:not(.growth-rank-promoted)').count()>0);
        assert.equal(await page.locator('.training-growth-table .growth-unchanged .growth-rank-up').count(),0);
        const allPromotions=await page.evaluate(()=>state.lastTrainingGains.flatMap(g=>g.changes).filter(c=>statRank(c.before)!==statRank(c.after)).length);
        assert.equal(await page.locator('.training-growth-table .growth-rank-up').count(),allPromotions);
        assert.deepEqual(await page.locator('.training-growth-table tbody tr').evaluateAll(rows=>rows.map(r=>+r.dataset.year)),growth.map(g=>g.year).sort((a,b)=>a-b));
        if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v1.65-training-ranks-${options.isMobile?'iphone':'pc'}.png`)});}
        await page.locator('.modal-training-result #next').click();
        assert.equal(await page.locator('#trainingGrowthHome .growth-rank-up').count(),allPromotions);
        for(const target of targets){
          const chip=page.locator(`#trainingGrowthHome [data-athlete-id="${target.id}"] [data-stat="${target.stat}"]`);
          assert.equal(await chip.locator('.growth-rank-up').textContent(),target.before+'→'+target.after);
          assert.ok((await chip.getAttribute('class')).includes('growth-rank-promoted'));
        }
        assert.equal(await page.locator(`#trainingGrowthHome [data-athlete-id="${targets[13].id}"]`).count(),1);
        // Older saves contain only numeric before/after snapshots. A swimmer's
        // current ability must not replace the grade earned in that saved turn.
        await page.evaluate(()=>{state.version='pwa-v1.50';state.players[0].stats.start=200;autoSaveNow()});
        await page.reload();
        assert.equal(await page.locator('#trainingGrowthHome .growth-rank-up').count(),allPromotions);
        assert.equal(await page.locator(`#trainingGrowthHome [data-athlete-id="${targets[0].id}"] [data-stat="start"] .growth-rank-up`).textContent(),'G→F');
        assert.equal(await page.evaluate(()=>state.players[0].stats.start),200);
        await page.evaluate(()=>showTrainingGrowth(state.lastTrainingGains,()=>{}));
        assert.equal(await page.locator('.training-growth-table .growth-rank-up').count(),allPromotions);
        assert.equal(await page.locator('.training-growth-table .growth-rank-up').first().textContent(),'G→F');
        assert.deepEqual(errors,[]);
      }finally{await context.close()}
    }
  }finally{await app.close()}
});

test('training requires one item, reset chooses specialty, and specialty popup stays narrow', async () => {
  const app = await fixture();
  try {
    for (const options of [
      {mobile:false,viewport:{width:1024,height:768}},
      {mobile:false,viewport:{width:1440,height:900}},
      {mobile:false,viewport:{width:1920,height:1080}},
      {mobile:true,viewport:{width:844,height:390}},
      {mobile:true,viewport:{width:390,height:844}},
      {mobile:true,viewport:{width:667,height:375}}
    ]) {
      const mobile=options.mobile;
      const context = await testContext({ viewport: options.viewport, isMobile: mobile, hasTouch: mobile });
      try {
        const page = await context.newPage();
        const errors = runtimeErrors(page);
        await page.goto(app.url);
        await page.evaluate(()=>{state.players.forEach(p=>p.bestTimes[p.specialty]=round2(expectedTime(p,p.specialty)));renderAll()});
        await page.locator('#nav [data-page="training"]').click();
        await page.locator('#trainingPlan .focus-btn.selected').click();
        assert.equal(await page.locator('#trainingPlan .focus-btn.selected').count(), 1);
        await page.locator('#trainingPlan .focus-btn:not(.selected)').first().click();
        assert.equal(await page.locator('#trainingPlan .focus-btn.selected').count(), 1);
        await page.locator('#trainingPlan [data-focus="fly_turn"]').click();
        assert.equal(await page.locator('#trainingPlan .focus-btn.selected').getAttribute('data-focus'),'fly_turn');
        await page.locator('#clearFocusBtn').click();
        assert.equal(await page.locator('#trainingPlan .focus-btn.selected').count(), 1);
        const size=await page.evaluate(()=>{
          const cards=document.querySelectorAll('#page-training>.two>.card'),list=document.getElementById('trainingPlayers');
          return{listCard:cards[0].offsetWidth,planCard:cards[1].offsetWidth,listCardHeight:cards[0].offsetHeight,planCardHeight:cards[1].offsetHeight,
            list:list.clientWidth,table:list.querySelector('table').clientWidth,scroll:list.scrollWidth,listHeight:list.clientHeight,scrollHeight:list.scrollHeight};
        });
        assert.ok(size.listCard>=(mobile?249:409)&&size.listCard<=(mobile?291:521),JSON.stringify(size));
        assert.ok(size.planCard>size.listCard,JSON.stringify(size));
        assert.ok(Math.abs(size.table-size.list)<3&&size.scroll<=size.list+2,JSON.stringify(size));
        if(mobile){assert.ok(Math.abs(size.listCardHeight-size.planCardHeight)<=1,JSON.stringify(size));assert.ok(size.scrollHeight>size.listHeight,JSON.stringify(size));}
        else{
          const inlinePB=await page.locator('#trainingPlayers tbody tr').evaluateAll(rows=>rows.every(row=>{
            const specialty=row.querySelector('.specialty').getBoundingClientRect(),pb=row.querySelector('.training-specialty-pb').getBoundingClientRect();
            return pb.left>=specialty.right&&Math.abs((pb.top+pb.bottom-specialty.top-specialty.bottom)/2)<6;
          }));
          assert.equal(inlinePB,true);
        }
        const focusRows=await page.locator('#trainingPlan .focus-btn').evaluateAll(buttons=>{
          const rows=[];
          for(const button of buttons){let row=rows.find(row=>row.top===button.offsetTop);if(!row)rows.push(row={top:button.offsetTop,stats:[]});row.stats.push(button.dataset.focus||button.dataset.derivedStat);}
          return rows.map(row=>row.stats);
        });
        assert.deepEqual(focusRows,[['start','mental'],['fr_speed','fr_stamina','fr_turn'],['ba_speed','ba_stamina','ba_turn'],['br_speed','br_stamina','br_turn'],['fly_speed','fly_stamina','fly_turn'],['im_speed','im_stamina']]);
        await page.evaluate(()=>{document.getElementById('gameScroll').scrollTop=0;document.getElementById('trainingPlayers').scrollTop=0});
        if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v1.65-training-size-${mobile?'iphone':'pc'}-${options.viewport.width}x${options.viewport.height}.png`)});}
        const gap = await page.evaluate(() => {
          const rotated=document.getElementById('gameViewport').classList.contains('landscape-rotated');
          const row = [...document.querySelectorAll('#trainingPlayers tbody tr')].sort((a,b)=>b.querySelector('.athlete-name').getBoundingClientRect()[rotated?'height':'width']-a.querySelector('.athlete-name').getBoundingClientRect()[rotated?'height':'width'])[0];
          const name=row.querySelector('.athlete-name').getBoundingClientRect(),grade=row.querySelector('.grade-pill').getBoundingClientRect();
          return rotated?grade.top-name.bottom:grade.left-name.right;
        });
        assert.ok(gap >= 0 && gap < 25, `name/grade gap ${gap}`);
        await page.locator('#nav [data-page="roster"]').click();
        await page.locator('#rosterTable [data-specialty]').first().click();
        const width = await page.locator('.modal-specialty-picker').evaluate(el => el.offsetWidth);
        assert.ok(width <= (mobile ? 360 : 400), width);
        await page.locator('.modal-specialty-picker #x').click();
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
  } finally { await app.close(); }
});

test('invalid saved PBs stay ineligible and a valid first race restores PB badges and every record on PC and iPhone',async()=>{
  const app=await fixture();
  try{
    for(const options of [{viewport:{width:1280,height:800}},{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]){
      const context=await testContext(options);
      try{
        const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);
        const id=await page.evaluate(()=>{
          const a=state.players[0];state.players=[a];state.world=[];state.recordRankings={};state.teamTop10={};
          a.bestTimes={fr100:0,ba50:-1};a.raceHistory=[];a.accolades=[];
          delete a.standardAchievements;delete a.standardAchievementVersion;saveLocal();return a.id;
        });
        await page.reload();
        await page.evaluate(()=>{entryDisplayMode='pb';openMeetEntry('japan_championship')});
        for(const event of ['fr100','ba50']){
          const entry=page.locator(`#entryMatrix input[data-pid="${id}"][data-event="${event}"]`),cell=entry.locator('..');
          assert.equal(await entry.isDisabled(),true);assert.match(await cell.innerText(),/PBなし/);
          assert.equal(await cell.locator('.entry-pb-view').innerText(),'-');assert.match(await cell.getAttribute('class'),/entry-no-pb/);
        }
        await page.locator('#entryViewToggle').click();
        assert.match(await page.locator(`#entryMatrix input[data-pid="${id}"][data-event="fr100"]`).locator('..').innerText(),/PBなし/);
        const first=await page.evaluate(()=>{
          closeModal();const a=state.players[0],time=49;
          const achievement=updateResultHistory(a,'fr100',time,'japan_championship','予選',1);
          const row={athlete:a,source:'PLAYER',race:{total:time},achievement,heatLane:4};
          const events=Object.fromEntries(EVENTS.map(e=>[e,{prelim:e==='fr100'?[row]:[],final:[]}]));
          showMeetResults({meet:'japan_championship',season:state.season,events,relays:[],scores:{}},()=>{});
          return {pb:achievement.pb,newlyCleared:achievement.newlyCleared.length,time:a.bestTimes.fr100};
        });
        assert.equal(first.pb,true);assert.equal(first.time,49);assert.equal(first.newlyCleared,4);
        assert.ok(await page.locator('#resBody .pb-badge').count()>0);assert.ok(await page.locator('#resBody .std-new').count()>0);
        await page.locator('.modal-meet-results #x').click();await page.locator('#showTeamTop10Btn').click();
        await page.locator('#teamTop10Event').selectOption('fr100');assert.match(await page.locator('#teamTop10Body').innerText(),/49\.00/);
        await page.locator('#nav [data-page="records"]').click();
        await page.evaluate(()=>{renderAll();saveLocal()});await page.reload();
        const saved=await page.evaluate(()=>{
          const a=state.players[0],repeat=updateResultHistory(a,'fr100',49.001,'japan_championship','決勝',1);
          return {repeat,pb:a.bestTimes.fr100,own:state.teamTop10.fr100[0].time,student:state.recordRankings.university.fr100[0].time,
            national:state.recordRankings.japan.fr100[0].time,rank:ranking('fr100','university')[0].bestTimes.fr100,
            clock:[fmt(59.999),fmt(119.999)]};
        });
        assert.equal(saved.repeat.pb,false);assert.deepEqual(saved.repeat.newlyCleared,[]);
        for(const field of ['pb','own','student','national','rank'])assert.equal(saved[field],49);
        assert.deepEqual(saved.clock,['1:00.00','2:00.00']);assert.deepEqual(errors,[]);
      }finally{await context.close()}
    }
  }finally{await app.close()}
});

test('winter cup names follow their dates through entry, race results, history and records on PC and iPhone',async()=>{
  const app=await fixture();
  try{
    for(const options of [{viewport:{width:1280,height:800}},{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]){
      const context=await testContext(options);
      try{
        const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);
        await page.evaluate(()=>showMeetSchedule());
        const schedule=await page.locator('.schedule-table tbody').innerText();
        assert.match(schedule,/1月 第2週後半\s+Higashikata CUP/);assert.match(schedule,/2月 第2週後半\s+ダイナミオープン/);
        await page.locator('.modal-schedule #x').click();
        for(const [slot,name] of [[76,'Higashikata CUP'],[84,'ダイナミオープン']]){
          await page.evaluate(slot=>{state.slot=slot;state.players[0].stats=Object.fromEntries(STATS.map(k=>[k,200]));renderAll();openMeetEntry('joint_record',slot,state.season,{fr100:[state.players[0].id]},{})},slot);
          assert.match(await page.locator('#homeMeet').innerText(),new RegExp(name));
          assert.equal(await page.locator('.modal h2').innerText(),name+' エントリー');
          await page.locator('#confirmEntry').click();assert.equal(await page.locator('.modal-entry-confirm h2').innerText(),name+' エントリー確認');
          await page.locator('#goRace').click();
          for(let step=0;step<40;step++){
            await page.waitForSelector('.modal-race-live, .modal-race-result, .modal-event-result, .modal-meet-results');
            if(await page.locator('.modal-meet-results').count())break;
            if(await page.locator('.modal-race-live').count()){await page.locator('#skipEvent').click();continue}
            if(await page.locator('#nextGroup').count()){await page.locator('#nextGroup').click();continue}
            if(await page.locator('#nextEv').count()){await page.locator('#nextEv').click();continue}
            assert.fail('unexpected cup screen');
          }
          assert.equal(await page.locator('.modal-meet-results h2').innerText(),name+' 結果');
          const own=await page.evaluate(()=>{
            const a=state.players[0],rows=a.raceHistory.filter(r=>r.meet==='joint_record'&&r.slot===state.slot);
            return {id:a.id,stages:rows.map(r=>r.stage),rank:rows.find(r=>r.stage==='A決勝')?.rank};
          });
          assert.deepEqual(own.stages,['予選','A決勝']);assert.ok(own.rank>=1&&own.rank<=8);
          await page.locator('.modal-meet-results #x').click();await page.evaluate(id=>showPlayerDetail(id),own.id);
          assert.match(await page.locator('#historyTable').innerText(),new RegExp(name));
          assert.ok(await page.locator('#historyTable .history-rank').count()>0);
          if(process.env.SWIM_SCREENSHOT_DIR){await page.locator('#historyTable .history-rank').first().scrollIntoViewIfNeeded();fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v1.65-cup-history-${slot}-${options.isMobile?'iphone':'pc'}.png`)})}
          await page.locator('.modal-player-detail #x').click();await page.locator('#showTeamTop10Btn').click();
          await page.locator('#teamTop10Event').selectOption('fr100');
          assert.match(await page.locator('#teamTop10Body').innerText(),/Higashikata CUP|ダイナミオープン/);
          await page.locator('#nav [data-page="home"]').click();
        }
        await page.evaluate(()=>saveLocal());await page.reload();
        await page.evaluate(()=>showPlayerDetail(state.players[0].id));
        const history=await page.locator('#historyTable').innerText();assert.match(history,/Higashikata CUP/);assert.match(history,/ダイナミオープン/);
        assert.deepEqual(errors,[]);
      }finally{await context.close()}
    }
  }finally{await app.close()}
});

test('player relay history shows personal legs, total times and places for all relays on PC and iPhone, recovers old totals and survives reload',async()=>{
  const app=await fixture();
  try{
    for(const options of [{viewport:{width:1280,height:800}},{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]){
      const context=await testContext(options);
      try{
        const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);
        const data=await page.evaluate(()=>{
          const own=state.players[0],original=[state.players[1],own,state.players[2],state.players[3]],replacement=[state.players[4],state.players[2],own,state.players[5]];
          state.recordRankings={};state.teamTop10={};state.slot=43;own.raceHistory=[];
          updateResultHistory(own,'fr100',52,'intercollege','A決勝',2);
          const personal=JSON.stringify([own.bestTimes,own.standardAchievements]);
          const races=RELAYS.map((kind,i)=>{
            const prelim={organization:state.playerUniversity,members:original,prelimRank:2,heatLane:4,race:simulateRelay(original,kind,false)};
            const final={organization:state.playerUniversity,members:replacement,rank:i+1,heatLane:5,race:simulateRelay(replacement,kind,false)};
            recordRelayResult(kind,prelim,'intercollege','予選');recordRelayResult(kind,final,'intercollege','決勝');
            return{kind,prelim:fmt(prelim.race.total),final:fmt(final.race.total),prelimLap:fmt(prelim.race.legs[1]),finalLap:fmt(final.race.legs[2]),prelimEvent:EVENT_LABEL[relayLegEvent(kind,1)],finalEvent:EVENT_LABEL[relayLegEvent(kind,2)]};
          });
          state.season=2025;state.slot=10;upsertRelayTop10('4x100fr',[own,...state.players.slice(10,13)],219,'kansai_college','予選');state.season=2026;state.slot=43;
          const unchanged=personal===JSON.stringify([own.bestTimes,own.standardAchievements]);saveLocal();showPlayerDetail(own.id);
          return{id:own.id,out:original[0].id,races,unchanged};
        });
        assert.equal(data.unchanged,true);
        await page.locator('#historySort').selectOption('only_relays');assert.equal(await page.locator('#historyTable tbody tr').count(),7);
        assert.equal(await page.locator('#historyTable .pb-badge,#historyTable .std-new').count(),0);
        for(const race of data.races){
          await page.locator('#historySort').selectOption('only_'+race.kind);
          const rows=page.locator('#historyTable tbody tr').filter({hasText:'インカレ'});
          assert.equal(await rows.count(),2);
          const prelim=rows.filter({hasText:'予選'}),final=rows.filter({hasText:'決勝'});
          assert.equal(await prelim.locator('.history-time').innerText(),race.prelim);assert.equal(await final.locator('.history-time').innerText(),race.final);
          assert.equal(await prelim.locator('.history-lap b').innerText(),race.prelimLap);assert.equal(await final.locator('.history-lap b').innerText(),race.finalLap);
          assert.equal(await prelim.locator('.history-lap .small').innerText(),'第2泳者・'+race.prelimEvent);
          assert.equal(await final.locator('.history-lap .small').innerText(),'第3泳者・'+race.finalEvent);
          assert.equal(await prelim.locator('.history-rank').count(),0);assert.equal(await final.locator('.history-rank').count(),1);
          assert.equal(await prelim.locator('td').nth(4).innerText(),'2');
        }
        if(process.env.SWIM_SCREENSHOT_DIR){await page.locator('#historyTable').scrollIntoViewIfNeeded();fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v1.65-relay-history-${options.isMobile?'iphone':'pc'}.png`)});}
        await page.locator('#historySort').selectOption('only_4x100fr');
        const legacy=page.locator('#historyTable tbody tr').filter({hasText:'関西カレッジ'});
        assert.equal(await legacy.count(),1);assert.equal(await legacy.locator('.history-time').innerText(),'3:39.00');
        assert.equal(await legacy.locator('.history-lap b').innerText(),'-');assert.equal(await legacy.locator('td').nth(4).innerText(),'-');
        await page.locator('#historySort').selectOption('only_fr100');
        assert.equal(await page.locator('#historyTable tbody tr').count(),1);assert.equal(await page.locator('#historyTable .history-lap').count(),0);
        await page.locator('#historySort').selectOption('event');
        assert.equal(await page.locator('#historyTable tbody tr').first().getAttribute('data-history-event'),'fr100');
        await page.locator('.modal-player-detail #x').click();await page.evaluate(id=>showPlayerDetail(id),data.out);
        await page.locator('#historySort').selectOption('only_relays');
        assert.equal(await page.locator('#historyTable tbody tr').count(),3);assert.doesNotMatch(await page.locator('#historyTable').innerText(),/決勝/);
        await page.locator('.modal-player-detail #x').click();await page.reload();await page.evaluate(id=>showPlayerDetail(id),data.id);
        await page.locator('#historySort').selectOption('only_relays');assert.equal(await page.locator('#historyTable tbody tr').count(),7);
        assert.equal(await page.locator('#historyTable .history-lap b').allTextContents().then(times=>times.filter(t=>t==='-').length),1);
        assert.deepEqual(errors,[]);
      }finally{await context.close();}
    }
  }finally{await app.close();}
});

test('player history highlights final medals and fourth-to-eighth places while prelims and own time trials keep ordinary ranks',async()=>{
  const app=await fixture();
  try{
    for(const options of [{viewport:{width:1280,height:800}},{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]){
      const context=await testContext(options);
      try{
        const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);
        await page.evaluate(()=>{
          const a=state.players[0];a.raceHistory=[];
          for(let rank=1;rank<=9;rank++){
            a.raceHistory.push({season:2026,slot:76,meet:'joint_record',event:'fr100',stage:rank%2?'A決勝':'決勝',rank,time:48+rank,newlyCleared:[],pb:false});
            a.raceHistory.push({season:2026,slot:84,meet:'joint_record',event:'fr100',stage:'予選',rank,time:48+rank,newlyCleared:[],pb:false});
            a.raceHistory.push({season:2026,slot:8,meet:'team_trial',event:'fr100',stage:'決勝',rank,time:48+rank,newlyCleared:[],pb:false});
          }
          saveLocal();showPlayerDetail(a.id);
        });
        assert.equal(await page.locator('#historyTable .history-rank-first').count(),1);
        assert.equal(await page.locator('#historyTable .history-rank-second').count(),1);
        assert.equal(await page.locator('#historyTable .history-rank-third').count(),1);
        assert.equal(await page.locator('#historyTable .history-rank-place').count(),5);
        const finalRows=page.locator('#historyTable tbody tr').filter({hasText:'Higashikata CUP'});
        for(let i=0;i<9;i++){
          const rank=finalRows.nth(i).locator('td').nth(4);assert.equal(await rank.innerText(),i<3?(i+1)+'位':i<8?(i+1)+'位 入賞':'9');
        }
        assert.equal(await page.locator('#historyTable tbody tr').filter({hasText:'予選'}).locator('.history-rank').count(),0);
        assert.equal(await page.locator('#historyTable tbody tr').filter({hasText:'自チーム記録会'}).locator('.history-rank').count(),0);
        const colors=await page.locator('#historyTable .history-rank').evaluateAll(rows=>rows.slice(0,3).map(row=>getComputedStyle(row).backgroundColor));
        assert.equal(new Set(colors).size,3);
        if(process.env.SWIM_SCREENSHOT_DIR){await page.locator('#historyTable .history-rank-first').scrollIntoViewIfNeeded();fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v1.65-history-awards-${options.isMobile?'iphone':'pc'}.png`)})}
        await page.locator('#historySort').selectOption('only_ba50');assert.equal(await page.locator('#historyTable .history-rank').count(),0);
        await page.locator('#historySort').selectOption('event');assert.equal(await page.locator('#historyTable .history-rank').count(),8);
        await page.locator('.modal-player-detail #x').click();await page.reload();await page.evaluate(()=>showPlayerDetail(state.players[0].id));
        assert.equal(await page.locator('#historyTable .history-rank').count(),8);assert.deepEqual(errors,[]);
      }finally{await context.close()}
    }
  }finally{await app.close()}
});

test('entry athletes follow grade and specialty order in every meet; badges and standards preserve entry', async () => {
  const app = await fixture();
  try {
    for(const options of [{viewport:{width:1440,height:900}},{viewport:{width:844,height:390},isMobile:true,hasTouch:true},{viewport:{width:390,height:844},isMobile:true,hasTouch:true},{viewport:{width:667,height:375},isMobile:true,hasTouch:true}]){
    const context=await testContext(options);
    try{
    const page = await context.newPage();
    const errors = runtimeErrors(page);
    await page.goto(app.url);
    const selection=await page.evaluate(() => {
      state.players.reverse();
      let standard=standardFor('intercollege','fr100');
      state.players[0].bestTimes.fr100=standard-.01;
      state.players[1].bestTimes.fr100=standard+.01;
      state.players[2].bestTimes.fr100=null;
      Object.assign(state.players[0].stats,{start:176,mental:25,fr_speed:175,fr_stamina:150,fr_turn:125,ba_speed:100,ba_stamina:75,ba_turn:50,br_speed:25,br_stamina:176,br_turn:151,fly_speed:126,fly_stamina:101,fly_turn:76});
      renderTrainingPlayers();
      openMeetEntry('intercollege');
      return{ids:state.players.slice(0,3).map(p=>p.id),originalOrder:state.players.map(p=>p.id),trainingOrder:[...document.querySelectorAll('#trainingPlayers tbody tr')].map(r=>r.dataset.id),im:[state.players[0].stats.im_speed,state.players[0].stats.im_stamina].map(v=>String(Math.round(v)))};
    });
    const entryOrder=()=>page.locator('#entryMatrix tbody tr').evaluateAll(rows=>rows.map(r=>r.querySelector('input[data-pid]').dataset.pid));
    assert.deepEqual(await entryOrder(),selection.trainingOrder);
    const cells=selection.ids.map(id=>page.locator(`#entryMatrix input[data-event="fr100"][data-pid="${id}"]`));
    await cells[0].check();
    for (const [i, word] of [[0, '標準突破'], [1, '未突破'], [2, 'PBなし']]) {
      assert.match(await cells[i].locator('..').innerText(), new RegExp(word));
      assert.equal(await cells[i].isDisabled(), i > 0);
    }
    await page.locator('#entryViewToggle').click();
    assert.deepEqual(await entryOrder(),selection.trainingOrder);
    assert.match(await cells[1].locator('..').innerText(), /未突破/);
    const first=cells[0].locator('xpath=ancestor::tr'),fr=cells[0].locator('..');
    assert.deepEqual(await fr.locator('.entry-stat-label').allTextContents(),['スピード','スタミナ']);
    assert.deepEqual(await fr.locator('.entry-stat-value').allTextContents(),['175','150']);
    assert.deepEqual(await fr.locator('.stat-rank-badge').allTextContents(),['A','B']);
    assert.equal(await page.locator('#entryMatrix [data-entry-stat="turn"]').count(),0);
    assert.deepEqual(await first.locator('.entry-common-stats .entry-stat-value').allTextContents(),['176','25']);
    assert.deepEqual(await first.locator('.entry-common-stats .stat-rank-badge').allTextContents(),['S','G']);
    const im=first.locator('input[data-event="im200"]').locator('..');
    assert.deepEqual(await im.locator('.entry-stat-value').allTextContents(),selection.im);
    const grades=await page.locator('#entryMatrix .entry-athlete-name .grade-pill').evaluateAll(badges=>badges.map(b=>({year:+b.textContent.replace('年',''),class:b.className,color:getComputedStyle(b).backgroundColor})));
    assert.ok(grades.every(g=>g.class.split(' ').includes('grade-'+g.year)));
    assert.equal(new Set(grades.map(g=>g.color)).size,4);
    const geometry=await page.locator('#entryMatrix .entry-stat-row').evaluateAll(rows=>rows.map(row=>{
      const number=row.querySelector('.entry-stat-value');
      return{overflow:row.scrollWidth-row.clientWidth,align:getComputedStyle(number).textAlign,font:parseFloat(getComputedStyle(number).fontSize),fits:row.clientWidth<=row.closest('td').clientWidth};
    }));
    assert.ok(geometry.every(g=>g.overflow<=1&&g.align==='right'&&g.font>=12&&g.fits),JSON.stringify(geometry.slice(0,5)));
    const available=await page.locator('.modal-meet-entry').evaluate(modal=>{
      const table=modal.querySelector('.entry-table-wrap'),matrix=modal.querySelector('#entryMatrix'),box=modal.getBoundingClientRect(),button=modal.querySelector('#confirmEntry').getBoundingClientRect();
      return{table:table.clientHeight,oneRow:matrix.querySelector('thead').offsetHeight+matrix.querySelector('tbody tr').offsetHeight,
        buttonVisible:button.left>=box.left&&button.right<=box.right+1&&button.top>=box.top&&button.bottom<=box.bottom+1};
    });
    assert.ok(available.table>=available.oneRow&&available.buttonVisible,JSON.stringify(available));
    assert.equal(await fr.evaluate(cell=>cell.classList.contains('entry-selected')),true);
    if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v1.65-entry-stats-${options.isMobile?'iphone':'pc'}-${options.viewport.width}x${options.viewport.height}.png`)});}
    await page.locator('#std').click();
    assert.equal(await page.locator('.standards-table thead th').count(), 6);
    assert.equal(await page.locator('.standards-table thead th').last().innerText(), '世界大会');
    assert.equal(await page.locator('.standards-table tbody tr').nth(1).locator('td').last().innerText(), '47.64');
    assert.match(await page.locator('.modal-standards').innerText(),/専門泳法を優先し、他の泳法は2位の選手/);
    await page.locator('.modal-standards #x').click();
    assert.equal(await cells[0].isChecked(), true);
    assert.deepEqual(await entryOrder(),selection.trainingOrder);
    assert.match(await page.locator('#entryViewToggle').innerText(), /能力表示 → PB表示/);
    await page.locator('#entryViewToggle').click();assert.equal(await cells[0].isChecked(),true);
    assert.equal(await page.locator('#entryStatGuide').isVisible(),false);
    for(const meet of ['team_trial','joint_record','kansai_college','japan_open','japan_championship']){
      const expectedOrder=await page.evaluate(meet=>{
        closeModal();const p=state.players[0];for(const e of meetIndividualEvents(meet))p.bestTimes[e]=RESTRICTED.has(meet)?standardFor(meet,e)-.01:55;
        renderTrainingPlayers();
        openMeetEntry(meet);
        return [...document.querySelectorAll('#trainingPlayers tbody tr')].map(r=>r.dataset.id);
      },meet);
      assert.deepEqual(await entryOrder(),expectedOrder);
      await page.locator('#entryViewToggle').click();
      const current=cells[0].locator('xpath=ancestor::tr');
      assert.equal(await page.locator('#entryMatrix [data-entry-stat="turn"]').count(),0);
      assert.deepEqual(await current.locator('input[data-event="fr100"]').locator('..').locator('.entry-stat-value').allTextContents(),['175','150']);
      if(await current.locator('input[data-event="ba50"]').count())assert.deepEqual(await current.locator('input[data-event="ba50"]').locator('..').locator('.entry-stat-value').allTextContents(),['100','75']);
      await current.locator('input[data-event="fr100"]').check();await page.locator('#entryViewToggle').click();
      assert.equal(await current.locator('input[data-event="fr100"]').isChecked(),true);
      assert.deepEqual(await entryOrder(),expectedOrder);
      await page.locator('#confirmEntry').click();await page.locator('#backEntry').click();
      await page.locator('#entryMatrix').waitFor();
      assert.equal(await cells[0].isChecked(),true);
      assert.deepEqual(await entryOrder(),expectedOrder);
      assert.deepEqual(await page.evaluate(()=>state.players.map(p=>p.id)),selection.originalOrder);
    }
    await page.evaluate(()=>closeModal());
    await page.locator('#nav [data-page="roster"]').click();
    const rosterGrades=await page.locator('#rosterTable .grade-pill').evaluateAll(badges=>badges.map(b=>({year:+b.textContent.replace('年',''),class:b.className,color:getComputedStyle(b).backgroundColor})));
    assert.deepEqual(rosterGrades,grades);
    assert.deepEqual(errors, []);
    }finally{await context.close()}
    }
  } finally { await app.close(); }
});

test('world meet automatically animates own swimmers and mixed national relay, exposes all CPU-only results and saves offline', async () => {
  const app = await fixture();
  const context = await testContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
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
    await page.locator('#confirmWorldAdditional').click();
    await page.locator('#goRace').click();
    await advanceToRace(page);
    assert.match(await page.locator('.modal-race-live h2').innerText(), /100mFr/);
    assert.match(await page.locator('.race-entrants .own').innerText(), /PB/);
    assert.equal(await page.locator('.race-event-stats').count(),0);
    const races=await drainRaces(page);
    assert.equal(races.filter(title=>/100mFr/.test(title)).length,2);
    assert.equal(races.filter(title=>/メドレーリレー/.test(title)).length,2);
    assert.equal(await page.locator('#resEv option').count(), 15);
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
  const context = await testContext();
  try {
    const page = await context.newPage();
    const errors = runtimeErrors(page);
    await page.goto(app.url);
    const selected = await page.evaluate(() => {
      let p=state.players.find(p=>p.year===4);
      p.stats=Object.fromEntries(STATS.map(k=>[k,200]));p.bestTimes.fr100=expectedTime(p,'fr100');
      state.season=2026;state.slot=94;state.activeCompetitionSeason=2026;state.activeCompetitionSlot=94;
      let entries=Object.fromEntries(EVENTS.map(e=>[e,e==='fr100'?[p.id]:[]]));
      // This case verifies selection persistence; poor races are covered separately.
      const originalRng=rng;let result;
      try{rng=()=>.5;result=executeMeet('japan_championship',entries,{})}finally{rng=originalRng}
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
    if(await page.locator('#confirmWorldAdditional').count())await page.locator('#confirmWorldAdditional').click();
    assert.match(await page.locator('.modal-entry-confirm').innerText(), new RegExp(selected.name));
    assert.deepEqual(errors, []);
  } finally { await context.close(); await app.close(); }
});

test('world opening offers vacant slots to registered own swimmers, saves unlimited choices and animates additional races on PC and iPhone',async()=>{
  const app=await fixture();
  try{
    for(const mobile of [false,true]){
      const context=await testContext({viewport:mobile?{width:390,height:844}:{width:1280,height:800},isMobile:mobile,hasTouch:mobile});
      try{
        const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);
        const target=await page.evaluate(()=>{
          const own=[state.players.find(a=>a.year===4),state.players.find(a=>a.year===1),state.players.find(a=>a.year===3)],cpu=state.world.slice(0,4);
          const individual=Object.fromEntries(EVENTS.map(e=>[e,e==='fr100'?[own[0].id,cpu[0].id]:e==='fr200'?[cpu[0].id]:[]]));
          const relays={'4x100fr':[own[1].id,...cpu.slice(0,3).map(a=>a.id)]};
          state.japanTeam={year:2027,individual,relays,athletes:[...own.slice(0,2),...cpu.slice(0,3)].map(a=>({id:a.id,snapshot:deepClone(a),ownAtSelection:own.includes(a)}))};
          state.season=2027;state.slot=36;renderAll();
          return {own:own.map(a=>a.id),cpu:cpu[0].id,base:JSON.stringify([individual,relays])};
        });
        await page.locator('#advanceBtn').click();await page.locator('.modal-training-result #next').click();
        await page.locator('.modal-world-additional').waitFor();assert.equal(await page.evaluate(()=>state.slot),37);
        assert.equal(await page.locator('#worldAdditionalTable select[data-world-event="fr100"]').count(),0);
        assert.equal(await page.locator('#worldAdditionalTable select[data-world-event="fr200"]').count(),1);
        const first=page.locator('#worldAdditionalTable select[data-world-event="fr50"][data-world-slot="0"]');
        assert.equal(await first.locator(`option[value="${target.own[2]}"]`).count(),0);
        assert.equal(await first.locator(`option[value="${target.cpu}"]`).count(),0);
        assert.deepEqual(await first.locator('option').evaluateAll(options=>options.map(o=>o.value).filter(Boolean)),[target.own[1],target.own[0]]);
        for(const event of ['fr50','ba100','br100','fly100','im400'])await page.locator(`#worldAdditionalTable select[data-world-event="${event}"][data-world-slot="0"]`).selectOption(target.own[0]);
        const second=page.locator('#worldAdditionalTable select[data-world-event="fr50"][data-world-slot="1"]');
        assert.equal(await second.locator(`option[value="${target.own[0]}"]`).evaluate(option=>option.disabled),true);await second.selectOption(target.own[1]);
        await page.locator('#worldAdditionalTable select[data-world-event="fr200"]').selectOption(target.own[1]);
        await page.locator('#std').click();assert.match(await page.locator('.modal-standards').innerText(),/追加種目の派遣標準突破は不要/);await page.locator('.modal-standards #x').click();
        assert.equal(await first.inputValue(),target.own[0]);
        const box=await page.locator('.modal-world-additional').evaluate(m=>{const r=m.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight}});
        assert.ok(box.left>=-1&&box.right<=box.width+1&&box.top>=-1&&box.bottom<=box.height+1,JSON.stringify(box));
        if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v1.65-world-additional-${mobile?'iphone':'pc'}.png`)});}
        await page.locator('#confirmWorldAdditional').click();
        assert.equal(await page.evaluate(()=>Object.values(state.japanTeam.additionalIndividual).flat().length),7);
        assert.equal(await page.evaluate(()=>JSON.stringify([state.japanTeam.individual,state.japanTeam.relays])),target.base);
        await page.locator('#backEntry').click();await page.locator('.modal-world-additional').waitFor();assert.equal(await first.inputValue(),target.own[0]);
        await page.locator('#confirmWorldAdditional').click();await page.reload();
        assert.equal(await page.evaluate(()=>Object.values(state.japanTeam.additionalIndividual).flat().length),7);
        await page.evaluate(()=>openMeetEntry('world_championship',36,2027));assert.equal(await second.inputValue(),target.own[1]);
        await page.locator('#clearWorldAdditional').click();assert.match(await page.locator('#worldAdditionalSummary').innerText(),/0件/);
        await first.selectOption(target.own[1]);await page.locator('#worldAdditionalTable select[data-world-event="im400"][data-world-slot="0"]').selectOption(target.own[0]);
        await page.locator('#confirmWorldAdditional').click();await page.locator('#goRace').click();
        const program=[],races=await drainRaces(page,program);
        assert.ok(races.some(title=>/50mFr.*予選/.test(title)),JSON.stringify(races));assert.ok(races.some(title=>/400mIM.*予選/.test(title)),JSON.stringify(races));
        assert.ok(program.some(block=>block.event==='fr50'&&block.phase==='prelim'));assert.equal(await page.evaluate(()=>state.slot),37);
        await page.locator('#resEv').selectOption('fr50');assert.ok(await page.locator('#resBody .result-own').count()>0);
        assert.equal(await page.evaluate(()=>state.meetHistory.at(-1).slot),36);await page.locator('#x').click();
        await page.evaluate(()=>{
          const ids=state.japanTeam.individual.fr100;state.japanTeam.individual=Object.fromEntries(EVENTS.map(e=>[e,[...ids]]));openMeetEntry('world_championship',36,2027);
        });
        assert.equal(await page.locator('.modal-world-additional').count(),0);assert.equal(await page.locator('.modal-entry-confirm').count(),1);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    }
  }finally{await app.close();}
});

test('a world meet with no own representatives skips interim screens and shows every result in its summary', async () => {
  const app=await fixture(),context=await testContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true});
  try{
    const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);
    await page.evaluate(()=>{state.season=2027;state.slot=36;state.japanTeam=null;openMeetEntry('world_championship',36,2027);});
    assert.equal(await page.locator('.modal-world-additional').count(),0);
    await page.locator('#goRace').click();
    const program=[],races=await drainRaces(page,program);
    assert.deepEqual(races,[]);
    assert.deepEqual(program,[]);
    assert.equal(await page.locator('#resEv option').count(),15);
    assert.equal(await page.locator('.modal-meet-results .result-own').count(),0);
    assert.equal(await page.locator('#resBody .final-qualifier').count(),8);
    assert.equal(await page.locator('#scoreBody .final-qualifier').count(),24);
    await page.locator('.modal-meet-results #x').click();
    assert.equal(await page.evaluate(()=>state.activeCompetitionSlot),null);
    assert.deepEqual(errors,[]);
  }finally{await context.close();await app.close();}
});

test('a training turn can enter and finish a record meet through the UI', async () => {
  const app = await fixture();
  const context = await testContext({ viewport: { width: 1440, height: 900 } });
  try {
    const page = await context.newPage();
    const errors = runtimeErrors(page);
    await page.goto(app.url);
    await page.evaluate(() => { state.slot = 8; renderAll(); });
    await page.locator('#advanceBtn').click();
    await page.locator('#modalRoot #next').click();
    const athleteId=await page.locator('#entryMatrix input[data-event="fr100"]').first().getAttribute('data-pid');
    await page.locator('#entryMatrix input[data-event="fr100"]').first().check();
    await page.locator('#confirmEntry').click();
    await page.locator('#goRace').click();
    await page.locator('#skipEvent').click();
    await page.locator('#nextGroup').click();
    await page.locator('#modalRoot #nextEv').click();
    await page.locator('#modalRoot #x').click();
    const result = await page.evaluate(id => ({ slot: state.slot, history: state.meetHistory.length,
      meet: state.meetHistory.at(-1).meet, active: state.activeCompetitionSlot,
      records: state.players.find(p=>p.id===id).raceHistory.filter(r => r.meet === 'team_trial' && r.event === 'fr100').length }),athleteId);
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

test('new stroke sprints show standards, remain unavailable as specialties and complete domestic and world races on PC and iPhone',async()=>{
  const app=await fixture();
  try{
    for(const mobile of [false,true]){
      const context=await testContext({viewport:mobile?{width:390,height:844}:{width:1280,height:800},isMobile:mobile,hasTouch:mobile});
      try{
        const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);
        const meet=mobile?'japan_championship':'japan_open';
        const own=await page.evaluate(meet=>{
          const p=state.players.find(a=>a.year===1),other=state.players.find(a=>a.id!==p.id);
          p.stats=Object.fromEntries(STATS.map(k=>[k,200]));
          for(const e of SPRINT_EVENTS){p.bestTimes[e]=expectedTime(p,e);other.bestTimes[e]=standardFor(meet,e)+.01;}
          state.slot=meet==='japan_championship'?94:65;renderAll();
          return{id:p.id,other:other.id};
        },meet);
        await page.locator('#nav [data-page="roster"]').click();await page.locator(`#rosterTable [data-detail="${own.id}"]`).click();
        assert.equal(await page.locator('.detail-pb-grid .pb-detail-row').count(),15);
        for(const label of ['50mBa','50mBr','50mFly'])assert.match(await page.locator('.detail-pb-grid').innerText(),new RegExp(label));
        await page.locator('#detailSpecialtyBtn').click();assert.equal(await page.locator('#spec option').count(),12);
        for(const e of ['ba50','br50','fly50'])assert.equal(await page.locator(`#spec option[value="${e}"]`).count(),0);
        await page.locator('.modal-specialty-picker #x').click();await page.locator('.modal-player-detail #x').click();
        await page.evaluate(meet=>openMeetEntry(meet),meet);
        for(const e of ['ba50','br50','fly50']){
          const entry=page.locator(`#entryMatrix input[data-pid="${own.id}"][data-event="${e}"]`);
          assert.equal(await entry.isDisabled(),false);assert.match(await entry.locator('..').innerText(),/標準突破/);await entry.check();
          assert.equal(await page.locator(`#entryMatrix input[data-pid="${own.other}"][data-event="${e}"]`).isDisabled(),true);
        }
        await page.locator('#std').click();
        for(const label of ['50mBa','50mBr','50mFly'])assert.match(await page.locator('.modal-standards').innerText(),new RegExp(label));
        assert.match(await page.locator('.modal-standards').innerText(),/世界水泳2025/);await page.locator('.modal-standards #x').click();
        if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v1.65-sprint-entry-${mobile?'iphone':'pc'}.png`)});}
        // Hold normal form here to isolate the new program and representative-selection paths.
        await page.evaluate(()=>{rng=()=>.5;});
        await page.locator('#confirmEntry').click();await page.locator('#goRace').click();
        const program=[],races=await drainRaces(page,program);
        for(const [event,label,day] of [['fly50','50mFly',1],['ba50','50mBa',2],['br50','50mBr',3]]){
          assert.ok(races.some(t=>t.includes(label)&&t.includes('予選')),JSON.stringify(races));
          assert.ok(races.some(t=>t.includes(label)&&t.includes('決勝')),JSON.stringify(races));
          assert.deepEqual(program.filter(b=>b.event===event).map(b=>[b.day,b.phase]),[[day,'prelim'],[day,'final']]);
          await page.locator('#resEv').selectOption(event);assert.ok(await page.locator('#resBody .result-own').count()>0);
        }
        assert.equal(await page.locator('#resEv option').count(),15);await page.locator('.modal-meet-results #x').click();
        if(mobile){
          assert.ok(await page.evaluate(id=>SPRINT_EVENTS.every(e=>state.japanTeam.individual[e].includes(id)),own.id));
          await page.evaluate(()=>{state.season=2027;state.slot=36;renderAll();openMeetEntry('world_championship',36,2027);});
          if(await page.locator('#confirmWorldAdditional').count())await page.locator('#confirmWorldAdditional').click();
          await page.locator('#goRace').click();const worldRaces=await drainRaces(page);
          for(const label of ['50mBa','50mBr','50mFly']){
            assert.ok(worldRaces.some(t=>t.includes(label)&&t.includes('予選')),JSON.stringify(worldRaces));
            assert.ok(worldRaces.some(t=>t.includes(label)&&t.includes('決勝')),JSON.stringify(worldRaces));
          }
          assert.equal(await page.locator('#resEv option').count(),15);await page.locator('.modal-meet-results #x').click();
        }
        await page.locator('#saveBtn').click();await page.reload();
        assert.ok(await page.evaluate(id=>SPRINT_EVENTS.every(e=>Number.isFinite(state.players.find(a=>a.id===id).bestTimes[e])),own.id));
        assert.deepEqual(errors,[]);
      }finally{await context.close();}
    }
  }finally{await app.close();}
});

test('legacy sprint rankings and every top ten agree on PC and iPhone, include own university students and persist after reload',async()=>{
  const app=await fixture();
  try{
    for(const mobile of [false,true]){
      const context=await testContext({viewport:mobile?{width:390,height:844}:{width:1280,height:800},isMobile:mobile,hasTouch:mobile});
      try{
        const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);
        const own=await page.evaluate(()=>{
          const p=state.players.find(a=>a.year===2);
          for(const event of SPRINT_EVENTS){
            updateResultHistory(p,event,22,'team_trial','記録会',1);
            for(const book of Object.values(state.recordRankings))delete book[event];
            delete state.teamTop10[event];delete state.recordBook[event];
          }
          delete state.sprintRecordRankingVersion;state.version='pwa-v1.45';saveLocal();
          return{id:p.id,name:p.name,seed:state.rngSeed,kept:JSON.stringify([...state.players,...state.world].map(a=>({id:a.id,stats:a.stats,pb:Object.fromEntries(SPECIALTY_EVENTS.map(e=>[e,a.bestTimes[e]]))})))};
        });
        await page.reload();
        assert.equal(await page.evaluate(()=>state.sprintRecordRankingVersion),1);
        assert.equal(await page.evaluate(()=>state.rngSeed),own.seed);
        assert.equal(await page.evaluate(()=>JSON.stringify([...state.players,...state.world].map(a=>({id:a.id,stats:a.stats,pb:Object.fromEntries(SPECIALTY_EVENTS.map(e=>[e,a.bestTimes[e]]))})))),own.kept);
        for(const event of ['ba50','br50','fly50']){
          for(const [rankCategory,recordCategory] of [['high','high'],['university','university'],['all','japan']]){
            await page.locator('#nav [data-page="rankings"]').click();await page.locator('#rankEvent').selectOption(event);await page.locator('#rankCategory').selectOption(rankCategory);
            assert.equal(await page.locator('#rankEvent option').count(),15);assert.equal(await page.locator('#rankingTable tbody tr').count(),50);
            const fastest=await page.locator('#rankingTable tbody tr').evaluateAll(rows=>rows.slice(0,10).map(r=>[r.cells[1].textContent.trim().replace(/^★ /,''),r.cells[5].textContent.trim()]));
            if(rankCategory==='university'){
              assert.match(await page.locator('#rankingTable .own-ranking').innerText(),new RegExp(own.name));
              assert.equal(await page.locator('#rankingTable .own-ranking .grade-pill').innerText(),'大2');
              assert.ok((await page.locator('#rankingTable .grade-pill').allTextContents()).every(label=>/^大[1-4]$/.test(label)));
              assert.equal(await page.locator('#rankingTable .own-ranking .grade-pill').getAttribute('class'),'grade-pill grade-2');
            }
            await page.locator('#nav [data-page="records"]').click();await page.locator('#recordRankingEvent').selectOption(event);await page.locator('#recordRankingCategory').selectOption(recordCategory);
            assert.equal(await page.locator('#recordRankingEvent option').count(),18);
            const records=await page.locator('#recordRankingBody tbody tr').evaluateAll(rows=>rows.map(r=>[r.cells[2].querySelector('b').textContent.trim().replace(/^★ /,''),r.cells[1].textContent.trim()]));
            assert.deepEqual(records,fastest,event+' '+recordCategory);
          }
          assert.equal(await page.locator('#recordRankingBody .record-ranking-own .record-school-label').innerText(),'大2');
          await page.locator('#showTeamTop10Btn').click();await page.locator('#teamTop10Event').selectOption(event);
          assert.equal(await page.locator('#teamTop10Body tbody tr').count(),1);assert.equal(await page.locator('#teamTop10Body td').nth(1).innerText(),'22.00');
          assert.match(await page.locator('#teamTop10Body .top10-active').innerText(),new RegExp(own.name));
          assert.equal(await page.locator('#teamTop10Body .active-athlete').innerText(),'現役 大2');
          await page.locator('#nav [data-page="records"]').click();
        }
        if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v1.65-sprint-records-${mobile?'iphone':'pc'}.png`)});}
        const saved=await page.evaluate(()=>{saveLocal();return JSON.stringify([state.recordRankings,state.teamTop10]);});
        await page.reload();assert.equal(await page.evaluate(()=>JSON.stringify([state.recordRankings,state.teamTop10])),saved);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    }
  }finally{await app.close();}
});

test('PWA upgrades its v1.64 cache to v1.65 and retains saved progress offline', async () => {
  const app = await fixture(true);
  const context = await testContext();
  try {
    const page = await context.newPage();
    const errors = runtimeErrors(page);
    await page.goto(app.url);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    assert.ok((await page.evaluate(() => caches.keys())).includes('swim-manager-pwa-v1.64'));
    const savedNames = await page.evaluate(() => {
      delete state.balanceModelVersion;
      state.slot = 15; state.points = 123; state.players[0].stats.fr_speed = 182;
      state.players[0].name = '名前保持 太郎';
      saveLocal();
      return [...state.players, ...state.world].map(a => [a.id, a.name]);
    });
    app.upgrade();
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await page.waitForFunction(async () => {
      const keys = await caches.keys();
      return keys.includes('swim-manager-pwa-v1.65') && !keys.includes('swim-manager-pwa-v1.64');
    });
    // Load the newly published HTML before validating that its cached copy is usable.
    await page.reload();
    assert.match(await page.title(), /v1\.65/);
    assert.equal(await page.evaluate(() => state.version), 'pwa-v1.65');
    assert.equal(await page.evaluate(() => state.slot), 15);
    assert.equal(await page.evaluate(() => state.points), 123);
    assert.equal(await page.evaluate(() => state.players[0].stats.fr_speed), 182);
    assert.deepEqual(await page.evaluate(() => [...state.players, ...state.world].map(a => [a.id, a.name])), savedNames);
    await context.setOffline(true);
    const response = await page.reload({ waitUntil: 'load' });
    assert.equal(response.fromServiceWorker(), true);
    assert.match(await page.title(), /v1\.65/);
    assert.equal(await page.evaluate(() => state.slot), 15);
    assert.equal(await page.evaluate(() => state.points), 123);
    assert.deepEqual(await page.evaluate(() => [...state.players, ...state.world].map(a => [a.id, a.name])), savedNames);
    assert.deepEqual(errors, []);
  } finally { await context.close(); await app.close(); }
});

test('portrait touch starts in landscape, keeps shared page widths and rotates dialogs and touch controls', async () => {
  const app=await fixture();
  const context=await testContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  try{
    const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);
    const layout=await page.evaluate(()=>{
      const root=document.getElementById('gameViewport'),rect=root.getBoundingClientRect();
      return {rotated:root.classList.contains('landscape-rotated'),width:root.clientWidth,height:root.clientHeight,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},widths:[document.querySelector('header'),document.querySelector('nav'),document.querySelector('main'),document.querySelector('#page-home>.grid')].map(el=>el.clientWidth)};
    });
    assert.equal(layout.rotated,true);assert.equal(layout.width,844);assert.equal(layout.height,390);
    assert.ok(Math.abs(layout.rect.x)<1&&Math.abs(layout.rect.y)<1);
    assert.equal(layout.rect.width,390);assert.equal(layout.rect.height,844);
    assert.ok(Math.max(...layout.widths)-Math.min(...layout.widths)<2,JSON.stringify(layout));
    await page.locator('#nav [data-page="training"]').tap();
    await page.locator('#trainingPlan .focus-btn:not(.selected)').first().tap();
    assert.equal(await page.locator('#trainingPlan .focus-btn.selected').count(),1);
    await page.locator('#nav [data-page="roster"]').tap();
    await page.locator('#rosterTable [data-detail]').first().tap();
    const dialog=await page.locator('.modal-player-detail').boundingBox();
    assert.ok(dialog.x>=0&&dialog.y>=0&&dialog.x+dialog.width<=391&&dialog.y+dialog.height<=845,JSON.stringify(dialog));
    await page.locator('.modal-player-detail #x').tap();
    await page.locator('#showTeamTop10Btn').tap();
    assert.equal(await page.locator('#page-team-top10.active').count(),1);
    assert.equal(await page.locator('#modalRoot .modal').count(),0);
    await page.locator('#teamTop10Event').selectOption('4x100fr');
    assert.equal(await page.locator('#teamTop10Title').innerText(),'4×100m フリーリレー 歴代10傑');
    await page.locator('#nav [data-page="home"]').tap();
    await page.locator('#showTeamTop10Btn').tap();
    assert.equal(await page.locator('#teamTop10Event').inputValue(),'4x100fr');
    if(process.env.SWIM_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,'v1.28-portrait-landscape.png')});
    await page.setViewportSize({width:844,height:390});
    assert.equal(await page.locator('#gameViewport').evaluate(el=>el.classList.contains('landscape-rotated')),false);
    await page.locator('#nav [data-page="home"]').tap();
    const widths=await page.evaluate(()=>['header','nav','main','#page-home>.grid'].map(q=>document.querySelector(q).clientWidth));
    assert.ok(Math.max(...widths)-Math.min(...widths)<2,JSON.stringify(widths));
    assert.deepEqual(errors,[]);
  }finally{await context.close();await app.close();}
});

test('Japan celebration follows first April training, includes selected graduates and resumes once after reload', async () => {
  const app=await fixture(),context=await testContext();
  try{
    const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);
    const names=await page.evaluate(()=>{
      let own=state.players[0],graduate=deepClone(state.players.find(p=>p.year===4)),cpu=state.world[0];
      graduate.id='selected-graduate';graduate.organization='関西青陵大学';
      state.season=2027;state.slot=1;
      state.japanTeam={year:2027,announced:false,individual:Object.fromEntries(EVENTS.map(e=>[e,e==='fr100'?[own.id,graduate.id]:[]])),relays:{'4x100fr':[own.id,cpu.id,graduate.id,state.world[1].id]},athletes:[own,graduate,cpu,state.world[1]].map(p=>({id:p.id,snapshot:deepClone(p),ownAtSelection:p===own||p===graduate}))};
      renderAll();return [own.name,graduate.name,cpu.name];
    });
    assert.equal(await page.locator('.modal-japan-celebration').count(),0);
    await page.locator('#advanceBtn').click();
    await page.locator('.modal-training-result').waitFor();
    assert.equal(await page.locator('.modal-japan-celebration').count(),0);
    await page.locator('.modal-training-result #next').click();
    await page.locator('.modal-japan-celebration').waitFor();
    const text=await page.locator('.modal-japan-celebration').innerText();
    assert.match(text,/おめでとう/);for(const name of names)assert.ok(text.includes(name));
    assert.equal(await page.locator('.celebration-table .result-own').count(),2);
    await page.reload();await page.locator('.modal-japan-celebration').waitFor();
    assert.equal(await page.evaluate(()=>state.slot),2);
    await page.locator('#representativeClose').click();
    assert.equal(await page.evaluate(()=>state.japanTeam.announced),true);
    await page.reload();assert.equal(await page.locator('.modal-japan-celebration').count(),0);
    await page.locator('#advanceBtn').click();await page.locator('.modal-training-result #next').click();
    assert.equal(await page.locator('.modal-japan-celebration').count(),0);
    assert.deepEqual(errors,[]);
  }finally{await context.close();await app.close();}
});

test('every domestic meet preserves all owned heats and finals after skip, then reaches final results', async () => {
  const app=await fixture(),context=await testContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true});
  try{
    const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);
    await page.evaluate(()=>{
      const original=buildMeetRaceQueue;
      buildMeetRaceQueue=(result,selections)=>{
        const queue=original(result,selections);
        window.expectedRaces=queue.map(q=>({event:q.event,phase:q.phase,label:q.label,
          names:[...q.rows].sort((a,b)=>(a.heatLane||1)-(b.heatLane||1)).map(x=>x.athlete.name),
          ownNames:q.rows.filter(x=>x.source==='PLAYER').flatMap(x=>x.members?x.members.map(p=>p.name):[x.athlete.name])}));
        return queue;
      };
    });
    for(const meet of ['team_trial','kansai_college','intercollege','japan_open','joint_record','japan_championship']){
      await page.evaluate(meet=>{
        delete window.expectedRaces;
        state=createState();state.points=10000;state.rngSeed=12345;
        for(let p of state.players.slice(0,4)){
          p.stats=Object.fromEntries(STATS.map(k=>[k,200]));
          for(let e of EVENTS)p.bestTimes[e]=expectedTime(p,e);
        }
        const entries=Object.fromEntries(EVENTS.map(e=>[e,e==='fr100'?state.players.slice(0,meet==='team_trial'?9:3).map(p=>p.id):e==='fr200'?[state.players[0].id]:[]]));
        const relays=RELAY_MEETS.has(meet)?Object.fromEntries((meet==='joint_record'?RELAYS:['4x100fr']).map(k=>[k,state.players.slice(0,4).map(p=>p.id)])):{};
        openMeetEntry(meet,8,2026,entries,relays);
      },meet);
      await page.locator('#confirmEntry').click();await page.locator('#goRace').click();
      await page.waitForFunction(()=>Array.isArray(window.expectedRaces));
      const expected=await page.evaluate(()=>window.expectedRaces);
      const seen=[],program=[],rankings=[];
      for(let steps=0;steps<200;steps++){
        await page.waitForFunction(()=>document.querySelector('#raceCanvas, #startProgramRace, #nextEv, #relayOk, #collegeRankingNext, .modal-meet-results'));
        if(await page.locator('.modal-meet-results').count())break;
        if(await page.locator('#collegeRankingNext').count()){
          assert.equal(seen.length,expected.length,meet);rankings.push(meet);await acceptCollegeRanking(page);continue;
        }
        if(await page.locator('#relayOk').count()){await page.locator('#relayOk').click();continue;}
        if(await page.locator('#startProgramRace').count()){
          const details=await page.locator('.modal-meet-program').evaluate(m=>({day:Number(m.dataset.day),event:m.dataset.event,phase:m.dataset.phase,
            listed:[...m.querySelectorAll('[data-program-event]')].map(r=>({event:r.dataset.programEvent,phase:r.dataset.programPhase,label:r.querySelector('b').textContent})),
            current:m.querySelector('.program-current')?.dataset.programEvent,
            currentPhase:m.querySelector('.program-current')?.dataset.programPhase,
            names:m.querySelector('.program-current .program-entry').textContent,
            finalNames:m.querySelector(`[data-program-event="${m.dataset.event}"][data-program-phase="final"] .program-entry`).textContent,
            finalEntries:Object.fromEntries([...m.querySelectorAll('[data-program-phase="final"]')].map(r=>[r.dataset.programEvent,r.querySelector('.program-entry').textContent])),
            bounds:{modal:m.getBoundingClientRect().bottom,button:m.querySelector('#startProgramRace').getBoundingClientRect().bottom}}));
          assert.equal(details.current,details.event);assert.equal(details.currentPhase,details.phase);
          assert.ok(details.bounds.button<=details.bounds.modal+1,JSON.stringify(details));
          if(details.phase==='prelim')assert.equal(details.finalNames,'予選待ち');
          program.push(details);await page.locator('#startProgramRace').click();continue;
        }
        if(await page.locator('#nextEv').count()){
          assert.ok(await page.locator('.modal-event-result .result-own').count()>0,`${meet}: unexpected CPU-only interim results`);
          if(/予選総合/.test(await page.locator('.modal-event-result h2').innerText()))assert.equal(await page.locator('.modal-event-result .final-qualifier').count(),8);
          await page.locator('#nextEv').click();continue;
        }
        let next=expected[seen.length];assert.ok(next,`${meet}: extra race`);
        const title=await page.locator('.modal-race-live h2').innerText();assert.ok(title.includes(next.label),`${meet}: ${title}`);
        assert.deepEqual((await page.locator('.race-entrant strong').allTextContents()).map(n=>n.replace(/^(?:★ )?\d+ /,'')),next.names);
        assert.equal(await page.locator('.race-event-stats').count(),meet==='team_trial'?next.names.length:0,meet);
        if(next.event.startsWith('4x')){
          assert.equal(await page.locator('.relay-member').count(),4*await page.locator('.relay-entrant').count());
          assert.equal(await page.locator('.race-entrants .entrant-team').count(),0);
          assert.doesNotMatch(await page.locator('.race-entrants').innerText(),/PB|\d+歳|選考時/);
        }
        // Own names have a star; compare names after stripping it.
        seen.push(title);await page.locator('#skipEvent').click();
        await page.locator('.modal-race-result').waitFor();
        assert.match(await page.locator('.modal-race-result h2').innerText(),/結果/);
        await page.locator('#nextGroup').click();
      }
      assert.equal(seen.length,expected.length,meet);
      assert.deepEqual(rankings,['kansai_college','intercollege'].includes(meet)?[meet]:[]);
      if(['kansai_college','intercollege','japan_open','japan_championship'].includes(meet)){
        const days=[['im400','ba200','fr100','fly50'],['fr200','fly200','br100','ba50','4x100fr'],['ba100','im200','fr400','br50','4x100medley'],['fr50','fly100','br200','4x200fr']];
        const withRelays=['kansai_college','intercollege'].includes(meet);
        const wanted=days.flatMap((events,i)=>['prelim','final'].flatMap(phase=>events.filter(e=>['fr100','fr200'].includes(e)||(withRelays&&e==='4x100fr')).map(event=>({day:i+1,event,phase}))));
        assert.deepEqual(program.map(({day,event,phase})=>({day,event,phase})),wanted,meet);
        for(const p of program){
          const events=days[p.day-1].filter(e=>(withRelays||!e.startsWith('4x'))&&(!withRelays||!['ba50','br50','fly50'].includes(e)));
          assert.deepEqual(p.listed.map(({event,phase})=>({event,phase})),['prelim','final'].flatMap(phase=>events.map(event=>({event,phase}))),meet);
          assert.ok(p.listed.every(r=>r.label.endsWith(r.phase==='prelim'?'予選':'決勝')),meet);
        }
        const ownName=await page.evaluate(()=>state.players[0].name);
        for(const p of program){
          const ownNames=expected.filter(q=>q.event===p.event&&q.phase===p.phase).flatMap(q=>q.ownNames);
          assert.ok(ownNames.length>0&&ownNames.every(name=>p.names.includes(name)),`${meet}: ${JSON.stringify(p)}`);
        }
        assert.ok(program.filter(p=>p.event==='4x100fr'&&p.phase==='prelim').every(p=>p.finalEntries.fr200.includes(ownName)),meet);
      }else assert.equal(program.length,0,meet);
      assert.ok(expected.some(q=>q.event==='fr100'),meet);
      assert.ok(expected.some(q=>q.event==='fr200'),meet);
      if(meet!=='team_trial')assert.ok(expected.some(q=>q.label==='A決勝'),meet);
      if(['kansai_college','intercollege','joint_record'].includes(meet))assert.ok(expected.some(q=>q.event==='4x100fr'&&q.label==='リレー A決勝'),meet);
      assert.equal(await page.locator('#resEv option').count(),meet==='team_trial'?2:['kansai_college','intercollege'].includes(meet)?12:15,meet);
      if(meet!=='team_trial'){
        await page.locator('#resEv').selectOption('im400');
        assert.match(await page.locator('#resBody').innerText(),/自チームの出場なし/);
        assert.equal(await page.locator('#resBody .final-qualifier').count(),8,meet);
        if(['kansai_college','intercollege'].includes(meet))assert.equal(await page.locator('#scoreBody h4').count(),3,meet);
      }
      await page.locator('.modal-meet-results #x').click();
      assert.equal(await page.evaluate(()=>state.activeCompetitionSlot),null);
    }
    assert.deepEqual(errors,[]);
  }finally{await context.close();await app.close();}
});

test('pause, speed and natural finish preserve the live clock across minute rollovers', async () => {
  const app=await fixture(),context=await testContext();
  try{
    const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);
    await page.clock.install();
    await page.evaluate(()=>{
      let p=state.players[0];p.stats=Object.fromEntries(STATS.map(k=>[k,173]));
      let q={event:'fr50',label:'予選 1組',rows:[{source:'PLAYER',athlete:p,race:simulateRace(p,'fr50',true,true)}]};
      playRaceCanvas(q.event,q.rows,{onDone:()=>showRaceGroupResult(q,()=>closeModal())});
    });
    await page.locator('#pause').click();const pausedAt=await page.locator('#clock').innerText();await page.clock.runFor(2000);
    assert.equal(await page.locator('#clock').innerText(),pausedAt);
    assert.equal(await page.locator('#nextRace').isDisabled(),true);
    await page.evaluate(()=>document.querySelector('#nextRace').onclick());
    assert.equal(await page.locator('#raceCanvas').count(),1);
    await page.locator('#pause').click();await page.locator('[data-sp="4"]').click();await page.clock.runFor(8000);
    assert.equal(await page.locator('#nextRace').isDisabled(),false);
    await page.locator('#nextRace').click();await page.locator('.modal-race-result').waitFor();
    await page.locator('#nextGroup').click();assert.equal(await page.locator('#modalRoot .modal').count(),0);
    await page.evaluate(()=>{
      const p=state.players[0],q={event:'fr200',label:'記録会 1組',rows:[{source:'PLAYER',athlete:p,race:replayRaceToOfficialTime(p,'fr200',125.01)}]};
      playRaceCanvas(q.event,q.rows,{meet:'team_trial',onDone:()=>showRaceGroupResult(q,()=>closeModal())});
    });
    await page.clock.fastForward(59000);
    assert.match(await page.locator('#clock').innerText(),/^59\.\d{2}$/);
    await page.clock.fastForward(1100);
    assert.match(await page.locator('#clock').innerText(),/^1:00\.\d{2}$/);
    await page.locator('#pause').click();
    const minutePausedAt=await page.locator('#clock').innerText();await page.clock.runFor(2000);
    assert.equal(await page.locator('#clock').innerText(),minutePausedAt);
    await page.locator('#pause').click();await page.locator('[data-sp="2"]').click();
    await page.clock.fastForward(30000);
    assert.match(await page.locator('#clock').innerText(),/^2:00\.\d{2}$/);
    assert.equal(await page.locator('#nextRace').isDisabled(),true);
    await page.locator('[data-sp="4"]').click();await page.clock.fastForward(2000);
    assert.equal(await page.locator('#clock').innerText(),'2:05.01');
    assert.equal(await page.locator('#nextRace').isDisabled(),false);
    await page.locator('#nextRace').click();await page.locator('#nextGroup').click();
    assert.deepEqual(errors,[]);
  }finally{await context.close();await app.close();}
});

test('results highlight own swimmers and first standards while top ten marks active members and compact popups fit', async () => {
  const app=await fixture(),context=await testContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true});
  try{
    const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);
    const cpuAchievements=await page.evaluate(()=>{
      let p=state.players[0];p.stats=Object.fromEntries(STATS.map(k=>[k,200]));p.bestTimes.fr100=70;p.standardAchievementVersion=1;p.standardAchievements={};
      // Explicit fast CPU fixtures exercise hidden PB/standard badges independently of cohort balance.
      for(let a of state.world){
        Object.assign(a.stats,{fr_speed:188,fr_stamina:188,fr_turn:188,start:188});a.bestTimes.fr100=70;
        a.standardAchievementVersion=1;a.standardAchievements={};
      }
      const entries=Object.fromEntries(EVENTS.map(e=>[e,e==='fr100'?[p.id]:[]]));
      const previousRng=rng;let result;
      try{rng=()=>.5;result=executeMeet('joint_record',entries,{})}finally{rng=previousRng}
      result.entries=entries;showMeetResults(result,()=>{});
      let rows=[...result.events.fr100.prelim,...result.events.fr100.final].filter(x=>x.source==='CPU');
      return {pb:rows.filter(x=>x.achievement?.pb).length,standards:rows.filter(x=>x.achievement?.newlyCleared.length).length};
    });
    assert.ok(cpuAchievements.pb>0);
    assert.ok(cpuAchievements.standards>0);
    assert.equal(await page.locator('#resBody tr:not(.result-own) .pb-badge').count(),0);
    assert.equal(await page.locator('#resBody tr:not(.result-own) .std-new').count(),0);
    assert.ok(await page.locator('#resBody .result-own').count()>=4);
    assert.ok(await page.locator('#resBody .pb-badge').count()>0);
    assert.equal(await page.locator('#resBody .std-clear').count(),0);
    // Each of the four standards is earned in prelim only and shown in its own result and global prelim ranking.
    assert.equal(await page.locator('#resBody .result-own .std-new').count(),8);
    const compact=await page.locator('#resBody table').last().evaluate(table=>({width:table.clientWidth,parent:table.parentElement.clientWidth,paddings:[...table.querySelectorAll('td')].map(td=>parseFloat(getComputedStyle(td).paddingLeft))}));
    assert.ok(compact.width<800,JSON.stringify(compact));assert.ok(compact.paddings.every(p=>p<=4));
    await page.locator('.modal-meet-results #x').click();
    await page.evaluate(()=>{
      const p=state.players[0],graduate={id:'former-student',name:'卒業した選手'};
      upsertIndividualTop10('fr100',graduate,48.4,'intercollege','決勝');
      upsertRelayTop10('4x100fr',[p,state.players[1],state.players[2],graduate],200,'intercollege');
    });
    await page.locator('#nav button[data-page="records"]').click();await page.locator('#showTeamTop10Btn').click();await page.locator('#teamTop10Event').selectOption('fr100');
    assert.ok(await page.locator('.top10-active .active-athlete').count()>0);
    const former=page.locator('.top10-table tr').filter({hasText:'卒業した選手'});
    assert.equal(await former.locator('.active-athlete').count(),0);
    await page.locator('#teamTop10Event').selectOption('4x100fr');assert.equal(await page.locator('.active-athlete').count(),3);
    await page.locator('#nav button[data-page="home"]').click();await page.locator('#reputationInfoBtn').click();
    assert.ok((await page.locator('.modal-reputation').boundingBox()).width<560);
    await page.locator('.modal-reputation #x').click();
    assert.equal(await page.locator('#showTeamTop10Btn').evaluate(b=>b.parentElement.id==='nav'&&b.previousElementSibling.dataset.page==='records'),true);
    await page.locator('#showTeamTop10Btn').click();
    assert.equal(await page.locator('#page-home.active').count(),0);
    assert.equal(await page.locator('#page-team-top10.active').count(),1);
    assert.equal(await page.locator('#showTeamTop10Btn.active[aria-current="page"]').count(),1);
    assert.equal(await page.locator('#modalRoot .modal').count(),0);
    assert.equal(await page.locator('#teamTop10Event').inputValue(),'4x100fr');
    await page.locator('#nav button[data-page="records"]').click();
    assert.equal(await page.locator('#nav button[data-page="records"]').innerText(),'記録');
    assert.equal(await page.locator('#page-records h1').innerText(),'記録');
    assert.equal(await page.locator('#meetHistory,[data-podium]').count(),0);
    assert.equal(await page.locator('#teamTop10Body').isVisible(),false);
    await page.locator('#showTeamTop10Btn').click();
    assert.equal(await page.locator('#teamTop10Event option').count(),18);
    assert.equal(await page.locator('#teamTop10Event').inputValue(),'4x100fr');
    await page.locator('#nav [data-page="records"]').click();
    assert.equal(await page.locator('#recordBook,#top10Btn').count(),0);
    assert.equal(await page.locator('#archiveTable').count(),1);
    assert.doesNotMatch(await page.locator('#page-records').innerText(),/大会履歴|表彰台|ゲーム内歴代記録/);
    assert.deepEqual(errors,[]);
  }finally{await context.close();await app.close();}
});

test('a swimmer eliminated in prelim gets his race and ranking, then CPU-only finals wait until the summary', async () => {
  const app=await fixture(),context=await testContext();
  try{
    const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);
    await page.evaluate(()=>{
      let p=state.players[0];p.stats=Object.fromEntries(STATS.map(k=>[k,80]));
      const entries=Object.fromEntries(EVENTS.map(e=>[e,e==='fr100'?[p.id]:[]]));
      openMeetEntry('joint_record',74,2026,entries,{});
    });
    await page.locator('#confirmEntry').click();await page.locator('#goRace').click();await page.locator('.modal-race-live').waitFor();
    assert.match(await page.locator('.modal-race-live h2').innerText(),/予選/);
    await page.locator('#skipEvent').click();await page.locator('#nextGroup').click();
    await page.locator('.modal-event-result').waitFor();
    assert.equal(await page.locator('.modal-event-result .final-qualifier').count(),8);
    assert.equal(await page.locator('.modal-event-result .result-own .final-qualifier').count(),0);
    await page.locator('#nextEv').click();await page.locator('.modal-meet-results').waitFor();
    assert.ok(await page.locator('#resBody h3').filter({hasText:'A決勝'}).count());
    assert.equal(await page.locator('#resBody .result-own').count(),2);
    await page.locator('.modal-meet-results #x').click();assert.deepEqual(errors,[]);
  }finally{await context.close();await app.close();}
});

test('race cards show event abilities only in team trials, follow seeded lanes and keep controls visible on PC and iPhone', async () => {
  const app=await fixture();
  try{
  for(const options of [{viewport:{width:1440,height:900}},{viewport:{width:844,height:390},isMobile:true,hasTouch:true},{viewport:{width:390,height:844},isMobile:true,hasTouch:true},{viewport:{width:667,height:375},isMobile:true,hasTouch:true}]){
  const context=await testContext(options);
  try{
    const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);await page.clock.install();
    const expected=await page.evaluate(()=>{
      let labels={},original=CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...args){
        if(/^[1-8]$/.test(String(text)))labels[text]={x,y};original.call(this,text,x,y,...args);
      };
      window.courseLabels=labels;
      Object.assign(state.players[0].stats,{fr_speed:175,fr_stamina:150,fr_turn:125,ba_speed:100,ba_stamina:75,ba_turn:50,br_speed:25,br_stamina:176,br_turn:151,fly_speed:126,fly_stamina:101,fly_turn:76});
      const entries=state.players.slice(0,8).map((p,i)=>{p.bestTimes.fr100=55+i;return {source:i===0?'PLAYER':'CPU',athlete:p,entryPB:p.bestTimes.fr100};});
      let rows=seedRaceHeats(entries,'fr100','team_trial')[0].map(x=>({...x,race:simulateRace(x.athlete,'fr100',true,true)}));
      window.cardRows=rows;
      state.pendingFreshmenWelcome=freshmanWelcomeRows(state.players.slice(0,8));
      playRaceCanvas('fr100',rows,{meet:'team_trial',onSkip:()=>showRaceGroupResult({event:'fr100',label:'記録会 1組',rows},()=>showFreshmenWelcome())});
      return rows.sort((a,b)=>a.heatLane-b.heatLane).map(x=>({lane:x.heatLane,name:x.athlete.name}));
    });
    await page.waitForFunction(()=>Object.keys(window.courseLabels).length===8);
    const labels=await page.evaluate(()=>window.courseLabels);
    assert.deepEqual(Object.keys(labels),['1','2','3','4','5','6','7','8']);
    for(let lane=1;lane<=8;lane++){
      assert.ok(labels[lane].x>1200,JSON.stringify(labels));
      if(lane>1)assert.ok(labels[lane].y>labels[lane-1].y);
    }
    const cards=await page.locator('.race-entrant strong').allTextContents();
    assert.deepEqual(cards.map(t=>Number(t.match(/\d+/)[0])),expected.map(x=>x.lane));
    assert.deepEqual(cards.map(t=>t.replace(/^(?:★ )?\d+ /,'')),expected.map(x=>x.name));
    const own=page.locator('.race-entrant.own');
    assert.equal(await page.locator('.race-event-stats').count(),8);
    assert.deepEqual(await own.locator('.race-event-stat-label').allTextContents(),['スピード','スタミナ','ターン']);
    assert.deepEqual(await own.locator('.race-event-stat-value').allTextContents(),['175','150','125']);
    assert.deepEqual(await own.locator('.race-event-stats .stat-rank-badge').allTextContents(),['A','B','C']);
    const im=await page.evaluate(()=>{const p=state.players[0],values=eventProfile(p,'im200').slice(0,3);return {values:values.map(v=>String(Math.round(v))),ranks:values.map(statRank)}});
    for(const [event,values,ranks] of [['ba50',['100','75','50'],['D','E','F']],['br100',['25','176','151'],['G','S','A']],['fly200',['126','101','76'],['B','C','D']],['im200',im.values,im.ranks],['im400',im.values,im.ranks]]){
      await page.evaluate(event=>{
        let rows=window.cardRows.map(x=>({...x,entryPB:x.athlete.bestTimes[event],race:simulateRace(x.athlete,event,false,true)}));
        playRaceCanvas(event,rows,{meet:'team_trial',onSkip:()=>showRaceGroupResult({event,label:'記録会 1組',rows},()=>showFreshmenWelcome())});
      },event);
      assert.equal(await page.locator('.race-event-stats').count(),8);
      assert.deepEqual(await own.locator('.race-event-stat-value').allTextContents(),values,event);
      assert.deepEqual(await own.locator('.race-event-stats .stat-rank-badge').allTextContents(),ranks,event);
      assert.equal(await own.locator('.race-event-stats').getAttribute('aria-label'),await page.evaluate(e=>EVENT_LABEL[e]+'のステータス',event));
    }
    await page.clock.fastForward(61000);
    assert.match(await page.locator('#clock').innerText(),/^1:\d{2}\.\d{2}$/);
    await page.locator('#pause').click();
    const geometry=await page.locator('.modal-race-live').evaluate(m=>{
      let box=m.getBoundingClientRect(),button=m.querySelector('#skipEvent').getBoundingClientRect();
      return{canvas:m.querySelector('canvas').offsetHeight,overflow:[...m.querySelectorAll('.race-event-stat')].map(e=>e.scrollWidth-e.clientWidth),buttonVisible:button.left>=box.left&&button.right<=box.right+1&&button.top>=box.top&&button.bottom<=box.bottom+1};
    });
    assert.ok(geometry.canvas>=120&&geometry.buttonVisible&&geometry.overflow.every(n=>n<=1),JSON.stringify(geometry));
    if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v1.65-trial-stats-${options.isMobile?'iphone':'pc'}-${options.viewport.width}x${options.viewport.height}.png`)});}
    for(const meet of ['joint_record','kansai_college','intercollege','japan_open','japan_championship','world_championship']){
      await page.evaluate(meet=>playRaceCanvas('fr100',window.cardRows,{meet}),meet);
      assert.equal(await page.locator('.race-event-stats').count(),0,meet);
      assert.equal(await page.locator('.race-entrant').count(),8,meet);
    }
    await page.evaluate(()=>playRaceCanvas('fr100',window.cardRows,{meet:'team_trial',onSkip:()=>showRaceGroupResult({event:'fr100',label:'記録会 1組',rows:window.cardRows},()=>showFreshmenWelcome())}));
    await page.locator('#skipEvent').click();await page.locator('#nextGroup').click();
    await page.locator('.modal-freshmen-welcome').waitFor();
    if(options.isMobile){const bounds=await page.locator('.modal-freshmen-welcome').boundingBox();assert.ok(Math.min(bounds.width,bounds.height)<385&&Math.max(bounds.width,bounds.height)<615,JSON.stringify(bounds));}
    assert.equal(await page.locator('.modal-freshmen-welcome tbody tr').count(),8);
    await page.locator('#freshClose').click();assert.deepEqual(errors,[]);
  }finally{await context.close();}
  }
  }finally{await app.close();}
});

test('swimsuit colors remain distinct for all eight lanes through every stroke, underwater, turns and relays', async () => {
  const app=await fixture();
  try{
    for(const options of [{viewport:{width:1280,height:800}},{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]){
      const context=await testContext(options);
      try{
        const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);
        await page.clock.install({time:new Date('2026-01-01T00:00:00Z')});
        await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
        const scenarios=await page.evaluate(()=>{
          // Pixel assertions repeatedly read the canvas; opt into Chromium's readback path.
          const getContext=HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext=function(type,options){
            return getContext.call(this,type,type==='2d'?{...options,willReadFrequently:true}:options);
          };
          const p=state.players[0];p.stats=Object.fromEntries(STATS.map(k=>[k,138]));
          const cases=[];
          for(const event of ['ba100','fr100','br100','fly100','im200','im400','4x100medley']){
            const members=Array.from({length:4},()=>p),relay=event.startsWith('4x');
            const race=relay?simulateRelay(members,event,true):replayRaceToOfficialTime(p,event,event==='im400'?270:event==='im200'?135:80);
            const rows=Array.from({length:8},(_,i)=>({source:'PLAYER',athlete:relay?{name:'チーム'+(i+1),organization:'チーム'+(i+1)}:state.players[i],heatLane:i+1,race:deepClone(race),...(relay?{members}: {})}));
            const strokes=event.startsWith('im')||relay?['fly','ba','br','fr']:[strokeForEvent(event)];
            for(const stroke of strokes){
              const samples=race.trajectory.filter(s=>s.stroke===stroke&&s.phase==='surface_swim'&&s.distance%50>20&&s.distance%50<40);
              if(!samples.length)throw new Error('Missing surface sample: '+event+' '+stroke);
              const sample=samples[Math.floor(samples.length/2)];
              cases.push({event,rows,label:event+'-'+stroke+'-surface',time:sample.t,stroke,underwater:false});
            }
            if(!relay&&!event.startsWith('im'))for(const phase of ['underwater','turn','return']){
              const samples=race.trajectory.filter(s=>phase==='underwater'?s.underwater&&s.distance>3&&s.distance<8:phase==='turn'?s.phase==='turn':s.phase==='surface_swim'&&s.distance>70&&s.distance<90);
              if(!samples.length)throw new Error('Missing phase sample: '+event+' '+phase);
              const sample=samples[Math.floor(samples.length/2)];
              cases.push({event,rows,label:event+'-'+phase,time:sample.t,stroke:sample.stroke,underwater:!!sample.underwater});
            }
          }
          window.swimsuitCases=cases;
          return cases.map(({label,time,stroke,underwater})=>({label,time,stroke,underwater}));
        });
        for(let i=0;i<scenarios.length;i++){
          const scenario=scenarios[i];
          await page.evaluate(i=>{const q=window.swimsuitCases[i];playRaceCanvas(q.event,q.rows,{meet:'joint_record',stageLabel:q.label});},i);
          await page.clock.fastForward(Math.round(scenario.time*1000));
          const counts=await page.locator('#raceCanvas').evaluate((canvas,scenario)=>{
            const ctx=canvas.getContext('2d'),colors=['#153e75','#9c2f4f','#146b55','#7c4db2','#b15b16','#216a9a','#80572c','#3c5577'];
            const rgb=color=>[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
            const blend=(front,back,alpha)=>front.map((v,i)=>Math.round(v*alpha+back[i]*(1-alpha)));
            return colors.map((color,lane)=>{
              const expected=rgb(color),water=rgb('#c9efff'),skin=rgb('#d8b69c');
              const candidates=scenario.underwater?[blend(expected,water,.72),blend(expected,blend(skin,water,.72),.72)]:[expected];
              const pixels=ctx.getImageData(0,50+lane*68+18-12,canvas.width,24).data;
              let count=0;
              for(let j=0;j<pixels.length;j+=4)if(candidates.some(c=>c.every((v,k)=>Math.abs(pixels[j+k]-v)<=2)))count++;
              return count;
            });
          },scenario);
          if(process.env.SWIM_SCREENSHOT_DIR&&scenario.label==='ba100-ba-surface'){
            fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`suit-backstroke-${options.isMobile?'iphone':'pc'}.png`)});
          }
          assert.ok(counts.every(n=>n>=8),scenario.label+' '+JSON.stringify(counts));
        }
        assert.deepEqual(errors,[]);
      }finally{await context.close();}
    }
  }finally{await app.close();}
});

test('IM canvas positions reflect a visibly faster butterfly leg on PC and portrait iPhone',async()=>{
  const app=await fixture();
  try{
    for(const options of [{viewport:{width:1280,height:800}},{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]){
      const context=await testContext(options);
      try{
        const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);
        await page.clock.install({time:new Date('2026-01-01T00:00:00Z')});
        await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
        for(const event of ['im200','im400']){
          const data=await page.evaluate(event=>{
            const a={...deepClone(state.players[0]),name:'Flyが得意',stats:Object.fromEntries(STATS.map(k=>[k,100])),bestTimes:{}};
            for(const s of MEDLEY_STROKES)for(const k of ['speed','stamina'])a.stats[s+'_'+k]=88;
            const b={...deepClone(a),id:'medley-ba-test',name:'Baが得意'};
            a.stats.fly_speed=163;b.stats.ba_speed=163;
            const target=event==='im200'?135:285,ra=replayRaceToOfficialTime(a,event,target),rb=replayRaceToOfficialTime(b,event,target);
            const t=ra.medleySections[0].time-1;
            playRaceCanvas(event,[{source:'PLAYER',athlete:a,heatLane:1,race:ra},{source:'PLAYER',athlete:b,heatLane:2,race:rb}],{meet:'joint_record',stageLabel:'泳法ごとの能力差'});
            return {t,positions:[stateAt(ra,t).distance,stateAt(rb,t).distance]};
          },event);
          await page.clock.fastForward(Math.round(data.t*1000));
          const drawn=await page.locator('#raceCanvas').evaluate(canvas=>{
            const ctx=canvas.getContext('2d'),pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
            const centers=[[21,62,117],[156,47,79]].map((color,lane)=>{
              let count=0,sum=0;
              for(let y=50+lane*68+6;y<50+lane*68+30;y++)for(let x=0;x<canvas.width;x++){
                const i=(y*canvas.width+x)*4;
                if(color.every((v,k)=>Math.abs(pixels[i+k]-v)<=2)){count++;sum+=x;}
              }
              return count?sum/count:null;
            });
            return {centers,width:canvas.width};
          });
          assert.ok(data.positions[0]>data.positions[1]+3,JSON.stringify(data));
          assert.ok(drawn.centers.every(x=>x!==null),JSON.stringify(drawn));
          for(let i=0;i<2;i++){
            const distance=data.positions[i],fraction=(distance%50)/50,span=drawn.width-60;
            const expected=Math.floor(distance/50)%2===0?18+span*fraction:drawn.width-42-span*fraction;
            assert.ok(Math.abs(drawn.centers[i]-expected)<6,JSON.stringify({event,drawn,expected}));
          }
          assert.ok(Math.abs(drawn.centers[0]-drawn.centers[1])>40,JSON.stringify(drawn));
          if(process.env.SWIM_SCREENSHOT_DIR){
            fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});
            await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`medley-${event}-${options.isMobile?'iphone':'pc'}.png`)});
          }
        }
        assert.deepEqual(errors,[]);
      }finally{await context.close();}
    }
  }finally{await app.close();}
});

test('endurance fade appears in actual 200m and 400m canvas motion on PC and portrait iPhone',async()=>{
  const app=await fixture();
  try{
    for(const options of [{viewport:{width:1280,height:800}},{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]){
      const context=await testContext(options);
      try{
        const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);
        await page.clock.install({time:new Date('2026-01-01T00:00:00Z')});
        await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
        await page.evaluate(()=>{
          // Repeated pixel checks need Chromium's readback path; production animation does not read pixels.
          const getContext=HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext=function(type,options){
            return getContext.call(this,type,type==='2d'?{...options,willReadFrequently:true}:options);
          };
        });
        for(const event of ['fr200','fr400']){
          const data=await page.evaluate(event=>{
            const weak={...deepClone(state.players[0]),name:'スタミナ不足',stats:Object.fromEntries(STATS.map(k=>[k,163])),bestTimes:{}};
            weak.stats.fr_stamina=60;
            const strong={...deepClone(weak),id:'endurance-strong',name:'スタミナ十分'};strong.stats.fr_stamina=163;
            const target=distanceOf(event)===400?270:135,races=[weak,strong].map(p=>replayRaceToOfficialTime(p,event,target));
            playRaceCanvas(event,[{source:'PLAYER',athlete:weak,heatLane:1,race:races[0]},{source:'PLAYER',athlete:strong,heatLane:2,race:races[1]}],{meet:'joint_record',stageLabel:'スタミナによる後半の失速'});
            return {target,frames:[.55,.9].map(f=>({t:target*f,positions:races.map(r=>stateAt(r,target*f).distance)}))};
          },event);
          const [middle,late]=data.frames;
          assert.ok(middle.positions[0]-middle.positions[1]>5,JSON.stringify(data));
          assert.ok(late.positions[0]-late.positions[1]<(middle.positions[0]-middle.positions[1])*.7,JSON.stringify(data));
          let elapsed=0;
          for(const frame of data.frames){
            await page.clock.fastForward(Math.round((frame.t-elapsed)*1000));elapsed=frame.t;
            const drawn=await page.locator('#raceCanvas').evaluate(canvas=>{
              const ctx=canvas.getContext('2d'),pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
              const centers=[[21,62,117],[156,47,79]].map((color,lane)=>{
                let count=0,sum=0;
                for(let y=50+lane*68+6;y<50+lane*68+30;y++)for(let x=0;x<canvas.width;x++){
                  const i=(y*canvas.width+x)*4;
                  if(color.every((v,k)=>Math.abs(pixels[i+k]-v)<=2)){count++;sum+=x}
                }
                return count?sum/count:null;
              });
              return {centers,width:canvas.width};
            });
            assert.ok(drawn.centers.every(x=>x!==null),JSON.stringify(drawn));
            for(let i=0;i<2;i++){
              const d=frame.positions[i],fraction=(d%50)/50,span=drawn.width-60;
              const expected=Math.floor(d/50)%2===0?18+span*fraction:drawn.width-42-span*fraction;
              assert.ok(Math.abs(drawn.centers[i]-expected)<6,JSON.stringify({event,frame,drawn,expected}));
            }
          }
          if(process.env.SWIM_SCREENSHOT_DIR){
            fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});
            await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`endurance-${event}-${options.isMobile?'iphone':'pc'}.png`)});
          }
        }
        assert.deepEqual(errors,[]);
      }finally{await context.close();}
    }
  }finally{await app.close();}
});

test('derived IM stats sit below Fly, follow swimming training and highlight their rank-up on PC and portrait iPhone',async()=>{
  const app=await fixture();
  try{
    for(const options of [{viewport:{width:1440,height:900}},{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]){
      const context=await testContext(options);
      try{
        const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);
        const saved=await page.evaluate(()=>{
          const p=state.players[0];state.players=[p];p.year=1;p.growthProfile={1:1,2:1,3:1,4:1};
          for(const k of STATS)p.stats[k]=138;
          const bias=medleyStatValue(p,'speed')-138;
          for(const s of MEDLEY_STROKES)p.stats[s+'_speed']=125.49-bias;
          state.slot=1;state.rngSeed=12345;state.facilities.fr_speed=100;state.trainingFocus[p.id]=['fr_speed'];selectedTrainingId=p.id;
          renderAll();return {id:p.id,speed:Math.round(p.stats.im_speed),stamina:Math.round(p.stats.im_stamina)};
        });
        await page.locator('#nav [data-page="training"]').click();
        for(const [key,value] of [['im_speed',saved.speed],['im_stamina',saved.stamina]]){
          const cell=page.locator(`#trainingPlan [data-derived-stat="${key}"]`);
          assert.equal(await cell.locator('.stat-number').innerText(),String(value));
          assert.match(await cell.innerText(),/4泳法の練習で向上/);
          await cell.click();assert.deepEqual(await page.evaluate(()=>state.trainingFocus[state.players[0].id]),['fr_speed']);
        }
        const layout=await page.evaluate(()=>{
          const rect=selector=>{const b=document.querySelector(selector);return {x:b.offsetLeft,y:b.offsetTop,w:b.offsetWidth}};
          return {fly:rect('#trainingPlan [data-focus="fly_speed"]'),im:rect('#trainingPlan [data-derived-stat="im_speed"]'),st:rect('#trainingPlan [data-derived-stat="im_stamina"]')};
        });
        assert.ok(layout.im.y>layout.fly.y);assert.ok(Math.abs(layout.im.x-layout.fly.x)<1);assert.ok(Math.abs(layout.im.y-layout.st.y)<1);
        const trainingFonts=await page.evaluate(()=>{
          const font=selector=>{const s=getComputedStyle(document.querySelector(selector));return [s.fontFamily,s.fontSize,s.fontWeight]};
          return ['b','.stat-number','.stat-rank-badge'].map(part=>({native:font('#trainingPlan [data-focus="fly_speed"] '+part),im:font('#trainingPlan [data-derived-stat="im_speed"] '+part)}));
        });
        for(const f of trainingFonts)assert.deepEqual(f.im,f.native);
        await page.locator('#nav [data-page="roster"]').click();await page.locator('#rosterTable [data-detail]').click();
        const detail=page.locator('.modal-player-detail');
        assert.equal(await detail.locator('[data-stat="im_speed"] .stat-number').innerText(),'125');
        assert.equal(await detail.locator('[data-detail-focus]').count(),14);
        const detailFonts=await detail.evaluate(m=>['.stat-detail-label','.stat-number','.stat-rank-badge'].map(part=>{
          const font=k=>{const s=getComputedStyle(m.querySelector('[data-stat="'+k+'"] '+part));return [s.fontFamily,s.fontSize,s.fontWeight]};
          return {native:font('fly_speed'),im:font('im_speed')};
        }));
        for(const f of detailFonts)assert.deepEqual(f.im,f.native);
        const positions=await detail.evaluate(m=>['fly_speed','im_speed','fr_turn'].map(k=>m.querySelector(`[data-stat="${k}"]`).offsetTop));
        assert.ok(positions[0]<positions[1]&&positions[1]<positions[2]);
        if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`derived-im-detail-${options.isMobile?'iphone':'pc'}.png`)});}
        await detail.locator('#x').click();await page.locator('#nav [data-page="home"]').click();await page.locator('#advanceBtn').click();
        const change=page.locator(`.training-growth-table [data-athlete-id="${saved.id}"] [data-stat="im_speed"]`);
        assert.equal(await change.locator('.growth-rank-up').textContent(),'C→B');
        assert.ok(await change.locator('.growth-up').count()>0);
        await page.locator('.modal-training-result #next').click();
        assert.equal(await page.locator(`#trainingGrowthHome [data-athlete-id="${saved.id}"] [data-stat="im_speed"] .growth-rank-up`).textContent(),'C→B');
        const before=await page.evaluate(()=>{saveLocal();return {speed:state.players[0].stats.im_speed,stamina:state.players[0].stats.im_stamina,pb:JSON.stringify(state.players[0].bestTimes),focus:state.trainingFocus[state.players[0].id]}});
        await page.reload();
        assert.deepEqual(await page.evaluate(()=>({speed:state.players[0].stats.im_speed,stamina:state.players[0].stats.im_stamina,pb:JSON.stringify(state.players[0].bestTimes),focus:state.trainingFocus[state.players[0].id]})),before);
        await page.locator('#nav [data-page="training"]').click();
        assert.equal(await page.locator('#trainingPlan [data-derived-stat="im_speed"] .stat-number').innerText(),String(Math.round(before.speed)));
        const cpu=await page.evaluate(()=>state.world.every(a=>Number.isFinite(a.stats.im_speed)&&Number.isFinite(a.stats.im_stamina)));
        assert.equal(cpu,true);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    }
  }finally{await app.close();}
});
