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
      data = Buffer.from(data.toString().replaceAll('v1.32.2', 'v1.32.1'));
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
    await pc.evaluate(()=>{state.points=321;state.players[0].stats.fr_speed=111.22;state.players[0].bestTimes.fr100=47.89;saveLocal()});
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
      openMeetEntry('intercollege',43,2026,entries,relays);
      return {original,next,kinds:RELAYS,labels:RELAY_LABEL};
    });
    // Leaving the preliminary editor must discard its unconfirmed draft.
    await page.locator('#relayBtn').click();
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

test('college awards and all three historic record categories work on PC and portrait iPhone and survive reload',async()=>{
  const app=await fixture();
  for(const options of [{viewport:{width:1280,height:800}},{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]){
    const context=await testContext(options);
    try{
      const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);
      const names=await page.evaluate(()=>{
        state.recordRankings={};
        const own=state.players[0];own.name='記録確認選手';
        recordIndividualResult({...own,id:'school-record',category:'high',year:null,organization:'記録高校'},'fr100',50,'全国高校総体','決勝');
        recordIndividualResult(own,'fr100',49,'intercollege','決勝');
        recordIndividualResult({id:'adult-record',name:'社会人選手',category:'adult',organization:'記録チーム'},'fr100',48,'japan_championship','決勝');
        recordRelayResult('4x100fr',{organization:state.playerUniversity,members:state.players.slice(0,4),race:{total:200}},'intercollege','決勝');
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
      assert.equal(await page.locator('#recordRankingEvent option').count(),15);
      assert.equal(await page.locator('#recordRankingCategory option').count(),3);
      await page.locator('#recordRankingCategory').selectOption('high');
      assert.equal(await page.locator('#recordRankingTitle').innerText(),'高校記録10傑');
      assert.match(await page.locator('#recordRankingBody').innerText(),/記録高校/);
      assert.equal(await page.locator('#recordRankingBody .record-time').innerText(),'50.00');
      await page.locator('#recordRankingCategory').selectOption('university');
      assert.match(await page.locator('#recordRankingBody').innerText(),/記録確認選手/);
      assert.equal(await page.locator('#recordRankingBody .record-time').innerText(),'49.00');
      await page.locator('#recordRankingEvent').selectOption('4x100fr');
      assert.equal(await page.locator('#recordRankingBody .record-time').innerText(),'3:20.00');
      assert.match(await page.locator('#recordRankingBody').innerText(),/記録確認選手/);
      await page.locator('#nav button[data-page="home"]').click();await page.locator('#nav button[data-page="records"]').click();
      assert.equal(await page.locator('#recordRankingCategory').inputValue(),'university');
      assert.equal(await page.locator('#recordRankingEvent').inputValue(),'4x100fr');
      const saved=await page.evaluate(()=>{saveLocal();return JSON.stringify(state.recordRankings)});
      await page.reload();await page.locator('#nav button[data-page="records"]').click();
      assert.equal(await page.evaluate(()=>JSON.stringify(state.recordRankings)),saved);
      await page.locator('#recordRankingCategory').selectOption('japan');await page.locator('#recordRankingEvent').selectOption('fr100');
      assert.deepEqual(await page.locator('#recordRankingBody .record-time').allTextContents(),['48.00','49.00','50.00']);
      assert.ok(await page.locator('#teamTop10Body').count());assert.deepEqual(errors,[]);
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

test('training requires one item, reset chooses specialty, and specialty popup stays narrow', async () => {
  const app = await fixture();
  try {
    for (const mobile of [false, true]) {
      const context = await testContext({ viewport: mobile ? { width: 844, height: 390 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile });
      try {
        const page = await context.newPage();
        const errors = runtimeErrors(page);
        await page.goto(app.url);
        await page.locator('#nav [data-page="training"]').click();
        await page.locator('#trainingPlan .focus-btn.selected').click();
        assert.equal(await page.locator('#trainingPlan .focus-btn.selected').count(), 1);
        await page.locator('#trainingPlan .focus-btn:not(.selected)').first().click();
        assert.equal(await page.locator('#trainingPlan .focus-btn.selected').count(), 1);
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
  const context = await testContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
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
    assert.equal(await page.locator('.standards-table thead th').last().innerText(), '世界大会');
    assert.equal(await page.locator('.standards-table tbody tr').nth(1).locator('td').last().innerText(), '47.64');
    assert.match(await page.locator('.modal-standards').innerText(),/専門泳法を優先し、他の泳法は2位の選手/);
    await page.locator('.modal-standards #x').click();
    assert.equal(await cells.nth(0).isChecked(), true);
    assert.match(await page.locator('#entryViewToggle').innerText(), /能力表示 → PB表示/);
    assert.deepEqual(errors, []);
  } finally { await context.close(); await app.close(); }
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
    await page.locator('#goRace').click();
    await advanceToRace(page);
    assert.match(await page.locator('.modal-race-live h2').innerText(), /100mFr/);
    assert.match(await page.locator('.race-entrants .own').innerText(), /PB/);
    const races=await drainRaces(page);
    assert.equal(races.filter(title=>/100mFr/.test(title)).length,2);
    assert.equal(races.filter(title=>/メドレーリレー/.test(title)).length,2);
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
    assert.match(await page.locator('.modal-entry-confirm').innerText(), new RegExp(selected.name));
    assert.deepEqual(errors, []);
  } finally { await context.close(); await app.close(); }
});

test('a world meet with no own representatives skips interim screens and shows every result in its summary', async () => {
  const app=await fixture(),context=await testContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true});
  try{
    const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);
    await page.evaluate(()=>{state.season=2027;state.slot=36;state.japanTeam=null;openMeetEntry('world_championship',36,2027);});
    await page.locator('#goRace').click();
    const program=[],races=await drainRaces(page,program);
    assert.deepEqual(races,[]);
    assert.deepEqual(program,[]);
    assert.equal(await page.locator('#resEv option').count(),12);
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
    await page.locator('#entryMatrix input[data-event="fr100"]').first().check();
    await page.locator('#confirmEntry').click();
    await page.locator('#goRace').click();
    await page.locator('#skipEvent').click();
    await page.locator('#nextGroup').click();
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

test('PWA upgrades its v1.32.1 cache to v1.32.2 and retains saved progress offline', async () => {
  const app = await fixture(true);
  const context = await testContext();
  try {
    const page = await context.newPage();
    const errors = runtimeErrors(page);
    await page.goto(app.url);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    assert.ok((await page.evaluate(() => caches.keys())).includes('swim-manager-pwa-v1.32.1'));
    await page.evaluate(() => {
      delete state.balanceModelVersion;
      state.slot = 15; state.points = 123; state.players[0].stats.fr_speed = 182;
      saveLocal();
    });
    app.upgrade();
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await page.waitForFunction(async () => {
      const keys = await caches.keys();
      return keys.includes('swim-manager-pwa-v1.32.2') && !keys.includes('swim-manager-pwa-v1.32.1');
    });
    // Load the newly published HTML before validating that its cached copy is usable.
    await page.reload();
    assert.match(await page.title(), /v1\.32\.2/);
    assert.equal(await page.evaluate(() => state.version), 'pwa-v1.32.2');
    assert.equal(await page.evaluate(() => state.slot), 15);
    assert.equal(await page.evaluate(() => state.points), 123);
    assert.equal(await page.evaluate(() => state.players[0].stats.fr_speed), 182);
    await context.setOffline(true);
    const response = await page.reload({ waitUntil: 'load' });
    assert.equal(response.fromServiceWorker(), true);
    assert.match(await page.title(), /v1\.32\.2/);
    assert.equal(await page.evaluate(() => state.slot), 15);
    assert.equal(await page.evaluate(() => state.points), 123);
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
        const days=[['im400','ba200','fr100'],['fr200','fly200','br100','4x100fr'],['ba100','im200','fr400','4x100medley'],['fr50','fly100','br200','4x200fr']];
        const withRelays=['kansai_college','intercollege'].includes(meet);
        const wanted=days.flatMap((events,i)=>['prelim','final'].flatMap(phase=>events.filter(e=>['fr100','fr200'].includes(e)||(withRelays&&e==='4x100fr')).map(event=>({day:i+1,event,phase}))));
        assert.deepEqual(program.map(({day,event,phase})=>({day,event,phase})),wanted,meet);
        for(const p of program){
          const events=days[p.day-1].filter(e=>withRelays||!e.startsWith('4x'));
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
      assert.equal(await page.locator('#resEv option').count(),meet==='team_trial'?2:12,meet);
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

test('pause, speed and natural finish enable next only after the current race ends', async () => {
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
    assert.deepEqual(errors,[]);
  }finally{await context.close();await app.close();}
});

test('results highlight own swimmers and first standards while top ten marks active members and compact popups fit', async () => {
  const app=await fixture(),context=await testContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true});
  try{
    const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);
    const cpuAchievements=await page.evaluate(()=>{
      let p=state.players[0];p.stats=Object.fromEntries(STATS.map(k=>[k,200]));p.bestTimes.fr100=70;p.standardAchievementVersion=1;p.standardAchievements={};
      for(let a of state.world){a.standardAchievementVersion=1;a.standardAchievements={}}
      const entries=Object.fromEntries(EVENTS.map(e=>[e,e==='fr100'?[p.id]:[]]));
      let result=executeMeet('joint_record',entries,{});result.entries=entries;showMeetResults(result,()=>{});
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
    await page.locator('#nav button[data-page="records"]').click();await page.locator('#teamTop10Event').selectOption('fr100');
    assert.ok(await page.locator('.top10-active .active-athlete').count()>0);
    const former=page.locator('.top10-table tr').filter({hasText:'卒業した選手'});
    assert.equal(await former.locator('.active-athlete').count(),0);
    await page.locator('#teamTop10Event').selectOption('4x100fr');assert.equal(await page.locator('.active-athlete').count(),3);
    await page.locator('#nav button[data-page="home"]').click();await page.locator('#reputationInfoBtn').click();
    assert.ok((await page.locator('.modal-reputation').boundingBox()).width<560);
    await page.locator('.modal-reputation #x').click();
    await page.locator('#nav button[data-page="records"]').click();
    assert.equal(await page.locator('#nav button[data-page="records"]').innerText(),'記録');
    assert.equal(await page.locator('#page-records h1').innerText(),'記録');
    assert.equal(await page.locator('#meetHistory,[data-podium]').count(),0);
    assert.equal(await page.locator('#teamTop10Event option').count(),15);
    assert.equal(await page.locator('#teamTop10Event').inputValue(),'4x100fr');
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

test('race cards follow their seeded lanes, course numbers appear on the right, and freshmen welcome stays compact', async () => {
  const app=await fixture(),context=await testContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true});
  try{
    const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);
    const expected=await page.evaluate(()=>{
      let labels={},original=CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...args){
        if(/^[1-8]$/.test(String(text)))labels[text]={x,y};original.call(this,text,x,y,...args);
      };
      window.courseLabels=labels;
      const entries=state.players.slice(0,8).map((p,i)=>{p.bestTimes.fr100=55+i;return {source:i===0?'PLAYER':'CPU',athlete:p,entryPB:p.bestTimes.fr100};});
      let rows=seedRaceHeats(entries,'fr100','team_trial')[0].map(x=>({...x,race:simulateRace(x.athlete,'fr100',true,true)}));
      let q={event:'fr100',label:'予選 1組',rows};
      state.pendingFreshmenWelcome=freshmanWelcomeRows(state.players.slice(0,8));
      playRaceCanvas('fr100',rows,{onSkip:()=>showRaceGroupResult(q,()=>showFreshmenWelcome())});
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
    await page.locator('#skipEvent').click();await page.locator('#nextGroup').click();
    await page.locator('.modal-freshmen-welcome').waitFor();
    const bounds=await page.locator('.modal-freshmen-welcome').boundingBox();
    assert.ok(bounds.width<615&&bounds.height<385,JSON.stringify(bounds));
    assert.equal(await page.locator('.modal-freshmen-welcome tbody tr').count(),8);
    await page.locator('#freshClose').click();assert.deepEqual(errors,[]);
  }finally{await context.close();await app.close();}
});
