const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { test, before, after } = require('node:test');
const { chromium } = require('playwright');
const {config:cloudConfig,backend:cloudBackend}=require('./cloud-fixture.cjs');

const repo = path.join(__dirname, '..');
const assets = ['index.html', 'sw.js', 'manifest.webmanifest', 'local-save.js', 'save-history.js', 'cloud-sync.js', 'cloud-config.json', 'CLOUD_SYNC_SETUP.md', 'firebase.database.rules.json', 'icons/apple-touch-icon.png',
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
  const legacyVersion=typeof legacy==='string'?legacy:'v1.91';
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const name = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!assets.includes(name)) { response.writeHead(404); response.end(); return; }
    let data = fs.readFileSync(path.join(repo, name));
    if(name==='cloud-config.json')data=Buffer.from(JSON.stringify(cloudDefaults));
    if (oldVersion && /\.(html|js|webmanifest)$/.test(name)) {
      data = Buffer.from(data.toString().replaceAll('v2.75', legacyVersion));
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
    close: () => server.listening?new Promise(resolve => server.close(resolve)):Promise.resolve(),
  };
}

function runtimeErrors(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'warning') errors.push(message.text()); });
  page.on('dialog', async dialog => { errors.push(dialog.message()); await dialog.dismiss(); });
  return errors;
}
test('tied individual and relay results, swim-off playback and saved places work on PC and iPhone',async()=>{
 const app=await fixture();
 try{for(const mobile of [false,true]){
  const context=await testContext(mobile?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{viewport:{width:1280,height:900}}),page=await context.newPage(),errors=runtimeErrors(page);
  try{
   await page.goto(app.url);await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy,null,{timeout:90000});
   const expected=await page.evaluate(()=>{
    const own=state.players.slice(0,8),cpu=state.world.slice(0,2),clocks=new Map([...own,...cpu].map((a,i)=>[a.id,{pre:[50,50,51,52,53,54,55,56,56,60][i],final:[48,49,49,50,51,52,53,54,55,60][i]}]));
    const oldBest=cpu.map(a=>a.bestTimes.fr100);cpu.forEach(a=>a.bestTimes.fr100=40);
    const original=simulateRace,originalCpu=simulateMeetRace;simulateRace=(a,e,c,r,t,preliminary)=>({total:clocks.get(a.id)[preliminary?'pre':'final']});simulateMeetRace=(a,e,m,r,preliminary)=>simulateRace(a,e,true,r,false,preliminary);
    const race=runEvent('japan_open','fr100',own.map(a=>a.id),{fr100:cpu.map(a=>a.id)});simulateRace=original;simulateMeetRace=originalCpu;cpu.forEach((a,i)=>a.bestTimes.fr100=oldBest[i]);
    const events=Object.fromEntries(EVENTS.map(e=>[e,e==='fr100'?race:{prelim:[],final:[],heats:[]} ])),result={meet:'japan_open',season:state.season,slot:state.slot,events,relays:[],teamScores:{}},manual={fr100:own.map(a=>a.id)};
    window.tieTestResult=result;const labels=buildMeetRaceQueue(result,manual).map(q=>q.label);playMeetSequence(result,manual,()=>showMeetResults(result,()=>{}));return{labels,id:own[2].id};
   });
   const races=await drainRaces(page);assert.equal(races.length,expected.labels.length);assert.ok(races.some(label=>label.includes('スイムオフ')));
   const finalRanks=await page.locator('#resBody').evaluate(el=>[...el.querySelectorAll('h3')].find(h=>h.textContent==='A決勝').nextElementSibling.querySelectorAll('tbody tr')?Array.from([...el.querySelectorAll('h3')].find(h=>h.textContent==='A決勝').nextElementSibling.querySelectorAll('tbody tr'),tr=>+tr.cells[0].textContent):[]);
   assert.deepEqual(finalRanks,[1,2,2,4,5,6,7,8]);assert.match(await page.locator('#resBody').innerText(),/決勝進出決定スイムオフ/);
   if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-tied-individual-${mobile?'iphone':'pc'}.png`)})}
   await page.locator('.modal-meet-results #x').click();
   await page.evaluate(()=>{
    const members=state.players.slice(0,4),cpu=state.world.slice(0,4),teams=[{organization:state.playerUniversity,members,race:{total:200,legs:[50,50,50,50]}},{organization:'他大学A',members:cpu,race:{total:200,legs:[50,50,50,50]}},{organization:'他大学B',members:cpu,race:{total:202,legs:[50,51,50,51]}}];
    showRaceGroupResult({event:'4x100fr',label:'同着決勝',rows:teams.map(t=>relayPlaybackRow(t,'4x100fr'))},()=>{});
   });
   assert.deepEqual(await page.locator('.modal-race-result tbody tr').evaluateAll(rows=>rows.map(tr=>+tr.cells[0].textContent)),[1,1,3]);
   if(process.env.SWIM_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-tied-relay-${mobile?'iphone':'pc'}.png`)});
   await page.locator('#nextGroup').click();
   const history=await page.evaluate(async id=>{migrateState();await saveLocal();await navigator.serviceWorker.ready;return JSON.stringify(state.players.find(a=>a.id===id).raceHistory)},expected.id);
   assert.ok(JSON.parse(history).some(h=>h.stage==='A決勝'&&h.rank===2));
   await context.setOffline(true);const response=await page.reload({waitUntil:'load'});assert.ok(response.fromServiceWorker());await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy);
   assert.equal(await page.evaluate(id=>JSON.stringify(state.players.find(a=>a.id===id).raceHistory),expected.id),history);assert.deepEqual(errors,[]);
  }finally{await context.close()}
 }}finally{await app.close()}
});

test('world selection accepts finalist teammates and CPU swimmers, compares every ability and PB, saves offline and runs the actual selected races',async()=>{
 const app=await fixture();
 try{for(const [label,options]of [['pc',{viewport:{width:1360,height:960}}],['iphone',{viewport:{width:844,height:390},isMobile:true,hasTouch:true}],['portrait',{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]]){
  const context=await testContext(options),page=await context.newPage(),errors=runtimeErrors(page);
  try{
   await page.goto(app.url);await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy,null,{timeout:90000});
   const setup=await page.evaluate(()=>{
    const own=state.players.slice(0,3),cpu=state.world.filter(a=>a.category==='university').slice(0,10),all=[...own,...cpu];
    all.forEach((a,i)=>{for(const k of STATS)a.stats[k]=i===0||i===3?188:175-i%5*2;for(const e of EVENTS)a.bestTimes[e]=Math.min(a.bestTimes[e]??Infinity,coherentCpuPB(a,e));restoreAthletePaceFromPB(a)});
    state.season=2026;state.slot=94;state.activeCompetitionSeason=2026;state.activeCompetitionSlot=94;
    const rows=(athletes,e,automatic)=>athletes.map((athlete,i)=>({athlete,source:own.includes(athlete)?'PLAYER':'CPU',race:{total:round2(dispatchStandard(e)+(i<automatic?-.3+i*.1:i+1))}}));
    const results=Object.fromEntries(EVENTS.map(e=>[e,{final:[]}]));
    results.fr100.final=rows([own[0],cpu[0],cpu[1],cpu[2],cpu[3],cpu[4],own[1],own[2]],'fr100',2);
    results.fr200.final=rows([cpu[0],cpu[1],cpu[2],cpu[3],cpu[4],own[1],own[2],cpu[5]],'fr200',1);
    results.ba100.final=rows([cpu[4],own[1],cpu[5],own[2],cpu[6],cpu[7],cpu[8],cpu[9]],'ba100',0);
    selectJapanTeam(results,2027);state.activeCompetitionSeason=null;state.activeCompetitionSlot=null;state.season=2027;state.slot=10;renderAll();
    return{own:own[1].id,cpu:cpu[4].id,auto:own[0].id,ownName:own[1].name,base:JSON.stringify([state.japanTeam.individual,state.japanTeam.relays]),stats:Object.fromEntries(TRAINING_DISPLAY_STATS.map(k=>[k,Math.round(displayStatValue(own[1],k))])),pbs:EVENTS.map(e=>fmt(own[1].bestTimes[e]))};
   });
   await page.locator('#nav [data-page="japan-team"]').click();await page.locator('#editJapanTeamSelection').click();await page.locator('.modal-world-additional').waitFor();
   assert.equal(await page.locator('select[data-world-event="fr100"]').count(),0);
   const select=(e,i=0)=>page.locator(`select[data-world-event="${e}"][data-world-slot="${i}"]`);
   assert.equal(await select('im400').locator(`option[value="${setup.own}"]`).count(),0);
   assert.ok(await select('ba100').locator(`option[value="${setup.own}"]`).count());assert.ok(await select('ba100').locator(`option[value="${setup.cpu}"]`).count());
   await select('ba100').selectOption(setup.own);await select('ba100',1).selectOption(setup.cpu);await select('im400').selectOption(setup.own);
   assert.equal(await select('ba100',1).locator(`option[value="${setup.own}"]`).getAttribute('disabled'),'');
   await page.locator('[data-world-compare="ba100"]').click();await page.locator('#worldCompareAthlete').selectOption(setup.own);
   const profile=page.locator('#worldCandidateProfile');assert.equal(await profile.locator('[data-entry-stat]').count(),16);assert.equal(await profile.locator('[data-world-profile-pb]').count(),15);assert.match(await profile.innerText(),new RegExp(setup.ownName));assert.match(await profile.innerText(),/日本選手権 2位/);
   for(const [key,value]of Object.entries(setup.stats))assert.equal(Number(await profile.locator(`[data-entry-stat="${key}"] .entry-stat-value`).innerText()),value);
   assert.deepEqual(await profile.locator('[data-world-profile-pb] b').allTextContents(),setup.pbs);
   const geometry=await page.locator('.modal-world-additional').evaluate(m=>{const r=m.getBoundingClientRect(),b=m.querySelector('#confirmWorldAdditional').getBoundingClientRect();return{fits:r.left>=-1&&r.top>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,button:b.left>=-1&&b.right<=innerWidth+1&&b.bottom<=innerHeight+1,overflow:[...m.querySelectorAll('#worldCandidateProfile .entry-stat-row')].some(el=>el.scrollWidth>el.clientWidth+1)}});
   assert.ok(geometry.fits&&geometry.button&&!geometry.overflow,JSON.stringify(geometry));
   if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-world-selection-${label}.png`)})}
   await page.evaluate(()=>autoSaveNow());await page.reload();await page.waitForFunction(()=>state?.meetSession?.phase==='worldEntry'&&!localSaveBusy);await page.locator('.modal-world-additional').waitFor();
   assert.equal(await select('ba100').inputValue(),setup.own);assert.equal(await select('ba100',1).inputValue(),setup.cpu);assert.equal(await select('im400').inputValue(),setup.own);
   if(options.isMobile)await page.locator('#worldSelectionListTab').click();await page.locator('[data-world-inspect-event="fr100"][data-world-inspect="'+setup.auto+'"]').click();assert.match(await profile.innerText(),/派遣標準突破・自動選出/);
   await page.locator('#confirmWorldAdditional').click();assert.equal(await page.locator('.modal-world-additional').count(),0);
   assert.equal(await page.evaluate(()=>JSON.stringify([state.japanTeam.individual,state.japanTeam.relays])),setup.base);
   assert.equal(await page.locator(`[data-representative="${setup.own}"][data-event="ba100"]`).count(),1);assert.equal(await page.locator(`[data-representative="${setup.cpu}"][data-event="ba100"]`).count(),1);
   const saved=await page.evaluate(async()=>{await saveLocal();await navigator.serviceWorker.ready;return JSON.stringify([state.japanTeam.additionalIndividual,state.japanTeam.selectionFinalists,state.japanTeam.selectionCandidates])});
   await context.setOffline(true);const response=await page.reload({waitUntil:'load'});assert.ok(response.fromServiceWorker());await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy);
   assert.equal(await page.evaluate(()=>JSON.stringify([state.japanTeam.additionalIndividual,state.japanTeam.selectionFinalists,state.japanTeam.selectionCandidates])),saved);
   if(label==='pc'){
    await page.evaluate(()=>{state.slot=36;openMeetEntry('world_championship',36,2027)});assert.equal(await select('ba100').inputValue(),setup.own);await page.locator('#confirmWorldAdditional').click();await page.locator('#goRace').click();
    const races=await drainRaces(page);assert.ok(races.some(t=>/100mBa.*予選/.test(t)));assert.ok(races.some(t=>/400mIM.*予選/.test(t)));
    const recorded=await page.evaluate(({own,cpu})=>{const entry=state.japanTeamHistory.find(e=>e.year===2027);return{own:entry.results.individual.ba100.some(r=>r.athleteId===own&&r.prelim),cpu:entry.results.individual.ba100.some(r=>r.athleteId===cpu&&r.prelim),locked:!canEditWorldSelection(2027)}},setup);
    assert.ok(recorded.own&&recorded.cpu&&recorded.locked);
   }
   assert.deepEqual(errors,[]);
  }finally{await context.close()}
 }}finally{await app.close()}
});

test('rival details show only the four major individual podiums with grades, places and clocks and preserve them offline',async()=>{
 const app=await fixture();
 try{for(const mobile of [false,true]){
  const context=await testContext(mobile?{viewport:{width:844,height:390},isMobile:true,hasTouch:true}:{viewport:{width:1280,height:900}}),page=await context.newPage(),errors=runtimeErrors(page);
  try{
   await page.goto(app.url);await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy);
   const setup=await page.evaluate(()=>{
    const u=state.universities.find(u=>u.region==='kansai'),a=state.world.find(a=>a.category==='university'&&a.organization===u.name&&a.grade===3);
    a.accolades=[];for(const [i,meet]of RIVAL_PODIUM_MEETS.entries())recordAthleteMainResult(a,{season:2026,slot:30+i,meet,event:EVENTS[i],stage:'A決勝',rank:i%3+1,time:50+i});
    a.accolades.push({kind:'podium',season:2026,slot:36,meet:'world_championship',event:'im400',stage:'決勝',rank:1,time:250},{kind:'podium',season:2026,slot:30,meet:'intercollege',event:'4x100fr',stage:'決勝',rank:1,time:200});
    renderAll();return{id:a.id,university:u.id,rows:rivalMainResults(a),before:JSON.stringify(state)};
   });
   await page.locator('#nav [data-page="rivals"]').click();await page.locator('#rivalUniversity').selectOption(setup.university);await page.locator(`[data-rival-athlete="${setup.id}"]`).first().click();
   const section=page.locator('.modal-rival-player .rival-major-results');await section.scrollIntoViewIfNeeded();assert.match(await section.innerText(),/主な実績/);assert.equal(await section.locator('[data-rival-podium-meet]').count(),4);
   for(const r of setup.rows){const row=section.locator(`[data-rival-podium-meet="${r.meet}"]`);assert.equal(await row.getAttribute('data-rival-podium-rank'),String(r.rank));assert.equal(await row.locator('.major-result-time').innerText(),r.time.toFixed(2));assert.match(await row.locator('.grade-pill').innerText(),/大3/)}
   assert.doesNotMatch(await section.innerText(),/世界大会|リレー/);assert.equal(await page.evaluate(()=>JSON.stringify(state)),setup.before);
   if(process.env.SWIM_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-rival-podiums-${mobile?'iphone':'pc'}.png`)});
   await page.locator('.modal-rival-player #x').click();await page.evaluate(async()=>{await saveLocal();await navigator.serviceWorker.ready});await context.setOffline(true);await page.reload();await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy);
   await page.locator('#nav [data-page="rivals"]').click();await page.locator('#rivalUniversity').selectOption(setup.university);await page.locator(`[data-rival-athlete="${setup.id}"]`).first().click();assert.equal(await page.locator('.rival-major-results [data-rival-podium-meet]').count(),4);assert.deepEqual(errors,[]);
  }finally{await context.close()}
 }}finally{await app.close()}
});

test('admissions sort groups current universities in competition and free modes without changing results, choices or eight-member intake',async()=>{
 const app=await fixture();
 try{for(const mobile of [false,true]){
  const context=await testContext(mobile?{viewport:{width:844,height:390},isMobile:true,hasTouch:true}:{viewport:{width:1280,height:900}}),page=await context.newPage(),errors=runtimeErrors(page);
  try{
   await page.goto(app.url);await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy);
   const setup=await page.evaluate(()=>{
    const schools=state.universities.slice(0,3),fresh=schools.map(u=>state.world.filter(a=>a.category==='university'&&a.grade===1&&a.organization===u.name)),leaders=[state.players[0],...fresh[1].slice(0,3),...fresh[0].slice(0,3),state.players[1],...fresh[1].slice(3,5),...fresh[2].slice(0,2)];
    state.pendingCollegeAdmissions={fromSeason:2025,toSeason:2026,rows:leaders.map((a,i)=>({id:a.id,name:a.name,from:'出身高校',to:a.organization,own:state.players.includes(a),specialty:a.specialty,specialtyPB:a.bestTimes[a.specialty],rankedEvents:[{event:a.specialty,rank:i+1}]})),signedIds:[],confirmed:{},playerProfiles:{}};
    return{original:leaders.map(a=>a.id),own:state.playerUniversity,moving:leaders[2].id};
   });
   const order=()=>page.locator('.modal-college-admissions tbody [data-admission-id]').evaluateAll(rows=>rows.map(row=>row.dataset.admissionId));
   const verifyGroups=async()=>{
    const rows=await page.evaluate(()=>{const c=collegeAdmissionContext(),names=new Map(c.universities.map(u=>[u.id,u.name]));return [...document.querySelectorAll('.modal-college-admissions tbody [data-admission-id]')].map(row=>({id:row.dataset.admissionId,target:names.get(c.choices.get(row.dataset.admissionId))}))});
    const actual=rows.map(r=>r.target),expected=[...actual].sort((a,b)=>Number(b===setup.own)-Number(a===setup.own)||a.localeCompare(b,'ja'));assert.deepEqual(actual,expected);
    for(const school of new Set(actual)){const ids=rows.filter(r=>r.target===school).map(r=>r.id);assert.deepEqual(ids,setup.original.filter(id=>ids.includes(id)))}
   };
   for(const mode of ['competition','free']){
    const before=await page.evaluate(mode=>{state.scoutingAdmissionsMode=mode;showCollegeAdmissions();return JSON.stringify(state)},mode);
    assert.deepEqual(await order(),setup.original);await page.locator('#admissionsSort').selectOption('university');await verifyGroups();assert.equal(await page.evaluate(()=>JSON.stringify(state)),before);
    await page.locator('#admissionsSort').selectOption('ranking');assert.deepEqual(await order(),setup.original);await page.evaluate(()=>closeModal());
   }
   await page.evaluate(()=>showCollegeAdmissions());await page.locator('#admissionsSort').selectOption('university');await page.locator(`[data-admission-choice="${setup.moving}"]`).selectOption('player');await verifyGroups();
   assert.ok((await order()).indexOf(setup.moving)<3);const choices=await page.evaluate(()=>JSON.stringify(state.pendingCollegeAdmissions.choices));
   await page.locator('#admissionsSort').selectOption('ranking');assert.deepEqual(await order(),setup.original);assert.equal(await page.evaluate(()=>JSON.stringify(state.pendingCollegeAdmissions.choices)),choices);
   await page.locator('#admissionsSort').selectOption('university');
   if(process.env.SWIM_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-admissions-sort-${mobile?'iphone':'pc'}.png`)});
   await page.locator('#admissionsClose').click();const result=await page.evaluate(id=>({own:state.players.filter(a=>a.year===1).length,moved:state.players.some(a=>a.id===id),counts:state.universities.map(u=>state.world.filter(a=>a.category==='university'&&a.grade===1&&a.organization===u.name).length)}),setup.moving);
   assert.equal(result.own,8);assert.ok(result.moved&&result.counts.every(n=>n===8));assert.deepEqual(errors,[]);
  }finally{await context.close()}
 }}finally{await app.close()}
});

test('admission destination edits and resets keep both scroll offsets in ranking and university order on PC and phones',async()=>{
 const app=await fixture();
 try{for(const options of [{viewport:{width:1280,height:900}},{viewport:{width:844,height:390},isMobile:true,hasTouch:true},{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]){
  const context=await testContext(options),page=await context.newPage(),errors=runtimeErrors(page);
  try{
   await page.goto(app.url);await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy);
   await page.evaluate(()=>{
    const leaders=[...state.players.filter(a=>a.year===1).slice(0,4),...state.universities.slice(0,10).flatMap(u=>state.world.filter(a=>a.category==='university'&&a.grade===1&&a.organization===u.name).slice(0,4))];
    state.scoutingAdmissionsMode='free';state.pendingCollegeAdmissions={fromSeason:state.season-1,toSeason:state.season,rows:leaders.map((a,i)=>({id:a.id,name:a.name,from:'出身高校',to:a.organization,own:state.players.includes(a),specialty:a.specialty,specialtyPB:a.bestTimes[a.specialty],rankedEvents:[{event:a.specialty,rank:i+1}]})),signedIds:[],playerProfiles:{}};
    showCollegeAdmissions();
   });
   const wrap=page.locator('.modal-college-admissions > .table-wrap');
   const offsets=()=>wrap.evaluate(el=>({top:el.scrollTop,left:el.scrollLeft}));
   const settled=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const assertPosition=async before=>{await settled();const after=await offsets();assert.ok(Math.abs(after.top-before.top)<=1&&Math.abs(after.left-before.left)<=1,JSON.stringify({viewport:options.viewport,before,after}))};
   for(const mode of ['ranking','university']){
    await page.locator('#admissionsSort').selectOption(mode);
    await wrap.evaluate(el=>{el.scrollTop=(el.scrollHeight-el.clientHeight)*.55;el.scrollLeft=el.scrollWidth-el.clientWidth});
    const choice=await wrap.evaluate(el=>{
     const bounds=el.getBoundingClientRect(),select=[...el.querySelectorAll('[data-admission-choice]')].find(select=>{const r=select.getBoundingClientRect();return r.top>bounds.top+40&&r.bottom<bounds.bottom-10&&r.left>=bounds.left&&r.right<=bounds.right});
     if(!select)throw new Error('No visible destination selector');
     const c=collegeAdmissionContext(),target=c.universities.find(u=>u.id!==select.value&&c.counts.get(u.id)<8);
     return{id:select.dataset.admissionChoice,target:target.id,original:select.value};
    });
    const selector=page.locator(`[data-admission-choice="${choice.id}"]`);await selector.focus();
    const before=await offsets();assert.ok(before.top>0);
    await selector.selectOption(choice.target);await assertPosition(before);
    assert.ok(await selector.evaluate(el=>document.activeElement===el),'Editing keeps focus on the selected swimmer');
    assert.equal(await page.evaluate(id=>collegeAdmissionContext().choices.get(id),choice.id),choice.target);
    // The reset button stays outside the scrolling table.
    await page.locator('#admissionsReset').click();await assertPosition(before);
    assert.equal(await page.evaluate(id=>collegeAdmissionContext().choices.get(id),choice.id),choice.original);
   }
   assert.deepEqual(errors,[]);
  }finally{await context.close()}
 }}finally{await app.close()}
});

test('scouting competition contacts, rival details, free admission editing and saved negotiations work on PC and iPhone offline',async()=>{
 const app=await fixture();
 try{for(const mobile of [false,true]){
  const context=await testContext(mobile?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{viewport:{width:1280,height:900}}),page=await context.newPage(),errors=[],dialogs=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss()});
  try{
   await page.goto(app.url);await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&state.players.length===32&&!localSaveBusy,null,{timeout:90000});
   const setup=await page.evaluate(()=>{state.points=100;renderAll();const a=refreshScoutBoard().find(a=>scoutingRecord(a.id).cpuTargets.length);return{id:a.id,name:a.name,rng:state.rngSeed,stats:JSON.stringify(activeAthletes().map(a=>[a.id,a.stats,a.bestTimes]))}});
   await page.locator('#nav [data-page="scout"]').click();assert.equal(await page.locator('#scoutingAdmissionsMode').inputValue(),'competition');
   let row=page.locator(`[data-scout-row="${setup.id}"]`);await row.locator('[data-scout]').click();assert.match(dialogs.pop(),/に接触しました/);assert.equal(await page.evaluate(()=>state.points),95);assert.equal(await row.locator('[data-scout]').isDisabled(),true);
   await row.locator('[data-scout-offer]').click();assert.match(dialogs.pop(),/内定を打診/);assert.match(await row.textContent(),/内定打診中/);
   await page.evaluate(id=>{const r=scoutingRecord(id);scoutingContact(id,r.cpuTargets[0]);renderAll()},setup.id);
   row=page.locator(`[data-scout-row="${setup.id}"]`);await row.locator('[data-scout-detail]').last().click();const modal=page.locator('.modal-scout-competition');await modal.waitFor();assert.equal(await modal.locator('tbody tr').count(),2);assert.match(await modal.textContent(),/志望度/);assert.match(await modal.textContent(),/80と70なら約60％対40％/);
   const modalBounds=await modal.evaluate(el=>({width:el.clientWidth,height:el.clientHeight}));assert.ok(modalBounds.width>200&&modalBounds.height>100);
   if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-scout-details-${mobile?'iphone':'pc'}.png`)})}
   await modal.locator('#scoutDetailClose').click();await page.locator('#scoutingAdmissionsMode').selectOption('free');
   await page.evaluate(()=>{state.slot=8;advanceSlot();renderAll()});row=page.locator(`[data-scout-row="${setup.id}"]`);assert.equal(await row.locator('[data-scout]').isDisabled(),false);await row.locator('[data-scout]').click();assert.match(dialogs.pop(),/に接触しました/);assert.equal(await page.evaluate(()=>state.points),90);
   const crowded=await page.evaluate(()=>{for(const slot of [16,24,32])processScoutingMonth(slot);renderAll();const a=refreshScoutBoard().find(a=>scoutingCompetitionRows(a.id).filter(u=>u.id!=='player').length>=4);return{id:a.id,count:scoutingCompetitionRows(a.id).length}});
   await page.locator(`[data-scout-row="${crowded.id}"] [data-scout-detail]`).last().click();await page.locator('.modal-scout-competition').waitFor();assert.equal(await page.locator('.modal-scout-competition tbody tr').count(),crowded.count);assert.ok(crowded.count>=5);
   if(process.env.SWIM_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-scout-many-rivals-${mobile?'iphone':'pc'}.png`)});
   await page.locator('#scoutDetailClose').click();
   const saved=await page.evaluate(async()=>{await saveLocal();await navigator.serviceWorker.ready;return JSON.stringify(state.scoutingCompetition)});
   const protectedData=await page.evaluate(()=>({rng:state.rngSeed,stats:JSON.stringify(activeAthletes().map(a=>[a.id,a.stats,a.bestTimes]))}));assert.equal(protectedData.rng,setup.rng);assert.equal(protectedData.stats,setup.stats);
   if(process.env.SWIM_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-scout-board-${mobile?'iphone':'pc'}.png`)});
   await context.setOffline(true);const response=await page.reload({waitUntil:'load'});assert.ok(response.fromServiceWorker());await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy);
   assert.equal(await page.evaluate(()=>JSON.stringify(state.scoutingCompetition)),saved);assert.equal(await page.evaluate(()=>state.scoutingAdmissionsMode),'free');
   await page.evaluate(()=>{closeModal();newSeason();showCollegeAdmissions()});await page.locator('.modal-college-admissions').waitFor();
   const move=await page.evaluate(()=>{const c=collegeAdmissionContext(),row=c.notice.rows.find(r=>!r.own),target=c.universities.find(u=>u.id!==c.defaults.get(row.id)&&c.counts.get(u.id)<8);return{id:row.id,target:target.id}});
   await page.locator(`[data-admission-choice="${move.id}"]`).selectOption(move.target);await page.locator('#admissionsClose').click();
   const actual=await page.evaluate(({id,target})=>{const school=scoutingSchools().find(u=>u.id===target),a=activeAthletes().find(a=>a.id===id);return{moved:a.organization===school.name,own:state.players.filter(a=>a.year===1).length,counts:state.universities.map(u=>state.world.filter(a=>a.category==='university'&&a.grade===1&&a.organization===u.name).length)}},move);
   assert.ok(actual.moved);assert.equal(actual.own,8);assert.ok(actual.counts.every(n=>n===8));assert.deepEqual(errors,[]);assert.deepEqual(dialogs,[]);
  }finally{await context.close()}
 }}finally{await app.close()}
});

test('college multi-event practice runs through real training controls and preserves bounded growth, PBs and saves offline on PC and phones',async()=>{
 const app=await fixture();
 try{for(const options of [{viewport:{width:1280,height:900}},{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]){
  const context=await testContext(options),page=await context.newPage(),errors=runtimeErrors(page);
  try{
   await page.goto(app.url);await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy,null,{timeout:90000});
   const initial=await page.evaluate(()=>{
    const plan=cpuCollegeTrainingPlan(),seed=state.rngSeed;let selected;
    for(const a of state.world.filter(a=>a.category==='university')){
     const events=plan.get(a.id),main=strokeForEvent(a.specialty);
     for(const e of events){
      const stroke=strokeForEvent(e);if(stroke==='im'||main==='im'||stroke===main)continue;
      const probe=attachMedleyStats(deepClone(a));state.rngSeed=seed;applyCpuTraining(probe,events);
      const key=stroke+'_speed';if(probe.stats[key]>a.stats[key]){selected={id:a.id,key,before:a.stats[key],event:e,pb:JSON.stringify(a.bestTimes),goals:[...a.cpuDevelopment.goals],floors:[...a.cpuDevelopment.floors]};break}
     }
     if(selected)break;
    }
    state.rngSeed=seed;if(!selected)throw new Error('No college athlete with secondary practice room');
    window.collegeTrainingCalls=[];window.collegeOriginalTraining=applyCpuTraining;
    applyCpuTraining=(a,events)=>{if(a.id===selected.id)window.collegeTrainingCalls.push([...events]);window.collegeOriginalTraining(a,events)};
    return selected;
   });
   for(let turn=0;turn<6;turn++){await page.locator('#advanceBtn').click();await page.locator('.modal-training-result').waitFor();await page.locator('.modal-training-result #next').click()}
   const actual=await page.evaluate(initial=>{
    applyCpuTraining=window.collegeOriginalTraining;delete window.collegeOriginalTraining;
    const a=state.world.find(a=>a.id===initial.id),calls=window.collegeTrainingCalls;delete window.collegeTrainingCalls;
    return{slot:state.slot,value:a.stats[initial.key],pb:JSON.stringify(a.bestTimes),goals:a.cpuDevelopment.goals,floors:a.cpuDevelopment.floors,calls,within:EVENTS.every((e,i)=>expectedTime(a,e)>=initial.floors[i]-.006)&&STATS.every((k,i)=>a.stats[k]<=initial.goals[i]+.005)};
   },initial);
   assert.equal(actual.slot,7);assert.ok(actual.value>initial.before&&actual.within);assert.equal(actual.pb,initial.pb);
   assert.deepEqual(actual.goals,initial.goals);assert.deepEqual(actual.floors,initial.floors);assert.equal(actual.calls.length,6);assert.ok(actual.calls.every(events=>events.includes(initial.event)));
   const saved=await page.evaluate(async id=>{await saveLocal();await navigator.serviceWorker.ready;return JSON.stringify(state.world.find(a=>a.id===id))},initial.id);
   await context.setOffline(true);const response=await page.reload();assert.ok(response.fromServiceWorker());await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy);
   assert.equal(await page.evaluate(id=>JSON.stringify(state.world.find(a=>a.id===id)),initial.id),saved);assert.deepEqual(errors,[]);
  }finally{await context.close()}
 }}finally{await app.close()}
});

test('adult growth and plateau follow real training turns and preserve personal ceilings and PBs offline on PC and iPhone',async()=>{
 const app=await fixture();
 try{for(const mobile of [false,true]){
  const context=await testContext(mobile?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{viewport:{width:1280,height:900}}),page=await context.newPage(),errors=runtimeErrors(page);
  try{
   await page.goto(app.url);await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy,null,{timeout:90000});
   const initial=await page.evaluate(()=>{
    state.slot=1;const adults=[23,24,25].map(age=>state.world.find(a=>a.category==='adult'&&a.age===age&&a.adultGrowth.rate>0)),students=['high','university'].map(category=>state.world.find(a=>a.category===category));
    const plateau=state.world.find(a=>a.category==='adult'&&a.age<26&&a.adultGrowth.rate===0);
    for(const a of adults)a.adultGrowth.rate=.8;
    const index=STATS.indexOf('mental');
    for(const a of [...adults,plateau,...students]){a.stats.mental=100;a.growthProfile={1:1,2:1,3:1,4:1};ensureCpuDevelopment(a);a.cpuDevelopment.goals[index]=200;a.cpuDevelopment.carry[index]=0}
    window.adultTestRng=rng;rng=()=>.5;renderAll();
    return{adults:adults.map(a=>({id:a.id,age:a.age,pb:JSON.stringify(a.bestTimes)})),students:students.map(a=>a.id),plateau:{id:plateau.id,data:JSON.stringify(plateau)}};
   });
   for(let turn=0;turn<6;turn++){await page.locator('#advanceBtn').click();await page.locator('.modal-training-result').waitFor();await page.locator('.modal-training-result #next').click()}
   const actual=await page.evaluate(({adults,students})=>{
    rng=window.adultTestRng;delete window.adultTestRng;
    return{slot:state.slot,adults:adults.map(({id})=>{const a=state.world.find(a=>a.id===id);return{value:a.stats.mental,pb:JSON.stringify(a.bestTimes),goal:a.cpuDevelopment.goals[STATS.indexOf('mental')],carry:a.cpuDevelopment.carry[STATS.indexOf('mental')]}}),students:students.map(id=>state.world.find(a=>a.id===id).stats.mental)};
   },initial);
   assert.equal(actual.slot,7);assert.ok(actual.adults[0].value>actual.adults[1].value&&actual.adults[1].value>actual.adults[2].value);
   for(const [i,a]of actual.adults.entries()){assert.ok(a.value>=100&&a.value<100.1);assert.equal(a.pb,initial.adults[i].pb);assert.equal(a.goal,200);assert.ok(a.carry>0&&a.carry<.01)}
   assert.ok(actual.students.every(v=>v>101));
   assert.equal(await page.evaluate(id=>JSON.stringify(state.world.find(a=>a.id===id)),initial.plateau.id),initial.plateau.data);
   const ids=[...initial.adults.map(a=>a.id),initial.plateau.id];
   const saved=await page.evaluate(async ids=>{await saveLocal();await navigator.serviceWorker.ready;return JSON.stringify(ids.map(id=>state.world.find(a=>a.id===id)))},ids);
   await context.setOffline(true);const response=await page.reload({waitUntil:'load'});assert.ok(response.fromServiceWorker());await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy);
   assert.equal(await page.evaluate(ids=>JSON.stringify(ids.map(id=>state.world.find(a=>a.id===id))),ids),saved);assert.deepEqual(errors,[]);
  }finally{await context.close()}
 }}finally{await app.close()}
});

test('v2.75 PWA update adds adult growth controls without changing earned abilities or PBs and restores them offline',async()=>{
 const app=await fixture('v2.39'),context=await testContext({viewport:{width:1280,height:900}});
 const protectedDigest=async()=>{
  const data=JSON.stringify([state.players,state.world.map(a=>[a.id,a.stats,a.bestTimes,a.raceHistory,a.accolades]),state.recordRankings,state.teamTop10,state.trainingFocus,state.rngSeed]);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data)))].map(v=>v.toString(16).padStart(2,'0')).join('');
 };
 try{
  const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);
  await page.waitForFunction(()=>state?.version==='pwa-v2.39'&&!localSaveBusy,null,{timeout:90000});
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;for(const a of state.world.filter(a=>a.category==='adult')){delete a.adultGrowth;delete a.cpuDevelopment.adultGrowthVersion}await saveLocal()});
  const before=await page.evaluate(protectedDigest);
  app.upgrade();await page.evaluate(async()=>await(await navigator.serviceWorker.getRegistration()).update());
  await page.waitForFunction(async()=>{const names=await caches.keys();return names.includes('swim-manager-pwa-v2.75')&&!names.includes('swim-manager-pwa-v2.39')});
  await page.reload();await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy,null,{timeout:90000});
  assert.equal(await page.evaluate(protectedDigest),before);
  assert.ok(await page.evaluate(()=>state.world.filter(a=>a.category==='adult').every(a=>a.adultGrowth?.version===1&&a.cpuDevelopment.adultGrowthVersion===1)));
  const profiles=await page.evaluate(()=>JSON.stringify(state.world.filter(a=>a.category==='adult').map(a=>a.adultGrowth)));
  await page.evaluate(async()=>{await saveLocal();await navigator.serviceWorker.ready});await context.setOffline(true);
  const response=await page.reload();assert.ok(response.fromServiceWorker());await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy);
  assert.equal(await page.evaluate(protectedDigest),before);
  assert.equal(await page.evaluate(()=>JSON.stringify(state.world.filter(a=>a.category==='adult').map(a=>a.adultGrowth))),profiles);
  assert.deepEqual(errors,[]);
 }finally{await context.close();await app.close()}
});

test('overall-ranked national CPU entries and PB top-five preliminary delays survive real heats, owned race playback and offline saves on PC and iPhone',async()=>{
 const app=await fixture();
 try{for(const mobile of [false,true]){
  const context=await testContext(mobile?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{viewport:{width:1280,height:900}}),page=await context.newPage(),errors=runtimeErrors(page);
  try{
   await page.goto(app.url);await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy,null,{timeout:90000});
   for(const [meet,slot]of [['japan_open',66],['japan_championship',94]]){
    const expected=await page.evaluate(({meet,slot})=>{
     closeModal();state.slot=slot;state.activeCompetitionSlot=slot;state.activeCompetitionSeason=state.season;
     const own=state.players[0];own.stats=Object.fromEntries(STATS.map(k=>[k,185]));attachMedleyStats(own);own.bestTimes.fr100=Math.min(own.bestTimes.fr100??Infinity,round2(expectedTime(own,'fr100')));
     const before=JSON.stringify(state),frozen=buildCpuNationalEntries(meet),stable=before===JSON.stringify(state),manual=Object.fromEntries(EVENTS.map(e=>[e,e==='fr100'?[own.id]:[]]));
     const clocks=Object.fromEntries(EVENTS.map(e=>[e,ranking(e,'all',Infinity).map(a=>a.bestTimes[e])])),errors=[];
     const counts={},ages=new Set();
     for(const a of state.world)if(allowedCpu(a,meet)){
      const selected=EVENTS.filter(e=>frozen[e].includes(a.id));
      const preferred=EVENTS.filter(e=>qualified(a,meet,e)).sort((x,y)=>clocks[x].indexOf(a.bestTimes[x])-clocks[y].indexOf(a.bestTimes[y])||Number(y===a.specialty)-Number(x===a.specialty)||EVENTS.indexOf(x)-EVENTS.indexOf(y)).slice(0,5);
      if(JSON.stringify([...selected].sort())!==JSON.stringify([...preferred].sort()))errors.push(a.id);
      if(selected.length){counts[a.id]=selected.length;ages.add(a.category)}
     }
     const actual=buildCpuNationalEntries;let builds=0;buildCpuNationalEntries=m=>{builds++;return actual(m)};
     const result=executeMeet(meet,manual,{});buildCpuNationalEntries=actual;
     const delayErrors=[];
     for(const e of EVENTS){
      const race=result.events[e];
      const eligible=[...race.prelim].filter(r=>Number.isFinite(r.entryPB)&&r.entryPB>0).sort((a,b)=>Math.round(a.entryPB*100)-Math.round(b.entryPB*100)||a.athlete.id.localeCompare(b.athlete.id)).slice(0,5).map(r=>r.athlete.id);
      for(const row of race.prelim)if((row.race.physics.preliminaryProbability>0)!==eligible.includes(row.athlete.id)||(!eligible.includes(row.athlete.id)&&row.race.physics.preliminaryDelay!==0))delayErrors.push(e+':'+row.athlete.id);
      if(race.final.some(r=>r.race.physics.preliminaryDelay)||(race.swimOffs||[]).flat().some(r=>r.race.physics.preliminaryDelay))delayErrors.push(e+':later-stage');
     }
     const lost=EVENTS.filter(e=>JSON.stringify(result.events[e].prelim.filter(r=>r.source==='CPU').map(r=>r.athlete.id).sort())!==JSON.stringify([...frozen[e]].sort()));
     const labels=buildMeetRaceQueue(result,manual).map(q=>q.label);playMeetSequence(result,manual,()=>showMeetResults(result,()=>{}));
     state.activeCompetitionSlot=null;state.activeCompetitionSeason=null;
     return{stable,errors,lost,delayErrors,counts:Object.values(counts),ages:[...ages],builds,labels,name:own.name,relays:result.relays.length};
    },{meet,slot});
    assert.ok(expected.stable&&expected.counts.length>0&&expected.counts.every(n=>n<=5));assert.deepEqual(expected.errors,[]);assert.deepEqual(expected.lost,[]);assert.deepEqual(expected.delayErrors,[]);assert.equal(expected.builds,1);assert.equal(expected.relays,0);
    assert.ok(expected.ages.includes('high')&&expected.ages.includes('university')&&expected.ages.includes('adult'));
    const races=await drainRaces(page);assert.equal(races.length,expected.labels.length);assert.ok(races.length>=1);for(const [i,title]of races.entries())assert.ok(title.includes(expected.labels[i]));
    await page.locator('#resEv').selectOption('fr100');assert.ok((await page.locator('#resBody').innerText()).includes(expected.name));
    if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-${meet}-overall-rank-${mobile?'iphone':'pc'}.png`)})}
    await page.locator('.modal-meet-results #x').click();
   }
   await page.evaluate(()=>showMeetFormRanges());assert.match(await page.locator('#modalRoot').innerText(),/PB上位5名/);await page.locator('#closeFormRanges').click();
   const saved=await page.evaluate(async()=>{await saveLocal();await navigator.serviceWorker.ready;return JSON.stringify([state.players,state.world,state.trainingFocus,state.recordRankings])});
   await context.setOffline(true);const response=await page.reload({waitUntil:'load'});assert.ok(response.fromServiceWorker());await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy);
   assert.equal(await page.evaluate(()=>JSON.stringify([state.players,state.world,state.trainingFocus,state.recordRankings])),saved);assert.deepEqual(errors,[]);
  }finally{await context.close()}
 }}finally{await app.close()}
});

test('rank-prioritized college CPU entries survive actual heats, owned race playback and offline saves on PC and iPhone',async()=>{
 const app=await fixture();
 try{for(const mobile of [false,true]){
  const context=await testContext(mobile?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{viewport:{width:1280,height:900}}),page=await context.newPage(),errors=runtimeErrors(page);
  try{
   await page.goto(app.url);await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy,null,{timeout:90000});
   for(const [meet,slot]of [['kansai_college',30],['intercollege',42]]){
    const expected=await page.evaluate(({meet,slot})=>{
     closeModal();state.slot=slot;state.activeCompetitionSlot=slot;state.activeCompetitionSeason=state.season;
     const own=state.players[0];own.stats=Object.fromEntries(STATS.map(k=>[k,185]));attachMedleyStats(own);own.bestTimes.fr100=round2(expectedTime(own,'fr100'));
     const before=JSON.stringify(state),frozen=buildCpuCollegeEntries(meet),stable=before===JSON.stringify(state),manual=Object.fromEntries(EVENTS.map(e=>[e,e==='fr100'?[own.id]:[]]));
     const result=executeMeet(meet,manual,{}),counts={},lost=[];
     for(const e of SPECIALTY_EVENTS){const actual=result.events[e].prelim.filter(r=>r.source==='CPU').map(r=>r.athlete.id).sort();if(JSON.stringify(actual)!==JSON.stringify([...frozen[e]].sort()))lost.push(e);for(const id of actual)counts[id]=(counts[id]||0)+1}
     const labels=buildMeetRaceQueue(result,manual).map(q=>q.label);playMeetSequence(result,manual,()=>showMeetResults(result,()=>{}));
     state.activeCompetitionSlot=null;state.activeCompetitionSeason=null;
     return{stable,lost,counts:Object.values(counts),labels,name:own.name};
    },{meet,slot});
    assert.ok(expected.stable&&expected.counts.length>0&&expected.counts.every(n=>n<=3));assert.deepEqual(expected.lost,[]);
    const races=await drainRaces(page);assert.equal(races.length,expected.labels.length);assert.ok(races.length>=1);for(const [i,title]of races.entries())assert.ok(title.includes(expected.labels[i]));
    await page.locator('#resEv').selectOption('fr100');assert.ok((await page.locator('#resBody').innerText()).includes(expected.name));
    if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-${meet}-rank-entries-${mobile?'iphone':'pc'}.png`)})}
    await page.locator('.modal-meet-results #x').click();
   }
   const saved=await page.evaluate(async()=>{await saveLocal();await navigator.serviceWorker.ready;return JSON.stringify([state.players,state.world,state.trainingFocus,state.recordRankings])});
   await context.setOffline(true);const response=await page.reload({waitUntil:'load'});assert.ok(response.fromServiceWorker());await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy);
   assert.equal(await page.evaluate(()=>JSON.stringify([state.players,state.world,state.trainingFocus,state.recordRankings])),saved);assert.deepEqual(errors,[]);
  }finally{await context.close()}
 }}finally{await app.close()}
});

test('own event depth shows five recorded PB leaders, opens details, preserves sorting and restores saves offline on PC and iPhone',async()=>{
 const app=await fixture();
 try{for(const mobile of [false,true]){
  const context=await testContext(mobile?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{viewport:{width:1280,height:900}}),page=await context.newPage(),errors=runtimeErrors(page);
  try{
   await page.goto(app.url);await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&state.players.length===32&&!localSaveBusy,null,{timeout:90000});
   const expected=await page.evaluate(()=>{
    state.players.slice(0,8).forEach((a,i)=>{a.bestTimes.fr100=55+(7-i)*.2;a.bestTimes.ba50=28+i*.1});
    renderAll();window.depthProtected=JSON.stringify(state);
    window.depthExpected=Object.fromEntries(EVENTS.map(event=>[event,state.players.filter(a=>!a.retired&&Number.isFinite(a.bestTimes[event])&&a.bestTimes[event]>0).sort((a,b)=>a.bestTimes[event]-b.bestTimes[event]||a.year-b.year||a.name.localeCompare(b.name,'ja')||a.id.localeCompare(b.id)).slice(0,5).map(a=>({id:a.id,pb:fmt(a.bestTimes[event]),year:a.year+'年'}))]));return depthExpected;
   });
   await page.locator('#nav [data-page="roster"]').click();await page.locator('#rosterSortMode').selectOption('event_br100');
   await page.locator('[data-roster-view="events"]').click();assert.equal(await page.locator('[data-roster-view="events"]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('#rosterSortControl').isVisible(),false);assert.equal(await page.locator('#rosterRankLegend').isVisible(),false);assert.equal(await page.locator('[data-roster-event]').count(),15);
   for(const [event,leaders]of Object.entries(expected)){
    const row=page.locator(`[data-roster-event="${event}"]`);assert.equal(await row.locator('td').count(),5);assert.deepEqual(await row.locator('[data-roster-athlete]').evaluateAll(nodes=>nodes.map(n=>n.dataset.rosterAthlete)),leaders.map(a=>a.id));assert.deepEqual(await row.locator('td>.pb-with-standard>b').allTextContents(),leaders.map(a=>a.pb));assert.deepEqual(await row.locator('.grade-pill').allTextContents(),leaders.map(a=>a.year));
   }
   const selected=expected.fr100[4];await page.locator(`[data-roster-event="fr100"] [data-roster-athlete="${selected.id}"]`).click();const modal=page.locator('.modal-player-detail');await modal.waitFor();assert.equal(await modal.locator('[data-stat]').count(),16);assert.equal(await modal.locator('#detailSpecialtyBtn').count(),1);await modal.locator('#x').click();assert.equal(await page.locator('[data-roster-view="events"]').getAttribute('aria-pressed'),'true');
   const bounds=await page.locator('#rosterTable').evaluate(el=>({width:el.clientWidth,page:document.getElementById('page-roster').clientWidth}));assert.ok(bounds.width<=bounds.page);
   if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.locator('#rosterTable').evaluate(el=>el.scrollLeft=0);await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-own-event-depth-${mobile?'iphone':'pc'}.png`)})}
   await page.locator('[data-roster-view="roster"]').click();assert.equal(await page.locator('#rosterSortMode').inputValue(),'event_br100');assert.ok(await page.locator('#rosterSortControl').isVisible());
   await page.locator('[data-roster-view="events"]').click();await page.locator('#nav [data-page="home"]').click();await page.locator('#nav [data-page="roster"]').click();assert.equal(await page.locator('[data-roster-event]').count(),15);assert.ok(await page.evaluate(()=>depthProtected===JSON.stringify(state)));
   const changed=await page.evaluate(()=>{const a=state.players[0];a.bestTimes.fr100=49.33;renderAll();return a.id});assert.equal(await page.locator('[data-roster-event="fr100"] [data-roster-athlete]').first().getAttribute('data-roster-athlete'),changed);assert.equal(await page.locator('[data-roster-event="fr100"] td>.pb-with-standard>b').first().innerText(),'49.33');
   const starts=await page.evaluate(async()=>{window.currentStarts=JSON.stringify([...state.players,...state.world].map(a=>[a.id,a.stats.start]));await saveLocal();await navigator.serviceWorker.ready;return currentStarts});
   await context.setOffline(true);const response=await page.reload({waitUntil:'load'});assert.ok(response.fromServiceWorker());await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy);assert.equal(await page.evaluate(()=>JSON.stringify([...state.players,...state.world].map(a=>[a.id,a.stats.start]))),starts);
   await page.locator('#nav [data-page="roster"]').click();await page.locator('[data-roster-view="events"]').click();assert.equal(await page.locator('[data-roster-event="fr100"] [data-roster-athlete]').first().getAttribute('data-roster-athlete'),changed);assert.deepEqual(errors,[]);
  }finally{await context.close()}
 }}finally{await app.close()}
});
test('rival university page shows actual rosters, PB depth, readonly details and relay starters without changing saves on PC and iPhone',async()=>{
 const app=await fixture();
 try{for(const mobile of [false,true]){
  const context=await testContext(mobile?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{viewport:{width:1280,height:900}}),page=await context.newPage(),errors=runtimeErrors(page);
  try{
   await page.goto(app.url);await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&state.players.length===32&&!localSaveBusy,null,{timeout:90000});
   const initial=await page.evaluate(()=>{
    window.rivalProtected=JSON.stringify(state);
    const u=state.universities.find(u=>u.region==='kansai');return{id:u.id,name:u.name,total:state.universities.length,regional:state.universities.filter(u=>u.region==='kansai').length,own:state.playerUniversity};
   });
   const nav=page.locator('#nav [data-page="rivals"]');await nav.click();assert.equal(await nav.getAttribute('aria-current'),'page');assert.equal(await nav.evaluate(b=>getComputedStyle(b).whiteSpace),'nowrap');assert.equal(await page.locator('#rivalUniversity option').count(),initial.total);assert.ok(!(await page.locator('#rivalUniversity option').allTextContents()).some(name=>name.startsWith(initial.own+'（')));
   await page.locator('#rivalRegion').selectOption('kansai');assert.equal(await page.locator('#rivalUniversity option').count(),initial.regional);await page.locator('#rivalUniversity').selectOption(initial.id);
   const expected=await page.evaluate(id=>{
    const university=state.universities.find(u=>u.id===id),roster=state.world.filter(a=>!a.retired&&a.category==='university'&&a.organization===university.name);
    return{count:roster.length,sorted:[...roster].sort((a,b)=>(a.bestTimes.fr100??Infinity)-(b.bestTimes.fr100??Infinity)||a.grade-b.grade||SPECIALTY_EVENTS.indexOf(a.specialty)-SPECIALTY_EVENTS.indexOf(b.specialty)||(a.bestTimes[a.specialty]??Infinity)-(b.bestTimes[b.specialty]??Infinity)||a.name.localeCompare(b.name,'ja')).map(a=>a.id),leaders:[...roster].filter(a=>validRaceTime(a.bestTimes.fr100)).sort((a,b)=>a.bestTimes.fr100-b.bestTimes.fr100||a.grade-b.grade||a.name.localeCompare(b.name,'ja')).slice(0,3).map(a=>a.id),relays:RELAYS.map(kind=>{const members=bestRelayMembers(roster,kind);return{kind,ids:members.map(a=>a.id),total:fmt(members.reduce((sum,a,i)=>sum+round2(relayMemberSeedTime(a,relayLegEvent(kind,i))),0))}})};
   },initial.id);
   assert.equal(await page.locator('#rivalContent [data-rival-row]').count(),expected.count);assert.match(await page.locator('#rivalSummary').innerText(),new RegExp(initial.name));
   await page.locator('#rivalEvent').selectOption('fr100');assert.deepEqual(await page.locator('[data-rival-row]').evaluateAll(rows=>rows.map(r=>r.dataset.rivalRow)),expected.sorted);
   const id=expected.sorted[0],athlete=await page.evaluate(id=>{const a=state.world.find(a=>a.id===id);return{name:a.name,stats:DETAIL_STATS.map(k=>Math.round(displayStatValue(a,k))),pbs:EVENTS.map(e=>validRaceTime(a.bestTimes[e])?fmt(a.bestTimes[e]):'未計測')}},id);
   await page.locator(`[data-rival-row="${id}"] [data-rival-athlete]`).click();const modal=page.locator('.modal-rival-player');await modal.waitFor();assert.match(await modal.locator('h2').innerText(),new RegExp(athlete.name));assert.deepEqual((await modal.locator('[data-stat] .stat-number').allTextContents()).map(Number),athlete.stats);assert.deepEqual(await modal.locator('[data-rival-pb] b').allTextContents(),athlete.pbs);assert.equal(await modal.locator('[data-detail-focus],#detailSpecialtyBtn').count(),0);
   const bounds=await modal.boundingBox();assert.ok(bounds.width<=(mobile?390:1280)+1&&bounds.height<=(mobile?844:900)+1);
   if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-rival-detail-${mobile?'iphone':'pc'}.png`)});}
   await modal.locator('#x').click();assert.equal(await page.locator('#rivalUniversity').inputValue(),initial.id);assert.equal(await page.locator('#rivalEvent').inputValue(),'fr100');
   if(process.env.SWIM_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-rival-roster-${mobile?'iphone':'pc'}.png`)});
   await page.locator('[data-rival-view="events"]').click();assert.equal(await page.locator('[data-rival-event]').count(),15);assert.deepEqual(await page.locator('[data-rival-event="fr100"] [data-rival-athlete]').evaluateAll(nodes=>nodes.map(n=>n.dataset.rivalAthlete)),expected.leaders);assert.equal(await page.locator('#rivalEventControl').isVisible(),false);
   if(process.env.SWIM_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-rival-events-${mobile?'iphone':'pc'}.png`)});
   await page.locator('[data-rival-view="relays"]').click();assert.equal(await page.locator('[data-rival-relay]').count(),3);
   for(const relay of expected.relays){const card=page.locator(`[data-rival-relay="${relay.kind}"]`);assert.deepEqual(await card.locator('[data-rival-athlete]').evaluateAll(nodes=>nodes.map(n=>n.dataset.rivalAthlete)),relay.ids);assert.equal(await card.locator('.rival-relay-total b').innerText(),relay.total);}
   if(process.env.SWIM_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-rival-relays-${mobile?'iphone':'pc'}.png`)});
   await page.locator('[data-rival-relay="4x100medley"] [data-rival-athlete]').first().click();await page.locator('.modal-rival-player #x').click();
   await page.locator('#nav [data-page="home"]').click();await nav.click();assert.equal(await page.locator('#rivalUniversity').inputValue(),initial.id);assert.equal(await page.locator('[data-rival-view="relays"]').getAttribute('aria-pressed'),'true');
   assert.equal(await page.evaluate(()=>window.rivalProtected===JSON.stringify(state)),true,'viewing must not change any game data');
   await page.evaluate(async()=>{await saveLocal();await navigator.serviceWorker.ready});await context.setOffline(true);const response=await page.reload({waitUntil:'load'});assert.ok(response.fromServiceWorker());await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy);
   await nav.click();await page.locator('#rivalUniversity').selectOption(initial.id);assert.equal(await page.locator('[data-rival-row]').count(),expected.count);await page.locator('[data-rival-view="relays"]').click();assert.equal(await page.locator('[data-rival-relay="4x100fr"] .rival-relay-total b').innerText(),expected.relays[0].total);assert.deepEqual(errors,[]);
  }finally{await context.close()}
 }}finally{await app.close()}
});

test('category-ranked CPU specialties match recorded PB places, stay fixed within the year and survive April and offline PC/iPhone saves',async()=>{
 const app=await fixture();
 try{for(const mobile of [false,true]){
  const context=await testContext(mobile?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{viewport:{width:1280,height:900}}),page=await context.newPage(),errors=runtimeErrors(page);
  try{
   await page.goto(app.url);await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&state.players.length===32&&!localSaveBusy,null,{timeout:90000});
   const initial=await page.evaluate(()=>{
    window.checkRankedSpecialties=()=>{
     const errors=[],all=activeAthletes();
     for(const category of ['middle','high','university','adult']){
      const peers=all.filter(a=>!a.retired&&(state.players.includes(a)?category==='university':a.category===category));
      const fields=new Map(SPECIALTY_EVENTS.map(e=>[e,peers.map(a=>a.bestTimes?.[e]).filter(validRaceTime).sort((a,b)=>a-b)]));
      for(const a of state.world.filter(a=>!a.retired&&a.category===category)){
       const ranks=SPECIALTY_EVENTS.filter(e=>validRaceTime(a.bestTimes?.[e])).map(e=>{
        const clocks=fields.get(e);let lo=0,hi=clocks.length;while(lo<hi){const mid=(lo+hi)>>1;if(clocks[mid]<a.bestTimes[e])lo=mid+1;else hi=mid}return{event:e,rank:lo+1};
       });
       if(ranks.find(r=>r.event===a.specialty)?.rank!==Math.min(...ranks.map(r=>r.rank)))errors.push(a.id);
      }
     }
     return errors;
    };
    return{errors:checkRankedSpecialties(),categories:[...new Set(state.world.map(a=>a.category))]};
   });
   assert.deepEqual(initial.errors,[]);assert.equal(initial.categories.length,4);
   await page.locator('#nav [data-page="scout"]').click();
   const scout=await page.evaluate(()=>{const a=state.world.find(a=>a.id===state.scoutBoard[0]);return{id:a.id,event:EVENT_LABEL[a.specialty],specialty:a.specialty}});
   const row=page.locator('#scoutTable tr').filter({has:page.locator(`[data-scout="${scout.id}"]`)});assert.match(await row.locator('td').nth(3).innerText(),new RegExp(scout.event));
   const inSeason=await page.evaluate(id=>{
    const a=state.world.find(a=>a.id===id),before=a.specialty,other=SPECIALTY_EVENTS.find(e=>e!==before&&validRaceTime(a.bestTimes[e]));
    if(other)a.bestTimes[other]=round2(Math.max(a.bestTimes[other]-.1,expectedTime(a,other)-.1));
    refreshScoutBoard();renderAll();return{before,after:a.specialty};
   },scout.id);assert.equal(inSeason.after,inSeason.before);
   if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await row.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-ranked-specialty-${mobile?'iphone':'pc'}.png`)});}
   const saved=await page.evaluate(async()=>{
    const own=state.players.find(a=>a.year===1);own.specialty='im400';ensureSpecialtyPBs([own]);
    newSeason();const errors=checkRankedSpecialties();renderAll();await saveLocal();await navigator.serviceWorker.ready;
    return{errors,ownId:own.id,ownSpecialty:own.specialty,season:state.season,specialties:JSON.stringify(state.world.map(a=>[a.id,a.specialty,a.cpuSpecialtySeason])),recruits:state.players.filter(a=>a.year===1).length};
   });
   assert.deepEqual(saved.errors,[]);assert.equal(saved.recruits,8);assert.equal(saved.ownSpecialty,'im400');
   await context.setOffline(true);const response=await page.reload({waitUntil:'load'});assert.ok(response.fromServiceWorker());await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy);
   const restored=await page.evaluate(id=>({season:state.season,specialties:JSON.stringify(state.world.map(a=>[a.id,a.specialty,a.cpuSpecialtySeason])),own:state.players.find(a=>a.id===id).specialty}),saved.ownId);
   assert.equal(restored.specialties,saved.specialties);assert.equal(restored.season,saved.season);assert.equal(restored.own,'im400');assert.deepEqual(errors,[]);
  }finally{await context.close()}
 }}finally{await app.close()}
});

test('v2.75 update repairs mixed 2030 podium saves by athlete identity and keeps own retired medalists, race data and offline saves on PC and phones',async()=>{
 for(const options of [{viewport:{width:1280,height:900}},{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]){
  const app=await fixture('v2.42'),context=await testContext(options),page=await context.newPage(),errors=runtimeErrors(page);
  const digest=async()=>{const json=JSON.stringify([state.players,state.world,state.teamTop10,state.recordRankings,state.meetHistory,state.rngSeed]);return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(json)))].map(v=>v.toString(16).padStart(2,'0')).join('')};
  try{
   await page.goto(app.url);await page.waitForFunction(()=>state?.version==='pwa-v2.42'&&!localSaveBusy,null,{timeout:90000});
   const expected=await page.evaluate(async()=>{
    state.season=2030;state.slot=43;migrateState();
    const own=state.players[0],cpu=state.world.find(a=>a.category==='university');cpu.name='混入した他大学2030';
    const medal=(id,name)=>({kind:'individual',season:2030,slot:43,meet:'intercollege',event:'fr100',stage:'決勝',rank:2,time:66,athleteId:id,name,schoolCategory:'university',gradeAtRecord:2});
    state.teamPodiumHistory=[medal(own.id,own.name),medal(cpu.id,cpu.name),medal('deleted-own-2030','引退済み自チーム2030'),medal('deleted-rival-2030','引退済み他大学2030')];state.teamPodiumHistoryVersion=1;
    state.meetHistory.push({season:2030,slot:43,meet:'intercollege',podiums:{fr100:[{athleteId:'deleted-rival-2030',name:'引退済み他大学2030',organization:'他大学',rank:2,time:66}]}});
    renderAll();await saveLocal();await navigator.serviceWorker.ready;return{own:own.name,cpu:cpu.name};
   });
   await page.locator('#showTeamTop10Btn').click();await page.locator('[data-team-record-view="podiums"]').click();
   assert.ok((await page.locator('#teamPodiumBody').innerText()).includes(expected.cpu));
   const before=await page.evaluate(digest);
   app.upgrade();await page.evaluate(async()=>await(await navigator.serviceWorker.getRegistration()).update());
   await page.waitForFunction(async()=>{const keys=await caches.keys();return keys.includes('swim-manager-pwa-v2.75')&&!keys.includes('swim-manager-pwa-v2.42')});
   await page.reload();await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy,null,{timeout:90000});
   assert.equal(await page.evaluate(digest),before);
   await page.locator('#showTeamTop10Btn').click();await page.locator('[data-team-record-view="podiums"]').click();await page.locator('#teamPodiumYear').selectOption('2030');
   assert.deepEqual(await page.locator('#teamPodiumBody .team-podium-athlete').allTextContents(),[expected.own,'引退済み自チーム2030'].sort((a,b)=>a.localeCompare(b,'ja')));
   assert.equal(await page.evaluate(()=>state.teamPodiumHistoryVersion),2);
   const saved=await page.evaluate(async()=>{await saveLocal();return JSON.stringify(state.teamPodiumHistory)});
   await context.setOffline(true);const response=await page.reload();assert.ok(response.fromServiceWorker());await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy);
   assert.equal(await page.evaluate(digest),before);assert.equal(await page.evaluate(()=>JSON.stringify(state.teamPodiumHistory)),saved);
   await page.locator('#showTeamTop10Btn').click();await page.locator('[data-team-record-view="podiums"]').click();
   assert.ok(!(await page.locator('#teamPodiumBody').innerText()).includes(expected.cpu));assert.deepEqual(errors,[]);
  }finally{await context.close();await app.close()}
 }
});

test('team history houses alumni beside podiums, updates current ages on real year rollover and restores history and archives offline on PC and phones',async()=>{
 const app=await fixture();
 try{for(const options of [{viewport:{width:1280,height:900}},{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]){
  const context=await testContext(options),page=await context.newPage(),errors=runtimeErrors(page);
  try{
   await page.goto(app.url);await page.waitForFunction(()=>state?.players?.length===32&&!localSaveBusy,null,{timeout:90000});
   await page.evaluate(()=>{
    state.alumniCareer=[{id:'career-probe',name:'卒業生の年齢確認',season:state.season-2,age:22,to:'社会人チーム',status:'大学卒業・競技終了'}];
    state.retiredArchive.push({id:'retired-probe',name:'引退生の年齢確認',season:state.season-1,age:25,organization:state.playerUniversity,reason:'大学卒業・競技終了',bestTimes:{},raceHistory:[],accolades:[]});renderAll();
   });
   assert.equal(await page.locator('#showTeamTop10Btn').innerText(),'自チーム歴史');
   await page.locator('#nav [data-page="records"]').click();assert.equal(await page.locator('#page-records #archiveTable').count(),0);
   await page.locator('#showTeamTop10Btn').click();assert.equal(await page.locator('#page-team-top10 h1').innerText(),'自チーム歴史');
   assert.deepEqual(await page.locator('[data-team-record-view]').allTextContents(),['歴代10傑','歴代表彰台','卒業生']);
   assert.ok(await page.locator('.team-record-views').evaluate(el=>{const [top,podium,alumni]=el.children;return top.offsetTop===podium.offsetTop&&podium.offsetTop===alumni.offsetTop&&alumni.offsetLeft>podium.offsetLeft}));
   await page.locator('[data-team-record-view="alumni"]').click();assert.ok(await page.locator('#teamAlumniPanel').isVisible());
   assert.equal(await page.locator('#teamTop10Panel').isVisible(),false);assert.equal(await page.locator('#teamPodiumPanel').isVisible(),false);
   const age=id=>page.locator(`[data-alumni-id="${id}"] td`).last().innerText();assert.equal(await age('career-probe'),'24');assert.equal(await age('retired-probe'),'26');
   await page.evaluate(()=>{newSeason();state.pendingCollegeAdmissions=null;state.pendingFreshmenWelcome=[];state.pendingSeasonRetirements=null;renderAll()});
   assert.equal(await age('career-probe'),'25');assert.equal(await age('retired-probe'),'27');
   assert.equal(await page.evaluate(()=>state.alumniCareer.find(a=>a.id==='career-probe').age),22);
   const saved=await page.evaluate(async()=>{await saveLocal();await navigator.serviceWorker.ready;return JSON.stringify([state.alumniCareer,state.retiredArchive,state.teamPodiumHistory])});
   await context.setOffline(true);const response=await page.reload();assert.ok(response.fromServiceWorker());await page.waitForFunction(()=>state?.players?.length===32&&!localSaveBusy);
   assert.equal(await page.evaluate(()=>JSON.stringify([state.alumniCareer,state.retiredArchive,state.teamPodiumHistory])),saved);
   await page.locator('#showTeamTop10Btn').click();await page.locator('[data-team-record-view="alumni"]').click();assert.equal(await age('career-probe'),'25');assert.equal(await age('retired-probe'),'27');
   await page.locator('[data-team-record-view="podiums"]').click();assert.equal(await page.locator('[data-team-podium-meet="all"]').count(),0);assert.equal(await page.locator('[data-team-podium-meet]').count(),5);
   await page.locator('[data-team-podium-meet="intercollege"]').click();assert.equal(await page.locator('[data-team-podium-meet="intercollege"]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('#teamPodiumBody [data-podium-meet]').count(),0);
   assert.deepEqual(errors,[]);
  }finally{await context.close()}
 }}finally{await app.close()}
});

test('team podium page switches years, groups actual individual and relay medalists by meet and restores them offline on PC and iPhone',async()=>{
 const app=await fixture();
 try{for(const mobile of [false,true]){
  const context=await testContext(mobile?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{viewport:{width:1280,height:900}}),page=await context.newPage(),errors=runtimeErrors(page);
  try{
   await page.goto(app.url);await page.waitForFunction(()=>state?.players?.length===32&&!localSaveBusy);
   await page.locator('#showTeamTop10Btn').click();await page.locator('[data-team-record-view="podiums"]').click();
   assert.match(await page.locator('#teamPodiumBody').innerText(),/表彰台の記録なし/);
   assert.equal(await page.locator('#teamPodiumYear').inputValue(),'2026');assert.equal(await page.locator('#teamTop10Panel').isVisible(),false);
   const expected=await page.evaluate(()=>{
    state.teamPodiumHistory=[];state.teamPodiumHistoryVersion=1;
    const own=state.players.slice(0,6);own.forEach((a,i)=>{a.name=i===0?'表彰 <&> 選手':`表彰選手${i}`;a.year=i%4+1;a.age=18+a.year});
    const individual=(a,meet,season,rank,event='fr100')=>{const previous=state.activeCompetitionSeason;state.activeCompetitionSeason=season;const time=state.players.includes(a)?(event==='br100'?65:50)+rank:round2(raceTarget(a,event));updateResultHistory(a,event,time,meet,'A決勝',rank);state.activeCompetitionSeason=previous};
    TEAM_PODIUM_MEETS.forEach((meet,i)=>individual(own[i%3],meet,2026,i%3+1));
    for(let i=0;i<3;i++)individual(own[i],'intercollege',2026,i+1);
    individual(own[5],'japan_open',2025,1,'br100');
    individual(own[0],'team_trial',2026,1,'ba100');individual(own[0],'joint_record',2026,1,'ba100');
    recordAthleteMainResult(own[0],{season:2026,meet:'intercollege',event:'ba100',stage:'予選',rank:1,time:60});
    const cpu=state.world.find(a=>a.category==='university');individual(cpu,'intercollege',2026,1,'ba100');
    for(const event of RELAYS){
     const legs=event==='4x200fr'?[99,100,100,101]:[49,50,50,51],total=legs.reduce((a,b)=>a+b,0);
     recordRelayResult(event,{organization:state.playerUniversity,members:own.slice(0,4),prelimRank:1,race:{total:total+4,legs:legs.map(t=>t+1)}},'intercollege','予選');
     const team={organization:state.playerUniversity,members:own.slice(1,5),rank:2,race:{total,legs}};
     recordRelayResult(event,team,'intercollege','決勝');recordRelayResult(event,team,'intercollege','決勝');
    }
    const national=[own[0],...state.world.filter(a=>a.category==='university').slice(0,3)];
    recordRelayResult('4x100medley',{organization:'日本',members:national,rank:3,race:{total:210,legs:[51,58,52,49]}},'world_championship','決勝');
    migrateState();renderAll();window.teamPodiumBefore=JSON.stringify([state.players,state.world,state.teamTop10,state.recordRankings,state.teamPodiumHistory,state.rngSeed]);
    return{names:own.map(a=>a.name),cpu:cpu.name,nationalOthers:national.slice(1).map(a=>a.name),year:state.season};
   });
   assert.deepEqual(await page.locator('[data-team-podium-meet]').allTextContents(),['世界大会','日本選手権','ジャパンオープン','インカレ','関西カレッジ']);
   for(const [meet,label]of [['world_championship','世界大会'],['japan_championship','日本選手権'],['japan_open','ジャパンオープン'],['intercollege','インカレ'],['kansai_college','関西カレッジ']]){
    await page.locator(`[data-team-podium-meet="${meet}"]`).click();
    assert.deepEqual(await page.locator('#teamPodiumBody h3').allTextContents(),[label]);
    assert.deepEqual(await page.locator('#teamPodiumBody [data-podium-meet]').evaluateAll(nodes=>nodes.map(node=>node.dataset.podiumMeet)),[meet]);
   }
   assert.deepEqual(await page.locator('#teamPodiumYear option').allTextContents(),['2026年度','2025年度']);
   await page.locator('[data-team-podium-meet="intercollege"]').click();
   const college=page.locator('[data-podium-meet="intercollege"]');
   assert.equal(await college.locator('tbody>tr').count(),6);
   assert.deepEqual(await college.locator('[data-podium-event="fr100"] .team-podium-athlete').allTextContents(),expected.names.slice(0,3));
   assert.deepEqual(await college.locator('[data-podium-event="fr100"] .history-rank').allTextContents(),['1位','2位','3位']);
   assert.deepEqual(await college.locator('[data-podium-event="fr100"] .record-school-label').allTextContents(),['大1','大2','大3']);
   assert.equal(await college.locator('[data-podium-event="ba100"]').count(),0);
   for(const event of ['4x100fr','4x200fr','4x100medley']){
    const row=college.locator(`[data-podium-event="${event}"]`);
    assert.deepEqual(await row.locator('.team-podium-athlete').allTextContents(),expected.names.slice(1,5));
    assert.deepEqual(await row.locator('.team-podium-lap').allTextContents(),event==='4x200fr'?['1:39.00','1:40.00','1:40.00','1:41.00']:['49.00','50.00','50.00','51.00']);
    assert.equal(await row.locator('.team-podium-time').innerText(),event==='4x200fr'?'6:40.00':'3:20.00');
    assert.ok(await row.locator('.team-podium-relay-leg').evaluateAll(nodes=>nodes.every(node=>{
     const member=node.querySelector('span').getBoundingClientRect(),lap=node.querySelector('.team-podium-lap').getBoundingClientRect();
     return node.scrollWidth<=node.clientWidth+1&&(member.right<=lap.left+1||lap.right<=member.left+1||member.bottom<=lap.top+1||lap.bottom<=member.top+1);
    })));
   }
   assert.equal(await page.locator('#teamPodiumBody [data-podium-meet="teijimayama_championship"]').count(),0);
   await page.locator('[data-team-podium-meet="world_championship"]').click();
   const worldRelay=page.locator('[data-podium-meet="world_championship"] [data-podium-event="4x100medley"]');
   assert.deepEqual(await worldRelay.locator('.team-podium-athlete').allTextContents(),[expected.names[0]]);assert.equal(await worldRelay.locator('.team-podium-lap').innerText(),'51.00');
   const text=await page.locator('#teamPodiumBody').innerText();for(const name of [expected.cpu,...expected.nationalOthers])assert.ok(!text.includes(name));assert.ok(!text.includes('自チーム記録会')&&!text.includes('合同記録会'));
   await page.locator('[data-team-podium-meet="japan_open"]').click();await page.locator('#teamPodiumYear').selectOption('2025');assert.equal(await page.locator('#teamPodiumBody tbody>tr').count(),1);assert.match(await page.locator('#teamPodiumBody').innerText(),new RegExp(expected.names[5]));assert.equal(await page.locator('#teamPodiumBody .record-school-label').innerText(),'大1');
   await page.locator('[data-team-record-view="top10"]').click();assert.ok(await page.locator('#teamTop10Panel').isVisible());assert.equal(await page.locator('#teamTop10Event option').count(),18);
   await page.locator('#teamTop10Event').selectOption('4x100fr');await page.locator('[data-team-record-view="podiums"]').click();assert.equal(await page.locator('#teamPodiumYear').inputValue(),'2025');
   await page.locator('#nav [data-page="home"]').click();await page.locator('#showTeamTop10Btn').click();assert.equal(await page.locator('#teamPodiumYear').inputValue(),'2025');assert.ok(await page.locator('#teamPodiumPanel').isVisible());
   await page.locator('#teamPodiumYear').selectOption('2026');
   await page.locator('[data-team-podium-meet="intercollege"]').click();
   if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-team-podiums-${mobile?'iphone':'pc'}.png`)});await college.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-team-podiums-relay-${mobile?'iphone':'pc'}.png`)})}
   assert.deepEqual(await page.evaluate(()=>{
    const before=JSON.parse(window.teamPodiumBefore),after=JSON.parse(JSON.stringify([state.players,state.world,state.teamTop10,state.recordRankings,state.teamPodiumHistory,state.rngSeed])),differences=[];
    const walk=(a,b,path)=>{if(differences.length>=8||JSON.stringify(a)===JSON.stringify(b))return;if(a&&b&&typeof a==='object'&&typeof b==='object'){for(const key of new Set([...Object.keys(a),...Object.keys(b)]))walk(a[key],b[key],path+'.'+key)}else differences.push({path,before:a,after:b})};walk(before,after,'state');return differences;
   }),[]);
   const saved=await page.evaluate(async()=>{await saveLocal();await navigator.serviceWorker.ready;return JSON.stringify([state.players,state.world,state.teamTop10,state.recordRankings,state.teamPodiumHistory,state.rngSeed])});
   await context.setOffline(true);const response=await page.reload({waitUntil:'load'});assert.ok(response.fromServiceWorker());await page.waitForFunction(()=>state?.players?.length===32&&!localSaveBusy);
   assert.deepEqual(await page.evaluate(saved=>{
    const before=JSON.parse(saved),after=JSON.parse(JSON.stringify([state.players,state.world,state.teamTop10,state.recordRankings,state.teamPodiumHistory,state.rngSeed])),differences=[];
    const walk=(a,b,path)=>{if(differences.length>=8||JSON.stringify(a)===JSON.stringify(b))return;if(a&&b&&typeof a==='object'&&typeof b==='object'){for(const key of new Set([...Object.keys(a),...Object.keys(b)]))walk(a[key],b[key],path+'.'+key)}else differences.push({path,before:a,after:b})};walk(before,after,'state');return differences;
   },saved),[]);
   await page.locator('#showTeamTop10Btn').click();await page.locator('[data-team-record-view="podiums"]').click();await page.locator('#teamPodiumYear').selectOption('2025');assert.equal(await page.locator('#teamPodiumBody tbody>tr').count(),1);assert.match(await page.locator('#teamPodiumBody').innerText(),new RegExp(expected.names[5]));
   assert.equal(await page.locator('#modalRoot .modal').count(),0);assert.deepEqual(errors,[]);
  }finally{await context.close()}
 }}finally{await app.close()}
});
test('scouting costs five points for success or failure, rejects four points and persists recruitment on PC and iPhone',async()=>{
 const app=await fixture();
 try{for(const mobile of [false,true]){
  const context=await testContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile});
  try{
   const page=await context.newPage(),errors=[],dialogs=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.accept()});
   await page.goto(app.url);await page.waitForFunction(()=>state?.players?.length&&!localSaveBusy&&cloudSync);
   const id=await page.evaluate(()=>{state.points=4;renderAll();return refreshScoutBoard().find(a=>!a.scouted).id});
   await page.locator('#nav [data-page="scout"]').click();const button=page.locator(`[data-scout="${id}"]`);
   assert.equal(await button.innerText(),'5ptで勧誘');assert.equal(await button.isDisabled(),true);
   const unchanged=await page.evaluate(id=>{const before=JSON.stringify([state.points,state.recruits,state.rngSeed,state.world.find(a=>a.id===id)]);doScout(id);return before===JSON.stringify([state.points,state.recruits,state.rngSeed,state.world.find(a=>a.id===id)])},id);
   assert.ok(unchanged);assert.match(dialogs.at(-1),/5pt必要/);
   await page.evaluate(()=>{state.points=5;window.scoutCostOriginalRng=rng;rng=()=>1;renderAll()});assert.equal(await button.isDisabled(),false);await button.click();
   assert.match(dialogs.at(-1),/スカウトに失敗/);assert.equal(await page.evaluate(()=>state.points),0);assert.equal(await button.isDisabled(),true);
   assert.equal(await page.evaluate(id=>state.recruits.includes(id),id),false);
   await page.evaluate(()=>{state.points=5;rng=()=>0;renderAll()});await button.click();assert.match(dialogs.at(-1),/スカウトに成功/);
   await page.evaluate(()=>{rng=window.scoutCostOriginalRng;delete window.scoutCostOriginalRng});assert.equal(await page.evaluate(()=>state.points),0);assert.equal(await button.innerText(),'加入予定');assert.equal(await button.isDisabled(),true);
   await page.evaluate(async()=>{await saveLocal();await navigator.serviceWorker.ready});await context.setOffline(true);const response=await page.reload();assert.ok(response.fromServiceWorker());await page.waitForFunction(()=>state?.players?.length&&!localSaveBusy&&cloudSync);
   await page.locator('#nav [data-page="scout"]').click();assert.equal(await page.evaluate(()=>state.points),0);assert.equal(await page.evaluate(id=>state.recruits.includes(id),id),true);assert.equal(await button.innerText(),'加入予定');assert.equal(await button.isDisabled(),true);assert.deepEqual(errors,[]);
  }finally{await context.close()}
 }}finally{await app.close()}
});
test('entry form purchases spend five points and preserve rows, checks, scroll, confirmation and offline saves on PC and iPhone',async()=>{
  const app=await fixture();
  try{for(const options of [{viewport:{width:1280,height:900}},{viewport:{width:390,height:844},isMobile:true,hasTouch:true},{viewport:{width:667,height:375},isMobile:true,hasTouch:true}]){
    const context=await testContext(options);
    try{
      const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);await page.waitForFunction(()=>state?.players?.length&&!localSaveBusy);
      await page.evaluate(()=>{
        // Keep this qualified UI fixture coherent with its abilities so a load
        // does not need to repair the deliberately accelerated PBs.
        for(const p of state.players){for(const k of STATS)if(k!=='mental')p.stats[k]=175;for(const e of EVENTS)p.bestTimes[e]=round2(expectedTime(p,e))}
        migrateState();renderAll();
      });
      const geometry=()=>page.locator('.modal-meet-entry').evaluate(m=>{
        const wrap=m.querySelector('.entry-table-wrap'),rows=[...m.querySelectorAll('#entryMatrix tbody tr')];
        return{top:wrap.scrollTop,left:wrap.scrollLeft,width:wrap.clientWidth,height:wrap.clientHeight,rows:rows.map(row=>[row.offsetWidth,row.offsetHeight]),selected:[...m.querySelectorAll('input:checked')].map(ch=>ch.dataset.pid+':'+ch.dataset.event)};
      });
      let last;
      for(const meet of ['team_trial','joint_record','kansai_college','intercollege','teijimayama_championship','japan_open','japan_championship']){
        last=await page.evaluate(meet=>{
          state.points=5;openMeetEntry(meet,60,2026);
          const a=sortedEntryRoster(playerMeetRoster(meet)).slice(12).find(a=>athleteMeetForm(a,meet,60,2026).level<2);
          return{id:a.id,level:athleteMeetForm(a,meet,60,2026).level,player:JSON.stringify(a),seed:state.rngSeed};
        },meet);
        const check=page.locator(`#entryMatrix input[data-pid="${last.id}"][data-event="fr100"]`);await check.check();
        const button=page.locator(`#entryMatrix [data-form-boost="${last.id}"]`);await button.scrollIntoViewIfNeeded();
        await page.locator('.entry-table-wrap').evaluate(w=>w.scrollLeft=180);
        const before=await geometry();await button.click();
        assert.deepEqual(await geometry(),before,`${options.viewport.width} ${meet} purchase preserves geometry and scroll`);
        assert.equal(await page.locator(`[data-form-athlete="${last.id}"]`).getAttribute('data-form-level'),String(last.level+1));
        assert.equal(await page.locator('[data-entry-form-points]').innerText(),'所持 0pt');assert.equal(await button.isDisabled(),true);
        assert.equal(await page.locator('#entryMatrix [data-form-boost]:not(:disabled)').count(),0);assert.ok(await check.isChecked());
        assert.deepEqual(await page.evaluate(id=>({player:JSON.stringify(state.players.find(a=>a.id===id)),seed:state.rngSeed,points:state.points}),last.id),{player:last.player,seed:last.seed,points:0});
        const fit=await button.evaluate(b=>{const row=b.closest('.entry-athlete-form'),td=b.closest('td');return row.scrollWidth<=td.clientWidth});assert.ok(fit);
        if(await page.locator('#std').count()){await page.locator('#std').click();await page.locator('.modal-standards #x').click();assert.deepEqual(await geometry(),before)}
        await page.locator('#confirmEntry').click();await page.locator('#editMeetForm').click();
        assert.equal(await page.locator('.modal-form-boost [data-form-boost]').count(),1);assert.equal(await page.locator('.modal-form-boost [data-form-boost]').isDisabled(),true);
        if(meet==='japan_championship'){
          const seed=await page.evaluate(()=>state.rngSeed);await page.locator('#showFormRanges').click();
          assert.equal(await page.locator('.modal-form-ranges tbody tr').count(),5);assert.match(await page.locator('.modal-form-ranges').innerText(),/−0.10〜＋0.50/);
          assert.match(await page.locator('.modal-form-ranges').innerText(),/−1.00〜＋4.00/);assert.equal(await page.evaluate(()=>state.rngSeed),seed);
          assert.match(await page.locator('.modal-form-ranges').innerText(),/100m ±0.80秒/);assert.match(await page.locator('.modal-form-ranges').innerText(),/予選補正は、距離別の基準発生率/);assert.match(await page.locator('.modal-form-ranges').innerText(),/リレーには予選補正を加えません/);
          await page.locator('#closeFormRanges').click();assert.equal(await page.locator('.modal-form-boost [data-form-boost]').count(),1);
        }
        await page.locator('#closeFormBoost').click();assert.equal(await page.locator(`.modal-entry-confirm [data-form-athlete="${last.id}"]`).getAttribute('data-form-level'),String(last.level+1));
        await page.locator('#backEntry').click();await page.locator('#entryMatrix').waitFor();assert.ok(await check.isChecked());
        assert.equal(await page.locator(`[data-form-athlete="${last.id}"]`).getAttribute('data-form-level'),String(last.level+1));assert.equal(await page.evaluate(()=>state.points),0);
        await page.evaluate(()=>closeModal());
      }
      const capped=await page.evaluate(()=>{
        state.points=50;const a=state.players.find(a=>athleteMeetForm(a,'team_trial',1,2026).level<2);openMeetEntry('team_trial',1,2026);return{id:a.id,level:athleteMeetForm(a,'team_trial',1,2026).level};
      });
      const capButton=page.locator(`[data-form-boost="${capped.id}"]`);for(let i=capped.level;i<2;i++)await capButton.click();assert.equal(await capButton.isDisabled(),true);
      assert.equal(await page.evaluate(()=>state.points),50-5*(2-capped.level));
      const saved=await page.evaluate(async()=>{await autoSaveNow();await navigator.serviceWorker.ready;return{points:state.points,boosts:JSON.stringify(state.meetFormBoosts),players:JSON.stringify(state.players)}});
      await context.setOffline(true);await page.reload();await page.waitForFunction(()=>state?.players?.length&&!localSaveBusy);
      assert.deepEqual(await page.evaluate(()=>({points:state.points,boosts:JSON.stringify(state.meetFormBoosts),players:JSON.stringify(state.players)})),saved);
      await page.evaluate(()=>openMeetEntry('team_trial',1,2026));assert.equal(await page.locator(`[data-form-boost="${capped.id}"]`).isDisabled(),true);
      if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-form-boost-${options.viewport.width}.png`)})}
      assert.deepEqual(errors,[]);
    }finally{await context.close()}
  }}finally{await app.close()}
});
test('world form purchases include owned graduates and relay-only representatives and refresh additions and automatic confirmation',async()=>{
  const app=await fixture();
  try{for(const options of [{viewport:{width:1280,height:900}},{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]){
    const context=await testContext(options);
    try{
      const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);await page.waitForFunction(()=>state?.players?.length&&!localSaveBusy);
      const data=await page.evaluate(()=>{
        state.season=2027;state.slot=36;state.points=10;
        const own=state.players.filter(a=>athleteMeetForm(a,'world_championship',36,2027).level<2).slice(0,2),cpu=state.world.find(a=>a.category==='university');
        const [graduate,relayOnly]=own;graduate.ownAtSelection=true;
        state.japanTeam={year:2027,individual:{fr100:[graduate.id,cpu.id]},relays:{'4x100fr':[relayOnly.id,cpu.id,...state.players.filter(a=>!own.includes(a)).slice(0,2).map(a=>a.id)]},athletes:[...own,cpu,...state.players.filter(a=>!own.includes(a)).slice(0,2)].map(a=>({id:a.id,snapshot:deepClone(a),ownAtSelection:a!==cpu}))};
        state.players=state.players.filter(a=>a!==graduate);renderAll();openMeetEntry('world_championship',36,2027);
        return{grad:graduate.id,relay:relayOnly.id,cpu:cpu.id,level:athleteMeetForm(graduate,'world_championship',36,2027).level};
      });
      assert.equal(await page.locator(`[data-form-boost="${data.cpu}"]`).count(),0);
      assert.equal(await page.locator(`[data-form-boost="${data.relay}"]`).count(),1);
      const select=page.locator('select[data-world-event="fr200"][data-world-slot="0"]');await select.selectOption(data.grad);
      await page.locator(`.entry-form-roster [data-form-boost="${data.grad}"]`).click();
      assert.equal(await select.inputValue(),data.grad);assert.equal(await select.locator('option:checked').innerText(),await page.evaluate(id=>{const a=japanTeamAthlete(id);return `★ ${a.name} ${athleteGradeLabel(a)} / ${a.organization||""} / PB ${fmt(a.bestTimes.fr200)} / 他種目内定 / ${athleteMeetForm(a,'world_championship',36,2027).label}`},data.grad));
      assert.equal(await page.locator(`tr[data-world-event="fr200"] [data-form-athlete="${data.grad}"]`).getAttribute('data-form-level'),String(data.level+1));
      await page.locator('#confirmWorldAdditional').click();await page.locator('#editMeetForm').click();
      assert.equal(await page.locator(`.modal-form-boost [data-form-boost="${data.cpu}"]`).count(),0);
      const relayBefore=await page.evaluate(id=>athleteMeetForm(japanTeamAthlete(id),'world_championship',36,2027).level,data.relay);
      await page.locator(`.modal-form-boost [data-form-boost="${data.relay}"]`).click();await page.locator('#closeFormBoost').click();
      assert.ok((await page.locator(`.modal-entry-confirm [data-form-athlete="${data.relay}"]`).evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.formLevel)))).every(level=>level===relayBefore+1));
      assert.equal(await page.locator('[data-entry-form-points]').innerText(),'所持 0pt');
      await page.locator('#backEntry').click();await page.locator('.modal-world-additional').waitFor();assert.equal(await select.inputValue(),data.grad);
      const saved=await page.evaluate(async()=>{await autoSaveNow();return{points:state.points,boosts:JSON.stringify(state.meetFormBoosts),added:JSON.stringify(state.japanTeam.additionalIndividual)}});
      await page.reload();await page.waitForFunction(()=>state?.players?.length&&!localSaveBusy);assert.deepEqual(await page.evaluate(()=>({points:state.points,boosts:JSON.stringify(state.meetFormBoosts),added:JSON.stringify(state.japanTeam.additionalIndividual)})),saved);
      // With every individual slot occupied, the automatic confirmation still offers owned representatives.
      await page.evaluate(()=>{for(const e of EVENTS)state.japanTeam.individual[e]=state.japanTeam.individual.fr100.slice();openMeetEntry('world_championship',36,2027)});
      assert.equal(await page.locator('.modal-world-additional').count(),0);await page.locator('#editMeetForm').click();assert.equal(await page.locator(`.modal-form-boost [data-form-boost="${data.grad}"]`).count(),1);
      await page.locator('#closeFormBoost').click();assert.deepEqual(errors,[]);
    }finally{await context.close()}
  }}finally{await app.close()}
});
test('paid form reaches real meet preliminaries, finals and replacement relay swimmers through skip and results on PC and iPhone',async()=>{
  const app=await fixture();
  try{for(const options of [{viewport:{width:1280,height:900}},{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]){
    const context=await testContext(options);
    try{
      const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);await page.waitForFunction(()=>state?.players?.length&&!localSaveBusy);
      const prepared=await page.evaluate(()=>{
        state.slot=73;state.points=10;for(const p of state.players)p.stats.mental=80;
        const ready=state.players.filter(p=>athleteMeetForm(p,'joint_record',73,2026).level<2),own=[...ready.slice(0,2),...state.players.filter(p=>!ready.slice(0,2).includes(p)).slice(0,3)];
        state.players=own;own.forEach(p=>{for(const k of STATS)p.stats[k]=k==='mental'?80:170;for(const e of EVENTS)p.bestTimes[e]=expectedTime(p,e)});
        state.world=state.world.filter(a=>a.category==='university').slice(0,8);for(const a of state.world){for(const k of STATS)a.stats[k]=100;for(const e of EVENTS)a.bestTimes[e]=expectedTime(a,e)}
        const original=executeMeet;executeMeet=(...args)=>{window.paidFormResult=original(...args);return window.paidFormResult};rng=()=>.5;gauss=()=>0;
        const entries=Object.fromEntries(EVENTS.map(e=>[e,e==='fr100'?[own[0].id]:[]])),relays={'4x100fr':[own[0].id,...own.slice(2).map(p=>p.id)]};
        openMeetEntry('joint_record',73,2026,entries,relays);
        return{racer:own[0].id,reserve:own[1].id,levels:own.slice(0,2).map(p=>athleteMeetForm(p,'joint_record',73,2026).level)};
      });
      await page.locator(`[data-form-boost="${prepared.racer}"]`).click();await page.locator(`[data-form-boost="${prepared.reserve}"]`).click();assert.equal(await page.evaluate(()=>state.points),0);
      await page.locator('#confirmEntry').click();await page.locator('#goRace').click();await page.waitForFunction(()=>!!window.paidFormResult);
      const computed=await page.evaluate(id=>{
        const r=window.paidFormResult,prelim=r.events.fr100.prelim.find(x=>x.athlete.id===id).race,final=r.events.fr100.final.find(x=>x.athlete.id===id).race;
        return{levels:[prelim.physics.meetFormLevel,final.physics.meetFormLevel],delay:prelim.physics.preliminaryDelay,probability:prelim.physics.preliminaryProbability,finalDelay:final.physics.preliminaryDelay??null,locked:!improveMeetForm(id,'joint_record',73,2026).ok};
      },prepared.racer);
      assert.deepEqual(computed.levels,[prepared.levels[0]+1,prepared.levels[0]+1]);assert.ok(computed.locked);assert.equal(computed.delay,0);assert.ok(computed.probability>0&&computed.probability<1);assert.equal(computed.finalDelay,null);
      let seen=0,changed=false;
      for(let steps=0;steps<60;steps++){
        await page.waitForFunction(()=>document.querySelector('#raceCanvas,#nextGroup,#nextEv,#relayOk,.modal-meet-results'));
        if(await page.locator('.modal-meet-results').count())break;
        if(await page.locator('#relayOk').count()){
          assert.equal(await page.locator('.modal-relay-editor [data-form-boost]').count(),0);
          await page.locator('select[data-kind="4x100fr"][data-i="0"]').selectOption(prepared.reserve);
          await page.evaluate(id=>{const a=state.players.find(a=>a.id===id);window.expectedReplacementLeg={time:withMeetRaceContext('joint_record',73,2026,()=>simulateRace(a,'fr100',true,true,false,false,false).total),level:athleteMeetForm(a,'joint_record',73,2026).level}},prepared.reserve);
          await page.locator('#relayOk').click();changed=true;continue;
        }
        if(await page.locator('#nextGroup').count()){await page.locator('#nextGroup').click();continue}
        if(await page.locator('#nextEv').count()){await page.locator('#nextEv').click();continue}
        assert.ok(await page.locator('.race-entrants').innerText());seen++;await page.locator('#skipEvent').click();await page.locator('.modal-race-result').waitFor();
      }
      assert.equal(seen,4);assert.ok(changed);await page.locator('.modal-meet-results').waitFor();
      const replacement=await page.evaluate(()=>{
        const relay=window.paidFormResult.relays.find(x=>x[0]==='4x100fr')[1].find(ownsRelayTeam);
        return{id:relay.members[0].id,leg:relay.race.legs[0],expected:window.expectedReplacementLeg.time,level:window.expectedReplacementLeg.level};
      });
      assert.equal(replacement.id,prepared.reserve);assert.equal(replacement.level,prepared.levels[1]+1);assert.equal(replacement.leg,replacement.expected);assert.deepEqual(errors,[]);
    }finally{await context.close()}
  }}finally{await app.close()}
});
test('legacy high-school and university qualifiers retain PBs after repair and race near them in Japan Open on PC and iPhone',async()=>{
  const app=await fixture();
  try{for(const options of [{viewport:{width:1280,height:900}},{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]){
    const context=await testContext(options);
    try{
      const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);await page.waitForFunction(()=>state?.players?.length&&!localSaveBusy);
      const saved=await page.evaluate(async()=>{
        const templates=['high','university'].map(category=>state.world.find(a=>a.category===category&&!a.accolades.length));
        state.world=Array.from({length:7},(_,i)=>{
          const a=deepClone(templates[i%2]);a.id='legacy-pace-'+i;a.name='検証 泳者'+i;a.grade=i%2?1:3;a.age=i%2?19:18;
          a.stats=Object.fromEntries(STATS.map(k=>[k,k==='mental'?160:43]));a.bestTimes={fr200:110};a.recordedPBs={fr200:110};a.specialty='fr200';a.accolades=[];a.raceHistory=[];
          a.cpuCompetitionCategory=a.category;a.cpuRaceDistributionCategory=a.category;attachMedleyStats(a);return a;
        });
        state.players=state.players.slice(0,1);const own=state.players[0];own.stats=Object.fromEntries(STATS.map(k=>[k,k==='mental'?160:138]));own.bestTimes={fr200:109};attachMedleyStats(own);
        recordIndividualResult(state.world[0],'fr200',110,'Higashikata CUP','決勝');
        const result={own:JSON.stringify([own.stats,own.bestTimes]),cpu:state.world.map(a=>({id:a.id,pb:a.bestTimes.fr200,base:expectedTime(a,'fr200')})),
          records:state.recordRankings.high.fr200.map(r=>({id:r.athleteId,time:r.time}))};
        state.version='pwa-v1.90';delete state.cpuRaceConsistencyVersion;await saveLocal();return result;
      });
      assert.ok(saved.cpu.every(a=>a.base>139&&a.base<142));await page.reload();await page.waitForFunction(()=>state?.cpuRaceConsistencyVersion===2&&!localSaveBusy);
      const repaired=await page.evaluate(()=>({own:JSON.stringify([state.players[0].stats,state.players[0].bestTimes]),cpu:state.world.map(a=>({id:a.id,pb:a.bestTimes.fr200,base:expectedTime(a,'fr200')})),
        records:state.recordRankings.high.fr200.map(r=>({id:r.athleteId,time:r.time}))}));
      assert.equal(repaired.own,saved.own);assert.deepEqual(repaired.records,saved.records);assert.ok(repaired.cpu.every(a=>a.pb===110&&a.base<111.2));
      const snapshot=await page.evaluate(async()=>{await saveLocal();return JSON.stringify(state.world)});await page.reload();await page.waitForFunction(()=>!localSaveBusy);
      assert.equal(await page.evaluate(()=>JSON.stringify(state.world)),snapshot);
      await page.evaluate(()=>{
        rng=()=>.5;gauss=()=>0;const original=executeMeet;executeMeet=(...args)=>{window.paceResult=original(...args);return window.paceResult};
        const selections=Object.fromEntries(EVENTS.map(e=>[e,e==='fr200'?[state.players[0].id]:[]]));showEntryConfirmation('japan_open',selections,{},68,2026);
      });
      await page.locator('#goRace').click();await advanceToRace(page);
      const races=await drainRaces(page);assert.ok(races.length>=2);
      const results=await page.evaluate(()=>['prelim','final'].map(stage=>({stage,rows:window.paceResult.events.fr200[stage].filter(r=>r.source==='CPU').map(r=>({pb:r.entryPB,time:r.race.total,last:r.race.cumulative.at(-1)}))})));
      for(const result of results){assert.equal(result.rows.length,7);assert.ok(result.rows.every(r=>r.pb===110&&r.time<114&&r.last===r.time),JSON.stringify(result))}
      await page.locator('.modal-meet-results #x').click();await acceptMeetGrowth(page);assert.deepEqual(errors,[]);
    }finally{await context.close()}
  }}finally{await app.close()}
});
test('external meet growth waits for every race, highlights rank-ups and restores an unacknowledged popup once on PC/iPhone',async()=>{
  const app=await fixture();
  try{for(const options of [{viewport:{width:1280,height:900}},{viewport:{width:390,height:844},isMobile:true,hasTouch:true},{viewport:{width:667,height:375},isMobile:true,hasTouch:true}]){
    const context=await testContext(options);
    try{
      const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);await page.waitForFunction(()=>cloudSync&&!localSaveBusy);
      const initial=await page.evaluate(()=>{
        state.slot=73;const p=state.players[0];p.stats.mental=124.25;p.growthProfile={1:1,2:1,3:1,4:1};state.facilities.mental=100;state.trainingFocus[p.id]=['mental'];
        const other=state.players[1];state.lastTrainingGains=[{id:other.id,name:other.name,year:other.year,changes:[{stat:'mental',before:100,after:101,up:1}]}];
        const original=executeMeet;executeMeet=(...args)=>{window.bonusResult=original(...args);return window.bonusResult};
        rng=()=>.5;gauss=()=>0;renderAll();
        const entries=Object.fromEntries(EVENTS.map(e=>[e,e==='fr50'?[p.id]:[]]));showEntryConfirmation('joint_record',entries,{},73,2026);
        return{id:p.id,before:p.stats.mental,other:JSON.stringify(other.stats),last:JSON.stringify(state.lastTrainingGains),cpu:JSON.stringify(state.world.map(a=>a.stats))};
      });
      await page.locator('#goRace').click();await advanceToRace(page);
      assert.equal(await page.evaluate(id=>state.players.find(p=>p.id===id).stats.mental,initial.id),initial.before);
      assert.equal(await page.evaluate(()=>state.pendingMeetGrowthRewards.length),0);
      assert.deepEqual(await page.evaluate(()=>state.pendingMeetCompletion.growthParticipantIds),[initial.id]);
      await drainRaces(page);
      const complete=await page.evaluate(id=>({value:state.players.find(p=>p.id===id).stats.mental,gains:state.pendingMeetGrowthRewards[0].gains,
        once:state.meetGrowthRewardKeys.length,other:JSON.stringify(state.players[1].stats),last:JSON.stringify(state.lastTrainingGains),cpu:JSON.stringify(state.world.map(a=>a.stats)),
        pending:state.pendingMeetCompletion}),initial.id);
      assert.equal(complete.value,126.49);assert.ok(Math.abs(complete.value-initial.before-2.24)<1e-8);
      assert.equal(complete.once,1);assert.equal(complete.gains.length,1);assert.equal(complete.other,initial.other);assert.equal(complete.last,initial.last);assert.equal(complete.cpu,initial.cpu);assert.equal(complete.pending,null);
      assert.equal(await page.evaluate(async()=>JSON.parse(await getLocalSaveStore().read()).pendingMeetGrowthRewards.length),1);
      await page.locator('.modal-meet-results #x').click();await page.locator('.modal-meet-growth').waitFor();
      assert.match(await page.locator('.modal-meet-growth h2').innerText(),/大会出場ボーナス/);
      assert.match(await page.locator('.modal-meet-growth .notice').innerText(),/Higashikata CUP.*全日程/s);
      assert.equal(await page.locator('.modal-meet-growth tbody tr').count(),1);
      assert.ok(await page.locator('.modal-meet-growth .growth-rank-up').count()>0);
      assert.equal(await page.locator('.modal-meet-growth [data-stat="mental"] .growth-up').innerText(),'+2.24');
      const geometry=await page.locator('.modal-meet-growth #next').evaluate(b=>{const r=b.getBoundingClientRect();return{right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight}});
      assert.ok(geometry.right<=geometry.width+1&&geometry.bottom<=geometry.height+1,JSON.stringify(geometry));
      if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-meet-growth-${options.viewport.width}x${options.viewport.height}.png`)})}
      await page.reload();await page.locator('.modal-meet-growth').waitFor();
      assert.equal(await page.evaluate(id=>state.players.find(p=>p.id===id).stats.mental,initial.id),complete.value);
      assert.equal(await page.evaluate(()=>state.meetGrowthRewardKeys.length),1);assert.equal(await page.locator('.modal-meet-growth tbody tr').count(),1);
      await page.locator('.modal-meet-growth #next').click();await page.reload();await page.waitForFunction(()=>cloudSync&&!localSaveBusy);
      assert.equal(await page.locator('.modal-meet-growth').count(),0);assert.equal(await page.evaluate(()=>state.pendingMeetGrowthRewards.length),0);
      assert.equal(await page.evaluate(id=>state.players.find(p=>p.id===id).stats.mental,initial.id),complete.value);assert.deepEqual(errors,[]);
    }finally{await context.close()}
  }}finally{await app.close()}
});

test('November Teijimayama opens from training, admits slow PBs under college limits and completes all sprint/relay days without team scores on PC/iPhone',async()=>{
  const app=await fixture();
  try{for(const options of [{viewport:{width:1280,height:900}},{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]){
    const context=await testContext(options);
    try{
      const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);await page.waitForFunction(()=>cloudSync&&!localSaveBusy);
      const ids=await page.evaluate(()=>{
        state.slot=60;state.points=10000;
        for(const p of state.players.slice(0,5)){
          p.stats=Object.fromEntries(STATS.map(k=>[k,200]));attachMedleyStats(p);for(const e of EVENTS)p.bestTimes[e]=round2(expectedTime(p,e)+.5);
        }
        state.players[0].bestTimes.ba50=999;renderAll();return state.players.slice(0,5).map(p=>p.id);
      });
      assert.match(await page.locator('#homeMeet').innerText(),/帝嶋山選手権/);
      await page.locator('#scheduleBtn').click();
      const row=page.locator('.schedule-table tbody tr').filter({hasText:'帝嶋山選手権'});
      assert.deepEqual(await row.locator('td').allTextContents(),['11月 第2週後半','帝嶋山選手権（4日間）','なし','あり']);
      await page.locator('.modal-schedule #x').click();
      await page.evaluate(()=>{rng=()=>.5;gauss=()=>0;const original=executeMeet;executeMeet=(...args)=>{window.teijimayamaResult=original(...args);return window.teijimayamaResult}});
      await page.locator('#advanceBtn').click();await page.locator('.modal-training-result #next').click();await page.waitForSelector('#entryMatrix');
      assert.equal(await page.evaluate(()=>state.slot),61);assert.match(await page.locator('.modal-meet-entry h2').innerText(),/帝嶋山選手権/);
      assert.match(await page.locator('.modal-meet-entry .notice').innerText(),/参加標準記録はありません/);
      assert.equal(await page.locator('#entryMatrix thead th').count(),17);assert.equal(await page.locator('.entry-standard-status').count(),0);
      const choice=(id,event)=>page.locator(`input[data-pid="${id}"][data-event="${event}"]`);
      for(const e of ['ba50','br50','fly50'])await choice(ids[0],e).check();
      assert.ok(await choice(ids[0],'fr100').isDisabled());
      await choice(ids[0],'br50').uncheck();assert.equal(await choice(ids[0],'fr100').isDisabled(),false);await choice(ids[0],'br50').check();
      await choice(ids[1],'fly50').check();await choice(ids[2],'fly50').check();assert.ok(await choice(ids[3],'fly50').isDisabled());
      assert.equal(await page.locator('#entryMatrix .meet-form').count(),24);
      const seniors=await page.evaluate(()=>state.players.filter(p=>p.year===4).map(p=>p.id));
      for(const id of seniors)assert.equal(await page.locator(`#entryMatrix [data-athlete-id="${id}"]`).count(),0);
      if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-teijimayama-entry-${options.isMobile?'iphone':'pc'}.png`)})}
      await page.locator('#relayBtn').click();
      for(const id of seniors)assert.equal(await page.locator(`.modal-relay-editor option[value="${id}"]`).count(),0);
      for(const kind of ['4x100fr','4x200fr','4x100medley'])for(let i=0;i<4;i++)await page.locator(`select[data-kind="${kind}"][data-i="${i}"]`).selectOption(ids[i]);
      await page.locator('#relayOk').click();await page.locator('#confirmEntry').click();
      assert.equal(await page.locator('.entry-summary-card').count(),18);await page.locator('#goRace').click();
      const program=[],movies=await drainRaces(page,program);
      const eventsByDay=[['fly50'],['ba50','4x100fr'],['br50','4x100medley'],['4x200fr']];
      assert.deepEqual(program,eventsByDay.flatMap((events,i)=>['prelim','final'].flatMap(phase=>events.map(event=>({day:i+1,event,phase})))));
      assert.ok(movies.length>=program.length);assert.equal(await page.locator('.modal-college-ranking').count(),0);
      assert.match(await page.locator('.modal-meet-results h2').innerText(),/帝嶋山選手権 結果/);
      const result=await page.evaluate(()=>({scores:window.teijimayamaResult.teamScores,scoreHistory:state.teamScoreHistory.length,
        schools:window.teijimayamaResult.events.fly50.prelim.filter(row=>row.source==='CPU').every(row=>allowedCpu(row.athlete,'teijimayama_championship')),
        history:state.players[0].raceHistory.filter(row=>row.meet==='teijimayama_championship').length,
        form:window.teijimayamaResult.events.ba50.prelim.find(row=>row.source==='PLAYER').race.physics.meetFormLevel,
        expected:athleteMeetForm(state.players[0],'teijimayama_championship',60,2026).level,competition:[window.teijimayamaResult.season,window.teijimayamaResult.slot]}));
      assert.ok(await page.evaluate(()=>Object.values(window.teijimayamaResult.events).every(field=>[...field.prelim,...field.final].every(row=>(row.athlete.year??row.athlete.grade)!==4))&&window.teijimayamaResult.relays.every(([,finals,meta])=>[...meta.prelim,...finals].every(team=>[...team.members,...(team.finalMembers||[])].every(a=>(a.year??a.grade)!==4)))));
      assert.deepEqual(result.scores,{});assert.equal(result.scoreHistory,0);assert.ok(result.schools&&result.history>=6);assert.equal(result.form,result.expected);assert.deepEqual(result.competition,[2026,60]);
      if(process.env.SWIM_SCREENSHOT_DIR){await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-teijimayama-results-${options.isMobile?'iphone':'pc'}.png`)})}
      await page.locator('.modal-meet-results #x').click();await acceptMeetGrowth(page);
      const saved=await page.evaluate(async()=>{await saveLocal();await navigator.serviceWorker.ready;return JSON.stringify([state.players,state.teamTop10])});
      await context.setOffline(true);await page.reload();await page.waitForFunction(()=>state?.slot===61&&!localSaveBusy);
      assert.deepEqual(await page.evaluate(()=>JSON.parse(JSON.stringify([state.players,state.teamTop10]))),JSON.parse(saved));
      await page.locator('#scheduleBtn').click();assert.equal(await page.locator('.schedule-table tbody tr').filter({hasText:'帝嶋山選手権'}).count(),1);assert.deepEqual(errors,[]);
    }finally{await context.close()}
  }}finally{await app.close()}
});
test('entry forms stay stable on every meet, world additions, relay prelim and final choices, and offline PC/iPhone saves',async()=>{
  const app=await fixture();
  try{for(const options of [{viewport:{width:1280,height:900}},{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]){
    const context=await testContext(options);
    try{
      const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);await page.waitForFunction(()=>cloudSync);
      const ids=await page.evaluate(()=>{
        for(const p of state.players.slice(0,5)){p.stats.mental=80;for(const e of EVENTS)p.bestTimes[e]=standardFor('japan_championship',e)-1}
        return state.players.slice(0,5).map(a=>a.id);
      });
      const formLevels=async selector=>page.locator(selector).evaluateAll(nodes=>nodes.map(n=>({id:n.dataset.formAthlete,level:Number(n.dataset.formLevel),label:n.textContent})));
      const assertForms=async(meet,slot,season,selector)=>{
        const actual=await formLevels(selector),expected=await page.evaluate(({actual,meet,slot,season})=>actual.map(row=>{
          const a=japanTeamAthlete(row.id),form=athleteMeetForm(a,meet,slot,season);return{id:a.id,level:form.level,label:form.label};
        }),{actual,meet,slot,season});
        assert.ok(actual.length);assert.deepEqual(actual,expected);return actual;
      };
      for(const [meet,slot] of [['team_trial',1],['joint_record',76],['kansai_college',25],['intercollege',45],['japan_open',21],['japan_championship',94]]){
        await page.evaluate(({meet,slot})=>openMeetEntry(meet,slot,2026),{meet,slot});
        const initial=await assertForms(meet,slot,2026,'#entryMatrix .meet-form');assert.equal(initial.length,32);
        assert.ok(await page.locator('#entryMatrix .entry-pb-view').first().isVisible());assert.ok(await page.locator('#entryMatrix .entry-stat-view').first().isVisible());assert.deepEqual(await formLevels('#entryMatrix .meet-form'),initial);
        await page.locator(`input[data-pid="${ids[0]}"][data-event="fr100"]`).check();
        assert.deepEqual(await formLevels('#entryMatrix .meet-form'),initial);
        if(meet==='kansai_college'){
          if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-entry-form-${options.isMobile?'iphone':'pc'}.png`)})}
          await page.locator('#relayBtn').click();
          for(let i=0;i<4;i++)await page.locator(`select[data-kind="4x100fr"][data-i="${i}"]`).selectOption(ids[i]);
          assert.equal(await page.locator('[data-relay-form-kind="4x100fr"] .meet-form').count(),4);
          await assertForms(meet,slot,2026,'.modal-relay-editor .meet-form');
          assert.match(await page.locator('select[data-kind="4x100fr"]').first().innerText(),/絶好調|好調|普通|不調|絶不調/);
          await page.locator('#relayOk').click();assert.deepEqual(await formLevels('#entryMatrix .meet-form'),initial);
        }
        await page.locator('#confirmEntry').click();await assertForms(meet,slot,2026,'.modal-entry-confirm .meet-form');
        if(meet==='kansai_college')assert.equal(await page.locator('.modal-entry-confirm .meet-form').count(),5);
        await page.locator('#backEntry').click();await page.waitForSelector('#entryMatrix');
        assert.deepEqual(await formLevels('#entryMatrix .meet-form'),initial);
        assert.ok(await page.locator(`input[data-pid="${ids[0]}"][data-event="fr100"]`).isChecked());
        await page.evaluate(()=>closeModal());
      }
      await page.evaluate(()=>{
        const own=state.players.slice(0,4),cpu=state.world.find(a=>a.category==='university');
        state.japanTeam={year:2027,individual:{fr100:[own[0].id,cpu.id]},relays:{'4x100fr':own.map(a=>a.id)},additionalIndividual:{},athletes:[...own,cpu].map(a=>({id:a.id,snapshot:deepClone(a),ownAtSelection:own.includes(a)}))};
        openMeetEntry('world_championship',36,2027);
      });
      await assertForms('world_championship',36,2027,'.modal-world-additional .meet-form');
      const select=page.locator('select[data-world-event="fr200"][data-world-slot="0"]');
      assert.match(await select.innerText(),/絶好調|好調|普通|不調|絶不調/);await select.selectOption(ids[0]);
      assert.equal(await page.locator('tr[data-world-event="fr200"] .meet-form').count(),1);
      await page.locator('#confirmWorldAdditional').click();
      await assertForms('world_championship',36,2027,'.modal-entry-confirm .meet-form');
      await page.evaluate(()=>{
        closeModal();const roster=state.players.slice(0,5),draft={'4x100fr':roster.slice(0,4).map(a=>a.id)};
        openRelayEditor(draft,()=>{window.savedFormFinalLineup=draft['4x100fr']},{kinds:['4x100fr'],roster,required:true,title:'決勝エントリー',formContext:{meet:'world_championship',slot:36,season:2027}});
      });
      await page.locator('select[data-kind="4x100fr"][data-i="0"]').selectOption(ids[4]);
      await assertForms('world_championship',36,2027,'.modal-relay-editor .meet-form');await page.locator('#relayOk').click();
      assert.deepEqual(await page.evaluate(()=>window.savedFormFinalLineup),[ids[4],...ids.slice(1,4)]);
      const saved=await page.evaluate(async()=>{
        closeModal();openMeetEntry('team_trial',1,2026);const levels=state.players.map(a=>[a.id,athleteMeetForm(a,'team_trial',1,2026).level]);
        await saveLocal();await navigator.serviceWorker.ready;return levels;
      });
      await context.setOffline(true);await page.reload();await page.waitForFunction(()=>state?.players?.length===32&&!localSaveBusy);
      await page.evaluate(()=>openMeetEntry('team_trial',1,2026));
      assert.deepEqual((await formLevels('#entryMatrix .meet-form')).map(row=>[row.id,row.level]),await page.evaluate(()=>sortedEntryRoster().map(a=>[a.id,athleteMeetForm(a,'team_trial',1,2026).level])));
      assert.deepEqual(await page.evaluate(()=>state.players.map(a=>[a.id,athleteMeetForm(a,'team_trial',1,2026).level])),saved);assert.deepEqual(errors,[]);
    }finally{await context.close()}
  }}finally{await app.close()}
});
test('Japan team page keeps annual own and CPU results, medal styling and changed relay laps on PC and portrait iPhone offline',async()=>{
  const app=await fixture();
  try{for(const options of [{viewport:{width:1280,height:900}},{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]){
    const context=await testContext(options);
    try{
      const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);await page.waitForFunction(()=>cloudSync);
      await page.locator('[data-page="japan-team"]').click();assert.match(await page.locator('#japanTeamNote').innerText(),/2027年/);
      const ownId=await page.evaluate(()=>{
        const own=state.players[0],cpu=state.world.find(a=>a.category==='university');
        state.japanTeam={year:2027,selectedSeason:2026,individual:{fr100:[own.id,cpu.id]},additionalIndividual:{},relays:{'4x100fr':[own.id,cpu.id,state.players[1].id,state.players[2].id]},selectionTimes:{fr100:{[own.id]:47.3,[cpu.id]:47.5}},athletes:[own,cpu,...state.players.slice(1,4)].map(a=>({id:a.id,snapshot:deepClone(a),ownAtSelection:state.players.includes(a)}))};
        state.season=2027;state.slot=36;const members=[own,cpu,state.players[1],state.players[2]];
        const result={meet:'world_championship',season:2027,slot:36,events:{fr100:{prelim:[{athlete:own,nationality:'日本',race:{total:48.4},achievement:{rank:5},heatLane:4},{athlete:cpu,nationality:'日本',race:{total:50.5},achievement:{rank:11},heatLane:5}],final:[{athlete:own,race:{total:47.4},achievement:{rank:2},heatLane:3}]}},relays:[['4x100fr',[{organization:'日本',members:[cpu,own,state.players[1],state.players[3]],rank:3,heatLane:5,race:{total:196,legs:[49,48,50,49]}}],{prelim:[{organization:'日本',members,prelimRank:6,heatLane:2,race:{total:198,legs:[50,49,50,49]}}],finalEntryPending:false}]]};
        recordJapanWorldResults(result,true);state.japanTeam.year=2029;archiveJapanTeam();selectedJapanTeamYear=null;renderAll();return own.id;
      });
      assert.equal(await page.locator('#japanTeamYear').inputValue(),'2029');assert.match(await page.locator('#japanTeamIndividuals').innerText(),/未開催/);
      await page.locator('#japanTeamYear').selectOption('2027');assert.match(await page.locator('#japanTeamNote').innerText(),/大会終了/);
      const own=page.locator(`[data-representative="${ownId}"][data-event="fr100"]`);
      assert.match(await own.innerText(),/47.40/);assert.match(await own.innerText(),/48.40/);assert.equal(await own.locator('.history-rank-second').count(),1);
      assert.match(await page.locator('#japanTeamIndividuals').innerText(),/予選敗退/);assert.match(await page.locator('#japanTeamRelays').innerText(),/3:16.00/);
      assert.equal(await page.locator('[data-relay="4x100fr"] .relay-leg').count(),12);
      const bounds=await page.evaluate(()=>({width:document.getElementById('page-japan-team').getBoundingClientRect().width,home:document.getElementById('page-home').parentElement.getBoundingClientRect().width}));assert.ok(bounds.width<=bounds.home+1);
      if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-japan-team-${options.isMobile?'iphone':'pc'}.png`)})}
      await page.evaluate(async()=>{await saveLocal();await navigator.serviceWorker.ready});await context.setOffline(true);await page.reload();
      await page.locator('[data-page="japan-team"]').click();await page.locator('#japanTeamYear').selectOption('2027');
      assert.equal(await page.locator('.history-rank-second').count(),1);assert.match(await page.locator('#japanTeamRelays').innerText(),/3:16.00/);assert.deepEqual(errors,[]);
    }finally{await context.close()}
  }}finally{await app.close()}
});
test('15MiB cleanup persists only old eligible details and preserves a failed-write backup before an offline restart',async()=>{
  const app=await fixture(),context=await testContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true});
  try{
    const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);await page.waitForFunction(()=>cloudSync);
    const result=await page.evaluate(async()=>{
      state.points=432;await writeSaveSilently('manual');const backup=await getLocalSaveStore().read();
      state.season=2035;const p=state.players[0];p.raceHistory=Array.from({length:100},(_,i)=>({season:i<80?2026+i%5:2031+i%5,slot:20,meet:'joint_record',stage:'予選',event:'fr100',time:80+i,notes:'記'.repeat(60000)}));
      state.japanTeamHistory=[{year:2027,worldStatus:'complete',individual:{},relays:{},athletes:[],results:{individual:{},relays:{}}}];
      const protectedData=JSON.stringify({stats:p.stats,best:p.bestTimes,plans:state.trainingPlans,records:state.recordRankings,top:state.teamTop10,japan:state.japanTeamHistory,reputation:state.meetParticipationHistory});
      const store=getLocalSaveStore(),write=store.write.bind(store);clearTimeout(autoSaveTimer);autoSaveTimer=null;store.write=()=>Promise.reject(new Error('Injected durable write failure'));
      const failure=await writeSaveSilently('manual'),liveKept=p.raceHistory.length===100,backupKept=await store.read()===backup;store.write=write;
      const success=await writeSaveSilently('manual');const saved=JSON.parse(await store.read());
      return{failure,liveKept,backupKept,success,bytes:serializedStateBytes(),retained:p.raceHistory.filter(row=>row.season>=2031).length,removed:state.historyCleanup.removed,
        protectedKept:protectedData===JSON.stringify({stats:p.stats,best:p.bestTimes,plans:state.trainingPlans,records:state.recordRankings,top:state.teamTop10,japan:state.japanTeamHistory,reputation:state.meetParticipationHistory}),durableMatches:JSON.stringify(saved)===JSON.stringify(state),rows:p.raceHistory.length};
    });
    assert.equal(result.failure,false);assert.ok(result.liveKept&&result.backupKept&&result.success&&result.protectedKept&&result.durableMatches);assert.equal(result.retained,20);assert.ok(result.removed>0);assert.ok(result.bytes<=12*1024*1024);
    await page.evaluate(()=>document.getElementById('universitiesBtn').click());assert.match(await page.locator('#saveHistoryStatus').innerText(),/最終整理：2035年度/);
    await page.evaluate(()=>navigator.serviceWorker.ready);await context.setOffline(true);await page.reload();
    await page.waitForFunction(()=>!localSaveBusy&&!!state?.players?.length&&!!cloudSync);
    assert.equal(await page.evaluate(()=>state.players[0].raceHistory.length),result.rows);assert.equal(await page.evaluate(()=>state.points),432);
    assert.equal(await page.evaluate(()=>state.japanTeamHistory[0].year),2027);
    assert.equal(errors.filter(error=>/Autosave failed:/.test(error)).length,1,JSON.stringify(errors));assert.deepEqual(errors.filter(error=>!/Autosave failed:/.test(error)),[]);
  }finally{await context.close();await app.close()}
});

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
test('iPhone cleans an older large cloud save after a durable load and synchronizes the cleaned revision back to PC',async()=>{
  const app=await fixture(false,cloudConfig),server=cloudBackend(),pcContext=await cloudContext(server),phoneContext=await cloudContext(server,{viewport:{width:844,height:390},isMobile:true,hasTouch:true});
  try{
    const pc=await pcContext.newPage(),phone=await phoneContext.newPage(),errors=[runtimeErrors(pc),runtimeErrors(phone)];
    await pc.goto(app.url);await pc.waitForFunction(()=>cloudSync?.config);
    await pc.evaluate(async()=>{
      // Emulate a pre-cleanup client that already uploaded this old history.
      autoSaveEnabled=false;clearTimeout(autoSaveTimer);autoSaveTimer=null;
      state.season=2035;state.points=765;state.players[0].raceHistory=Array.from({length:100},(_,i)=>({season:i<80?2026+i%5:2031+i%5,slot:20,meet:'joint_record',stage:'予選',event:'fr100',time:80+i,notes:'記'.repeat(55000)}));
      const prepare=cloudSync.options.prepareUpload;cloudSync.options.prepareUpload=null;
      try{await cloudSync.login('history@example.test','test-password',true)}finally{cloudSync.options.prepareUpload=prepare}
    });
    assert.equal(await pc.evaluate(()=>cloudSync.status.kind),'synced');
    const id=server.saves.keys().next().value,oldRevision=server.saves.get(id).revision;
    await phone.goto(app.url);await phone.waitForFunction(()=>cloudSync?.config);
    await phone.evaluate(()=>cloudSync.login('history@example.test','test-password'));assert.equal(await phone.evaluate(()=>cloudSync.status.kind),'conflict');
    await phone.locator('#cloudSyncChip').click();await phone.locator('#cloudUseRemote').click();await phone.waitForFunction(()=>cloudSync.status.kind==='synced');
    const saved=await phone.evaluate(async()=>({points:state.points,removed:state.historyCleanup.removed,bytes:serializedStateBytes(),recent:state.players[0].raceHistory.filter(row=>row.season>=2031).length,durableMatches:JSON.stringify(state)===await getLocalSaveStore().read()}));
    assert.equal(saved.points,765);assert.ok(saved.removed>0&&saved.durableMatches);assert.ok(saved.bytes<=12*1024*1024);assert.equal(saved.recent,20);assert.notEqual(server.saves.get(id).revision,oldRevision);
    await pc.evaluate(()=>cloudSync.sync());assert.equal(await pc.evaluate(()=>state.historyCleanup.removed),saved.removed);
    await phone.locator('#cloudClose').click();await phone.evaluate(()=>navigator.serviceWorker.ready);await phoneContext.setOffline(true);await phone.reload();
    assert.equal(await phone.evaluate(()=>state.points),765);assert.equal(await phone.evaluate(()=>state.historyCleanup.removed),saved.removed);assert.deepEqual(errors,[[],[]]);
  }finally{await pcContext.close();await phoneContext.close();await app.close()}
});

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
    assert.equal(await phone.evaluate(async()=>JSON.parse(await getLocalSaveStore().read()).points),444);
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
    const result=await page.evaluate(async()=>{
      state.points=543;renderAll();autoSaveNow();
      const original=JSON.stringify(state),stored=localStorage.getItem('swimManagerSave'),storedData=await getLocalSaveStore().read();
      let damaged=deepClone(state);damaged.points=999;damaged.recordRankings.japan.fr100=[{kind:'relay',event:'fr100',time:45}];
      let rejected=false;try{await cloudSync.options.applySave(damaged)}catch(error){rejected=true}
      return{rejected,progressKept:JSON.stringify(state)===original,backupKept:localStorage.getItem('swimManagerSave')===stored&&(await getLocalSaveStore().read())===storedData,
        points:JSON.parse(await getLocalSaveStore().read()).points,status:document.getElementById('status').textContent};
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

test('iPhone loads a cloud save beyond Web Storage quota and keeps progress after offline restarts and reset',async()=>{
  const app=await fixture(false,cloudConfig),server=cloudBackend(),pcContext=await cloudContext(server),phoneContext=await cloudContext(server,{viewport:{width:844,height:390},isMobile:true,hasTouch:true});
  await phoneContext.addInitScript(()=>{
    const original=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){
      let bytes=0;
      for(let i=0;i<this.length;i++){const name=this.key(i);if(name!==key)bytes+=2*(name.length+this.getItem(name).length);}
      bytes+=2*(String(key).length+String(value).length);
      if(bytes>5*1024*1024)throw new DOMException('The quota has been exceeded.','QuotaExceededError');
      return original.call(this,key,value);
    };
  });
  try{
    const pc=await pcContext.newPage(),phone=await phoneContext.newPage(),errors=[runtimeErrors(pc),runtimeErrors(phone)];
    await pc.goto(app.url);await pc.waitForFunction(()=>cloudSync?.config);
    const expected=await pc.evaluate(async()=>{
      state.points=987;state.slot=5;state.playerUniversity='同期確認大学';state.saveStorageTestPadding='容量検証'.repeat(700000);
      const a=state.players[0];state.trainingFocus[a.id]={key:'fr_speed'};
      await saveLocal();await cloudSync.login('large-save@example.test','test-password',true);
      return{bytes:JSON.stringify(state).length*2,id:a.id,players:JSON.stringify(state.players),records:JSON.stringify(state.recordRankings)};
    });
    assert.ok(expected.bytes>5*1024*1024);
    await phone.goto(app.url);await phone.waitForFunction(()=>cloudSync?.config);
    await phone.evaluate(async()=>{state.points=111;await saveLocal()});
    assert.equal(await phone.evaluate(async()=>JSON.parse(await getLocalSaveStore().read()).points),111);
    await phone.locator('#cloudSyncChip').click();await phone.locator('#cloudEmail').fill('large-save@example.test');await phone.locator('#cloudPassword').fill('test-password');
    await phone.locator('#cloudLogin').click();await phone.locator('#cloudUseRemote').waitFor();await phone.locator('#cloudUseRemote').click();
    await phone.waitForFunction(()=>cloudSync.status.kind==='synced');
    assert.equal(await phone.evaluate(()=>state.points),987);
    assert.equal(await phone.evaluate(()=>JSON.stringify(state.players)),expected.players);
    assert.equal(await phone.evaluate(()=>JSON.stringify(state.recordRankings)),expected.records);
    assert.equal(await phone.evaluate(()=>localStorage.getItem('swimManagerSave')),'swim-manager-indexeddb-v1');
    assert.equal(await phone.evaluate(async()=>JSON.parse(await getLocalSaveStore().read()).points),987);
    assert.equal(await phone.locator('#saveLoading').count(),0);
    await phone.locator('#cloudClose').click();await phone.evaluate(()=>navigator.serviceWorker.ready);
    await phone.waitForFunction(()=>!!navigator.serviceWorker.controller);await phoneContext.setOffline(true);await phone.reload();
    await phone.waitForFunction(()=>cloudSync?.session&&state.points===987);
    assert.equal(await phone.evaluate(()=>JSON.stringify(state.players)),expected.players);
    await phone.evaluate(async()=>{state.points=992;state.players[0].stats.fr_speed+=1;await saveLocal()});
    await phone.reload();await phone.waitForFunction(()=>cloudSync?.session&&state.points===992);
    const downloadPromise=phone.waitForEvent('download');await phone.evaluate(()=>exportJson());const download=await downloadPromise;
    assert.equal(JSON.parse(fs.readFileSync(await download.path(),'utf8')).points,992);
    await phoneContext.setOffline(false);await phone.evaluate(()=>cloudSync.sync());await phone.waitForFunction(()=>cloudSync.status.kind==='synced');
    assert.equal((await require('../cloud-sync.js').decode(server.saves.values().next().value)).points,992);
    await phoneContext.setOffline(true);
    await phone.evaluate(async()=>{cloudSync.logout();window.confirm=()=>true;resetGame();await getLocalSaveStore().tail});
    await phone.reload();await phone.waitForFunction(()=>cloudSync&&state?.points===0);
    assert.equal(await phone.evaluate(()=>state.playerUniversity),'同期確認大学');
    assert.equal(await phone.evaluate(()=>state.players.length),32);
    assert.equal((await require('../cloud-sync.js').decode(server.saves.values().next().value)).points,992);
    assert.deepEqual(errors[0],[]);
    assert.deepEqual(errors[1],['大学名・学校名・チーム名を引き継いで初期化しました']);
  }finally{await pcContext.close();await phoneContext.close();await app.close()}
});

test('a failed IndexedDB cloud commit preserves the old local save and restores the game and controls',async()=>{
  const app=await fixture(),context=await testContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true});
  try{
    const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);await page.waitForFunction(()=>cloudSync);
    const result=await page.evaluate(async()=>{
      state.points=543;renderAll();await saveLocal();
      const original=JSON.stringify(state),stored=localStorage.getItem('swimManagerSave'),storedData=await getLocalSaveStore().read(),training=selectedTrainingId;
      let damaged=deepClone(state);damaged.points=999;damaged.saveStorageTestPadding='容量検証'.repeat(700000);
      const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=()=>{throw new DOMException('No space remaining.','QuotaExceededError')};
      let rejected=false;try{await cloudSync.options.applySave(damaged)}catch(error){rejected=true}finally{IDBObjectStore.prototype.put=put}
      return{rejected,progressKept:JSON.stringify(state)===original,backupKept:localStorage.getItem('swimManagerSave')===stored&&(await getLocalSaveStore().read())===storedData,
        trainingKept:selectedTrainingId===training,points:JSON.parse(await getLocalSaveStore().read()).points,
        status:document.getElementById('status').textContent,locked:localSaveBusy||!!document.getElementById('saveLoading')||[...document.body.children].some(el=>el.inert)};
    });
    assert.equal(result.rejected,true);assert.equal(result.progressKept,true);assert.equal(result.backupKept,true);assert.equal(result.trainingKept,true);
    assert.equal(result.points,543);assert.match(result.status,/pt 543/);assert.equal(result.locked,false);
    assert.equal(errors.filter(error=>/Autosave failed:/.test(error)).length,1);
    assert.deepEqual(errors.filter(error=>!/Autosave failed:/.test(error)),[]);
    await page.reload();assert.equal(await page.evaluate(()=>state.points),543);
  }finally{await context.close();await app.close()}
});

test('an unreadable IndexedDB save at startup waits for cloud recovery and never uploads the fresh game',async()=>{
  const app=await fixture(false,cloudConfig),server=cloudBackend(),context=await cloudContext(server,{viewport:{width:844,height:390},isMobile:true,hasTouch:true});
  try{
    const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);await page.waitForFunction(()=>cloudSync?.config);
    await page.evaluate(async()=>{
      state.points=987;state.saveStorageTestPadding='容量検証'.repeat(700000);await saveLocal();await cloudSync.login('recovery@example.test','test-password',true);
    });
    const original=JSON.stringify(server.saves.values().next().value),uploads=server.calls.filter(call=>call.method==='PUT').length;
    await context.addInitScript(()=>{
      window.originalTestIDBOpen=IDBFactory.prototype.open;
      IDBFactory.prototype.open=()=>{throw new DOMException('Storage temporarily unavailable.','InvalidStateError')};
    });
    await page.reload();await page.waitForFunction(()=>cloudSync?.status.kind==='conflict');
    assert.equal(await page.evaluate(()=>localSaveLoadFailed&&!autoSaveEnabled&&!localSaveBusy),true);
    assert.equal(JSON.stringify(server.saves.values().next().value),original);
    assert.equal(server.calls.filter(call=>call.method==='PUT').length,uploads);
    await page.locator('#cloudSyncChip').click();assert.equal(await page.locator('#cloudUseLocal').isDisabled(),true);
    await page.evaluate(()=>{IDBFactory.prototype.open=window.originalTestIDBOpen});
    await page.locator('#cloudUseRemote').click();await page.waitForFunction(()=>cloudSync.status.kind==='synced');
    assert.equal(await page.evaluate(()=>state.points),987);assert.equal(await page.evaluate(()=>!localSaveLoadFailed&&autoSaveEnabled),true);
    assert.equal(await page.evaluate(async()=>JSON.parse(await getLocalSaveStore().read()).points),987);
    assert.equal(JSON.stringify(server.saves.values().next().value),original);
    assert.equal(errors.filter(error=>/Save load failed:/.test(error)).length,1);
    assert.deepEqual(errors.filter(error=>!/Save load failed:/.test(error)),[]);
  }finally{await context.close();await app.close()}
});

test('IndexedDB autosaves keep write order, recover after a failed commit and read the last committed save',async()=>{
  const app=await fixture(),context=await testContext();
  try{
    const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);await page.waitForFunction(()=>cloudSync);
    const result=await page.evaluate(async()=>{
      const storage={getItem:key=>localStorage.getItem('ordered-'+key),setItem:(key,value)=>{
        if(value.length>1024)throw new DOMException('Quota exceeded.','QuotaExceededError');localStorage.setItem('ordered-'+key,value);
      }};
      const store=new SwimLocalSaveStore({storage});await store.write('old'.repeat(1000));
      const database=store.database.bind(store);let fail=true;
      store.database=(mode,text)=>{if(mode==='readwrite'&&fail){fail=false;return Promise.reject(new Error('Transaction aborted'))}return database(mode,text)};
      let failed=false;try{await store.write('failed')}catch{failed=true}
      const preserved=await store.read();
      await Promise.all([store.write('first'),store.write('second'),store.write('newest')]);
      const restarted=new SwimLocalSaveStore({storage});
      return{failed,preserved,newest:await restarted.read(),pending:store.pending,marker:storage.getItem('swimManagerSave')};
    });
    assert.equal(result.failed,true);assert.equal(result.preserved,'old'.repeat(1000));assert.equal(result.newest,'newest');assert.equal(result.pending,0);
    assert.equal(result.marker,'swim-manager-indexeddb-v1');assert.deepEqual(errors,[]);
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
        const own=rows.find(row=>row.source==='PLAYER');window.relayTestRace={event,final:options.stageLabel.includes('A決勝'),members:own?.members?.map(p=>p.id),names:own?.members?.map(p=>p.name),legs:own?.race?.legs?.map(fmt)};
        return play(event,rows,options);
      };
      const entries=Object.fromEntries(EVENTS.map(e=>[e,[]])),relays=Object.fromEntries(RELAYS.map(k=>[k,[...original]]));
      renderTrainingPlayers();
      openMeetEntry('intercollege',43,2026,entries,relays);
      return {original,next,kinds:RELAYS,labels:RELAY_LABEL,roster:state.players.map(p=>p.id)};
    });
    const checkPBOrder=async(select,event)=>{
      const ids=await select.locator('option').evaluateAll(options=>options.map(o=>o.value).filter(Boolean));
      assert.deepEqual([...ids].sort(),[...fixtures.roster].sort());
      const times=await page.evaluate(({ids,event})=>ids.map(id=>{
        const t=state.players.find(p=>p.id===id).bestTimes[event];return validRaceTime(t)?t:null;
      }),{ids,event});
      const ordered=times.map(t=>t??Infinity);
      assert.deepEqual(ordered,[...ordered].sort((a,b)=>a-b));
    };
    // Leaving the preliminary editor must discard its unconfirmed draft.
    await page.locator('#relayBtn').click();
    await checkPBOrder(page.locator('#relayEditorBody select').first(),'fr100');
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
        await checkPBOrder(page.locator('#relayEditorBody select').first(),kind==='4x100fr'?'fr100':kind==='4x200fr'?'fr200':'ba100');
        assert.deepEqual(await page.locator('#relayEditorBody select').evaluateAll(selects=>selects.map(s=>s.value)),fixtures.original);
        assert.ok((await page.locator('.modal-relay-editor h2').innerText()).includes(fixtures.labels[kind]));
        const wanted=kind==='4x100medley'?[...fixtures.next].reverse():fixtures.next;
        for(let leg=0;leg<4;leg++)await page.locator(`select[data-kind="${kind}"][data-i="${leg}"]`).selectOption(wanted[leg]);
        edited.push(kind);await page.locator('#relayOk').click();continue;
      }
      if(await page.locator('#startProgramRace').count()){await page.locator('#startProgramRace').click();continue}
      if(await page.locator('#nextEv').count()){const race=await page.evaluate(()=>window.relayTestRace),row=page.locator('.modal-event-result .result-own');assert.deepEqual(await row.locator('.result-relay-name').allTextContents(),race.names);assert.deepEqual(await row.locator('.result-relay-lap').allTextContents(),race.legs);await page.locator('#nextEv').click();continue}
      const race=await page.evaluate(()=>window.relayTestRace),wanted=race.final?(race.event==='4x100medley'?[...fixtures.next].reverse():fixtures.next):fixtures.original;
      assert.deepEqual(race.members,wanted);seen.push({event:race.event,final:race.final});
      await page.locator('#skipEvent').click();const row=page.locator('.modal-race-result .result-own');assert.deepEqual(await row.locator('.result-relay-name').allTextContents(),race.names);assert.deepEqual(await row.locator('.result-relay-lap').allTextContents(),race.legs);await page.locator('#nextGroup').click();
    }
    assert.deepEqual([...edited].sort(),[...fixtures.kinds].sort());
    assert.equal(seen.length,6);assert.equal(seen.filter(r=>r.final).length,3);
    const saved=await page.evaluate(async()=>{
      const result=window.relayTestResult;
      return {relays:result.relays.map(([kind,finals,meta])=>({kind,prelim:meta.prelim.find(ownsRelayTeam).members.map(p=>p.id),
        final:finals.find(ownsRelayTeam).members.map(p=>p.id),pending:meta.finalEntryPending})),
        actual:result.teamScores[state.playerUniversity],wanted:result.relays.reduce((sum,r)=>sum+[24,20,16,12,8,6,4,2][r[1].find(ownsRelayTeam).rank-1],0),
        history:JSON.parse(await getLocalSaveStore().read()).teamScoreHistory.at(-1).scores[state.playerUniversity],
        bonus:state.pendingMeetGrowthRewards[0].gains.map(g=>g.id),
        savedBonus:JSON.parse(await getLocalSaveStore().read()).pendingMeetGrowthRewards[0].gains.map(g=>g.id)};
    });
    for(const row of saved.relays){
      assert.deepEqual(row.prelim,fixtures.original);
      assert.deepEqual(row.final,row.kind==='4x100medley'?[...fixtures.next].reverse():fixtures.next);assert.equal(row.pending,false);
    }
    for(const entry of saved.relays)for(const phase of ['prelim','final']){const names=await page.evaluate(ids=>ids.map(id=>state.players.find(p=>p.id===id).name),entry[phase]);assert.deepEqual(await page.locator(`[data-relay-event="${entry.kind}"][data-relay-stage="${phase}"] .result-own .result-relay-name`).allTextContents(),names)}
    assert.equal(saved.actual,saved.wanted);assert.equal(saved.history,saved.actual);
    assert.deepEqual([...saved.bonus].sort(),[...fixtures.original,...fixtures.next].sort());assert.deepEqual(saved.savedBonus,saved.bonus);assert.deepEqual(errors,[]);
    await page.locator('.modal-meet-results #x').click();await acceptMeetGrowth(page);
  }finally{await context.close();await app.close()}
});

test('relay candidates follow each leg PB and every history filter shows finals before prelims on PC and iPhone',async()=>{
  const app=await fixture();
  try{for(const options of [{viewport:{width:1280,height:900}},{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]){
    const context=await testContext(options);
    try{
      const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);
      const fixture=await page.evaluate(()=>{
        const events=['fr100','fr200','ba100','br100','fly100'];
        state.players.forEach((p,i)=>events.forEach((e,j)=>p.bestTimes[e]=i<3?50+((i+j)%3):i===3?0:i===4?null:90+i));
        const ids=state.players.slice(0,4).map(p=>p.id),draft=Object.fromEntries(RELAYS.map(kind=>[kind,[...ids]]));
        const expected=Object.fromEntries(events.map(e=>[e,state.players.filter(p=>validRaceTime(p.bestTimes[e])).sort((a,b)=>a.bestTimes[e]-b.bestTimes[e]).map(p=>p.id)]));
        window.lineupOriginal=JSON.stringify(draft);openRelayEditor(draft,()=>{window.lineupConfirmed=JSON.stringify(draft)});
        return{ids,expected};
      });
      const selects=page.locator('.modal-relay-editor select');
      for(let i=0;i<await selects.count();i++){
        const select=selects.nth(i),kind=await select.getAttribute('data-kind'),leg=Number(await select.getAttribute('data-i'));
        const event=kind==='4x100fr'?'fr100':kind==='4x200fr'?'fr200':['ba100','br100','fly100','fr100'][leg];
        const shown=await select.locator('option').evaluateAll(opts=>opts.filter(o=>o.value&&!o.textContent.includes('未記録')).map(o=>o.value));
        assert.deepEqual(shown,fixture.expected[event]);assert.equal(await select.inputValue(),fixture.ids[leg]);
        assert.equal(await select.locator('option').last().textContent().then(text=>text.includes('未記録')),true);
      }
      await page.locator('#relayOk').click();assert.equal(await page.evaluate(()=>window.lineupConfirmed===window.lineupOriginal),true);
      const history=await page.evaluate(()=>{
        const p=state.players[0];p.raceHistory=[];state.teamTop10={};state.recordRankings={};
        for(const [season,slot,meet] of [[2025,20,'joint_record'],[2026,43,'intercollege']])for(const event of ['fr100','br100','4x100fr']){
          const relay=event==='4x100fr';
          for(const stage of ['予選',relay?'決勝':'A決勝'])p.raceHistory.push({season,slot,meet,event,stage,time:relay?200:50,rank:2,...(relay?{legIndex:0,legEvent:'fr100',lapTime:50}:{})});
        }
        window.storedRaceHistory=JSON.stringify(p.raceHistory);showPlayerDetail(p.id);return{id:p.id,stages:p.raceHistory.map(h=>h.stage)};
      });
      await page.locator('[data-detail-view="history"]').click();
      for(const mode of ['recent','event','only_relays','only_fr100','only_4x100fr']){
        await page.locator('#historySort').selectOption(mode);
        const rows=await page.locator('#historyTable tbody tr').evaluateAll(rows=>rows.map(row=>({key:[...row.cells].slice(0,3).map(cell=>cell.textContent).join('|'),stage:row.cells[3].textContent})));
        const groups=new Map();
        for(const row of rows){if(!groups.has(row.key))groups.set(row.key,[]);groups.get(row.key).push(row.stage);}
        assert.ok(groups.size>0);for(const stages of groups.values()){assert.equal(stages.length,2);assert.match(stages[0],/決勝/);assert.equal(stages[1],'予選');}
      }
      assert.equal(await page.evaluate(id=>JSON.stringify(state.players.find(p=>p.id===id).raceHistory)===window.storedRaceHistory,history.id),true);
      await page.locator('.modal-player-detail #x').click();assert.equal(await page.locator('#gameScroll').evaluate(el=>el.inert),false);
      assert.deepEqual(errors,[]);
    }finally{await context.close();}
  }}finally{await app.close();}
});

test('fresh resets keep all PBs and recorded race clocks coherent on PC and iPhone, including offline reload',async()=>{
  const app=await fixture();
  try{for(const options of [{viewport:{width:1280,height:900}},{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]){
    const context=await testContext(options);
    try{
      const page=await context.newPage(),errors=[];
      page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
      await page.goto(app.url);await page.waitForFunction(()=>state?.players?.length&&!localSaveBusy);
      let previous=await page.evaluate(()=>JSON.stringify([state.players,state.world]));
      for(const seed of [24680,54321]){
        await page.evaluate(seed=>Object.defineProperty(crypto,'getRandomValues',{value:a=>{a[0]=seed;return a}}),seed);
        await page.locator('.utility-summary').click();await page.locator('#resetBtn').click();
        await page.waitForFunction(seed=>state?.cpuCompetitionSeed===seed&&!localSaveBusy,seed);
        const result=await page.evaluate(async seed=>{
          const bad=[],races=[];let pbs=0;
          for(const a of [...state.players,...state.world])for(const e of EVENTS){
            const base=expectedTime(a,e),d=distanceOf(e),ranges=MEET_FORM_TIME_RANGES[d],radius=RACE_EXECUTION_RANGE[d],pb=a.bestTimes[e];
            if(validRaceTime(pb)){pbs++;if(pb<base+Math.min(...ranges.map(r=>r[0]))-radius-.025||pb>base+Math.max(...ranges.map(r=>r[1]))+radius+PRELIMINARY_TIME_DELAY[d][1]+.025)bad.push({id:a.id,e,pb,base})}
            else if(!state.players.includes(a))bad.push({id:a.id,e,reason:'missing PB'});
          }
          const profiles=JSON.stringify([state.players,state.world]);
          if(seed===24680)for(const a of [state.players[0],...['middle','high','university','adult'].map(c=>state.world.find(a=>a.category===c))])for(const e of EVENTS)for(const preliminary of [true,false]){
            const base=expectedTime(a,e),r=withMeetRaceContext('japan_open',60,2026,()=>simulateRace(a,e,true,true,false,preliminary));
            races.push({event:e,total:r.total,expected:round2(base+r.physics.formCorrection+r.physics.raceCorrection+(r.physics.preliminaryDelay||0)),base,actualBase:r.physics.abilityBase,
              splits:round2(r.splits.reduce((sum,t)=>sum+t,0)),last:r.cumulative.at(-1),finish:r.trajectory.at(-1).t});
          }
          await saveLocal();return{bad,pbs,races,profiles,stable:profiles===JSON.stringify([state.players,state.world]),world:state.world.length,own:state.players.length};
        },seed);
        assert.deepEqual(result.bad,[]);assert.equal(result.pbs,result.world*15);assert.equal(result.own,32);
        assert.ok(result.stable);assert.notEqual(result.profiles,previous);previous=result.profiles;
        for(const r of result.races){for(const key of ['expected','splits','last'])assert.equal(r[key],r.total,JSON.stringify(r));assert.equal(r.base,r.actualBase);assert.ok(Math.abs(r.finish-r.total)<1e-7)}
      }
      await page.evaluate(()=>navigator.serviceWorker.ready);await context.setOffline(true);
      const response=await page.reload();assert.ok(response.fromServiceWorker());await page.waitForFunction(()=>state?.cpuCompetitionSeed===54321&&!localSaveBusy);
      assert.equal(await page.evaluate(()=>JSON.stringify([state.players,state.world])),previous);assert.deepEqual(errors,[]);
    }finally{await context.close()}
  }}finally{await app.close()}
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
    await page.waitForFunction(()=>state?.players?.length&&!localSaveBusy);
    const original=await page.evaluate(async()=>{
      renamePlayerUniversity('保持した自大学');
      state.universities.forEach((u,i)=>renameOrganization('university',i,`保持した大学${i+1}`));
      for(const cat of ['middle','high','adult'])organizationNames()[cat].forEach((n,i)=>renameOrganization(cat,i,`保持した${cat}${i+1}`));
      state.season=2032;state.slot=59;state.points=888;state.reputation=310;
      STATS.forEach(k=>{state.facilities[k]=75;state.players[0].stats[k]=165});
      state.universities[0].reputation=500;state.players[0].bestTimes.fr100=48.01;
      state.meetHistory=[{season:2031,meet:'intercollege',pointsAfter:888}];
      renderAll();await saveLocal();
      return{state:JSON.stringify(state),save:await getLocalSaveStore().read(),
        names:{player:state.playerUniversity,universities:state.universities.map(u=>({id:u.id,name:u.name})),organizations:deepClone(organizationNames())},
        players:JSON.stringify(state.players)};
    });
    await page.locator('.utility-summary').click();await page.locator('#resetBtn').click();
    assert.equal(await page.evaluate(()=>JSON.stringify(state)),original.state);
    assert.equal(await page.evaluate(()=>getLocalSaveStore().read()),original.save);
    acceptReset=true;
    await page.evaluate(()=>Object.defineProperty(crypto,'getRandomValues',{value:array=>{array[0]=24680;return array;}}));
    await page.locator('.utility-summary').click();await page.locator('#resetBtn').click();
    await page.waitForFunction(()=>state.season===2026&&state.points===0);
    const reset=await page.evaluate(async()=>({
      names:{player:state.playerUniversity,universities:state.universities.map(u=>({id:u.id,name:u.name})),organizations:deepClone(organizationNames())},
      season:state.season,slot:state.slot,points:state.points,reputation:state.reputation,
      facilities:Object.values(state.facilities),count:state.players.length,players:JSON.stringify(state.players),
      ownAffiliations:state.players.every(p=>p.organization===state.playerUniversity),
      cpuFresh:state.universities.every(u=>u.reputation===initialUniversityReputation(u.strength)),
      worldAffiliations:state.world.every(a=>a.category==='university'?state.universities.some(u=>u.name===a.organization):organizationNames()[a.category].includes(a.organization)),
      everyOrgPopulated:['middle','high','adult'].every(cat=>organizationNames()[cat].every(n=>state.world.some(a=>a.category===cat&&a.organization===n)))&&state.universities.every(u=>state.world.some(a=>a.category==='university'&&a.organization===u.name)),
      history:state.meetHistory.length,savedNames:JSON.parse(await getLocalSaveStore().read()).organizationNames,
      reputationLabel:reputationLabel(state.reputation),favorites:state.favoriteRivals,
      depthRank:1+state.universities.filter(u=>initialTeamDepthScore(state.world.filter(a=>a.category==='university'&&a.organization===u.name))>initialTeamDepthScore(state.players)).length,
      pbMismatches:state.world.flatMap(a=>EVENTS.flatMap(e=>{
        const base=expectedTime(a,e),pb=a.bestTimes[e],d=distanceOf(e),ranges=MEET_FORM_TIME_RANGES[d],radius=RACE_EXECUTION_RANGE[d];
        return validRaceTime(pb)&&(pb<base+Math.min(...ranges.map(r=>r[0]))-radius-.025||pb>base+Math.max(...ranges.map(r=>r[1]))+radius+PRELIMINARY_TIME_DELAY[d][1]+.025)?[{id:a.id,e,pb,base}]:[];
      }))
    }));
    assert.deepEqual(reset.names,original.names);
    assert.deepEqual([reset.season,reset.slot,reset.points,reset.reputation,reset.count,reset.history],[2026,1,0,50,32,0]);
    assert.ok(reset.facilities.every(v=>v===0));assert.notEqual(reset.players,original.players);
    assert.ok(reset.ownAffiliations&&reset.cpuFresh&&reset.worldAffiliations&&reset.everyOrgPopulated);
    assert.deepEqual(reset.savedNames,original.names.organizations);
    assert.deepEqual(reset.pbMismatches,[]);
    assert.equal(reset.reputationLabel,'発展途上');assert.deepEqual(reset.favorites,[]);
    assert.ok(reset.depthRank>=30&&reset.depthRank<=40,JSON.stringify({depthRank:reset.depthRank}));
    assert.ok(dialogs.filter(d=>d.type==='confirm').every(d=>/30〜40位/.test(d.message)&&/仕様は保持/.test(d.message)&&/ポイント・施設/.test(d.message)));
    await page.reload();
    await page.waitForFunction(()=>state?.players?.length&&!localSaveBusy);
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

async function acceptMeetGrowth(page){
  while(await page.locator('.modal-meet-growth').count()){
    const expected=await page.evaluate(()=>state.pendingMeetGrowthRewards[0].gains.length);
    assert.equal(await page.locator('.modal-meet-growth tbody tr').count(),expected);
    assert.match(await page.locator('.modal-meet-growth .notice').innerText(),/通常練習の想定成長量の2倍/);
    await page.locator('.modal-meet-growth #next').click();
  }
}

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
          state.reputation=149;state.meetParticipationHistory=[{season:2025,meet:'intercollege',individualOnly:true,counts:{player:0}}];
          const entries=Object.fromEntries(EVENTS.map(e=>[e,e==='fr100'?[swimmer.id]:[]]));
          showEntryConfirmation('intercollege',entries,{},42,2026);
          return {id:swimmer.id,kept:kept.id};
        });
        await page.locator('#goRace').click();await advanceToRace(page);
        assert.ok(await page.evaluate(id=>state.players.some(p=>p.id===id),setup.id));
        assert.equal(await page.evaluate(()=>state.reputation),149);
        assert.ok(await page.evaluate(()=>state.pendingMeetCompletion?.meet==='intercollege'));
        await drainRaces(page);
        assert.equal(await page.evaluate(()=>state.reputation),157);
        assert.equal(await page.locator('#homeRep').innerText(),'中堅');
        assert.ok(await page.evaluate(id=>!state.players.some(p=>p.id===id)&&!state.trainingPlans[id]&&!state.trainingFocus[id],setup.id));
        assert.ok(await page.evaluate(id=>state.players.some(p=>p.id===id&&p.year===4),setup.kept));
        assert.equal(await page.evaluate(async()=>JSON.parse(await getLocalSaveStore().read()).reputation),157);
        await page.locator('.modal-meet-results #x').click();await acceptMeetGrowth(page);
        await page.locator('.modal-season-notice').waitFor();
        assert.match(await page.locator('.modal-season-notice').innerText(),/発展途上 → 中堅/);
        assert.match(await page.locator('.modal-season-notice').innerText(),/引退確認 選手/);
        if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-season-${mobile?'iphone':'pc'}.png`)});}
        await page.reload();await page.locator('.modal-season-notice').waitFor();
        assert.equal(await page.evaluate(()=>state.reputation),157);assert.equal(await page.evaluate(()=>state.reputationEvaluations.length),1);
        await page.locator('#seasonNoticeNext').click();await page.evaluate(()=>autoSaveNow());await page.reload();
        await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy);
        assert.equal(await page.locator('.modal-season-notice').count(),0);
        assert.equal(await page.locator('#modalRoot .modal').count(),0,await page.locator('#modalRoot').innerText());
        await page.locator('#nav [data-page="roster"]').click();
        assert.doesNotMatch(await page.locator('#rosterTable').innerText(),/引退確認 選手|早熟|晩成|通常型|成長タイプ/);
        await page.locator(`#rosterTable [data-detail="${setup.kept}"]`).click();
        assert.doesNotMatch(await page.locator('.modal-player-detail').innerText(),/早熟|晩成|通常型|成長タイプ/);
        await page.locator('.modal-player-detail #x').click();
        const national=await page.evaluate(()=>{
          for(const meet of ['japan_open','japan_championship'])state.meetParticipationHistory.push({season:2025,meet,individualOnly:true,counts:{player:2}});
          const own=state.players[0];completeMeet({meet:'japan_open',season:2026,events:{fr100:{prelim:[{source:'PLAYER',athlete:own}],final:[]}},relays:[]});const before=state.reputation;
          completeMeet({meet:'japan_championship',season:2026,events:{},relays:[]});saveLocal();showPendingSeasonNotices(()=>renderAll());
          return {before,after:state.reputation};
        });
        assert.deepEqual(national,{before:157,after:109});assert.match(await page.locator('.modal-season-notice').innerText(),/日本選手権終了/);
        assert.match(await page.locator('.modal-season-notice').innerText(),/中堅 → 発展途上/);
        await page.locator('#seasonNoticeNext').click();assert.deepEqual(errors,[]);
      }finally{await context.close();}
    }
  }finally{await app.close();}
});

test('college awards and all three historic record categories work on PC and portrait iPhone and survive reload',async()=>{
  const app=await fixture();
  try{for(const options of [{viewport:{width:1280,height:800}},{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]){
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
      await page.locator('#collegeRankingNext').click();await page.locator('.modal-meet-results #x').click();await acceptMeetGrowth(page);
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
      await page.locator('#recordRankingCategory').selectOption('japan');await page.locator('#recordRankingEvent').selectOption('fr100');
      assert.deepEqual(await page.locator('#recordRankingBody .record-time').allTextContents(),['48.00','49.00','50.00']);
      assert.deepEqual(await page.locator('#recordRankingBody .record-school-label').allTextContents(),['社会人','大2','高3']);
      // The fixture deliberately truncated the CPU books. Reconcile their live
      // PBs before taking the save snapshot, just as a real load does.
      const saved=await page.evaluate(async()=>{migrateState();renderAll();await saveLocal();return{records:JSON.stringify(state.recordRankings),times:state.recordRankings.japan.fr100.map(r=>fmt(r.time)),labels:state.recordRankings.japan.fr100.map(recordSchoolLabel)}});
      await page.reload();await page.locator('#nav button[data-page="records"]').click();
      assert.equal(await page.evaluate(()=>JSON.stringify(state.recordRankings)),saved.records);
      await page.locator('#recordRankingCategory').selectOption('japan');await page.locator('#recordRankingEvent').selectOption('fr100');
      assert.deepEqual(await page.locator('#recordRankingBody .record-time').allTextContents(),saved.times);
      assert.deepEqual(await page.locator('#recordRankingBody .record-school-label').allTextContents(),saved.labels);
      assert.equal(await page.locator('#teamTop10Body').isVisible(),false);
      const recordPageWidth=await page.locator('#page-records>.card').first().evaluate(el=>el.clientWidth);
      await page.locator('#showTeamTop10Btn').click();
      await page.locator('#page-team-top10.active').waitFor();
      assert.equal(await page.locator('#page-records.active').count(),0);
      assert.equal(await page.locator('#showTeamTop10Btn').getAttribute('aria-current'),'page');
      assert.equal(await page.locator('#modalRoot .modal').count(),0);
      assert.equal(await page.locator('#teamTop10Panel').evaluate(el=>el.clientWidth),recordPageWidth);
      assert.equal(await page.locator('#teamTop10Event option').count(),18);
      assert.ok(await page.locator('#teamTop10Body').isVisible());
      assert.match(await page.locator('#teamTop10Body').innerText(),/記録確認選手/);
      assert.equal(await page.locator('#teamTop10Title').innerText(),'100mFr 歴代10傑');
      if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-team-top10-${options.isMobile?'iphone':'pc'}.png`)});}
      await page.locator('#nav [data-page="records"]').click();
      assert.equal(await page.locator('#page-team-top10').isVisible(),false);
      assert.equal(await page.locator('#page-records.active').count(),1);assert.deepEqual(errors,[]);
    }finally{await context.close()}
  }
  }finally{await app.close()}
});

test('team relay top tens show each ordered swimmer and lap on PC and portrait iPhone, recover saved legacy splits and persist offline',async()=>{
  const app=await fixture();
  try{for(const options of [{viewport:{width:1280,height:800}},{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]){
    const context=await testContext(options);
    try{
      const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);
      const data=await page.evaluate(()=>{
        state.slot=43;state.teamTop10={};state.recordRankings={};
        const members=state.players.slice(0,4);members.forEach(p=>p.raceHistory=[]);
        const rows=RELAYS.map((event,i)=>{
          const legs=i===0?[50.01,51.02,52.03,53.04]:i===1?[120.25,119.75,122.5,121.5]:[53.1,60.25,51.9,null];
          const time=i===2?214:round2(legs.reduce((a,b)=>a+b,0));
          upsertRelayTop10(event,members,time,'intercollege','決勝',i===0?legs:[]);
          if(i){
            delete state.teamTop10[event][0].legs;
            recordRelayResult(event,{organization:state.playerUniversity,members,rank:2,race:{total:time,legs}},'intercollege','決勝');
            if(i===2){delete state.recordRankings.university[event];delete state.recordRankings.japan[event]}
          }
          return{event,total:fmt(time),laps:legs.map(fmt),labels:members.map((_,j)=>`${j+1}泳 ${EVENT_LABEL[relayLegEvent(event,j)]}`)};
        });
        upsertIndividualTop10('fr100',members[0],49,'intercollege','決勝');
        state.retiredArchive.push({...deepClone(members[3]),season:state.season,reason:'大学卒業・競技終了'});
        state.players=state.players.filter(p=>p.id!==members[3].id);
        return{rows,names:members.map(p=>p.name),saved:JSON.stringify(state.teamTop10)};
      });
      await page.locator('#showTeamTop10Btn').click();
      for(const row of data.rows){
        await page.locator('#teamTop10Event').selectOption(row.event);
        assert.equal(await page.locator('#teamTop10Body th').nth(2).innerText(),'メンバー / ラップ');
        assert.equal(await page.locator('#teamTop10Body td').nth(1).innerText(),row.total);
        assert.deepEqual(await page.locator('#teamTop10Body .top10-relay-lap').allTextContents(),row.laps);
        assert.deepEqual(await page.locator('#teamTop10Body .top10-relay-order').allTextContents(),row.labels);
        assert.equal(await page.locator('#teamTop10Body .active-athlete').count(),3);
        const names=await page.locator('#teamTop10Body .top10-relay-name').allTextContents();
        data.names.forEach((name,i)=>assert.ok(names[i].includes(name)));
        const bounds=await page.locator('#teamTop10Body .top10-relay-leg').evaluateAll(legs=>legs.map(leg=>{
          const cell=leg.closest('td').getBoundingClientRect(),lap=leg.querySelector('.top10-relay-lap').getBoundingClientRect();
          return{inside:lap.left>=cell.left&&lap.right<=cell.right+1,fits:leg.scrollWidth<=leg.clientWidth+1};
        }));
        assert.ok(bounds.every(b=>b.inside&&b.fits),JSON.stringify(bounds));
        if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-top10-relay-${row.event}-${options.isMobile?'iphone':'pc'}.png`)});}
      }
      await page.locator('#teamTop10Event').selectOption('fr100');
      assert.equal(await page.locator('#teamTop10Body th').nth(2).innerText(),'選手');assert.equal(await page.locator('#teamTop10Body .top10-relay-leg').count(),0);
      assert.equal(await page.evaluate(()=>JSON.stringify(state.teamTop10)),data.saved);
      await page.evaluate(async()=>{await saveLocal();await navigator.serviceWorker.ready});await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
      await context.setOffline(true);await page.reload();await page.locator('#showTeamTop10Btn').click();
      for(const row of data.rows){await page.locator('#teamTop10Event').selectOption(row.event);assert.deepEqual(await page.locator('#teamTop10Body .top10-relay-lap').allTextContents(),row.laps)}
      assert.equal(await page.evaluate(()=>JSON.stringify(state.teamTop10)),data.saved);assert.deepEqual(errors,[]);
    }finally{await context.close()}
  }}finally{await app.close()}
});

const DETAIL_PB_ROWS = [
 ['fr50','fr100'],['fr200','fr400'],
 ['ba50','ba100'],['ba200'],
 ['br50','br100'],['br200'],
 ['fly50','fly100'],['fly200'],
 ['im200','im400'],
];

test('own and rival PBs show only the fastest cleared standard across lists, training, details and favorites on PC and phones',async()=>{
 const app=await fixture();
 try{for(const mobile of [false,true]){
  const context=await testContext({viewport:mobile?{width:390,height:844}:{width:1440,height:900},isMobile:mobile,hasTouch:mobile});
  try{
   const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);await page.waitForFunction(()=>state?.players?.length===32&&!localSaveBusy);
   const data=await page.evaluate(()=>{
    const university=state.universities[0],own=state.players.slice(0,5),cpu=rivalUniversityRoster(university.id).slice(0,5);
    const times=[STANDARDS.japan_championship.fr100,STANDARDS.japan_open.fr100,STANDARDS.intercollege.fr100,STANDARDS.intercollege.fr100+.01,null];
    for(const roster of [own,cpu])roster.forEach((a,i)=>{a.specialty='fr100';a.bestTimes.fr100=times[i];if(i===0)for(const e of EVENTS)a.bestTimes[e]=STANDARDS.japan_championship[e]});
    selectedTrainingId=own[0].id;selectedRivalRegion=university.region;selectedRivalUniversityId=university.id;setFavoriteRival(cpu[0].id,true);renderAll();
    window.pbTagProtected=JSON.stringify([state.players,state.world,state.rngSeed,state.recordBook,state.teamTop10]);
    return{own:own.map(a=>a.id),cpu:cpu.map(a=>a.id),times:times.map(fmt),university:university.id};
   });
   const tags=['japan_championship','japan_open','intercollege',null,null];
   const check=async(root,expected)=>{
    assert.deepEqual(await root.locator('[data-pb-standard]').evaluateAll(nodes=>nodes.map(n=>n.dataset.pbStandard)),expected?[expected]:[]);
    if(expected==='japan_championship')assert.equal(await root.locator('[data-pb-standard]').innerText(),'選手権標準');
   };
   const fits=async selector=>{
    const failures=await page.locator(selector).evaluateAll(nodes=>nodes.flatMap(n=>{
     const pb=n.querySelector('b'),tag=n.querySelector('[data-pb-standard]');
     const fits=n.scrollWidth<=n.clientWidth+1&&(!tag||tag.offsetLeft+tag.offsetWidth<=n.offsetLeft+n.offsetWidth+1&&tag.offsetLeft>=pb.offsetLeft+pb.offsetWidth-1&&Math.abs(tag.offsetTop+tag.offsetHeight/2-pb.offsetTop-pb.offsetHeight/2)<3);
     return fits?[]:[{text:n.textContent,width:n.clientWidth,scroll:n.scrollWidth}];
    }));assert.deepEqual(failures,[],selector+' fits with its tag beside the PB');
   };
   const twoColumnPBs=async()=>{
    const layout=await page.locator('.modal-player-detail .detail-pb-grid').evaluate(grid=>{
     const rows=[...grid.children],lines=new Map();
     for(const row of rows){if(!lines.has(row.offsetTop))lines.set(row.offsetTop,[]);lines.get(row.offsetTop).push(row.dataset.playerPb||row.dataset.rivalPb)}
     return{count:rows.length,columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,
      eventRows:[...lines.values()],
      overflow:rows.some(row=>row.scrollWidth>row.clientWidth+1)||grid.scrollWidth>grid.clientWidth+1};
    });assert.deepEqual(layout,{count:15,columns:2,eventRows:DETAIL_PB_ROWS,overflow:false});
   };
   await page.locator('#nav [data-page="roster"]').click();
   for(let i=0;i<5;i++)await check(page.locator(`#rosterTable [data-detail="${data.own[i]}"]`).locator('xpath=ancestor::tr'),tags[i]);
   await page.locator(`#rosterTable [data-detail="${data.own[0]}"]`).click();
   assert.equal(await page.locator('[data-player-pb] [data-pb-standard="japan_championship"]').count(),15);await twoColumnPBs();await fits('.modal-player-detail .pb-with-standard');
   if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`pb-standard-detail-${mobile?'phone':'pc'}.png`)})}
   await page.locator('.modal-player-detail #x').click();await page.locator('#nav [data-page="training"]').click();
   for(let i=0;i<5;i++)await check(page.locator(`#trainingPlayers [data-id="${data.own[i]}"]`),tags[i]);
   await page.locator(`#trainingPlayers [data-id="${data.own[0]}"]`).click();await check(page.locator('#trainingSpecialty'),tags[0]);
   await fits('#trainingPlayers .pb-with-standard');
   assert.ok(await page.locator('#trainingPlayers').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'training list has no horizontal clipping');
   if(process.env.SWIM_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`pb-standard-training-${mobile?'phone':'pc'}.png`)});
   await page.locator('#nav [data-page="rivals"]').click();await page.locator('#rivalUniversity').selectOption(data.university);
   for(let i=0;i<5;i++)await check(page.locator(`[data-rival-row="${data.cpu[i]}"]`),tags[i]);
   await page.locator(`[data-rival-athlete="${data.cpu[0]}"]`).click();assert.equal(await page.locator('[data-rival-pb] [data-pb-standard="japan_championship"]').count(),15);await twoColumnPBs();await fits('.modal-rival-player .pb-with-standard');await page.locator('.modal-rival-player #x').click();
   await page.locator('[data-rival-view="events"]').click();await check(page.locator('[data-rival-event="fr100"] td').first(),tags[0]);
   await page.locator('#favoriteRivalsBtn').click();await check(page.locator(`[data-favorite-row="${data.cpu[0]}"]`),tags[0]);await fits('.favorite-rival-pb .pb-with-standard');await page.locator('#favoriteRivalsClose').click();
   assert.ok(await page.evaluate(()=>window.pbTagProtected===JSON.stringify([state.players,state.world,state.rngSeed,state.recordBook,state.teamTop10])),'displaying badges changes no athletes, PBs, RNG or records');
   await page.evaluate(async()=>{await saveLocal();await navigator.serviceWorker.ready});await context.setOffline(true);await page.reload();await page.waitForFunction(()=>state?.players?.length===32&&!localSaveBusy);
   await page.locator('#favoriteRivalsBtn').click();await check(page.locator(`[data-favorite-row="${data.cpu[0]}"]`),tags[0]);assert.deepEqual(errors,[]);
  }finally{await context.close()}
 }}finally{await app.close()}
});

test('detail PBs stay on one line in two columns with stable desktop and touch sizes', async () => {
  const app = await fixture();
  try {
    for (const mobile of [false, true]) {
      const sizes = mobile ? [[844,390],[390,844],[740,360],[360,740],[667,375],[375,667],[568,320],[320,568],[1024,768],[768,1024],[844,390]]
        : [[1440,900],[1100,900],[1061,900],[951,900],[950,900],[900,900],[700,900],[390,900],[320,900],[1440,900]];
      const context = await testContext({viewport:{width:sizes[0][0],height:sizes[0][1]},isMobile:mobile,hasTouch:mobile});
      try {
        const page = await context.newPage(), errors = runtimeErrors(page);
        await page.goto(app.url);
        await page.waitForFunction(()=>state?.players?.length===32&&!localSaveBusy);
        const data = await page.evaluate(() => {
          const own=state.players[0],cpu=rivalUniversityRoster(state.universities[0].id)[0];
          for(const p of [own,cpu]){
            p.specialty='fr100';p.stats=Object.fromEntries(STATS.map(k=>[k,150]));p.imAptitude={speed:0,stamina:0};p.accolades=[];p.raceHistory=[];
            p.raceHistory=Array.from({length:64},(_,i)=>({season:2026,slot:43,meet:'intercollege',event:i%2?'4x100fr':'fr100',stage:'決勝',rank:8,time:i%2?220+i/100:51+i/100,...(i%2?{legIndex:1,legEvent:'fr100',lapTime:54.25}:{}),newlyCleared:[],pb:false}));
            for(const [event,rank,time]of [['fr100',1,50.21],['fr200',2,109.65],['fly100',3,53.62]])upsertMainResult(p,{season:2026,slot:43,meet:'intercollege',event,rank,time,stage:'決勝',gradeAtRecord:2,schoolLabel:'大2',categoryAtRecord:'university',organization:p.organization});
            p.bestTimes={fr50:23.25,fr100:50.21,fr200:109.65,fr400:950,ba50:null,ba100:56.88,ba200:123.45,br50:28.71,br100:62.18,br200:135.05,fly50:24.21,fly100:53.62,fly200:122.03,im200:124.82,im400:265.10};
          }
          return{own:own.id,cpu:cpu.id,university:state.playerUniversity,protected:JSON.stringify([state.players,state.world,state.rngSeed,state.recordBook,state.teamTop10])};
        });
        const ownOverviewBySize=new Map();
        for(const rival of [false,true]){
          await page.evaluate(({rival,data})=>rival?showRivalPlayerDetail(data.cpu):showPlayerDetail(data.own),{rival,data});
          if(!rival){
            assert.doesNotMatch(await page.locator('.modal-player-detail .rival-detail-meta').innerText(),new RegExp(data.university));
            assert.equal(await page.locator('.detail-training-guide #detailTrainingNote').count(),1);
            assert.equal(await page.locator('.detail-training-guide .stat-rank-legend .rank-legend-item').count(),8);
            assert.equal(await page.locator('.detail-own-tools .stat-rank-legend').count(),0);
          }
          assert.equal(await page.locator('[data-detail-view]').count(),2);
          assert.ok(await page.locator('#detailOverviewPanel').isVisible());
          assert.ok(await page.locator('#detailHistoryPanel').isHidden());
          assert.ok(await page.locator('.detail-major-results').evaluate(el=>{const s=getComputedStyle(el);return s.borderTopStyle==='solid'&&parseFloat(s.borderTopWidth)>=1&&parseFloat(s.borderRadius)>=8&&parseFloat(s.paddingLeft)>=8}));
          for(const [width,height] of sizes){
            await page.setViewportSize({width,height});
            await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
            const layout=await page.locator('.modal-player-detail').evaluate(m=>{
              const grid=m.querySelector('.detail-pb-grid'),rows=[...grid.children],rotated=document.getElementById('gameViewport').classList.contains('landscape-rotated');
              const lines=new Map();for(const row of rows){if(!lines.has(row.offsetTop))lines.set(row.offsetTop,[]);lines.get(row.offsetTop).push(row.dataset.playerPb||row.dataset.rivalPb)}
              const crossCenter=el=>{const r=el.getBoundingClientRect();return rotated?r.left+r.width/2:r.top+r.height/2};
              const overflow=rows.flatMap(row=>[row,row.firstElementChild,row.lastElementChild,...row.querySelectorAll('b,[data-pb-standard]')])
                .filter(el=>el.scrollWidth>el.clientWidth+1).map(el=>el.textContent);
              const measure=el=>{const style=getComputedStyle(el);return{width:el.offsetWidth,height:el.offsetHeight,font:style.fontSize,weight:style.fontWeight,lineHeight:style.lineHeight,padding:style.padding}};
              const sharedOverview={stats:measure(m.querySelector('.detail-stat-section')),statRows:[...m.querySelectorAll('.stat-detail-row')].map(measure),statLabels:[...m.querySelectorAll('.stat-detail-label')].map(measure),statValues:[...m.querySelectorAll('[data-stat] .stat-number')].map(measure),pb:measure(m.querySelector('.detail-pb-section')),pbRows:rows.map(measure),pbTimes:rows.map(row=>measure(row.querySelector('b'))),major:measure(m.querySelector('.detail-major-results')),majorHeading:measure(m.querySelector('.detail-major-results h3')),majorList:measure(m.querySelector('.major-result-list')),majorRows:[...m.querySelectorAll('.major-result')].map(measure)};
              const blockBounds=el=>{const rect=el.getBoundingClientRect();return rotated?{start:-rect.right,end:-rect.left}:{start:rect.top,end:rect.bottom}};
              const tools=m.querySelector('.detail-own-tools'),overviewEnd=Math.max(blockBounds(m.querySelector('.detail-stat-section')).end,blockBounds(m.querySelector('.detail-pb-section')).end);
              const ownToolsBelow=!tools||blockBounds(tools).start>=overviewEnd-1;
              const statRows=[...m.querySelectorAll('.stat-detail-row')],statGrid=m.querySelector('.detail-stat-grid');
              const statPairs=statRows.every((row,i)=>i%2===1||row.offsetTop===statRows[i+1].offsetTop&&row.offsetLeft<statRows[i+1].offsetLeft);
              const statColumns=getComputedStyle(statGrid).gridTemplateColumns.split(' ').length;
              const alongBounds=el=>{const rect=el.getBoundingClientRect();return rotated?{start:rect.top,end:rect.bottom}:{start:rect.left,end:rect.right}};
              const separatedStatNames=statRows.every(row=>alongBounds(row.firstElementChild).end<=alongBounds(row.lastElementChild).start+1);
              const guide=m.querySelector('.detail-training-guide'),meta=m.querySelector('.rival-detail-meta');
              const guideUnderName=!guide||guide.previousElementSibling===m.firstElementChild&&blockBounds(guide).start>=blockBounds(m.firstElementChild).end-1&&blockBounds(guide).end<=blockBounds(meta).start+1;
              return{statPairs,statColumns,separatedStatNames,guideUnderName,ownToolsBelow,sharedOverview,count:rows.length,columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,
                eventRows:[...lines.values()],
                singleLine:rows.every(row=>Math.abs(crossCenter(row.firstElementChild)-crossCenter(row.lastElementChild))<1),
                overflow,modalOverflow:m.scrollWidth-m.clientWidth,sectionOverflow:grid.scrollWidth-grid.clientWidth,
                statWidths:[...m.querySelectorAll('.stat-detail-row')].map(row=>row.offsetWidth),rowHeight:rows[0].offsetHeight,pbOnRight:m.querySelector('.detail-stat-section').offsetTop===m.querySelector('.detail-pb-section').offsetTop&&m.querySelector('.detail-stat-section').offsetLeft<m.querySelector('.detail-pb-section').offsetLeft,
                fonts:[getComputedStyle(rows[0]).fontSize,getComputedStyle(rows[0].querySelector('b')).fontSize,getComputedStyle(m.querySelector('[data-pb-standard]')).fontSize],
                textSizeAdjust:getComputedStyle(m).getPropertyValue('text-size-adjust'),
                clippedStats:[...m.querySelectorAll('.stat-detail-label')].filter(el=>el.scrollWidth>el.clientWidth+1).map(el=>({text:el.textContent,width:el.clientWidth,content:el.scrollWidth}))};
            });
            const where=JSON.stringify({mobile,rival,width,height,layout});
            assert.ok(layout.ownToolsBelow,'ability help follows the entire overview without overlap');
            assert.ok(layout.guideUnderName,'training guidance is immediately below the player name');
            assert.equal(layout.statColumns,2,'stats retain two columns at '+width+'x'+height);assert.ok(layout.statPairs,where);assert.ok(layout.separatedStatNames,where);
            const sizeKey=width+'x'+height;
            if(rival)assert.deepEqual(layout.sharedOverview,ownOverviewBySize.get(sizeKey),'own and rival regions have identical sizes at '+sizeKey);
            else ownOverviewBySize.set(sizeKey,layout.sharedOverview);
            assert.deepEqual(layout.fonts,mobile?['12px','13px','10px']:['16px','17px','13px'],where);
            assert.ok(layout.singleLine,where);
            if(mobile)assert.ok(layout.pbOnRight,where);else{assert.equal(layout.rowHeight,36,where);assert.deepEqual([...new Set(layout.statWidths)],[192],where)}
            assert.deepEqual(layout.clippedStats,[],where);
            assert.equal(layout.textSizeAdjust,'100%',where);
            assert.equal(layout.count,15,where);assert.equal(layout.columns,2,where);assert.deepEqual(layout.eventRows,DETAIL_PB_ROWS,where);
            assert.deepEqual(layout.overflow,[],where);assert.ok(layout.modalOverflow<=1&&layout.sectionOverflow<=1,where);
            assert.equal(await page.locator('[data-'+(rival?'rival':'player')+'-pb="fr400"] b').innerText(),'15:50.00');
            await page.locator('.pb-detail-row').last().scrollIntoViewIfNeeded();
            assert.ok(await page.locator('.pb-detail-row').last().isVisible());
            if(process.env.SWIM_SCREENSHOT_DIR&&width===sizes[0][0]&&height===sizes[0][1]){
              fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});
              await page.locator('.modal-player-detail').evaluate(m=>m.querySelector('.detail-stats-pb').scrollTop=0);
              await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`detail-pb-${rival?'rival':'own'}-${mobile?'phone':'pc'}.png`)});
            }
          }
          await page.setViewportSize({width:mobile?667:390,height:mobile?375:900});
          const overviewScroll=await page.locator('#detailOverviewPanel').evaluate(panel=>{panel.scrollTop=90;const pb=panel.querySelector('.detail-pb-section');pb.scrollLeft=50;return{top:panel.scrollTop,pbLeft:pb.scrollLeft}});
          await page.locator('[data-detail-view="history"]').click();
          assert.ok(await page.locator('#detailOverviewPanel').isHidden());assert.ok(await page.locator('#detailHistoryPanel').isVisible());
          assert.equal(await page.locator('[data-detail-view="history"]').getAttribute('aria-selected'),'true');
          await page.locator('#historySort').selectOption('only_4x100fr');
          assert.ok(await page.locator('#historyTable tbody tr').count()>=32);
          assert.equal(await page.locator('#historyTable .history-lap b').first().innerText(),'54.25');
          const historyScroll=await page.locator('#historyTable').evaluate(table=>{table.scrollTop=120;table.scrollLeft=80;return{top:table.scrollTop,left:table.scrollLeft}});
          assert.ok(historyScroll.top>0&&historyScroll.left>0,JSON.stringify(historyScroll));
          await page.locator('[data-detail-view="history"]').focus();await page.keyboard.press('ArrowLeft');
          assert.ok(await page.locator('#detailOverviewPanel').isVisible());assert.equal(await page.locator('[data-detail-view="overview"]').evaluate(el=>el===document.activeElement),true);
          assert.deepEqual(await page.locator('#detailOverviewPanel').evaluate(panel=>({top:panel.scrollTop,pbLeft:panel.querySelector('.detail-pb-section').scrollLeft})),overviewScroll);
          await page.locator('[data-detail-view="history"]').click();
          assert.equal(await page.locator('#historySort').inputValue(),'only_4x100fr');
          assert.deepEqual(await page.locator('#historyTable').evaluate(table=>({top:table.scrollTop,left:table.scrollLeft})),historyScroll);
          await page.locator('[data-detail-view="history"]').focus();await page.keyboard.press('Home');
          assert.ok(await page.locator('#detailOverviewPanel').isVisible());
          await page.locator('.modal-player-detail #x').click();
        }
        assert.equal(await page.evaluate(()=>JSON.stringify([state.players,state.world,state.rngSeed,state.recordBook,state.teamTop10])),data.protected);
        assert.deepEqual(errors,[]);
      } finally { await context.close(); }
    }
  } finally { await app.close(); }
});


test('history places each meet score below medalists and compact pages keep roster data on one line',async()=>{
 const app=await fixture();
 try{for(const mobile of [false,true]){
  const context=await testContext({viewport:mobile?{width:740,height:360}:{width:1440,height:960},isMobile:mobile,hasTouch:mobile}),page=await context.newPage(),errors=runtimeErrors(page);
  try{
   await page.goto(app.url);await page.waitForFunction(()=>state?.players?.length===32&&!localSaveBusy);
   const own=await page.evaluate(()=>{
    const p=state.players[0],name=state.playerUniversity;
    state.teamPodiumHistory=[{kind:'individual',season:2026,meet:'intercollege',event:'fr100',rank:1,time:50.21,athleteId:p.id,name:p.name,organization:name,gradeAtRecord:2,schoolLabel:'大2'}];
    state.teamScoreHistory=[{season:2026,meet:'intercollege',scores:{[name]:100,同点大学:100,第三大学:80}},{season:2026,meet:'kansai_college',scores:{[name]:45,関西大学:60}},{season:2024,meet:'intercollege',scores:{[name]:30,過去大学:80}}];
    state.meetHistory.push({season:2023,meet:'kansai_college',teamScores:{[name]:21,保存大学:29}});
    window.scoreProtected=JSON.stringify([state.teamScoreHistory,state.meetHistory,state.teamPodiumHistory,state.points,state.rngSeed]);renderAll();return{name,p:p.name};
   });
   assert.equal(await page.locator('#lastScores').count(),0);
   await page.locator('#showTeamTop10Btn').click();await page.locator('[data-team-record-view="podiums"]').click();await page.locator('[data-team-podium-meet="intercollege"]').click();
   assert.deepEqual(await page.locator('#teamPodiumYear option').allTextContents(),['2026年度','2024年度','2023年度']);
   const scores=page.locator('[data-team-scores="intercollege"]');
   assert.deepEqual(await scores.locator('tbody tr td:first-child').allTextContents(),['1','1','3']);
   assert.equal(await scores.locator('tr.result-own td:nth-child(2)').innerText(),own.name);
   assert.ok(await page.evaluate(()=>!!(document.querySelector('.team-podium-table').compareDocumentPosition(document.querySelector('.team-podium-scores'))&Node.DOCUMENT_POSITION_FOLLOWING)));
   await page.locator('[data-team-podium-meet="kansai_college"]').click();assert.equal(await page.locator('[data-team-scores="kansai_college"] tr.result-own td:nth-child(3)').innerText(),'45pt');
   assert.equal(await page.locator('[data-team-scores="intercollege"]').count(),0);
   await page.locator('[data-team-podium-meet="japan_open"]').click();assert.equal(await page.locator('[data-team-scores]').count(),0);
   await page.locator('#teamPodiumYear').selectOption('2024');await page.locator('[data-team-podium-meet="intercollege"]').click();
   assert.equal(await page.locator('.team-podium-table').count(),0);assert.equal(await page.locator('[data-team-scores] tr.result-own td:nth-child(3)').innerText(),'30pt');
   await page.locator('#teamPodiumYear').selectOption('2023');await page.locator('[data-team-podium-meet="kansai_college"]').click();assert.equal(await page.locator('[data-team-scores] tr.result-own td:nth-child(3)').innerText(),'21pt');
   assert.equal(await page.locator('#page-team-top10 .page-lead p,#teamTop10Panel>p,#teamPodiumPanel>p,#teamAlumniPanel>p').count(),0);
   await page.locator('#nav [data-page="records"]').click();assert.equal(await page.locator('#page-records p').count(),0);assert.equal(await page.locator('#page-settings #saveHistoryStatus').count(),1);
   await page.locator('#nav [data-page="scout"]').click();assert.equal(await page.locator('#page-scout>.page-lead p,#page-scout>.card>p').count(),0);
   const guide=await page.locator('#scoutingGuide').innerText();for(const text of ['接触と競合','競合状況','早期内定','50以上','70以上','12以上','11月末・1月末','3月末','40以上','抽選','最終内定'])assert.ok(guide.includes(text),text);
   await page.locator('#nav [data-page="roster"]').click();
   for(const mode of ['grade_asc','specialty_pb','event_im400']){
    await page.locator('#rosterSortMode').selectOption(mode);
    assert.deepEqual(await page.locator('#rosterTable .pb-with-standard').evaluateAll(nodes=>[...new Set(nodes.map(n=>getComputedStyle(n).fontSize))]),[mobile?'13px':'16px']);
    if(mobile){
     assert.deepEqual(await page.locator('#rosterTable tbody tr').evaluateAll(rows=>rows.flatMap(row=>{
      const cell=row.cells[3],chips=[...row.querySelectorAll('.top-stat-chip')];
      return getComputedStyle(cell).whiteSpace==='nowrap'&&chips.every(chip=>chip.offsetTop===chips[0].offsetTop&&chip.scrollWidth<=chip.clientWidth+1)?[]:[row.textContent];
     })),[]);
     assert.ok(await page.locator('#rosterTable').evaluate(el=>el.scrollWidth>el.clientWidth));
     assert.ok(await page.locator('#gameScroll').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    }
   }
   assert.equal(await page.evaluate(()=>JSON.stringify([state.teamScoreHistory,state.meetHistory,state.teamPodiumHistory,state.points,state.rngSeed])),await page.evaluate(()=>window.scoreProtected));
   if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`compact-roster-${mobile?'phone':'pc'}.png`)})}
   await page.evaluate(async()=>{await saveLocal();await navigator.serviceWorker.ready});await context.setOffline(true);await page.reload();await page.waitForFunction(()=>state?.players?.length===32&&!localSaveBusy);
   await page.locator('#showTeamTop10Btn').click();await page.locator('[data-team-record-view="podiums"]').click();await page.locator('#teamPodiumYear').selectOption('2024');await page.locator('[data-team-podium-meet="intercollege"]').click();
   assert.equal(await page.locator('[data-team-scores] tr.result-own td:nth-child(3)').innerText(),'30pt');
   if(process.env.SWIM_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`history-scores-${mobile?'phone':'pc'}.png`)});
   assert.deepEqual(errors,[]);
  }finally{await context.close()}
 }}finally{await app.close()}
});

test('touch selects open inside the landscape viewport, handle dialogs and keyboard, and preserve drafts offline',async()=>{
 const app=await fixture();
 try{for(const portrait of [false,true]){
  const context=await testContext({viewport:portrait?{width:360,height:740}:{width:740,height:360},isMobile:true,hasTouch:true}),page=await context.newPage(),errors=runtimeErrors(page);
  try{
   await page.goto(app.url);await page.waitForFunction(()=>state?.players?.length===32&&!localSaveBusy);
   await page.locator('#nav [data-page="roster"]').tap();
   await page.evaluate(()=>{window.selectChanges=0;document.getElementById('rosterSortMode').addEventListener('change',()=>window.selectChanges++)});
   const before=await page.evaluate(()=>[document.getElementById('gameScroll').scrollTop,state.rngSeed,state.points]);
   await page.locator('#rosterSortMode').tap();await page.locator('.touch-select-panel').waitFor();
   assert.equal(await page.locator('.touch-select-panel').evaluate(el=>el.closest('#gameViewport').classList.contains('landscape-rotated')),portrait);
   const bounds=await page.locator('.touch-select-panel').boundingBox(),vp=page.viewportSize();assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=vp.width+1&&bounds.y+bounds.height<=vp.height+1);
   assert.equal(await page.locator('#gameScroll').evaluate(el=>el.inert),true);
   if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`landscape-dropdown-${portrait?'portrait':'landscape'}.png`)})}
   await page.locator('#touchSelectOptions').getByRole('option',{name:'専門種目PB順',exact:true}).tap();
   assert.equal(await page.locator('#rosterSortMode').inputValue(),'specialty_pb');assert.equal(await page.evaluate(()=>window.selectChanges),1);assert.equal(await page.locator('#gameScroll').evaluate(el=>el.inert),false);
   assert.deepEqual(await page.evaluate(()=>[document.getElementById('gameScroll').scrollTop,state.rngSeed,state.points]),before);
   await page.locator('#rosterSortMode').tap();await page.locator('.touch-select-header button').tap();assert.equal(await page.evaluate(()=>window.selectChanges),1);
   await page.locator('#rosterSortMode').tap();await page.touchscreen.tap(4,4);assert.equal(await page.locator('.touch-select-panel').count(),0);assert.equal(await page.evaluate(()=>window.selectChanges),1);
   await page.locator('#rosterSortMode').tap();await page.locator('#touchSelectOptions').getByRole('option',{name:'専門種目PB順',exact:true}).tap();assert.equal(await page.evaluate(()=>window.selectChanges),1);
   // Long lists, disabled groups, empty values and cancellation all retain native select semantics.
   await page.evaluate(()=>{const m=showModal('<h2>選択の確認</h2><label>進路<select id="touchFixture"><option value="">未選択</option><optgroup label="選択不可" disabled><option value="disabled">無効候補</option></optgroup><optgroup label="有効"><option value="one">第一候補</option><option value="two">第二候補</option></optgroup><option value="hidden" hidden>非表示</option></select></label>');window.fixtureChanges=0;m.querySelector('select').onchange=()=>window.fixtureChanges++});
   await page.locator('#touchFixture').tap();assert.ok(await page.locator('#touchSelectOptions').getByRole('option',{name:'無効候補'}).isDisabled());assert.equal(await page.locator('#touchSelectOptions').getByRole('option',{name:'非表示'}).count(),0);
   await page.keyboard.press('Escape');assert.equal(await page.locator('#touchFixture').inputValue(),'');assert.equal(await page.locator('#gameScroll').evaluate(el=>el.inert),true);assert.equal(await page.locator('#modalRoot').evaluate(el=>el.inert),false);
   await page.locator('#touchFixture').focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('End');await page.keyboard.press('Enter');
   assert.equal(await page.locator('#touchFixture').inputValue(),'two');assert.equal(await page.evaluate(()=>window.fixtureChanges),1);
   await page.locator('#touchFixture').tap();await page.locator('#touchSelectOptions').getByRole('option',{name:'未選択',exact:true}).tap();assert.equal(await page.locator('#touchFixture').inputValue(),'');
   await page.locator('#touchFixture').tap();await page.evaluate(()=>closeModal());await page.waitForFunction(()=>!document.querySelector('.touch-select-backdrop'));assert.equal(await page.locator('#gameScroll').evaluate(el=>el.inert),false);
   // The same handler covers dynamically created entry and relay selectors.
   await page.evaluate(()=>{state.slot=43;state.players[0].bestTimes.fr100=48;openMeetEntry('intercollege',43,state.season)});
   const select=page.locator('.modal-meet-entry select').first();
   if(await select.count()){await select.tap();await page.locator('.touch-select-panel').waitFor();await page.locator('.touch-select-header button').tap()}
   const entry=page.locator('#entryMatrix input[data-event="fr100"]:not(:disabled)').first();await entry.check();
   const pending=await page.evaluate(async()=>{await saveLocal();await navigator.serviceWorker.ready;return JSON.stringify(state.meetSession.selections)});
   await context.setOffline(true);await page.reload();await page.waitForFunction(()=>state?.meetSession&&!localSaveBusy);await page.locator('.modal-meet-entry').waitFor();
   assert.equal(await page.evaluate(()=>JSON.stringify(state.meetSession.selections)),pending);assert.equal(await page.locator('#entryMatrix input[data-event="fr100"]:checked').count(),1);
   assert.deepEqual(errors,[]);
  }finally{await context.close()}
 }}finally{await app.close()}
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
        const current=await page.evaluate(()=>state.players.map(p=>({id:p.id,stats:p.stats,bestTimes:p.bestTimes})));
        for(const original of JSON.parse(fixture.stable)){
          const saved=current.find(p=>p.id===original.id);assert.deepEqual(saved.stats,original.stats);
          for(const [event,time]of Object.entries(original.bestTimes))assert.equal(saved.bestTimes[event],time);
        }
        // Normalize the artificial IDs, inherited clocks and missing PBs before checking save/reload stability.
        const persisted=await page.evaluate(async()=>{migrateState();await saveLocal();return JSON.stringify(state.players.map(p=>({id:p.id,stats:p.stats,bestTimes:p.bestTimes})))});
        await page.reload();await page.waitForFunction(()=>state?.players?.length&&!localSaveBusy);
        assert.equal(await page.evaluate(id=>state.players.find(p=>p.id===id).specialty,id),'im400');
        assert.deepEqual(await page.evaluate(id=>state.trainingFocus[id],id),['fly_stamina']);
        const reloaded=await page.evaluate(()=>state.players.map(p=>({id:p.id,stats:p.stats,bestTimes:p.bestTimes})));
        for(const original of JSON.parse(persisted))assert.deepEqual(reloaded.find(p=>p.id===original.id),original,original.id);
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

test('all specialty PBs migrate, stay visible for unranked scouts, change with specialty selection and persist offline on PC and iPhone',async()=>{
  const app=await fixture();
  try{for(const mobile of [false,true]){
    const context=await testContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile});
    try{
      const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);await page.waitForFunction(()=>state?.players?.length&&!localSaveBusy);
      assert.equal(await page.evaluate(()=>[...state.players,...state.world].filter(a=>!validRaceTime(a.bestTimes[a.specialty])).length),0);
      const prepared=await page.evaluate(async()=>{
        const own=state.players[0],event=SPECIALTY_EVENTS.find(e=>!validRaceTime(own.bestTimes[e]));own.specialty=event;
        const high=state.world.find(a=>a.category==='high'&&a.grade===3&&Object.keys(a.bestTimes).length===1&&!a.accolades.length);high.name='専門PB 検証候補';
        high.scouted=true;state.recruits=[high.id];delete high.bestTimes[high.specialty];
        state.version='pwa-v2.02';await saveLocal();await navigator.serviceWorker.ready;
        return{own:own.id,high:high.id,event,highEvent:high.specialty,stats:JSON.stringify([own.stats,high.stats]),seed:state.rngSeed,ownExpected:coherentCpuPB(own,event),highExpected:coherentCpuPB(high,high.specialty)};
      });
      await page.reload({waitUntil:'load'});await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy);
      const result=await page.evaluate(({own,high})=>{
        const p=state.players.find(a=>a.id===own),a=state.world.find(a=>a.id===high),fields=highSchoolScoutRankings();
        return{stats:JSON.stringify([p.stats,a.stats]),seed:state.rngSeed,ownPB:p.bestTimes[p.specialty],highPB:a.bestTimes[a.specialty],highRank:scoutHighSchoolRank(a,a.specialty),missing:[...state.players,...state.world].filter(a=>!validRaceTime(a.bestTimes[a.specialty])).length,extra:EVENTS.some(e=>fields.get(e).rows.slice(50).some(a=>a.specialty!==e))};
      },prepared);
      assert.equal(result.stats,prepared.stats);assert.equal(result.seed,prepared.seed);assert.equal(result.ownPB,prepared.ownExpected);assert.equal(result.highPB,prepared.highExpected);assert.ok(result.highRank>50);assert.equal(result.missing,0);assert.equal(result.extra,false);
      await page.locator('#nav [data-page="scout"]').click();const row=page.locator('#scoutTable tr').filter({has:page.locator(`[data-scout="${prepared.high}"]`)});
      assert.doesNotMatch(await row.innerText(),/PBなし/);assert.ok((await row.locator('td').nth(3).innerText()).includes(await page.evaluate(t=>fmt(t),prepared.highExpected)));
      assert.equal(await row.locator('td').nth(2).innerText(),'肩書なし');
      if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await row.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-specialty-scout-${mobile?'iphone':'pc'}.png`)})}
      await page.locator('#nav [data-page="roster"]').click();await page.locator(`[data-specialty="${prepared.own}"]`).click();
      const changed=await page.evaluate(id=>{const p=state.players.find(a=>a.id===id),event=SPECIALTY_EVENTS.find(e=>!validRaceTime(p.bestTimes[e]));return{event,pb:coherentCpuPB(p,event),stats:JSON.stringify(p.stats),seed:state.rngSeed}},prepared.own);
      await page.locator('.modal-specialty-picker #spec').selectOption(changed.event);await page.locator('.modal-specialty-picker #ok').click();
      assert.deepEqual(await page.evaluate(id=>{const p=state.players.find(a=>a.id===id);return{event:p.specialty,pb:p.bestTimes[p.specialty],stats:JSON.stringify(p.stats),seed:state.rngSeed}},prepared.own),changed);
      await page.locator(`[data-detail="${prepared.own}"]`).click();
      const pbDisplay=await page.locator('.detail-pb-grid').innerText();assert.ok(pbDisplay.includes(await page.evaluate(e=>EVENT_LABEL[e],changed.event)));assert.ok(pbDisplay.includes(await page.evaluate(t=>fmt(t),changed.pb)));
      await page.locator('.modal-player-detail #x').click();
      const saved=await page.evaluate(async()=>{await saveLocal();return JSON.stringify([state.world,state.players,state.teamTop10,state.recordRankings,state.rngSeed])});
      await context.setOffline(true);const response=await page.reload({waitUntil:'load'});assert.ok(response.fromServiceWorker());await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy);
      assert.equal(await page.evaluate(()=>JSON.stringify([state.world,state.players,state.teamTop10,state.recordRankings,state.rngSeed])),saved);
      await page.locator('#nav [data-page="scout"]').click();assert.doesNotMatch(await row.innerText(),/PBなし/);
      assert.equal(await page.evaluate(id=>{const p=state.players.find(a=>a.id===id);return p.bestTimes[p.specialty]},prepared.own),changed.pb);assert.deepEqual(errors,[]);
    }finally{await context.close()}
  }}finally{await app.close()}
});

test('existing school PBs migrate once and main final podiums appear below personal bests and persist offline on PC and iPhone',async()=>{
  const app=await fixture();
  try{for(const mobile of [false,true]){
    const context=await testContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile});
    try{
      const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);await page.waitForFunction(()=>state?.players?.length&&!localSaveBusy);
      const prepared=await page.evaluate(async()=>{
        const high=state.world.find(a=>a.category==='high'&&a.grade===3&&Object.keys(a.bestTimes).length===1&&!a.bestTimes.ba100&&!a.accolades.length);
        high.stats.ba_speed=170;high.stats.ba_stamina=170;high.stats.ba_turn=170;high.name='年次計測 高校生';
        const middle=deepClone(state.world.find(a=>a.category==='middle'));middle.id='browser-middle-migration';middle.name='PB整理 中学生';middle.specialty='fr100';middle.accolades=[];middle.recordedPBs={};delete middle.pbEventSelectionVersion;delete middle.discardedPBHistoryEvents;
        for(const s of ['fr','ba','br','fly'])for(const k of ['speed','stamina','turn'])middle.stats[s+'_'+k]=s==='fr'?150:s==='ba'?145:60;
        middle.imAptitude={speed:-20,stamina:-20};attachMedleyStats(middle);middle.bestTimes=Object.fromEntries(EVENTS.map(e=>[e,coherentCpuPB(middle,e)]));state.world.push(middle);
        const p=state.players[0];p.name='表彰台検証 泳者';p.stats=Object.fromEntries(STATS.map(k=>[k,163]));attachMedleyStats(p);p.raceHistory=[];p.accolades=[];state.slot=43;
        for(const [meet,stage,rank,event]of [['intercollege','A決勝',1,'fr100'],['kansai_college','A決勝',2,'ba100'],['japan_open','A決勝',3,'br100'],['japan_championship','予選',1,'fly100'],['japan_open','B決勝',1,'fly100'],['team_trial','記録会',1,'fly50']])updateResultHistory(p,event,round2(expectedTime(p,event)+.3),meet,stage,rank);
        const members=[p,...state.players.slice(1,4)];const race=simulateRelay(members,'4x100fr',true);
        recordRelayResult('4x100fr',{organization:state.playerUniversity,members,race,rank:2},'intercollege','決勝');p.accolades=[];
        delete state.schoolPBModelVersion;delete state.highSchoolPBMeasurementSeason;delete state.mainResultsVersion;state.version='pwa-v2.01';await saveLocal();await navigator.serviceWorker.ready;
        return{high:high.id,middle:middle.id,own:p.id,stats:JSON.stringify([p.stats,high.stats,middle.stats]),seed:state.rngSeed,slot:state.slot,relay:fmt(race.total),lap:fmt(race.legs[0])};
      });
      await page.reload({waitUntil:'load'});await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy);
      const migrated=await page.evaluate(({own,high,middle})=>{
        const p=state.players.find(a=>a.id===own),h=state.world.find(a=>a.id===high),m=state.world.find(a=>a.id===middle);
        return{stats:JSON.stringify([p.stats,h.stats,m.stats]),seed:state.rngSeed,slot:state.slot,highTime:h.bestTimes.ba100,expected:coherentCpuPB(h,'ba100'),rank:scoutHighSchoolRank(h,'ba100'),middlePBs:Object.keys(m.bestTimes),season:state.highSchoolPBMeasurementSeason,medals:playerMainResults(p).length};
      },prepared);
      assert.equal(migrated.stats,prepared.stats);assert.equal(migrated.seed,prepared.seed);assert.equal(migrated.slot,prepared.slot);assert.equal(migrated.highTime,migrated.expected);assert.ok(migrated.rank<=50);assert.equal(migrated.season,2026);assert.equal(migrated.medals,4);
      for(const event of ['fr50','fr100','fr200','fr400','ba50','ba100','ba200'])assert.ok(migrated.middlePBs.includes(event));for(const event of ['br50','br100','br200','fly50','fly100','fly200','im200','im400'])assert.ok(!migrated.middlePBs.includes(event));
      await page.locator('#nav [data-page="roster"]').click();await page.locator(`[data-detail="${prepared.own}"]`).click();
      const main=page.locator('#detailMainResults');assert.equal(await main.locator('.major-result').count(),4);
      assert.match(await main.locator('[data-main-meet="intercollege"][data-main-event="fr100"]').innerText(),/インカレ\s+100mFr\s+優勝/);
      const grade=await page.evaluate(id=>'大'+state.players.find(p=>p.id===id).year,prepared.own);
      assert.deepEqual(await main.locator('.major-result-grade').allTextContents(),Array(4).fill(grade));
      assert.equal(await main.locator('.major-result-season').count(),0);
      assert.equal(await main.locator('.history-rank-first').count(),1);assert.equal(await main.locator('.history-rank-second').count(),2);assert.equal(await main.locator('.history-rank-third').count(),1);
      const relay=main.locator('[data-main-event="4x100fr"]');assert.ok((await relay.innerText()).includes(prepared.relay));assert.ok((await relay.innerText()).includes('本人ラップ '+prepared.lap));
      assert.equal(await main.locator('[data-main-meet="team_trial"], [data-main-event="fly100"], [data-main-event="fly50"]').count(),0);
      const layout=await page.locator('.detail-pb-section').evaluate(section=>{
        const grid=section.querySelector('.detail-pb-grid'),main=section.querySelector('.detail-major-results');
        return{follows:!!(grid.compareDocumentPosition(main)&Node.DOCUMENT_POSITION_FOLLOWING),fits:main.scrollWidth<=main.clientWidth+1};
      });assert.ok(layout.follows&&layout.fits,JSON.stringify(layout));
      if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await main.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-main-results-${mobile?'iphone':'pc'}.png`)})}
      await page.locator('.modal-player-detail #x').click();
      const stored=await page.evaluate(async()=>{await saveLocal();return JSON.stringify([state.world,state.players,state.rngSeed,state.highSchoolPBMeasurementSeason])});
      await context.setOffline(true);const response=await page.reload({waitUntil:'load'});assert.ok(response.fromServiceWorker());await page.waitForFunction(()=>state?.players?.length&&!localSaveBusy);
      assert.equal(await page.evaluate(()=>JSON.stringify([state.world,state.players,state.rngSeed,state.highSchoolPBMeasurementSeason])),stored);
      await page.locator('#nav [data-page="roster"]').click();await page.locator(`[data-detail="${prepared.own}"]`).click();assert.equal(await page.locator('#detailMainResults .major-result').count(),4);await page.locator('.modal-player-detail #x').click();
      const next=await page.evaluate(()=>{newSeason();return{season:state.season,measurement:state.highSchoolPBMeasurementSeason,highCounts:EVENTS.map(e=>ranking(e,'high',50).length)}});
      assert.equal(next.measurement,next.season);assert.ok(next.highCounts.every(n=>n===50));
      await page.locator('#nav [data-page="roster"]').click();await page.locator(`[data-detail="${prepared.own}"]`).click();
      assert.deepEqual(await page.locator('#detailMainResults .major-result-grade').allTextContents(),Array(4).fill(grade));
      assert.deepEqual(errors,[]);
    }finally{await context.close()}
  }}finally{await app.close()}
});

test('scouting titles match the best school ranking, retain unranked specialty PBs and survive saves offline on PC and iPhone',async()=>{
  const app=await fixture();
  try{for(const mobile of [false,true]){
    const context=await testContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile});
    try{
      const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);await page.waitForFunction(()=>state?.players?.length&&!localSaveBusy);
      const prepared=await page.evaluate(()=>{
        const template=state.world.find(a=>a.category==='high'&&a.grade===3);
        const candidates=Array.from({length:70},(_,i)=>{
          const a={...deepClone(template),id:'browser-title-'+i,name:'肩書検証'+i,specialty:'fr100',scouted:false,discovered:false,accolades:[],recordedPBs:{},discardedPBHistoryEvents:[],stats:Object.fromEntries(STATS.map(k=>[k,165])),imAptitude:{speed:0,stamina:0},scoutPreferences:{version:3,worldAmbition:false,preferredRegion:null,earlyCompetition:false,prestigeSchool:false}};
          attachMedleyStats(a);a.bestTimes=Object.fromEntries(EVENTS.map(e=>[e,round2(expectedTime(a,e)+i*.02)]));return a;
        });
        state.world=state.world.filter(a=>a.category!=='high').concat(candidates);state.recruits=[];
        const target=candidates[38],unranked=candidates[69],sixteenth=candidates[15],seventeenth=candidates[16];
        target.bestTimes.ba100=round2(expectedTime(target,'ba100')+.03);for(const e of SPRINT_EVENTS)target.bestTimes[e]=round2(expectedTime(target,e)-.01);
        seventeenth.accolades=[{competition:'全国高校総体',season:2026,event:'fr100',rank:1,time:seventeenth.bestTimes.fr100,title:'100mFr インターハイ優勝'}];
        unranked.scouted=true;state.recruits=[unranked.id];renderAll();
        return{target:target.id,unranked:unranked.id,sixteenth:sixteenth.id,seventeenth:seventeenth.id,firstPB:target.bestTimes.ba100,stats:JSON.stringify(target.stats),oldHistory:JSON.stringify(seventeenth.accolades)};
      });
      await page.locator('#nav [data-page="scout"]').click();
      const row=id=>page.locator('#scoutTable tr').filter({has:page.locator(`[data-scout="${id}"]`)});
      assert.equal(await row(prepared.target).locator('td').nth(2).innerText(),'100mBa 高校ランキング3位');
      assert.match(await row(prepared.target).locator('td').nth(3).innerText(),/100mBa/);
      assert.equal(await row(prepared.sixteenth).locator('td').nth(2).innerText(),'100mFr 高校ランキング16位');
      assert.equal(await row(prepared.seventeenth).locator('td').nth(2).innerText(),'肩書なし');
      assert.doesNotMatch(await row(prepared.unranked).innerText(),/PBなし/);assert.ok(await row(prepared.unranked).locator('button').isDisabled());
      assert.equal(await page.evaluate(id=>Object.keys(state.world.find(a=>a.id===id).bestTimes).length,prepared.unranked),1);
      await page.locator('#scoutEventFilter').selectOption('ba100');assert.ok(await row(prepared.target).isVisible());
      await page.locator('#scoutSortMode').selectOption('pb');assert.ok(await row(prepared.target).isVisible());
      await page.locator('#nav [data-page="rankings"]').click();await page.locator('#rankCategory').selectOption('high');await page.locator('#rankEvent').selectOption('ba100');
      const ranked=page.locator(`[data-ranking-athlete="${prepared.target}"]`);assert.equal(await ranked.locator('td').first().innerText(),'3');assert.equal(await ranked.locator('td').last().innerText(),await page.evaluate(time=>fmt(time),prepared.firstPB));
      await page.evaluate(id=>{const a=state.world.find(a=>a.id===id);a.bestTimes.fly200=round2(expectedTime(a,'fly200')+.01);renderAll()},prepared.target);
      await page.locator('#nav [data-page="scout"]').click();await page.locator('#scoutEventFilter').selectOption('fly200');
      assert.equal(await row(prepared.target).locator('td').nth(2).innerText(),'200mFly 高校ランキング2位');
      const saved=await page.evaluate(async()=>{await saveLocal();await navigator.serviceWorker.ready;return JSON.stringify(state.world.map(a=>[a.id,a.stats,a.bestTimes,a.specialty,a.accolades]))});
      await context.setOffline(true);const response=await page.reload({waitUntil:'load'});assert.ok(response.fromServiceWorker());await page.waitForFunction(()=>state?.players?.length&&!localSaveBusy);
      await page.locator('#nav [data-page="scout"]').click();await page.locator('#scoutEventFilter').selectOption('fly200');
      assert.equal(await row(prepared.target).locator('td').nth(2).innerText(),'200mFly 高校ランキング2位');
      assert.equal(await page.evaluate(()=>JSON.stringify(state.world.map(a=>[a.id,a.stats,a.bestTimes,a.specialty,a.accolades]))),saved);
      await page.locator('#scoutEventFilter').selectOption('');assert.doesNotMatch(await row(prepared.unranked).innerText(),/PBなし/);
      assert.deepEqual(await page.evaluate(({target,seventeenth})=>({stats:JSON.stringify(state.world.find(a=>a.id===target).stats),history:JSON.stringify(state.world.find(a=>a.id===seventeenth).accolades)}),prepared),{stats:prepared.stats,history:prepared.oldHistory});
      await page.evaluate(({sixteenth,seventeenth})=>{const a=state.world.find(a=>a.id===sixteenth),b=state.world.find(a=>a.id===seventeenth);b.bestTimes.fr100=a.bestTimes.fr100;renderAll()},prepared);
      assert.equal(await row(prepared.seventeenth).locator('td').nth(2).innerText(),'100mFr 高校ランキング16位');
      await page.locator('#nav [data-page="rankings"]').click();await page.locator('#rankCategory').selectOption('high');await page.locator('#rankEvent').selectOption('fr100');
      for(const id of [prepared.sixteenth,prepared.seventeenth])assert.equal(await page.locator(`[data-ranking-athlete="${id}"] td`).first().innerText(),'16');
      assert.deepEqual(errors,[]);
    }finally{await context.close()}
  }}finally{await app.close()}
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
          await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-scout-${mobile?'iphone':'pc'}.png`)});
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
        await page.evaluate(async()=>await saveLocal());await page.reload();await page.locator('#nav [data-page="scout"]').click();
        assert.deepEqual(await page.evaluate(id=>state.world.find(a=>a.id===id).scoutPreferences,fixture.id),{version:3,worldAmbition:true,preferredRegion:'kansai',earlyCompetition:true,prestigeSchool:true});
        assert.equal(await row.locator('.prob-pill').innerText(),(improved.reputation*100).toFixed(1)+'%');
        await page.evaluate(()=>{window.originalScoutingRng=rng;rng=()=>0});
        await row.locator('[data-scout]').click();
        await page.evaluate(()=>{rng=window.originalScoutingRng;delete window.originalScoutingRng});
        assert.ok(dialogs.some(message=>message.includes('スカウトに成功')));
        assert.equal(await page.evaluate(()=>state.points),45);assert.equal(await row.locator('[data-scout]').isDisabled(),true);
        assert.equal(await row.locator('[data-scout]').innerText(),'加入予定');
        await page.evaluate(async()=>await saveLocal());await page.reload();await page.locator('#nav [data-page="scout"]').click();
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
        await page.locator('#freshClose').click();await page.evaluate(async()=>await saveLocal());await page.reload();
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
        const target=await page.evaluate(async()=>{
          const a=state.world.find(p=>p.category==='high'&&p.grade===3);a.name='PB整合 確認選手';a.specialty='fr100';
          // The historical swim must be reachable from this swimmer's abilities.
          for(const key of ['fr_speed','fr_stamina','fr_turn','start'])a.stats[key]=165;
          for(const event of EVENTS)a.bestTimes[event]=round2(expectedTime(a,event)+.4);
          a.accolades=[{competition:'全国高校総体',competitionId:'interhigh_'+state.season,event:'fr100',rank:1,time:49.01,season:state.season,
            organization:a.organization,schoolCategory:'high',gradeAtRecord:3}];
          recordIndividualResult(a,'fr100',49.01,'全国高校総体','決勝');
          // Reproduce an older save whose yearly PB regeneration lost an earned time.
          a.bestTimes.fr100=53.65;await saveLocal();
          return {id:a.id,name:a.name,stats:JSON.stringify(a.stats)};
        });
        await page.reload();
        await page.waitForFunction(()=>state?.players?.length&&!localSaveBusy);
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
        const before=await page.evaluate(async()=>{await saveLocal();return JSON.stringify(state)});await page.reload();
        await page.waitForFunction(()=>state?.players?.length&&!localSaveBusy);
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
        if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-training-ranks-${options.isMobile?'iphone':'pc'}.png`)});}
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
        await page.evaluate(async()=>{state.version='pwa-v1.50';state.players[0].stats.start=200;await autoSaveNow()});
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

test('keyboard cannot advance turns behind dialogs and nested relay and standards dialogs restore playable controls', async () => {
  const app=await fixture();
  try{for(const options of [
    {viewport:{width:1440,height:900}},
    {viewport:{width:390,height:844},isMobile:true,hasTouch:true}
  ]){
    const context=await testContext(options);
    try{
      const page=await context.newPage(),errors=runtimeErrors(page);
      await page.goto(app.url);
      await page.locator('#advanceBtn').focus();await page.keyboard.press('Enter');
      await page.locator('.modal-training-result').waitFor();
      assert.equal(await page.evaluate(()=>state.slot),2);
      await page.keyboard.press('Enter');await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(()=>state.slot),2);
      assert.equal(await page.locator('#gameScroll').evaluate(el=>el.inert),true);
      assert.equal(await page.evaluate(()=>document.querySelector('.modal-training-result').contains(document.activeElement)),true);
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(()=>document.activeElement.id),'next');
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('#modalRoot .modal').count(),0);
      assert.equal(await page.locator('#gameScroll').evaluate(el=>el.inert),false);
      assert.equal(await page.evaluate(()=>document.activeElement.id),'advanceBtn');
      await page.keyboard.press('Enter');await page.locator('.modal-training-result').waitFor();
      assert.equal(await page.evaluate(()=>state.slot),3);
      await page.locator('.modal-training-result #next').click();
      await page.locator('#nav [data-page="training"]').click();
      const ids=await page.locator('#trainingPlayers tr[data-id]').evaluateAll(rows=>rows.map(row=>row.dataset.id));
      await page.locator('#trainingPlayers tr[data-id]').nth(5).click();
      await page.evaluate(()=>openMeetEntry('joint_record',72,2026));
      await page.locator('#relayBtn').click();
      await page.locator('#relayClose').focus();
      await page.locator('#confirmEntry').focus();
      assert.equal(await page.evaluate(()=>document.activeElement.id),'relayClose');
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('.modal-relay-editor').count(),0);
      assert.equal(await page.locator('.modal-meet-entry').evaluate(el=>el.closest('.modal-back').inert),false);
      // A restricted entry screen supplies its standards button; the child
      // dialog must preserve the parent and keep the game behind it blocked.
      await page.evaluate(()=>openMeetEntry('japan_open',72,2026));
      await page.locator('#std').click();
      await page.locator('#advanceBtn').focus();await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(()=>state.slot),3);
      assert.equal(await page.locator('.modal-standards').count(),1);
      await page.locator('.modal-standards #x').click();
      assert.equal(await page.locator('.modal-meet-entry').count(),1);
      await page.locator('#confirmEntry').click();await page.locator('#goRace').click();
      await page.locator('.modal-meet-results').waitFor();
      assert.equal(await page.evaluate(()=>state.slot),3);
      await page.locator('.modal-meet-results #x').click();await acceptMeetGrowth(page);
      assert.equal(await page.locator('#gameScroll').evaluate(el=>el.inert),false);
      await page.keyboard.press('ArrowUp');
      assert.equal(await page.evaluate(()=>selectedTrainingId),ids[4]);
      assert.deepEqual(errors,[]);
    }finally{await context.close();}
  }}finally{await app.close();}
});

test('training arrows wrap immediately on opening and still work after editing practice on PC and iPhone', async () => {
  const app=await fixture();
  try{for(const options of [
    {viewport:{width:1440,height:900}},
    {viewport:{width:844,height:390},isMobile:true,hasTouch:true},
    {viewport:{width:390,height:844},isMobile:true,hasTouch:true}
  ]){
    const context=await testContext(options);
    try{
      const page=await context.newPage(),errors=runtimeErrors(page);
      await page.goto(app.url);
      await page.locator('#nav [data-page="training"]').click();
      const rows=page.locator('#trainingPlayers tr[data-id]');
      const ids=await rows.evaluateAll(rows=>rows.map(row=>row.dataset.id));
      const original=await page.evaluate(()=>JSON.stringify({players:state.players,plans:state.trainingPlans,focus:state.trainingFocus}));
      const check=async id=>{
        const shown=await page.evaluate(()=>{
          const p=state.players.find(p=>p.id===selectedTrainingId);
          return{id:selectedTrainingId,focused:document.activeElement.dataset.id,name:p.name,
            title:document.getElementById('trainingPlayerTitle').textContent,
            pb:document.getElementById('trainingSpecialtyPB').textContent,
            expectedPB:validRaceTime(p.bestTimes[p.specialty])?fmt(p.bestTimes[p.specialty]):'未記録',
            practice:document.querySelector('#trainingPlan [data-focus].selected')?.dataset.focus,
            expectedPractice:state.trainingFocus[p.id][0]};
        });
        assert.equal(shown.id,id);assert.equal(shown.focused,id);assert.ok(shown.title.includes(shown.name));
        assert.equal(shown.pb,shown.expectedPB);assert.equal(shown.practice,shown.expectedPractice);
      };
      await check(ids[0]);
      await page.keyboard.press('ArrowUp');await check(ids.at(-1));
      assert.ok(await page.locator('#trainingPlayers').evaluate(el=>el.scrollTop>0));
      await page.keyboard.press('ArrowDown');await check(ids[0]);
      for(let i=1;i<=ids.length;i++){
        await page.keyboard.press('ArrowDown');await check(ids[i%ids.length]);
      }
      for(let i=1;i<=ids.length;i++){
        await page.keyboard.press('ArrowUp');await check(ids[(ids.length-i)%ids.length]);
      }
      assert.equal(await page.evaluate(()=>JSON.stringify({players:state.players,plans:state.trainingPlans,focus:state.trainingFocus})),original);
      await rows.nth(5).click();
      const practice=await page.locator('#trainingPlan [data-focus]:not(.selected)').first().getAttribute('data-focus');
      await page.locator(`#trainingPlan [data-focus="${practice}"]`).click();
      assert.equal(await page.evaluate(()=>document.activeElement.tagName),'BODY');
      await page.keyboard.press('ArrowUp');await check(ids[4]);
      await page.keyboard.press('ArrowDown');await check(ids[5]);
      assert.equal(await page.locator('#trainingPlan [data-focus].selected').getAttribute('data-focus'),practice);
      await page.locator('#clearFocusBtn').click();
      await page.keyboard.press('ArrowUp');await check(ids[4]);
      await page.locator('#trainingSpecialtyBtn').click();
      await page.locator('#modalRoot select').focus();
      await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowDown');
      assert.equal(await page.evaluate(()=>selectedTrainingId),ids[4]);
      await page.locator('#modalRoot #x').click();
      await page.keyboard.press('ArrowDown');await check(ids[5]);
      await page.locator('#standardsBtn').focus();
      await page.keyboard.press('ArrowUp');
      assert.equal(await page.evaluate(()=>selectedTrainingId),ids[5]);
      await rows.nth(8).focus();await page.keyboard.press('Enter');await check(ids[8]);
      await rows.nth(10).focus();await page.keyboard.press('Space');await check(ids[10]);
      await page.locator('#trainingPlayers').focus();
      await page.keyboard.press('ArrowUp');await check(ids[9]);
      await page.locator('#nav [data-page="home"]').click();
      await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowDown');
      assert.equal(await page.evaluate(()=>selectedTrainingId),ids[9]);
      assert.deepEqual(errors,[]);
    }finally{await context.close();}
  }}finally{await app.close();}
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
        if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-training-size-${mobile?'iphone':'pc'}-${options.viewport.width}x${options.viewport.height}.png`)});}
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
        await page.evaluate(()=>openMeetEntry('japan_championship'));
        for(const event of ['fr100','ba50']){
          const entry=page.locator(`#entryMatrix input[data-pid="${id}"][data-event="${event}"]`),cell=entry.locator('..');
          assert.equal(await entry.isDisabled(),true);assert.match(await cell.innerText(),/PBなし/);
          assert.equal(await cell.locator('.entry-pb-time').innerText(),'-');assert.match(await cell.getAttribute('class'),/entry-no-pb/);
        }
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
        await page.locator('.modal-meet-results #x').click();await acceptMeetGrowth(page);await page.locator('#showTeamTop10Btn').click();
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
        const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);await page.waitForFunction(()=>state?.players?.length===32&&!localSaveBusy,null,{timeout:90000});
        await page.evaluate(()=>showMeetSchedule());
        const schedule=await page.locator('.schedule-table tbody').innerText();
        assert.match(schedule,/1月 第2週後半\s+Higashikata CUP/);assert.match(schedule,/2月 第2週後半\s+ダイナミオープン/);
        await page.locator('.modal-schedule #x').click();
        for(const [slot,name] of [[76,'Higashikata CUP'],[84,'ダイナミオープン']]){
          const pointsBefore=await page.evaluate(slot=>{state.slot=slot;state.players[0].stats=Object.fromEntries(STATS.map(k=>[k,200]));renderAll();openMeetEntry('joint_record',slot,state.season,{fr100:[state.players[0].id]},{});return state.points},slot);
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
          assert.equal(await page.evaluate(()=>state.points),pointsBefore+30);assert.equal(await page.evaluate(()=>state.pointLog.at(-1).points),30);
          const own=await page.evaluate(()=>{
            const a=state.players[0],rows=a.raceHistory.filter(r=>r.meet==='joint_record'&&r.slot===state.slot);
            return {id:a.id,stages:rows.map(r=>r.stage),rank:rows.find(r=>r.stage==='A決勝')?.rank};
          });
          assert.deepEqual(own.stages,['予選','A決勝']);assert.ok(own.rank>=1&&own.rank<=8);
          await page.locator('.modal-meet-results #x').click();await acceptMeetGrowth(page);await page.evaluate(id=>showPlayerDetail(id),own.id);
          await page.locator('[data-detail-view="history"]').click();
          assert.match(await page.locator('#historyTable').innerText(),new RegExp(name));
          assert.ok(await page.locator('#historyTable .history-rank').count()>0);
          if(process.env.SWIM_SCREENSHOT_DIR){await page.locator('#historyTable .history-rank').first().scrollIntoViewIfNeeded();fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-cup-history-${slot}-${options.isMobile?'iphone':'pc'}.png`)})}
          await page.locator('.modal-player-detail #x').click();await page.locator('#showTeamTop10Btn').click();
          await page.locator('#teamTop10Event').selectOption('fr100');
          assert.match(await page.locator('#teamTop10Body').innerText(),/Higashikata CUP|ダイナミオープン/);
          await page.locator('#nav [data-page="home"]').click();
        }
        await page.evaluate(()=>saveLocal());await page.reload();await page.waitForFunction(()=>state?.players?.length===32&&!localSaveBusy,null,{timeout:90000});
        await page.evaluate(()=>showPlayerDetail(state.players[0].id));
        await page.locator('[data-detail-view="history"]').click();
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
        await page.locator('[data-detail-view="history"]').click();
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
        if(process.env.SWIM_SCREENSHOT_DIR){await page.locator('#historyTable').scrollIntoViewIfNeeded();fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-relay-history-${options.isMobile?'iphone':'pc'}.png`)});}
        await page.locator('#historySort').selectOption('only_4x100fr');
        const legacy=page.locator('#historyTable tbody tr').filter({hasText:'関西カレッジ'});
        assert.equal(await legacy.count(),1);assert.equal(await legacy.locator('.history-time').innerText(),'3:39.00');
        assert.equal(await legacy.locator('.history-lap b').innerText(),'-');assert.equal(await legacy.locator('td').nth(4).innerText(),'-');
        await page.locator('#historySort').selectOption('only_fr100');
        assert.equal(await page.locator('#historyTable tbody tr').count(),1);assert.equal(await page.locator('#historyTable .history-lap').count(),0);
        await page.locator('#historySort').selectOption('event');
        assert.equal(await page.locator('#historyTable tbody tr').first().getAttribute('data-history-event'),'fr100');
        await page.locator('.modal-player-detail #x').click();await page.evaluate(id=>showPlayerDetail(id),data.out);
        await page.locator('[data-detail-view="history"]').click();
        await page.locator('#historySort').selectOption('only_relays');
        assert.equal(await page.locator('#historyTable tbody tr').count(),3);assert.doesNotMatch(await page.locator('#historyTable').innerText(),/決勝/);
        await page.locator('.modal-player-detail #x').click();await page.reload();await page.waitForFunction(()=>state?.players?.length&&!localSaveBusy);await page.evaluate(id=>showPlayerDetail(id),data.id);
        await page.locator('[data-detail-view="history"]').click();
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
        const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);await page.waitForFunction(()=>state?.players?.length&&!localSaveBusy);
        await page.evaluate(async()=>{
          const a=state.players[0];a.raceHistory=[];
          for(let rank=1;rank<=9;rank++){
            a.raceHistory.push({season:2026,slot:76,meet:'joint_record',event:'fr100',stage:rank%2?'A決勝':'決勝',rank,time:48+rank,newlyCleared:[],pb:false});
            a.raceHistory.push({season:2026,slot:84,meet:'joint_record',event:'fr100',stage:'予選',rank,time:48+rank,newlyCleared:[],pb:false});
            a.raceHistory.push({season:2026,slot:8,meet:'team_trial',event:'fr100',stage:'決勝',rank,time:48+rank,newlyCleared:[],pb:false});
          }
          await saveLocal();showPlayerDetail(a.id);
        });
        await page.locator('[data-detail-view="history"]').click();
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
        if(process.env.SWIM_SCREENSHOT_DIR){await page.locator('#historyTable .history-rank-first').scrollIntoViewIfNeeded();fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-history-awards-${options.isMobile?'iphone':'pc'}.png`)})}
        await page.locator('#historySort').selectOption('only_ba50');assert.equal(await page.locator('#historyTable .history-rank').count(),0);
        await page.locator('#historySort').selectOption('event');assert.equal(await page.locator('#historyTable .history-rank').count(),8);
        await page.locator('.modal-player-detail #x').click();await page.reload();await page.waitForFunction(()=>state?.players?.length&&!localSaveBusy);await page.evaluate(()=>showPlayerDetail(state.players[0].id));
        await page.locator('[data-detail-view="history"]').click();
        assert.equal(await page.locator('#historyTable .history-rank').count(),8);assert.deepEqual(errors,[]);
      }finally{await context.close()}
    }
  }finally{await app.close()}
});

test('simultaneous PB and abilities keep row heights and scroll offsets while changing selections and opening standards on every meet on PC and iPhone',async()=>{
  const app=await fixture();
  try{for(const options of [{viewport:{width:1280,height:900}},{viewport:{width:390,height:844},isMobile:true,hasTouch:true},{viewport:{width:667,height:375},isMobile:true,hasTouch:true}]){
    const context=await testContext(options);
    try{
      const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);await page.waitForFunction(()=>state?.players?.length&&!localSaveBusy);
      const selected=await page.evaluate(()=>{
        for(const p of state.players)for(const e of EVENTS)p.bestTimes[e]=round2(standardFor('japan_championship',e)-.1);
        state.players[11].name='長い名前の選手 テスト・スイマー';return state.players[19].id;
      });
      const snapshot=()=>page.evaluate(()=>{
        const wrap=document.querySelector('.modal-meet-entry .entry-table-wrap'),matrix=document.getElementById('entryMatrix'),header=matrix.tHead.offsetHeight;
        const rows=[...matrix.tBodies[0].rows],visible=rows.filter(row=>row.offsetTop+row.offsetHeight>wrap.scrollTop+header&&row.offsetTop<wrap.scrollTop+wrap.clientHeight);
        return{top:wrap.scrollTop,left:wrap.scrollLeft,width:wrap.clientWidth,height:wrap.clientHeight,tableWidth:matrix.offsetWidth,tableHeight:matrix.offsetHeight,
          rowHeights:rows.map(row=>row.offsetHeight),rowWidths:rows.map(row=>row.offsetWidth),
          visible:visible.map(row=>({id:row.querySelector('input').dataset.pid,offset:row.offsetTop-wrap.scrollTop})),
          selected:[...matrix.querySelectorAll('input:checked')].map(input=>input.dataset.pid+':'+input.dataset.event)};
      });
      for(const meet of ['team_trial','joint_record','kansai_college','intercollege','teijimayama_championship','japan_open','japan_championship']){
        await page.evaluate(meet=>openMeetEntry(meet,60,2026),meet);
        assert.equal(await page.locator('.modal-meet-entry .stat-rank-legend').count(),0);
        const layout=await page.locator('.modal-meet-entry').evaluate(modal=>{
          const wrap=modal.querySelector('.entry-table-wrap'),tableBox=wrap.getBoundingClientRect(),box=modal.getBoundingClientRect(),button=modal.querySelector('#confirmEntry').getBoundingClientRect();
          const badges=[...modal.querySelectorAll('.entry-stat-row .stat-rank-badge')];
          return{height:wrap.clientHeight,oneRow:modal.querySelector('#entryMatrix thead').offsetHeight+modal.querySelector('#entryMatrix tbody tr').offsetHeight,modalHeight:modal.clientHeight,logicalHeight:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--game-vh'))*100,
            uncapped:getComputedStyle(wrap).maxHeight==='none',insideViewport:box.left>=0&&box.top>=0&&box.right<=innerWidth+1&&box.bottom<=innerHeight+1,
            tableInside:tableBox.left>=box.left&&tableBox.top>=box.top&&tableBox.right<=box.right+1&&tableBox.bottom<=box.bottom+1,
            buttonVisible:button.left>=box.left&&button.top>=box.top&&button.right<=box.right+1&&button.bottom<=box.bottom+1,
            coloredStats:badges.length>0&&badges.every(badge=>getComputedStyle(badge).backgroundColor!=='rgba(0, 0, 0, 0)')};
        });
        assert.ok(layout.uncapped&&layout.insideViewport&&layout.tableInside&&layout.buttonVisible&&layout.coloredStats,JSON.stringify(layout));
        assert.ok(layout.modalHeight>=layout.logicalHeight*.9&&layout.height>=layout.oneRow,JSON.stringify(layout));
        if(options.isMobile){
          assert.ok(layout.height>=layout.logicalHeight*.65,JSON.stringify(layout));
          assert.equal(await page.locator('.modal-meet-entry>.notice').isVisible(),false);
          assert.equal(await page.locator('#entryCompactCount').isVisible(),true);
        }
        await page.locator(`#entryMatrix input[data-pid="${selected}"][data-event="fr100"]`).check();
        assert.equal(await page.locator('#entryCompactCount').innerText(),'個人 1件');
        for(const position of ['middle','bottom']){
          await page.evaluate(position=>{
            const wrap=document.querySelector('.modal-meet-entry .entry-table-wrap'),rows=[...document.querySelectorAll('#entryMatrix tbody tr')];
            wrap.scrollTop=position==='bottom'?wrap.scrollHeight-wrap.clientHeight-7:rows[17].offsetTop+9;
            wrap.scrollLeft=Math.min(240,wrap.scrollWidth-wrap.clientWidth);
          },position);
          const before=await snapshot();assert.ok(before.top>0&&before.left>0&&before.visible.length>0,JSON.stringify(before));
          assert.equal(await page.locator('#entryViewToggle').count(),0);
          assert.equal(await page.locator('#entryMatrix .entry-pb-view').first().isVisible(),true);
          assert.equal(await page.locator('#entryMatrix .entry-stat-view').first().isVisible(),true);
          assert.equal(await page.locator('#entryStatGuide').isVisible(),true);
          assert.equal(await page.locator('#entryMatrix .entry-common-stats').first().isVisible(),true);
          assert.equal(await page.locator('#entryMatrix [data-entry-stat="mental"]').count(),0);
          const geometry=({selected,...dimensions})=>dimensions;
          const toggleSelected=()=>page.evaluate(id=>document.querySelector(`#entryMatrix input[data-pid="${id}"][data-event="fr100"]`).click(),selected);
          await toggleSelected();
          const cleared=await snapshot();assert.deepEqual(cleared.selected,[]);
          assert.equal(await page.locator('#entryCompactCount').innerText(),'個人 0件');
          assert.deepEqual(geometry(cleared),geometry(before),`${options.viewport.width} ${meet} ${position}: deselection preserves rows and scroll offsets`);
          await toggleSelected();assert.deepEqual(await snapshot(),before,'Reselection preserves the same row and scroll offsets');
          if(['kansai_college','intercollege','japan_open','japan_championship'].includes(meet)){
            const beforeStandards=await snapshot();
            await page.locator('#std').click();await page.locator('.modal-standards #x').click();
            assert.deepEqual(await snapshot(),beforeStandards,'The standards dialog preserves the current row and entry');
          }
        }
        if(meet==='intercollege'&&process.env.SWIM_SCREENSHOT_DIR){
          fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});const label=options.isMobile?(options.viewport.width<500?'iphone-portrait':'iphone-landscape'):'pc';
          await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-combined-entry-${label}.png`)});
        }
        await page.evaluate(()=>closeModal());
      }
      assert.deepEqual(errors,[]);
    }finally{await context.close()}
  }}finally{await app.close()}
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
      // Keep the display fixture reachable so the existing load-time PB repair
      // does not override the deliberately distinct stroke stats under test.
      for(const e of EVENTS)if(e!=='fr100')state.players[0].bestTimes[e]=expectedTime(state.players[0],e);
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
    assert.deepEqual(await entryOrder(),selection.trainingOrder);
    assert.match(await cells[1].locator('..').innerText(), /未突破/);
    const first=cells[0].locator('xpath=ancestor::tr'),fr=cells[0].locator('..');
    assert.deepEqual(await fr.locator('.entry-stat-label').allTextContents(),['スピード','スタミナ']);
    assert.deepEqual(await fr.locator('.entry-stat-value').allTextContents(),['175','150']);
    assert.deepEqual(await fr.locator('.stat-rank-badge').allTextContents(),['A','B']);
    assert.equal(await page.locator('#entryMatrix [data-entry-stat="turn"]').count(),0);
    assert.deepEqual(await first.locator('.entry-common-stats .entry-stat-value').allTextContents(),['176']);
    assert.deepEqual(await first.locator('.entry-common-stats .stat-rank-badge').allTextContents(),['S']);
    assert.equal(await page.locator('#entryMatrix [data-entry-stat="mental"]').count(),0);
    assert.equal(await page.evaluate(id=>state.players.find(p=>p.id===id).stats.mental,selection.ids[0]),25);
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
    if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-entry-stats-${options.isMobile?'iphone':'pc'}-${options.viewport.width}x${options.viewport.height}.png`)});}
    await page.locator('#std').click();
    assert.equal(await page.locator('.standards-table thead th').count(), 6);
    assert.equal(await page.locator('.standards-table thead th').last().innerText(), '世界大会');
    assert.equal(await page.locator('.standards-table tbody tr').nth(1).locator('td').last().innerText(), '47.64');
    assert.match(await page.locator('.modal-standards').innerText(),/専門泳法を優先し、他の泳法は2位の選手/);
    await page.locator('.modal-standards #x').click();
    assert.equal(await cells[0].isChecked(), true);
    assert.deepEqual(await entryOrder(),selection.trainingOrder);
    assert.equal(await page.locator('#entryViewToggle').count(),0);
    assert.equal(await cells[0].isChecked(),true);
    assert.equal(await page.locator('#entryStatGuide').isVisible(),true);
    for(const meet of ['team_trial','joint_record','kansai_college','japan_open','japan_championship']){
      const expectedOrder=await page.evaluate(meet=>{
        closeModal();const p=state.players[0];for(const e of EVENTS)p.bestTimes[e]=expectedTime(p,e);p.bestTimes.fr100=RESTRICTED.has(meet)?standardFor(meet,'fr100')-.01:55;
        renderTrainingPlayers();
        openMeetEntry(meet);
        return [...document.querySelectorAll('#trainingPlayers tbody tr')].map(r=>r.dataset.id);
      },meet);
      assert.deepEqual(await entryOrder(),expectedOrder);
      const current=cells[0].locator('xpath=ancestor::tr');
      assert.equal(await page.locator('#entryMatrix [data-entry-stat="turn"]').count(),0);
      assert.deepEqual(await current.locator('input[data-event="fr100"]').locator('..').locator('.entry-stat-value').allTextContents(),['175','150']);
      if(await current.locator('input[data-event="ba50"]').count())assert.deepEqual(await current.locator('input[data-event="ba50"]').locator('..').locator('.entry-stat-value').allTextContents(),['100','75']);
      await current.locator('input[data-event="fr100"]').check();
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
      // This flow test requires an own finalist; ordinary form can finish 12th.
      state.meetFormBoosts={[meetFormBoostKey('world_championship',36,2027)]:{[own.id]:4}};
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
    assert.deepEqual(await page.evaluate(()=>state.pendingMeetGrowthRewards[0].gains.map(g=>g.id)),[await page.evaluate(()=>state.players[0].id)]);
    await page.locator('#x').click();await acceptMeetGrowth(page);
    await page.locator('#saveBtn').click();
    const saved = await page.evaluate(async () => JSON.parse(await getLocalSaveStore().read()));
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
    await page.waitForFunction(()=>state?.players?.length===32&&!localSaveBusy&&cloudSync);
    const selected = await page.evaluate(async () => {
      let p=state.players.find(p=>p.year===4);
      p.stats=Object.fromEntries(STATS.map(k=>[k,200]));p.bestTimes.fr100=expectedTime(p,'fr100');
      state.season=2026;state.slot=94;state.activeCompetitionSeason=2026;state.activeCompetitionSlot=94;
      let entries=Object.fromEntries(EVENTS.map(e=>[e,e==='fr100'?[p.id]:[]]));
      // This case verifies selection persistence; race variance is covered separately.
      const originalRng=rng;let result;
      try{rng=()=>.5;result=executeMeet('japan_championship',entries,{})}finally{rng=originalRng}
      let selected=result.selection.individual.fr100.includes(p.id),year=state.japanTeam.year,selectedIds=[...state.japanTeam.individual.fr100];
      state.activeCompetitionSeason=null;state.activeCompetitionSlot=null;newSeason();await saveLocal();
      return {id:p.id,name:p.name,selected,year,season:state.season,selectedIds,afterGraduation:[...state.japanTeam.individual.fr100],savedIds:JSON.parse(await getLocalSaveStore().read()).japanTeam.individual.fr100};
    });
    assert.equal(selected.selected, true);
    assert.equal(selected.year, 2027);
    assert.equal(selected.season, 2027);
    assert.deepEqual(selected.afterGraduation,selected.selectedIds);assert.deepEqual(selected.savedIds,selected.selectedIds);
    await page.reload();
    await page.waitForFunction(()=>state?.season===2027&&!localSaveBusy&&cloudSync);
    const retained = await page.evaluate(id => ({ own:ownJapanAthlete(id),ids:worldAutoEntries(2027).individual.fr100 }), selected.id);
    assert.equal(retained.own, true);
    assert.ok(retained.ids.includes(selected.id),JSON.stringify({selected,retained}));
    await page.evaluate(() => openMeetEntry('world_championship',36,2027));
    if(await page.locator('#confirmWorldAdditional').count())await page.locator('#confirmWorldAdditional').click();
    assert.match(await page.locator('.modal-entry-confirm').innerText(), new RegExp(selected.name));
    assert.deepEqual(errors, []);
  } finally { await context.close(); await app.close(); }
});

test('world opening offers vacant slots to registered own and CPU swimmers, saves unlimited choices and animates additional races on PC and iPhone',async()=>{
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
        assert.equal(await first.locator(`option[value="${target.cpu}"]`).count(),1);
        assert.ok(await first.locator(`option[value="${target.own[0]}"]`).count());assert.ok(await first.locator(`option[value="${target.own[1]}"]`).count());assert.equal(await first.locator('option[value]:not([value=""])').count(),5);
        for(const event of ['fr50','ba100','br100','fly100','im400'])await page.locator(`#worldAdditionalTable select[data-world-event="${event}"][data-world-slot="0"]`).selectOption(target.own[0]);
        const second=page.locator('#worldAdditionalTable select[data-world-event="fr50"][data-world-slot="1"]');
        assert.equal(await second.locator(`option[value="${target.own[0]}"]`).evaluate(option=>option.disabled),true);await second.selectOption(target.own[1]);
        await page.locator('#worldAdditionalTable select[data-world-event="fr200"]').selectOption(target.own[1]);
        await page.locator('#std').click();assert.match(await page.locator('.modal-standards').innerText(),/追加種目の派遣標準突破は不要/);await page.locator('.modal-standards #x').click();
        assert.equal(await first.inputValue(),target.own[0]);
        const box=await page.locator('.modal-world-additional').evaluate(m=>{const r=m.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight}});
        assert.ok(box.left>=-1&&box.right<=box.width+1&&box.top>=-1&&box.bottom<=box.height+1,JSON.stringify(box));
        if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-world-additional-${mobile?'iphone':'pc'}.png`)});}
        await page.locator('#confirmWorldAdditional').click();
        assert.equal(await page.evaluate(()=>Object.values(state.japanTeam.additionalIndividual).flat().length),7);
        assert.equal(await page.evaluate(()=>JSON.stringify([state.japanTeam.individual,state.japanTeam.relays])),target.base);
        await page.locator('#backEntry').click();await page.locator('.modal-world-additional').waitFor();assert.equal(await first.inputValue(),target.own[0]);
        await page.locator('#confirmWorldAdditional').click();await page.reload();await page.waitForFunction(()=>state?.japanTeam&&!localSaveBusy);
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
    assert.equal(await page.evaluate(()=>state.pendingMeetGrowthRewards.length),0);
    assert.equal(await page.evaluate(()=>state.pendingMeetCompletion),null);
    await page.locator('.modal-meet-results #x').click();await acceptMeetGrowth(page);
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
        if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-sprint-entry-${mobile?'iphone':'pc'}.png`)});}
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
        assert.equal(await page.locator('#resEv option').count(),15);await page.locator('.modal-meet-results #x').click();await acceptMeetGrowth(page);
        if(mobile){
          assert.ok(await page.evaluate(id=>SPRINT_EVENTS.every(e=>state.japanTeam.individual[e].includes(id)),own.id));
          await page.evaluate(()=>{state.season=2027;state.slot=36;renderAll();openMeetEntry('world_championship',36,2027);});
          if(await page.locator('#confirmWorldAdditional').count())await page.locator('#confirmWorldAdditional').click();
          await page.locator('#goRace').click();const worldRaces=await drainRaces(page);
          for(const label of ['50mBa','50mBr','50mFly']){
            assert.ok(worldRaces.some(t=>t.includes(label)&&t.includes('予選')),JSON.stringify(worldRaces));
            assert.ok(worldRaces.some(t=>t.includes(label)&&t.includes('決勝')),JSON.stringify(worldRaces));
          }
          assert.equal(await page.locator('#resEv option').count(),15);await page.locator('.modal-meet-results #x').click();await acceptMeetGrowth(page);
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
        if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-sprint-records-${mobile?'iphone':'pc'}.png`)});}
        const saved=await page.evaluate(()=>{saveLocal();return JSON.stringify([state.recordRankings,state.teamTop10]);});
        await page.reload();assert.equal(await page.evaluate(()=>JSON.stringify([state.recordRankings,state.teamTop10])),saved);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    }
  }finally{await app.close();}
});

for(const oldVersion of ['v1.91','v1.96','v1.97','v1.98','v1.99','v2.00','v2.01','v2.02','v2.03','v2.04','v2.05','v2.06','v2.07','v2.08','v2.09','v2.10','v2.11','v2.12','v2.13','v2.14','v2.15','v2.16','v2.17','v2.18','v2.19','v2.20','v2.21','v2.22','v2.23','v2.24','v2.25','v2.26','v2.27','v2.28','v2.29','v2.30','v2.31','v2.32','v2.33','v2.34','v2.35','v2.36','v2.37','v2.38','v2.44','v2.45','v2.46','v2.47','v2.48','v2.49','v2.50','v2.51','v2.52','v2.53','v2.54','v2.55','v2.56','v2.57','v2.58','v2.59','v2.60','v2.61','v2.62','v2.63','v2.64','v2.65','v2.66','v2.67','v2.68','v2.69','v2.70','v2.71','v2.72','v2.73','v2.74'])test(`PWA upgrades its ${oldVersion} cache to v2.75 and retains saved progress offline`, async () => {
  const app = await fixture(oldVersion);
  const context = await testContext();
  try {
    const page = await context.newPage();
    const errors = runtimeErrors(page);
    await page.goto(app.url);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    assert.ok((await page.evaluate(() => caches.keys())).includes(`swim-manager-pwa-${oldVersion}`));
    const savedNames = await page.evaluate(async oldVersion => {
      state.slot = 15; state.points = 123; state.players[0].stats.fr_speed = 182;
      state.players[0].name = '名前保持 太郎';
      if(oldVersion==='v2.51'){state.players[0].stats.mental=7.25;state.players[1].stats.mental=192.75}
      await saveLocal();
      return [...state.players, ...state.world].map(a => [a.id, a.name]);
    },oldVersion);
    app.upgrade();
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await page.waitForFunction(async oldVersion => {
      const keys = await caches.keys();
      return keys.includes('swim-manager-pwa-v2.75') && !keys.includes(`swim-manager-pwa-${oldVersion}`);
    },oldVersion);
    // Load the newly published HTML and await IndexedDB restoration before reading state.
    await page.reload();
    await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy,null,{timeout:90000});
    assert.match(await page.title(), /v2\.75/);
    assert.equal(await page.evaluate(() => state.version), 'pwa-v2.75');
    assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('script[src]')].map(script=>new URL(script.src).searchParams.get('version'))),['v2.75','v2.75','v2.75']);
    assert.equal(await page.evaluate(async()=>!!await caches.match('./local-save.js?version=v2.75')),true);
    assert.equal(await page.evaluate(async()=>!!await caches.match('./cloud-sync.js?version=v2.75')),true);
    assert.equal(await page.evaluate(async()=>!!await caches.match('./save-history.js?version=v2.75')),true);
    assert.equal(await page.evaluate(() => state.slot), 15);
    assert.equal(await page.evaluate(() => state.points), 123);
    assert.equal(await page.evaluate(() => state.players[0].stats.fr_speed), 182);
    if(oldVersion==='v2.51')assert.deepEqual(await page.evaluate(()=>state.players.slice(0,2).map(a=>a.stats.mental)),[7.25,192.75]);
    assert.deepEqual(await page.evaluate(() => [...state.players, ...state.world].map(a => [a.id, a.name])), savedNames);
    await page.waitForFunction(()=>!localSaveBusy);
    assert.match(await page.evaluate(async()=>(await(await(await caches.open('swim-manager-pwa-v2.75')).match('./index.html')).text()).match(/<title>(.*?)<\/title>/)?.[1]),/v2\.75/);
    if(oldVersion==='v2.24'){
     const staleHTML=await page.evaluate(async()=>{
      // An outgoing worker can finish an old cache write after activation.
      // Keep stale HTML in another bucket, and stop the HTTP server below:
      // offline startup must use the installed version with no network escape.
      const stale=await caches.open('leftover-previous-worker');await stale.put('./index.html',new Response('<!doctype html><title>旧キャッシュ</title>',{headers:{'Content-Type':'text/html; charset=utf-8'}}));
      return(await stale.match('./index.html')).text();
     });assert.match(staleHTML,/旧キャッシュ/);await app.close();
    }
    await page.evaluate(()=>autoSaveNow());
    await context.setOffline(true);
    const response = await page.reload({ waitUntil: 'load' });
    assert.equal(response.fromServiceWorker(), true);
    await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy,null,{timeout:90000});
    assert.match(await page.title(), /v2\.75/);
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
      await page.locator('.modal-meet-results #x').click();await acceptMeetGrowth(page);
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
    await page.locator('.modal-meet-results #x').click();await acceptMeetGrowth(page);
    await page.evaluate(()=>{
      const p=state.players[0],graduate={id:'former-student',name:'卒業した選手'};
      upsertIndividualTop10('fr100',graduate,48.4,'intercollege','決勝');
      upsertRelayTop10('4x100fr',[p,state.players[1],state.players[2],graduate],200,'intercollege');
    });
    await page.locator('#nav button[data-page="records"]').click();await page.locator('#showTeamTop10Btn').click();await page.locator('#teamTop10Event').selectOption('fr100');
    assert.ok(await page.locator('.top10-active .active-athlete').count()>0);
    const former=page.locator('.top10-table tr').filter({hasText:'卒業した選手'});
    assert.equal(await former.locator('.active-athlete').count(),0);
    await page.locator('#teamTop10Event').selectOption('4x100fr');assert.equal(await page.locator('#teamTop10Body .active-athlete').count(),3);
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
    await page.locator('.modal-meet-results #x').click();await acceptMeetGrowth(page);assert.deepEqual(errors,[]);
  }finally{await context.close();await app.close();}
});

test('individual overall results compare each stage with its pre-race PB on PC and iPhone and survive JSON and offline saves',async()=>{
 const app=await fixture();
 try{for(const mobile of [false,true]){
  const context=await testContext(mobile?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{viewport:{width:1280,height:900}}),page=await context.newPage(),errors=runtimeErrors(page);
  try{
   await page.goto(app.url);await page.waitForFunction(()=>state?.players?.length===32&&!localSaveBusy,null,{timeout:90000});
   for(const [meet,slot]of [['kansai_college',30],['intercollege',41],['teijimayama_championship',60],['japan_open',66],['joint_record',74],['joint_record',82],['japan_championship',94],['world_championship',35]]){
    await page.evaluate(({meet,slot})=>{
     closeModal();state.slot=slot;
     const p=state.players.find(p=>p.year===1),first=state.players.filter(p=>p.year===1)[1];
     p.bestTimes.fr200=125;delete first.bestTimes.fr200;
     const prelim=[p,first].map((athlete,i)=>({source:'PLAYER',athlete,entryPB:athlete.bestTimes.fr200??null,heatLane:4+i,race:{total:123+i}}));
     prelim.forEach((row,i)=>row.achievement=updateResultHistory(row.athlete,'fr200',row.race.total,meet,'予選',i+1));
     const final=prelim.map((row,i)=>({...row,prelimTime:row.race.total,entryPB:row.athlete.bestTimes.fr200,race:{total:122+i}}));
     final.forEach((row,i)=>row.achievement=updateResultHistory(row.athlete,'fr200',row.race.total,meet,'A決勝',i+1));
     const cpu=state.world.find(a=>a.category==='university'),cpuRow={source:'CPU',athlete:cpu,entryPB:120,heatLane:6,race:{total:126}};
     const race={prelim:[...prelim,cpuRow],final:[...final,cpuRow],heats:[[...prelim,cpuRow]],swimOffs:[]};
     window.comparisonResult={meet,season:state.season,slot,events:Object.fromEntries(EVENTS.map(e=>[e,e==='fr200'?race:{prelim:[],final:[],heats:[]}])),relays:[],teamScores:{},entries:{fr200:[p.id,first.id]}};
     showEventOverallPlayback({stage:'prelim',event:'fr200',eventResult:race},()=>{});
    },{meet,slot});
    const overall=page.locator('.modal-event-result');await overall.waitFor();
    assert.ok((await overall.locator('th').allTextContents()).includes('レース前PB'));
    assert.deepEqual(await overall.locator('.result-own .result-entry-pb').allTextContents(),['2:05.00','-'],meet);
    assert.equal(await overall.locator('tbody tr:not(.result-own) .result-entry-pb').innerText(),'—');
    await overall.locator('#nextEv').click();
    await page.evaluate(()=>showEventOverallPlayback({stage:'final',event:'fr200',eventResult:window.comparisonResult.events.fr200},()=>{}));
    assert.deepEqual(await page.locator('.modal-event-result .result-own .result-entry-pb').allTextContents(),['2:03.00','2:04.00'],meet);
    assert.ok(await page.evaluate(()=>window.comparisonResult.events.fr200.final.slice(0,2).every(r=>r.achievement.pb&&r.athlete.bestTimes.fr200<r.entryPB)));
    const overflow=await overall.evaluate(el=>el.scrollWidth>el.clientWidth+1);assert.equal(overflow,false);
    await overall.locator('#nextEv').click();await page.evaluate(()=>showMeetResults(window.comparisonResult));
    const tables=page.locator('#resBody .individual-results-table');assert.equal(await tables.count(),2);
    assert.deepEqual(await tables.nth(0).locator('.result-own .result-entry-pb').allTextContents(),['2:03.00','2:04.00']);
    assert.deepEqual(await tables.nth(1).locator('.result-own .result-entry-pb').allTextContents(),['2:05.00','-']);
    await page.locator('.modal-meet-results #x').click();
   }
   await page.evaluate(async()=>{state.comparisonResultTest=JSON.parse(JSON.stringify(window.comparisonResult));await saveLocal();await navigator.serviceWorker.ready});
   await context.setOffline(true);assert.ok((await page.reload()).fromServiceWorker());await page.waitForFunction(()=>state?.comparisonResultTest&&!localSaveBusy);
   await page.evaluate(()=>showMeetResults(state.comparisonResultTest));
   const tables=page.locator('#resBody .individual-results-table');
   assert.deepEqual(await tables.nth(0).locator('.result-own .result-entry-pb').allTextContents(),['2:03.00','2:04.00']);
   assert.deepEqual(await tables.nth(1).locator('.result-own .result-entry-pb').allTextContents(),['2:05.00','-']);
   assert.deepEqual(errors,[]);
  }finally{await context.close()}
 }}finally{await app.close()}
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
    if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-trial-stats-${options.isMobile?'iphone':'pc'}-${options.viewport.width}x${options.viewport.height}.png`)});}
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

test('final race cards show actual prelim clocks and keep relay qualifying clocks after lineup changes on PC and portrait iPhone',async()=>{
  const app=await fixture();
  try{for(const options of [{viewport:{width:1280,height:800}},{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]){
    const context=await testContext(options);
    try{
      const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);
      const individual=await page.evaluate(()=>{
        rng=()=>.5;gauss=()=>0;
        state.slot=43;
        state.players.slice(0,8).forEach(p=>{p.stats=Object.fromEntries(STATS.map(k=>[k,185]));p.bestTimes=Object.fromEntries(EVENTS.map(e=>[e,round2(expectedTime(p,e))]))});
        const own=state.players[0],original=state.players.slice(0,4).map(p=>p.id);
        const field=runEvent('intercollege','fr200',[own.id],buildCpuCollegeEntries('intercollege'));
        const events=Object.fromEntries(EVENTS.map(e=>[e,e==='fr200'?field:{prelim:[],final:[],heats:[]}]));
        window.finalCardResult={meet:'intercollege',season:2026,slot:43,events,relays:runRelays('intercollege',{'4x200fr':original},true),relayEntries:{'4x200fr':original}};
        window.finalCardEntries={fr200:[own.id]};
        const q=buildMeetRaceQueue(window.finalCardResult,window.finalCardEntries).find(q=>q.event==='fr200'&&q.phase==='final');
        if(!q)throw new Error('Missing own final');
        const rows=[...q.rows].sort((a,b)=>a.heatLane-b.heatLane);
        const expected=rows.map(row=>fmt(field.prelim.find(p=>p.athlete.id===row.athlete.id).race.total));
        const metadata=rows.every(row=>row.prelimTime===field.prelim.find(p=>p.athlete.id===row.athlete.id).race.total);
        playRaceCanvas(q.event,q.rows,{meet:'intercollege',stageLabel:'A決勝',onSkip:()=>{}});
        return{expected,metadata};
      });
      assert.ok(individual.metadata);assert.equal(individual.expected.length,8);
      assert.deepEqual(await page.locator('.race-prelim-time b').allTextContents(),individual.expected);
      assert.equal(await page.locator('#nextRace').isDisabled(),true);
      if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-final-prelims-${options.isMobile?'iphone':'pc'}.png`)});}
      await page.locator('#skipEvent').click();
      const relay=await page.evaluate(()=>{
        const result=window.finalCardResult,entry=result.relays.find(r=>r[0]==='4x200fr'),prelim=entry[2].prelim.find(ownsRelayTeam).race.total;
        const replacements=state.players.slice(4,8).map(p=>p.id);
        const team=setRelayFinalEntry(result,'4x200fr',replacements);
        const q=buildMeetRaceQueue(result,window.finalCardEntries).find(q=>q.event==='4x200fr'&&q.phase==='final');
        const rows=[...q.rows].sort((a,b)=>a.heatLane-b.heatLane),saved=JSON.stringify(entry[2].prelim);
        playRaceCanvas(q.event,q.rows,{meet:'intercollege',stageLabel:'リレー A決勝',onSkip:()=>{}});
        return{expected:rows.map(row=>fmt(entry[2].prelim.find(p=>p.organization===row.athlete.organization).race.total)),
          actual:team.prelimTime,prelim,replacements:team.members.map(p=>p.id),ids:replacements,saved};
      });
      assert.equal(relay.actual,relay.prelim);assert.deepEqual(relay.replacements,relay.ids);
      assert.deepEqual(await page.locator('.race-prelim-time b').allTextContents(),relay.expected);
      assert.equal(await page.locator('.relay-entrant .relay-member').count(),32);
      const bounds=await page.locator('.modal-race-live').evaluate(m=>{
        const modal=m.getBoundingClientRect(),button=m.querySelector('#skipEvent').getBoundingClientRect();
        return{inside:button.left>=modal.left&&button.right<=modal.right+1&&button.top>=modal.top&&button.bottom<=modal.bottom+1,canvas:m.querySelector('canvas').clientHeight};
      });
      assert.ok(bounds.inside&&bounds.canvas>50,JSON.stringify(bounds));
      if(process.env.SWIM_SCREENSHOT_DIR){await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-relay-final-prelims-${options.isMobile?'iphone':'pc'}.png`)});}
      await page.locator('#skipEvent').click();
      assert.equal(await page.evaluate(()=>JSON.stringify(window.finalCardResult.relays.find(r=>r[0]==='4x200fr')[2].prelim)),relay.saved);assert.deepEqual(errors,[]);
    }finally{await context.close()}
  }}finally{await app.close()}
});

test('restored CPU universities, 32-swimmer cohorts and qualified entries persist on PC and iPhone',async()=>{
  const app=await fixture();
  try{for(const options of [{viewport:{width:1280,height:900}},{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]){
    const context=await testContext(options);
    try{
      const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);await page.waitForFunction(()=>cloudSync);
      const result=await page.evaluate(async()=>{
        const errors=[],cohorts=state.universities.map(u=>state.world.filter(a=>a.category==='university'&&!a.retired&&a.organization===u.name).length);
        for(const meet of ['kansai_college','intercollege','japan_open','japan_championship']){
          const college=COLLEGE_ENTRY_LIMIT_MEETS.has(meet),entries=college?buildCpuCollegeEntries(meet):buildCpuNationalEntries(meet),counts={},schools={};
          for(const e of meetIndividualEvents(meet)){
            const roster=entries[e].map(id=>state.world.find(a=>a.id===id));
            const seeded=seedRaceHeats(roster.map(a=>({source:'CPU',athlete:a,entryPB:a.bestTimes[e]})),e,meet);
            if(seeded.flat().length!==roster.length||new Set(seeded.flat().map(row=>row.athlete.id)).size!==roster.length)errors.push(meet+e+' discarded/duplicate entry');
            if(seeded.some((heat,i)=>heat.length>8||(heat.length<(roster.length>=8?4:roster.length)&&!(i===0&&roster.length>24&&roster.length<28))))errors.push(meet+e+' invalid heat packing');
            for(const a of roster){counts[a.id]=(counts[a.id]||0)+1;const key=a.organization+'|'+e;schools[key]=(schools[key]||0)+1;if(!qualified(a,meet,e))errors.push('unqualified')}
          }
          if(college&&(Object.values(counts).some(n=>n>3)||Object.values(schools).some(n=>n>3)))errors.push('college quota');
          if(!college&&Object.values(counts).some(n=>n>5))errors.push('national quota');
          if(!college&&state.world.some(a=>allowedCpu(a,meet)&&EVENTS.some(e=>qualified(a,meet,e))&&!counts[a.id]))errors.push('missing qualified swimmer');
        }
        const serial=state.serial,old=JSON.stringify(state.world),own=JSON.stringify(state.players);
        state.points=172;await saveLocal();await loadLocal(false);
        return{errors,cohorts,kansai:state.kansaiIds.length,inter:state.interIds.length,
          stable:state.serial===serial&&JSON.stringify(state.world)===old&&JSON.stringify(state.players)===own,
          saved:JSON.parse(await getLocalSaveStore().read()).points,standard:standardFor('kansai_college','fr100')};
      });
      assert.deepEqual(result.errors,[]);assert.equal(result.kansai,12);assert.equal(result.inter,39);assert.equal(result.stable,true);
      assert.equal(result.cohorts.length,39);assert.ok(result.cohorts.every(count=>count===32),JSON.stringify(result.cohorts));
      assert.equal(result.saved,172);assert.equal(result.standard,61);
      await page.locator('#standardsBtn').click();assert.match(await page.locator('.modal').last().innerText(),/1:01\.00/);
      assert.deepEqual(errors,[]);
    }finally{await context.close()}
  }}finally{await app.close()}
});

test('v1.85 expanded saves migrate college baseline once, preserve own data and university names, and reload offline on PC and iPhone',async()=>{
  for(const options of [{viewport:{width:1280,height:900}},{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]){
    const app=await fixture(true),context=await testContext(options);
    try{
      const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);
      await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
      const original=await page.evaluate(async()=>{
        renamePlayerUniversity('保持した自大学');renameOrganization('university',0,'保持した他大学');
        state.season=2028;state.slot=15;state.points=179;
        const own=state.players[0];own.stats.fr_speed=151.37;own.bestTimes.fr100=48.13;
        state.trainingFocus[own.id]=['fr_stamina'];state.trainingPlans[own.id]=Object.fromEntries(STATS.map(k=>[k,k==='fr_stamina'?100:0]));
        recordIndividualResult(own,'fr100',48.13,'intercollege','A決勝');upsertIndividualTop10('fr100',own,48.13,'intercollege','A決勝');
        // Recreate an expanded save independently of the new canonical roster.
        const template=deepClone(state.world.find(a=>a.category==='university'));
        for(let n=201;n<=236;n++){
          const university={id:'CPUU'+n,name:'追加大学'+n,strength:75,region:'kansai',baseReputation:110,reputation:110};state.universities.push(university);
          for(let grade=1;grade<=4;grade++)for(let i=0;i<8;i++)state.world.push({...deepClone(template),id:'legacy-expanded-'+n+'-'+grade+'-'+i,name:'旧追加選手 '+n+'-'+grade+'-'+i,organization:university.name,grade,age:18+grade});
        }
        state.kansaiIds=state.universities.filter(u=>u.region==='kansai').map(u=>u.id);state.interIds=state.universities.map(u=>u.id);
        delete state.cpuUniversityRosterModelVersion;delete state.collegeReputationBaselineVersion;
        state.cpuMeetPopulationVersion=1;state.version='pwa-v1.85';
        state.meetParticipationHistory=[{season:2026,meet:'kansai_college',counts:{player:3}},{season:2026,meet:'intercollege',counts:{player:2}},
          {season:2027,meet:'kansai_college',counts:{player:4}},{season:2027,meet:'intercollege',counts:{player:3}}];
        state.reputationEvaluations=[
          {season:2026,meet:'intercollege',before:35,reputation:35,delta:0,comparisons:[{meet:'kansai_college',current:3,previous:null,delta:0},{meet:'intercollege',current:2,previous:null,delta:0}],cpuChanges:[]},
          {season:2026,meet:'japan_championship',before:35,reputation:50,delta:15,comparisons:[{meet:'japan_open',current:1,previous:0,delta:15},{meet:'japan_championship',current:0,previous:0,delta:0}],cpuChanges:[]},
          {season:2027,meet:'intercollege',before:50,reputation:62,delta:12,comparisons:[{meet:'kansai_college',current:4,previous:3,delta:2},{meet:'intercollege',current:3,previous:2,delta:10}],cpuChanges:[]}
        ];state.reputation=82;
        const result={players:JSON.stringify(state.players),focus:JSON.stringify(state.trainingFocus),plans:JSON.stringify(state.trainingPlans),top:JSON.stringify(state.teamTop10),
          names:state.universities.filter(u=>!u.id.startsWith('CPUU2')).map(u=>[u.id,u.name]),legacyIds:state.world.filter(a=>a.id.startsWith('legacy-expanded-')).map(a=>a.id).sort(),ownId:own.id};
        await saveLocal();return result;
      });
      app.upgrade();await page.evaluate(async()=>await(await navigator.serviceWorker.getRegistration()).update());
      await page.waitForFunction(async()=>{const keys=await caches.keys();return keys.includes('swim-manager-pwa-v2.75')&&!keys.includes('swim-manager-pwa-v1.91')});
      await page.reload();await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&state.players.length===32);assert.match(await page.title(),/v2\.75/);
      const migrated=await page.evaluate(async()=>{
        await saveLocal();const first=JSON.stringify(state);await loadLocal(false);const second=JSON.stringify(state);
        return{version:state.version,season:state.season,slot:state.slot,points:state.points,reputation:state.reputation,
          players:JSON.stringify(state.players),focus:JSON.stringify(state.trainingFocus),plans:JSON.stringify(state.trainingPlans),top:JSON.stringify(state.teamTop10),
          names:state.universities.map(u=>[u.id,u.name]),orphanSchools:state.world.filter(a=>a.category==='university'&&!a.retired&&!state.universities.some(u=>u.name===a.organization)).length,
          legacyIds:state.world.filter(a=>a.id.startsWith('legacy-expanded-')).map(a=>a.id).sort(),
          evaluations:state.reputationEvaluations.map(r=>({before:r.before,reputation:r.reputation,delta:r.delta,previous:r.comparisons.map(c=>c.previous)})),
          stable:first===second,save:JSON.parse(await getLocalSaveStore().read()).reputation};
      });
      assert.equal(migrated.version,'pwa-v2.75');assert.deepEqual([migrated.season,migrated.slot,migrated.points,migrated.reputation],[2028,15,179,108]);
      for(const key of ['players','focus','plans','top','names','legacyIds'])assert.deepEqual(migrated[key],original[key],key);
      assert.equal(migrated.orphanSchools,0);assert.ok(migrated.stable);assert.equal(migrated.save,108);
      assert.deepEqual(migrated.evaluations,[{before:35,reputation:61,delta:26,previous:[0,0]},{before:61,reputation:76,delta:15,previous:[0,0]},{before:76,reputation:88,delta:12,previous:[3,2]}]);
      assert.equal(await page.evaluate(id=>state.recordRankings.university.fr100.some(r=>r.athleteId===id&&r.time===48.13),original.ownId),true);
      await context.setOffline(true);const response=await page.reload({waitUntil:'load'});assert.ok(response.fromServiceWorker());await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&state.players.length===32);
      assert.equal(await page.evaluate(()=>state.reputation),108);assert.equal(await page.evaluate(()=>JSON.stringify(state.players)),original.players);
      assert.equal(await page.evaluate(()=>JSON.stringify(state.teamTop10)),original.top);
      assert.deepEqual(await page.evaluate(()=>state.universities.map(u=>[u.id,u.name])),original.names);assert.deepEqual(errors,[]);
    }finally{await context.close();await app.close()}
  }
});

test('circle-seeded final three heats play all owned swimmers in PB rank order positions on PC and iPhone',async()=>{
  const app=await fixture();
  try{for(const options of [{viewport:{width:1280,height:900}},{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]){
    const context=await testContext(options);
    try{
      const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);
      const expected=await page.evaluate(()=>{
        state.slot=76;const own=state.players.slice(0,3);
        own.forEach((a,i)=>{a.stats=Object.fromEntries(STATS.map(k=>[k,200]));a.bestTimes.fr100=47+i*.1});
        const entrants=own.map(a=>({source:'PLAYER',athlete:a,entryPB:a.bestTimes.fr100})).concat(state.world.filter(a=>a.category==='middle').slice(0,45).map(a=>({source:'CPU',athlete:a,entryPB:a.bestTimes.fr100})));
        const field=withMeetRaceContext('joint_record',76,2026,()=>raceEventField('joint_record','fr100',entrants));
        const entries={fr100:own.map(a=>a.id)},result={meet:'joint_record',season:2026,slot:76,entries,events:Object.fromEntries(EVENTS.map(e=>[e,e==='fr100'?field:{prelim:[],final:[],heats:[]}])),relays:[],teamScores:{}};
        const queue=buildMeetRaceQueue(result,entries),prelim=queue.filter(q=>q.phase==='prelim');
        const positions=own.map(a=>{const row=field.prelim.find(r=>r.athlete.id===a.id);return{id:a.id,name:a.name,heat:row.heatNo,lane:row.heatLane}});
        window.circleExpected={positions,heats:prelim.map(q=>q.heatNo),labels:queue.map(q=>q.label),count:queue.length,ownDelays:field.prelim.filter(r=>r.source==='PLAYER').map(r=>[r.race.physics.preliminaryDelay,r.race.physics.preliminaryProbability])};
        playMeetSequence(result,entries,()=>showMeetResults(result,()=>{}));return window.circleExpected;
      });
      assert.deepEqual(expected.positions.map(row=>[row.heat,row.lane]),[[6,4],[5,4],[4,4]]);
      assert.deepEqual(expected.heats,[4,5,6]);assert.equal(expected.count,4);assert.equal(expected.ownDelays.length,3);for(const [delay,p]of expected.ownDelays){assert.ok(p>0&&p<1);assert.ok(delay===0||(delay>=.18&&delay<=.45))}
      const races=await drainRaces(page);assert.equal(races.length,4);
      for(let i=0;i<races.length;i++)assert.ok(races[i].includes(expected.labels[i]),JSON.stringify({race:races[i],label:expected.labels[i]}));
      assert.match(await page.locator('#resBody').innerText(),/全6組/);
      assert.equal(await page.locator('#resBody .final-qualifier').count(),8);
      for(const row of expected.positions)assert.ok((await page.locator('#resBody').innerText()).includes(row.name));
      assert.deepEqual(errors,[]);
    }finally{await context.close()}
  }}finally{await app.close()}
});

test('owned national entries beyond the nominal heat limit play the actual late heat, final and summary on PC and iPhone',async()=>{
  const app=await fixture();
  try{for(const options of [{viewport:{width:1280,height:900}},{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]){
    const context=await testContext(options);
    try{
      const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);
      const expected=await page.evaluate(()=>{
        rng=()=>.5;gauss=()=>0;state.slot=67;
        const own=state.players[0];own.stats=Object.fromEntries(STATS.map(k=>[k,200]));own.bestTimes.fr100=40;
        const candidates=state.world.filter(a=>allowedCpu(a,'japan_open')).slice(0,72);
        for(const a of candidates){a.stats=Object.fromEntries(STATS.map(k=>[k,100]));a.bestTimes.fr100=standardFor('japan_open','fr100')-.01}
        const qualifiedIds=buildCpuNationalEntries('japan_open').fr100;
        const field=runEvent('japan_open','fr100',[own.id]);
        const result={meet:'japan_open',season:2026,slot:67,entries:{fr100:[own.id]},events:Object.fromEntries(EVENTS.map(e=>[e,e==='fr100'?field:{prelim:[],final:[],heats:[]}])),relays:[],teamScores:{}};
        const queue=buildMeetRaceQueue(result,result.entries),heat=queue.find(q=>q.phase==='prelim');
        playMeetSequence(result,result.entries,()=>showMeetResults(result,()=>{}));
        return{heatNo:heat.heatNo,heatCount:field.heats.length,nominal:preliminaryHeatCount('japan_open','fr100'),
          qualifiedIds,enteredIds:field.prelim.filter(r=>r.source==='CPU').map(r=>r.athlete.id),
          ownFinal:field.final.some(r=>r.source==='PLAYER'),labels:queue.map(q=>q.label)};
      });
      assert.ok(expected.heatNo>expected.nominal,JSON.stringify(expected));assert.equal(expected.heatNo,expected.heatCount);
      assert.equal(expected.ownFinal,true);assert.deepEqual([...expected.enteredIds].sort(),[...expected.qualifiedIds].sort());
      const races=await drainRaces(page);assert.equal(races.length,2);assert.ok(races[0].includes(expected.labels[0]),races[0]);assert.match(races[1],/A決勝/);
      assert.match(await page.locator('#resBody').innerText(),new RegExp('全'+expected.heatCount+'組'));
      assert.equal(await page.locator('#resBody .final-qualifier').count(),8);assert.ok(await page.locator('#resBody .result-own').count()>=3);
      assert.deepEqual(errors,[]);
    }finally{await context.close()}
  }}finally{await app.close()}
});

test('year-end admissions reflect actual college entrants, resume once offline, and own adult alumni stay highlighted in individual and relay records on PC and iPhone',async()=>{
 const app=await fixture();
 try{for(const options of [{viewport:{width:1280,height:900}},{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]){
  const context=await testContext(options);
  try{
   const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);await page.waitForFunction(()=>state?.players?.length&&!localSaveBusy);
   const prepared=await page.evaluate(async()=>{
    state.slot=96;
    const senior=state.players.find(a=>a.year===4);senior.name='卒業検証 泳者';senior.stats=Object.fromEntries(STATS.map(k=>[k,188]));senior.imAptitude={speed:10,stamina:-10};
    for(const e of EVENTS)senior.bestTimes[e]=round2(expectedTime(senior,e));
    recordIndividualResult(senior,'fr100',senior.bestTimes.fr100,'team_trial','記録会');upsertIndividualTop10('fr100',senior,senior.bestTimes.fr100,'team_trial','記録会');
    const members=[senior,...state.players.filter(a=>a.year===1).slice(0,3)];for(const a of members.slice(1)){a.stats=Object.fromEntries(STATS.map(k=>[k,163]));attachMedleyStats(a);for(const e of EVENTS)a.bestTimes[e]=round2(expectedTime(a,e))}const race=simulateRelay(members,'4x100fr',true);
    recordRelayResult('4x100fr',{organization:state.playerUniversity,members,race},'team_trial','記録会');upsertRelayTop10('4x100fr',members,race.total,'team_trial','記録会',race.legs);
    const old=state.recordRankings.university.fr100.find(r=>r.athleteId===senior.id);
    state.recordRankings.high.fr100=[{...deepClone(old),schoolCategory:'high',gradeAtRecord:3,organization:'卒業検証高校',season:2023}];
    const leaders=graduatingHighSchoolLeaders(),signed=state.world.find(a=>a.id===leaders[0].id);signed.scouted=true;state.recruits=[signed.id];
    const originalNewSeason=newSeason;newSeason=()=>{window.expectedAdmissionLeaders=graduatingHighSchoolLeaders().map(a=>a.id);return originalNewSeason()};
    renderAll();await saveLocal();return{id:senior.id,name:senior.name,leaders:leaders.map(a=>a.id),signed:signed.id};
   });
   await page.locator('#advanceBtn').click();await page.locator('.modal-training-result #next').click();await page.locator('.modal-year-end-retirements').waitFor();
   const ending=await page.evaluate(()=>({notice:deepClone(state.pendingSeasonRetirements),expected:window.expectedAdmissionLeaders,active:activeAthletes().map(a=>a.id)}));
   assert.equal(ending.notice.season,2026);assert.ok(ending.notice.rows.length>0);assert.ok(ending.notice.rows.every(a=>!ending.active.includes(a.id)));assert.ok(!ending.notice.rows.some(a=>a.id===prepared.id));
   assert.equal(await page.locator('.modal-year-end-retirements [data-retirement-id]').count(),ending.notice.rows.length);
   assert.equal(await page.locator('.modal-college-admissions').count(),0);
   const retirementBounds=await page.locator('.modal-year-end-retirements').boundingBox();assert.ok(retirementBounds.width<=options.viewport.width+1&&retirementBounds.height<=options.viewport.height+1);
   for(const a of ending.notice.rows.filter(a=>a.own))assert.match(await page.locator(`[data-retirement-id="${a.id}"]`).innerText(),/自チーム/);
   if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-retirements-${options.isMobile?'iphone':'pc'}.png`)})}
   await page.evaluate(async()=>{await saveLocal();await navigator.serviceWorker.ready});await context.setOffline(true);await page.reload();await page.locator('.modal-year-end-retirements').waitFor();
   assert.deepEqual(await page.evaluate(()=>state.pendingSeasonRetirements),ending.notice);
   await page.locator('#retirementsNext').click();await page.locator('.modal-college-admissions').waitFor();
   assert.equal(await page.evaluate(()=>state.pendingSeasonRetirements),null);
   await page.evaluate(async()=>await saveLocal());await page.reload();await page.locator('.modal-college-admissions').waitFor();assert.equal(await page.locator('.modal-year-end-retirements').count(),0);
   assert.match(await page.locator('.modal-college-admissions').innerText(),/2026年度末 ／ 2027年度/);
   const live=await page.evaluate(()=>{
    const all=new Map(activeAthletes().map(a=>[a.id,a])),notice=state.pendingCollegeAdmissions;
    return{rows:notice.rows.map(a=>({id:a.id,to:a.to,actual:all.get(a.id)?.organization,grade:all.get(a.id)?.year||all.get(a.id)?.grade,own:a.own})),version:state.version};
   });
   assert.deepEqual(live.rows.map(a=>a.id).sort(),[...ending.expected].sort());assert.ok(live.rows.every(a=>a.to===a.actual&&a.grade===1));assert.ok(live.rows.find(a=>a.id===prepared.signed).own);
   for(const row of live.rows)assert.equal(await page.locator(`[data-admission-id="${row.id}"] .admission-destination b`).innerText(),row.actual);
   const bounds=await page.locator('.modal-college-admissions').boundingBox();assert.ok(bounds.width<=options.viewport.width+1&&bounds.height<=options.viewport.height+1,JSON.stringify(bounds));
   const choice=await page.evaluate(()=>{
    const ctx=collegeAdmissionContext(),target=ctx.universities.find(u=>u.id!=='player'&&!ctx.counts.get(u.id)),ids=ctx.notice.rows.filter(a=>!a.own).slice(0,9).map(a=>a.id);
    const signature=()=>profileHash(JSON.stringify(activeAthletes().map(a=>[a.id,a.stats,a.imAptitude,a.bestTimes]).sort((a,b)=>a[0].localeCompare(b[0]))));
    window.admissionsSignature=signature;
    return{target,ids,original:Object.fromEntries(ctx.choices),signature:signature(),seed:state.rngSeed,sizes:state.universities.map(u=>[u.id,state.world.filter(a=>a.category==='university'&&a.grade===1&&a.organization===u.name).length])};
   });
   assert.equal(choice.ids.length,9);
   for(const id of choice.ids.slice(0,8))await page.locator(`[data-admission-choice="${id}"]`).selectOption(choice.target.id);
   const ninth=page.locator(`[data-admission-choice="${choice.ids[8]}"]`);assert.ok(await ninth.locator(`option[value="${choice.target.id}"]`).isDisabled());
   assert.equal(await page.evaluate(({id,target})=>setCollegeAdmissionChoice(id,target).ok,{id:choice.ids[8],target:choice.target.id}),false);
   assert.equal(await page.evaluate(()=>window.admissionsSignature()),choice.signature);assert.equal(await page.evaluate(()=>state.rngSeed),choice.seed);
   await page.evaluate(async()=>{await saveLocal();await navigator.serviceWorker.ready});await context.setOffline(true);await page.reload();await page.locator('.modal-college-admissions').waitFor();
   assert.equal(await page.locator('.modal-college-admissions tbody tr').count(),live.rows.length);
   for(const id of choice.ids.slice(0,8))assert.equal(await page.locator(`[data-admission-choice="${id}"]`).inputValue(),choice.target.id);
   await page.locator('#admissionsReset').click();
   for(const id of choice.ids)assert.equal(await page.locator(`[data-admission-choice="${id}"]`).inputValue(),choice.original[id]);
   for(const id of choice.ids.slice(0,8))await page.locator(`[data-admission-choice="${id}"]`).selectOption(choice.target.id);
   await ninth.selectOption('player');
   if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-admissions-${options.isMobile?'iphone':'pc'}.png`)})}
   await page.locator('#admissionsClose').click();await page.locator('.modal-freshmen-welcome').waitFor();assert.equal(await page.locator('.modal-freshmen-welcome tbody tr').count(),8);
   const confirmed=await page.evaluate(ids=>{
    const all=new Map(activeAthletes().map(a=>[a.id,a]));
    return{names:ids.slice(0,8).map(id=>all.get(id).organization),own:state.players.some(a=>a.id===ids[8]&&a.year===1),count:state.players.filter(a=>a.year===1).length,
     signature:profileHash(JSON.stringify(activeAthletes().map(a=>[a.id,a.stats,a.imAptitude,a.bestTimes]).sort((a,b)=>a[0].localeCompare(b[0])))),
     sizes:state.universities.map(u=>[u.id,state.world.filter(a=>a.category==='university'&&a.grade===1&&a.organization===u.name).length])};
   },choice.ids);
   assert.ok(confirmed.names.every(name=>name===choice.target.name));assert.ok(confirmed.own);assert.equal(confirmed.count,8);assert.equal(confirmed.signature,choice.signature);assert.deepEqual(confirmed.sizes,choice.sizes);
   await page.locator('#freshClose').click();await page.waitForFunction(()=>!localSaveBusy);await page.evaluate(async()=>await saveLocal());await page.reload();await page.waitForFunction(()=>state?.players?.length&&!localSaveBusy);
   assert.equal(await page.locator('.modal-college-admissions').count(),0);assert.equal(await page.evaluate(()=>state.pendingCollegeAdmissions),null);
   assert.equal(await page.evaluate(id=>state.players.some(a=>a.id===id),choice.ids[8]),true);
   for(const id of choice.ids.slice(0,8))assert.equal(await page.evaluate(id=>state.world.find(a=>a.id===id).organization,id),choice.target.name);
   const alumni=await page.evaluate(id=>{const a=state.world.find(a=>a.id===id);return{age:a.age,category:a.category,own:a.alumni,organization:a.organization}},prepared.id);
   assert.deepEqual([alumni.age,alumni.category,alumni.own],[23,'adult',true]);
   await page.locator('#nav [data-page="rankings"]').click();await page.locator('#rankEvent').selectOption('fr100');
   for(const category of ['all','adult']){
    await page.locator('#rankCategory').selectOption(category);const row=page.locator(`[data-ranking-athlete="${prepared.id}"]`);assert.ok((await row.getAttribute('class')).includes('own-ranking'));assert.match(await row.innerText(),/卒業生/);assert.match(await row.innerText(),/23歳/);assert.match(await row.innerText(),/★/);assert.ok((await row.innerText()).includes(alumni.organization));
   }
   await page.locator('#nav [data-page="records"]').click();await page.locator('#recordRankingEvent').selectOption('fr100');
   for(const [category,grade] of [['high','高3'],['university','大4'],['japan','大4']]){
    await page.locator('#recordRankingCategory').selectOption(category);const row=page.locator('#recordRankingBody tr').filter({hasText:prepared.name});assert.ok((await row.getAttribute('class')).includes('record-ranking-own'));assert.equal(await row.locator('.alumni-tag').innerText(),'卒業生');assert.match(await row.innerText(),new RegExp(grade));assert.match(await row.locator('.active-athlete').innerText(),/現役 23歳/);
   }
   await page.locator('#recordRankingEvent').selectOption('4x100fr');await page.locator('#recordRankingCategory').selectOption('university');
   const relay=page.locator('#recordRankingBody .record-relay-leg').filter({hasText:prepared.name});assert.equal(await relay.locator('.alumni-tag').innerText(),'卒業生');assert.ok(await relay.locator('.record-relay-lap').innerText());
   await page.locator('#nav [data-page="team-top10"]').click();
   for(const event of ['fr100','4x100fr']){await page.locator('#teamTop10Event').selectOption(event);const row=page.locator('#teamTop10Body tr').filter({hasText:prepared.name});assert.ok((await row.getAttribute('class')).includes(event==='fr100'?'top10-alumnus':'top10-active'));assert.equal(await row.locator('.alumni-tag').innerText(),'卒業生');assert.match(await row.innerText(),/現役 23歳/)}
   await page.evaluate(id=>{
    state.world=state.world.filter(a=>a.id!==id);state.alumniCareer.find(a=>a.id===id).status='社会人引退';renamePlayerUniversity('改名後の母校');renderAll();
   },prepared.id);
   const retired=page.locator('#teamTop10Body tr').filter({hasText:prepared.name});assert.equal(await retired.locator('.alumni-tag').innerText(),'卒業生');assert.equal(await retired.locator('.active-athlete').count(),3);
   await page.locator('#nav [data-page="records"]').click();await page.locator('#recordRankingEvent').selectOption('fr100');await page.locator('#recordRankingCategory').selectOption('japan');
   const historic=page.locator('#recordRankingBody tr').filter({hasText:prepared.name});assert.equal(await historic.locator('.alumni-tag').innerText(),'卒業生');assert.equal(await historic.locator('.active-athlete').count(),0);
   await page.evaluate(async()=>await saveLocal());await page.reload();await page.waitForFunction(()=>state?.players?.length&&!localSaveBusy);
   await page.locator('#nav [data-page="records"]').click();await page.locator('#recordRankingCategory').selectOption('japan');await page.locator('#recordRankingEvent').selectOption('fr100');assert.match(await page.locator('#recordRankingBody').innerText(),/卒業生/);assert.deepEqual(errors,[]);
  }finally{await context.close()}
 }}finally{await app.close()}
});

test('PB top-five preliminary correction includes both teams, keeps the shared race clock and persists offline on PC and iPhone',async()=>{
  const app=await fixture();
  try{for(const mobile of [false,true]){
    const context=await testContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile});
    try{
      const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy);
      const races=await page.evaluate(()=>{
        const cpu=state.world.find(a=>a.category==='university'),own=state.players[0],before=JSON.stringify([cpu,own]),savedRng=rng,savedGauss=gauss,rows=[];
        gauss=()=>0;
        try{for(const event of ['fr50','fr100','fr200','fr400','im200','im400']){
          const entrants=[cpu,own].map(athlete=>({athlete,entryPB:athlete.bestTimes[event]??round2(expectedTime(athlete,event))}));
          const simulate=(athlete,gate)=>{let i=0;const seq=[.5,.5,.5,.5,gate,.5,.5];rng=()=>seq[i++%seq.length];return withMeetRaceContext('japan_open',65,2026,()=>withPreliminaryDelayField(entrants,event,()=>simulateMeetRace(athlete,event,'japan_open',true,true)))};
          for(const athlete of [cpu,own]){const yes=simulate(athlete,0),no=simulate(athlete,.99);rows.push({event,source:athlete===own?'PLAYER':'CPU',p:yes.physics.preliminaryProbability,normalProbability:athletePreliminaryProbability(athlete,event),level:yes.physics.meetFormLevel,delay:yes.physics.preliminaryDelay,zero:no.physics.preliminaryDelay,difference:round2(yes.total-no.total),finish:[yes.trajectory.at(-1).t,no.trajectory.at(-1).t],times:[yes.total,no.total]})}
        }}finally{rng=savedRng;gauss=savedGauss}
        return{rows,unchanged:before===JSON.stringify([cpu,own])};
      });
      assert.ok(races.unchanged);assert.equal(races.rows.filter(r=>r.source==='PLAYER').length,6);for(const row of races.rows){assert.ok(row.p>0&&row.p<1);assert.ok(Math.abs(row.p-row.normalProbability*({'-2':1,'-1':1,0:1,1:.7,2:.4}[row.level]))<1e-10);assert.ok(row.delay>0);assert.equal(row.zero,0);assert.ok(Math.abs(row.difference-row.delay)<.011);assert.deepEqual(row.finish,row.times)}
      await page.evaluate(()=>showMeetFormRanges());const help=page.locator('.modal-form-ranges');await help.waitFor();
      const text=await help.innerText();assert.match(text,/PB上位5名/);assert.match(text,/6番手以下とPB未計測の選手は対象外/);assert.match(text,/好調なら0.7倍/);assert.match(text,/絶好調なら0.4倍/);
      if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-preliminary-${mobile?'iphone':'pc'}.png`)})}
      await page.locator('#closeFormRanges').click();
      const saved=await page.evaluate(async()=>{await saveLocal();await navigator.serviceWorker.ready;return{actors:JSON.stringify([state.players,state.world]),seed:state.rngSeed,rates:state.world.slice(0,10).map(a=>[50,100,200,400].map(d=>athletePreliminaryProbability(a,'fr'+d)))}});
      await context.setOffline(true);const response=await page.reload({waitUntil:'load'});assert.ok(response.fromServiceWorker());await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy);
      assert.deepEqual(await page.evaluate(()=>({actors:JSON.stringify([state.players,state.world]),seed:state.rngSeed,rates:state.world.slice(0,10).map(a=>[50,100,200,400].map(d=>athletePreliminaryProbability(a,'fr'+d)))})),saved);assert.deepEqual(errors,[]);
    }finally{await context.close()}
  }}finally{await app.close()}
});

test('relay performance uses dedicated corrections for both teams and keeps laps, records and help tabs across offline reload on PC and iPhone',async()=>{
 const app=await fixture();
 try{for(const mobile of [false,true]){
  const context=await testContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile});
  try{
   const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy);
   const data=await page.evaluate(()=>{
    const members=state.players.slice(0,4),savedRng=rng,savedGauss=gauss,before=JSON.stringify(members.map(a=>a.stats)),others=JSON.stringify(members.slice(1).map(a=>a.bestTimes));rng=()=>.5;gauss=()=>0;
    const races=[];try{for(const kind of RELAYS){
     const own=simulateRelay(members,kind,true,true),cpu=simulateCpuRelay(members,kind,'intercollege',true);
     const events=relayLegEvents(kind),individual=members.map((a,i)=>simulateRace(a,events[i],true,true,i>0,false).total),pb=members.map((a,i)=>a.bestTimes[events[i]]??null);
     recordRelayResult(kind,{organization:state.playerUniversity,members,race:own,rank:1},'intercollege','決勝');upsertRelayTop10(kind,members,own.total,'intercollege','決勝',own.legs);
     races.push({kind,legs:own.legs,cpu:cpu.legs,individual,total:own.total,sum:round2(own.legs.reduce((s,t)=>s+t,0)),last:own.cumulativeLegs.at(-1),finish:own.trajectory.at(-1).t,pb,firstPB:members[0].bestTimes[events[0]]});
    }}finally{rng=savedRng;gauss=savedGauss}
    showMeetFormRanges();return{races,own:members[0].id,unchanged:before===JSON.stringify(members.map(a=>a.stats))&&others===JSON.stringify(members.slice(1).map(a=>a.bestTimes))};
   });
   assert.ok(data.unchanged);for(const r of data.races){assert.equal(r.firstPB,Math.min(r.pb[0]??Infinity,Math.round(r.legs[0]*100)/100));assert.deepEqual(r.legs,r.cpu);assert.equal(r.total,r.sum);assert.equal(r.total,r.last);assert.ok(Math.abs(r.finish-r.total)<1e-8);assert.equal(r.legs[0],r.individual[0]);assert.ok(r.legs.slice(1).every((t,i)=>t<r.individual[i+1]));}
   const help=page.locator('.modal-form-ranges');assert.equal(await help.locator('#individualFormRanges').getAttribute('aria-pressed'),'true');assert.equal(await help.locator('thead th').count(),5);
   await help.locator('#relayFormRanges').click();assert.equal(await help.locator('thead th').count(),3);assert.equal(await help.locator('tbody tr').count(),5);
   const relayText=await help.locator('#formRangesTable').innerText();assert.match(relayText,/−0.20〜＋0.40/);assert.match(relayText,/−0.50〜＋0.90/);assert.match(relayText,/−0.60〜＋0.00/);assert.match(relayText,/−1.20〜＋0.00/);assert.ok(await help.locator('#relayFormInfo').isVisible());
   assert.match(await help.locator('#relayFormInfo').innerText(),/第1泳者は「個人種目・第1泳者」の表/);assert.match(await help.locator('#relayFormInfo').innerText(),/自チーム・CPU共通/);assert.match(await help.locator('#relayFormInfo').innerText(),/第1泳者が個人PBを上回った場合はPB/);
   if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-relay-ranges-${mobile?'iphone':'pc'}.png`)})}
   await help.locator('#individualFormRanges').click();assert.equal(await help.locator('thead th').count(),5);assert.match(await help.locator('#formRangesTable').innerText(),/−0.20〜＋1.00/);
   await help.locator('#closeFormRanges').click();await page.evaluate(id=>showPlayerDetail(id),data.own);
   await page.locator('[data-detail-view="history"]').click();
   const rows=page.locator('#historyTable tbody tr');for(const race of data.races){const row=rows.filter({hasText:await page.evaluate(e=>RELAY_LABEL[e],race.kind)});assert.ok((await row.innerText()).includes(await page.evaluate(t=>fmt(t),race.legs[0])))}
   await page.locator('.modal-player-detail #x').click();
   const saved=await page.evaluate(async()=>{await saveLocal();await navigator.serviceWorker.ready;return JSON.stringify([state.players,state.world,state.recordRankings,state.teamTop10,state.rngSeed])});
   await context.setOffline(true);const response=await page.reload({waitUntil:'load'});assert.ok(response.fromServiceWorker());await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy);
   assert.equal(await page.evaluate(()=>JSON.stringify([state.players,state.world,state.recordRankings,state.teamTop10,state.rngSeed])),saved);assert.deepEqual(errors,[]);
  }finally{await context.close()}
 }}finally{await app.close()}
});


test('entry PB sorting and automatic championship-first world candidate order preserve selections on PC and iPhone',async()=>{
 const app=await fixture();
 try{for(const mobile of [false,true]){
  const context=await testContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile});
  try{
   const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);await page.waitForFunction(()=>state?.players?.length===32&&!localSaveBusy);
   const setup=await page.evaluate(()=>{
    state.players=state.players.slice(0,6);
    const years=[4,1,2,1,3,1],specialties=['fr100','ba100','fly100','fr200','im200','fr50'],times=[50,49,49,null,0,51];
    state.players.forEach((p,i)=>{p.year=years[i];p.age=18+years[i];p.specialty=specialties[i];for(const k of STATS)if(k!=='mental')p.stats[k]=170;for(const e of EVENTS)p.bestTimes[e]=round2(expectedTime(p,e)+(5-i)*.3);p.bestTimes.fr100=times[i]});
    migrateCpuRaceConsistency();
    const baseline=[...state.players].sort((a,b)=>a.year-b.year||SPECIALTY_EVENTS.indexOf(a.specialty)-SPECIALTY_EVENTS.indexOf(b.specialty)).map(a=>a.id);
    const expected=Object.fromEntries(EVENTS.map(e=>[e,[...state.players].sort((a,b)=>{
     const at=typeof a.bestTimes[e]==='number'&&a.bestTimes[e]>0?a.bestTimes[e]:Infinity,bt=typeof b.bestTimes[e]==='number'&&b.bestTimes[e]>0?b.bestTimes[e]:Infinity;
     return at-bt||baseline.indexOf(a.id)-baseline.indexOf(b.id);
    }).map(a=>a.id)]));
    return{baseline,expected,ids:state.players.map(a=>a.id),players:JSON.stringify(state.players),seed:state.rngSeed};
   });
   const order=()=>page.locator('#entryMatrix tbody tr').evaluateAll(rows=>rows.map(row=>row.dataset.athleteId));
   for(const [meet,slot] of [['team_trial',1],['joint_record',76],['joint_record',84],['kansai_college',28],['intercollege',44],['japan_open',60],['japan_championship',94],['teijimayama_championship',60]]){
    const eligibleOrder=ids=>meet==='teijimayama_championship'?ids.filter(id=>id!==setup.ids[0]):ids;
    await page.evaluate(({meet,slot})=>openMeetEntry(meet,slot,2026),{meet,slot});assert.deepEqual(await order(),eligibleOrder(setup.baseline));
    const box=id=>page.locator(`#entryMatrix input[data-event="fr100"][data-pid="${id}"]`);
    await box(setup.ids[1]).check();
    await page.locator('[data-entry-sort="fr100"]').click();assert.deepEqual(await order(),eligibleOrder(setup.expected.fr100));
    assert.equal(await page.locator('[data-entry-sort="fr100"]').evaluate(b=>b.closest('th').getAttribute('aria-sort')),'ascending');assert.equal(await page.locator('#entryMatrix th[aria-sort="ascending"]').count(),1);assert.ok(await box(setup.ids[1]).isChecked());
    await box(setup.ids[2]).check();assert.deepEqual(await order(),eligibleOrder(setup.expected.fr100));assert.equal(await page.locator('#entryMatrix input:checked').count(),2);
    await page.locator('[data-entry-sort="fr100"]').click();assert.deepEqual(await order(),eligibleOrder(setup.expected.fr100));
    for(const event of ['ba50','im400'])if(await page.locator(`[data-entry-sort="${event}"]`).count()){
     const button=page.locator(`[data-entry-sort="${event}"]`);await button.scrollIntoViewIfNeeded();const left=await page.locator('.entry-table-wrap').evaluate(w=>w.scrollLeft);await button.click();assert.deepEqual(await order(),eligibleOrder(setup.expected[event]));
     const scroll=await page.locator('.entry-table-wrap').evaluate(w=>({top:w.scrollTop,left:w.scrollLeft}));assert.equal(scroll.top,0);assert.equal(scroll.left,left);if(event==='im400')assert.ok(scroll.left>0);
     assert.ok(await box(setup.ids[1]).isChecked());assert.ok(await box(setup.ids[2]).isChecked());
    }
    const header=page.locator('[data-entry-sort="fr100"]');await header.focus();await header.press('Enter');assert.deepEqual(await order(),eligibleOrder(setup.expected.fr100));
    if(await page.locator('#std').count()){
     await page.locator('#std').click();await page.locator('.modal-standards #x').click();assert.deepEqual(await order(),eligibleOrder(setup.expected.fr100));assert.ok(await box(setup.ids[1]).isChecked());
    }
    if(await page.locator('#relayBtn').count()){
     await page.locator('#relayBtn').click();await page.locator('#relayOk').click();assert.deepEqual(await order(),eligibleOrder(setup.expected.fr100));assert.equal(await page.locator('#entryMatrix input:checked').count(),2);
    }
    if(meet==='intercollege'&&process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-entry-pb-sort-${mobile?'iphone':'pc'}.png`)})}
    await page.locator('#clearAll').click();assert.equal(await page.locator('#entryMatrix input:checked').count(),0);assert.deepEqual(await order(),eligibleOrder(setup.expected.fr100));
    await box(setup.ids[1]).check();await page.locator('[data-entry-sort=""]').click();assert.deepEqual(await order(),eligibleOrder(setup.baseline));assert.ok(await box(setup.ids[1]).isChecked());
    await page.locator('#confirmEntry').click();await page.locator('#backEntry').click();await page.locator('#entryMatrix').waitFor();assert.ok(await box(setup.ids[1]).isChecked());
    if(meet==='japan_championship'){assert.ok(await box(setup.ids[0]).isDisabled());assert.ok(await box(setup.ids[3]).isDisabled());assert.ok(await box(setup.ids[4]).isDisabled())}
    assert.equal(await page.evaluate(()=>JSON.stringify(state.players)),setup.players);assert.equal(await page.evaluate(()=>state.rngSeed),setup.seed);await page.evaluate(()=>closeModal());
   }
   await page.evaluate(()=>{
    const own=state.players;own[4].bestTimes.fr100=60;
    state.japanTeam={year:2027,selectedSeason:2026,individual:Object.fromEntries(EVENTS.map(e=>[e,[]])),relays:{'4x100fr':own.slice(0,4).map(a=>a.id)},additionalIndividual:{},athletes:own.map(a=>({id:a.id,snapshot:deepClone(a),ownAtSelection:true,universityId:controlledUniversityId()}))};
    state.japanTeam.selectionFinalists={fr100:[{id:own[2].id,rank:1,time:50},{id:own[0].id,rank:2,time:51}]};
    state.japanTeam.individual.fr50=own.slice(4).map(a=>a.id);openMeetEntry('world_championship',36,2027);
   });
   const select=slot=>page.locator(`select[data-world-event="fr100"][data-world-slot="${slot}"]`),choices=()=>select(0).locator('option[value]:not([value=""])').evaluateAll(rows=>rows.map(r=>r.value));
   const expectedWorld=[2,0,1,5,4,3].map(i=>setup.ids[i]);
   assert.deepEqual(await choices(),expectedWorld);assert.equal(await page.locator('[data-world-sort]').count(),0);
   await select(0).selectOption(setup.ids[0]);await select(1).selectOption(setup.ids[1]);
   assert.deepEqual(await choices(),expectedWorld);assert.equal(await select(0).inputValue(),setup.ids[0]);assert.equal(await select(1).inputValue(),setup.ids[1]);assert.equal(await select(1).locator(`option[value="${setup.ids[0]}"]`).evaluate(option=>option.disabled),true);
   await select(0).selectOption(setup.ids[2]);assert.deepEqual(await choices(),expectedWorld);
   if(mobile)await page.locator('#worldSelectionProfileTab').click();await page.locator('#worldCompareEvent').selectOption('fr100');
   assert.deepEqual(await page.locator('#worldCompareAthlete option').evaluateAll(rows=>rows.map(r=>r.value)),expectedWorld);
   if(mobile)await page.locator('#worldSelectionListTab').click();assert.deepEqual(await choices(),expectedWorld);assert.equal(await select(0).inputValue(),setup.ids[2]);
   await page.locator('#confirmWorldAdditional').click();assert.deepEqual(await page.evaluate(()=>state.japanTeam.additionalIndividual.fr100),[setup.ids[2],setup.ids[1]]);
   const saved=await page.evaluate(async()=>{closeModal();await saveLocal();await navigator.serviceWorker.ready;return JSON.stringify([state.players,state.japanTeam])});
   await context.setOffline(true);const response=await page.reload({waitUntil:'load'});assert.ok(response.fromServiceWorker());await page.waitForFunction(()=>state?.players?.length===6&&!localSaveBusy);
   assert.equal(await page.evaluate(()=>JSON.stringify([state.players,state.japanTeam])),saved);await page.evaluate(()=>openMeetEntry('team_trial',1,2026));await page.locator('[data-entry-sort="fr100"]').click();assert.deepEqual(await order(),[1,2,0,5,4,3].map(i=>setup.ids[i]));assert.deepEqual(errors,[]);
  }finally{await context.close()}
 }}finally{await app.close()}
});


test('relay results pair each actual swimmer with their split in every stage, national teams and offline PC/iPhone summaries',async()=>{
 const app=await fixture();
 try{for(const mobile of [false,true]){
  const context=await testContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile});
  try{
   const page=await context.newPage(),errors=runtimeErrors(page);await page.goto(app.url);await page.waitForFunction(()=>state?.players?.length===32&&!localSaveBusy);
   const fixtures=await page.evaluate(()=>{
    const own=state.players.slice(0,8),org=state.universities[0].name,cpu=state.world.filter(a=>a.category==='university'&&a.organization===org).slice(0,8),foreign=Array.from({length:8},(_,i)=>({id:'INT-display-'+i,name:'Alexander '+(i===0?'Long <Name> & Hill':'Swimmer '+i),category:'international',age:23+i%4,organization:'米国',nationality:'USA'}));
    own[0].name='青木 <泳者> & 海';
    const make=(members,organization,legs,lane,final)=>({organization,members,heatLane:lane,rank:final?lane-3:undefined,prelimRank:final?undefined:lane-3,race:{total:round2(legs.reduce((s,t)=>s+t,0)),legs}});
    const fixtures=[];
    for(const world of [false,true])for(const kind of RELAYS){
     const distance=kind==='4x200fr'?110:50,other=world?foreign:cpu;
     const pre=[make(own.slice(0,4),world?'日本':state.playerUniversity,[distance+.11,distance+1.22,distance+2.33,distance+3.44],4,false),make(other.slice(0,4),world?'米国':org,[distance+1.41,distance+2.52,distance+3.63,distance+4.74],5,false)];
     const final=[make(own.slice(4,8).reverse(),world?'日本':state.playerUniversity,[distance-.15,distance+.26,distance+1.37,distance+2.48],4,true),make(other.slice(4,8).reverse(),world?'米国':org,[distance+.85,distance+1.96,distance+3.07,distance+4.18],5,true)];
     fixtures.push({meet:world?'world_championship':'intercollege',season:2026,slot:world?36:44,entries:{},teamScores:{},events:Object.fromEntries(EVENTS.map(e=>[e,{prelim:[],final:[],heats:[]}])),relays:[[kind,final,{prelim:pre,heats:[pre]}]]});
    }
    window.relayDisplayBefore=JSON.stringify([state.players,state.world,state.teamTop10,state.recordRankings,state.rngSeed]);
    return fixtures;
   });
   const checkTeam=async(row,team,kind)=>{
    assert.deepEqual(await row.locator('.result-relay-name').allTextContents(),team.members.map(a=>a.name));
    assert.deepEqual(await row.locator('.result-relay-lap').allTextContents(),await page.evaluate(legs=>legs.map(fmt),team.race.legs));
    assert.deepEqual(await row.locator('.result-relay-leg').evaluateAll(nodes=>nodes.map(n=>n.dataset.athleteId)),team.members.map(a=>a.id));
    const orders=await row.locator('.result-relay-order').allTextContents();assert.ok(orders.every((text,i)=>text.startsWith(`${i+1}泳`)));if(kind==='4x100medley')assert.deepEqual(orders,['1泳 Ba','2泳 Br','3泳 Fly','4泳 Fr']);
    assert.ok((await row.innerText()).includes(await page.evaluate(t=>fmt(t),team.race.total)));
    assert.ok(await row.locator('.result-relay-leg').evaluateAll(nodes=>nodes.every(n=>{const name=n.querySelector('.result-relay-member').getBoundingClientRect(),lap=n.querySelector('.result-relay-lap').getBoundingClientRect(),box=n.getBoundingClientRect();const separate=name.right<=lap.left+1||lap.right<=name.left+1||name.bottom<=lap.top+1||lap.bottom<=name.top+1;return n.scrollWidth<=n.clientWidth+1&&separate&&lap.left>=box.left-1&&lap.right<=box.right+1&&lap.top>=box.top-1&&lap.bottom<=box.bottom+1})));
   };
   for(const result of fixtures){
    const [kind,finals,meta]=result.relays[0];
    for(const [phase,teams]of [['prelim',meta.prelim],['final',finals]]){
     await page.evaluate(({kind,teams,phase})=>showRaceGroupResult({event:kind,label:phase==='final'?'A決勝':'予選 1組',rows:teams.map(t=>({source:ownsRelayTeam(t)?'PLAYER':'CPU',athlete:{id:'RELAY-'+t.organization,name:t.organization,organization:t.organization,category:'relay'},heatLane:t.heatLane,members:t.members,race:t.race}))},()=>window.relayGroupClosed=(window.relayGroupClosed||0)+1),{kind,teams,phase});
     const rows=page.locator('.modal-race-result .relay-results-table tbody>tr');assert.equal(await rows.count(),2);for(let i=0;i<2;i++)await checkTeam(rows.nth(i),teams[i],kind);await page.locator('#nextGroup').click();assert.equal(await page.locator('.modal-race-result').count(),0);
     await page.evaluate(({kind,teams,phase})=>showEventOverallPlayback({event:kind,stage:phase==='final'?'relay_final':'relay_prelim',relayTeams:teams},()=>{}),{kind,teams,phase});
     const overall=page.locator('.modal-event-result .relay-results-table tbody>tr');for(let i=0;i<2;i++)await checkTeam(overall.nth(i),teams[i],kind);assert.equal(await page.locator('.modal-event-result .final-qualifier').count(),phase==='prelim'?2:0);await page.locator('#nextEv').click();
    }
    await page.evaluate(result=>showMeetResults(result,()=>{}),result);assert.equal(await page.locator('#resBody').innerText(),'個人種目の結果はありません。');
    for(const [phase,teams]of [['prelim',meta.prelim],['final',finals]]){const rows=page.locator(`[data-relay-event="${kind}"][data-relay-stage="${phase}"] .relay-results-table tbody>tr`);for(let i=0;i<2;i++)await checkTeam(rows.nth(i),teams[i],kind)}
    assert.equal(await page.locator('.modal-meet-results .pb-badge').count(),0);
    if(result.meet==='world_championship'&&kind==='4x100medley'&&process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.locator('[data-relay-stage="final"]').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-relay-result-${mobile?'iphone':'pc'}.png`)})}
    await page.locator('.modal-meet-results #x').click();assert.equal(await page.locator('.modal-meet-results').count(),0);
   }
   const legacy=fixtures[0].relays[0][1][0];await page.evaluate(team=>{const copy=deepClone(team);copy.members=copy.members.slice(0,1);copy.race.legs=[copy.race.legs[0],null,0];showRaceGroupResult({event:'4x100fr',label:'旧結果',rows:[{source:'PLAYER',athlete:{name:copy.organization,organization:copy.organization,category:'relay'},members:copy.members,race:copy.race}]},()=>{})},legacy);
   assert.deepEqual(await page.locator('.result-relay-name').allTextContents(),[legacy.members[0].name,'メンバー不明','メンバー不明','メンバー不明']);assert.deepEqual((await page.locator('.result-relay-lap').allTextContents()).slice(1),['-','-','-']);await page.locator('#nextGroup').click();
   assert.equal(await page.evaluate(()=>window.relayDisplayBefore===JSON.stringify([state.players,state.world,state.teamTop10,state.recordRankings,state.rngSeed])),true);
   const saved=await page.evaluate(async()=>{await saveLocal();await navigator.serviceWorker.ready;return JSON.stringify([state.players,state.world,state.teamTop10,state.recordRankings,state.rngSeed])});
   await context.setOffline(true);const response=await page.reload({waitUntil:'load'});assert.ok(response.fromServiceWorker());await page.waitForFunction(()=>state?.players?.length===32&&!localSaveBusy);assert.equal(await page.evaluate(()=>JSON.stringify([state.players,state.world,state.teamTop10,state.recordRankings,state.rngSeed])),saved);
   const restored=fixtures.at(-1);await page.evaluate(result=>showMeetResults(result,()=>{}),restored);await checkTeam(page.locator('[data-relay-stage="final"] .result-own'),restored.relays[0][1][0],restored.relays[0][0]);assert.deepEqual(errors,[]);
  }finally{await context.close()}
 }}finally{await app.close()}
});

test('favorite rivals register beside roster names without scrolling or opening details, open current details from any page and persist offline on PC and phones',async()=>{
 const app=await fixture();
 try{for(const [label,options]of [['pc',{viewport:{width:1280,height:900}}],['iphone-landscape',{viewport:{width:844,height:390},isMobile:true,hasTouch:true}],['iphone-portrait',{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]]){
  const context=await testContext(options),page=await context.newPage(),errors=runtimeErrors(page);
  try{
   await page.goto(app.url);await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy,null,{timeout:90000});
   await page.locator('#favoriteRivalsBtn').click();assert.match(await page.locator('.modal-favorite-rivals').innerText(),/まだ登録されていません/);await page.locator('#favoriteRivalsClose').click();
   await page.locator('#nav [data-page="rivals"]').click();
   const setup=await page.evaluate(()=>{
    const roster=rivalUniversityRoster(selectedRivalUniversityId),a=roster[0],b=roster[8];
    a.name=b.name='同姓 同名 <注目>';renderRivals();window.favoritesProtected=JSON.stringify({...state,favoriteRivals:[]});
    return{ids:[a.id,b.id],university:selectedRivalUniversityId};
   });
   for(const id of setup.ids){
    const star=page.locator(`[data-favorite-rival="${id}"]`);await star.scrollIntoViewIfNeeded();
    const before=await star.evaluate(el=>({root:document.getElementById('gameScroll').scrollTop,table:document.querySelector('.rival-roster-wrap').scrollLeft,ids:[...document.querySelectorAll('[data-rival-row]')].map(row=>row.dataset.rivalRow),left:el.getBoundingClientRect().left}));
    const handle=await star.elementHandle();await star.click();
    assert.equal(await star.innerText(),'★');assert.equal(await star.getAttribute('aria-pressed'),'true');assert.equal(await page.locator('#modalRoot .modal').count(),0);
    const after=await star.evaluate(el=>({root:document.getElementById('gameScroll').scrollTop,table:document.querySelector('.rival-roster-wrap').scrollLeft,ids:[...document.querySelectorAll('[data-rival-row]')].map(row=>row.dataset.rivalRow),left:el.getBoundingClientRect().left}));
    assert.deepEqual(after,before,'registration preserves roster order and scroll');assert.ok(await handle.evaluate(el=>el.isConnected&&document.activeElement===el));
   }
   assert.match(await page.locator('#favoriteRivalsBtn').innerText(),/（2）/);
   if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.locator('#gameScroll').evaluate(el=>el.scrollTop=0);await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-favorite-roster-${label}.png`)})}
   await page.locator('#nav [data-page="home"]').click();await page.locator('#favoriteRivalsBtn').click();
   assert.equal(await page.locator('[data-favorite-row]').count(),2);assert.equal(await page.locator('.favorite-rival-name').filter({hasText:'同姓 同名 <注目>'}).count(),2);
   for(const id of setup.ids){
    const row=page.locator(`[data-favorite-row="${id}"]`);await row.locator('button.primary').click();
    assert.equal(await page.locator('.modal-rival-player [data-stat]').count(),16);assert.equal(await page.locator('.modal-rival-player [data-rival-pb]').count(),15);assert.equal(await page.locator('[data-detail-focus],#detailSpecialtyBtn').count(),0);
    const expected=await page.evaluate(id=>{const a=state.world.find(a=>a.id===id);return EVENTS.map(e=>validRaceTime(a.bestTimes[e])?fmt(a.bestTimes[e]):'未計測')},id);assert.deepEqual(await page.locator('.modal-rival-player [data-rival-pb] b').allTextContents(),expected);
    await page.locator('#backToFavoriteRivals').click();
   }
   const box=await page.locator('.modal-favorite-rivals').boundingBox();assert.ok(box.x>=-1&&box.y>=-1&&box.x+box.width<=options.viewport.width+1&&box.y+box.height<=options.viewport.height+1,JSON.stringify(box));
   assert.ok(await page.locator('.favorite-rival-list').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'favorites fit without horizontal overflow');
   if(process.env.SWIM_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-favorite-list-${label}.png`)});
   assert.ok(await page.evaluate(()=>window.favoritesProtected===JSON.stringify({...state,favoriteRivals:[]})),'registration and viewing preserve game data and RNG');
   await page.locator('#favoriteRivalsClose').click();await page.waitForFunction(()=>autoSaveTimer===null&&!localSaveBusy&&localSaveStore?.pending===0);await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
   await context.setOffline(true);assert.ok((await page.reload({waitUntil:'load'})).fromServiceWorker());await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy);
   assert.deepEqual(await page.evaluate(()=>state.favoriteRivals.map(entry=>entry.id)),setup.ids);
   await page.locator('#favoriteRivalsBtn').click();
   await page.evaluate(id=>{const a=state.world.find(a=>a.id===id);a.category='adult';a.age=23;a.organization='移籍先実業団';a.bestTimes.fr200=111.25;showFavoriteRivals()},setup.ids[0]);
   const adult=page.locator(`[data-favorite-row="${setup.ids[0]}"]`);assert.match(await adult.innerText(),/社会人 23歳/);assert.match(await adult.innerText(),/移籍先実業団/);await adult.locator('button.primary').click();assert.match(await page.locator('.modal-rival-player').innerText(),/移籍先実業団/);assert.equal(await page.locator('[data-rival-pb="fr200"] b').innerText(),'1:51.25');await page.locator('#backToFavoriteRivals').click();
   await page.evaluate(id=>{state.world=state.world.filter(a=>a.id!==id);showFavoriteRivals()},setup.ids[0]);
   const missing=page.locator(`[data-favorite-row="${setup.ids[0]}"]`);assert.match(await missing.innerText(),/現在の選手情報がありません/);assert.ok(await missing.locator('button.primary').isDisabled());await missing.locator('[data-favorite-remove]').click();
   assert.equal(await page.locator('[data-favorite-row]').count(),1);await page.locator('[data-favorite-remove]').click();assert.match(await page.locator('.modal-favorite-rivals').innerText(),/まだ登録されていません/);
   await page.evaluate(()=>autoSaveNow());await page.reload();await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy);assert.equal(await page.evaluate(()=>state.favoriteRivals.length),0);assert.deepEqual(errors,[]);
  }finally{await context.close()}
 }}finally{await app.close()}
});

test('favorite rivals sort by university and ascending grade and preserve long-list and roster scroll through both detail return buttons on PC and phones',async()=>{
 const app=await fixture();
 try{for(const [label,options]of [['pc',{viewport:{width:1280,height:900}}],['landscape',{viewport:{width:844,height:390},isMobile:true,hasTouch:true}],['portrait',{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]]){
  const context=await testContext(options),page=await context.newPage(),errors=runtimeErrors(page);
  try{
   await page.goto(app.url);await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy,null,{timeout:90000});
   await page.locator('#nav [data-page="rivals"]').click();
   const setup=await page.evaluate(()=>{
    const schools=state.universities.slice(0,2);schools[0].reputation=100;schools[1].reputation=300;renderRivals();
    const universityOrder=new Map([...document.querySelector('#rivalUniversity').options].map((option,i)=>[state.universities.find(u=>u.id===option.value).name,i]));
    const athletes=state.world.filter(a=>a.category==='university'&&schools.some(u=>u.name===a.organization)).slice().reverse();
    state.favoriteRivals=[];athletes.forEach(a=>setFavoriteRival(a.id,true));updateFavoriteRivalButtons();
    window.sortScrollProtected=JSON.stringify(state);
    const expected=athletes.slice().sort((a,b)=>universityOrder.get(a.organization)-universityOrder.get(b.organization)||a.grade-b.grade||a.name.localeCompare(b.name,'ja')||a.id.localeCompare(b.id)).map(a=>a.id);
    return{expected,roster:rivalUniversityRoster(selectedRivalUniversityId).map(a=>a.id)};
   });
   await page.locator('#favoriteRivalsBtn').click();assert.deepEqual(await page.locator('[data-favorite-row]').evaluateAll(rows=>rows.map(row=>row.dataset.favoriteRow)),setup.expected);
   const snapshots=()=>page.evaluate(()=>({root:document.getElementById('gameScroll').scrollTop,table:document.querySelector('.rival-roster-wrap').scrollLeft,list:document.querySelector('.favorite-rival-list')?.scrollTop,modal:document.querySelector('.modal-favorite-rivals')?.scrollTop}));
   for(const [index,close]of [[25,'#backToFavoriteRivals'],[35,'.modal-rival-player #x']]){
    const row=page.locator('[data-favorite-row]').nth(index),button=row.locator('button.primary');await button.scrollIntoViewIfNeeded();
    const before=await snapshots();assert.ok(before.list>0,'test must open a detail below the top of a long list');const handle=await page.locator('.favorite-rival-list').elementHandle();
    await button.click();assert.equal((await snapshots()).root,before.root);await page.locator(close).click();await page.evaluate(()=>new Promise(requestAnimationFrame));
    assert.ok(await handle.evaluate(el=>el.isConnected));assert.deepEqual(await snapshots(),before,'return restores every original scroll container');assert.ok(await button.evaluate(el=>document.activeElement===el));
   }
   await page.locator('#favoriteRivalsClose').click();
   const row=page.locator(`[data-rival-row="${setup.roster[20]}"]`),link=row.locator('[data-rival-athlete]');await link.scrollIntoViewIfNeeded();const before=await snapshots();
   await link.click();assert.equal((await snapshots()).root,before.root);await page.locator('.modal-rival-player #x').click();await page.evaluate(()=>new Promise(requestAnimationFrame));assert.deepEqual(await snapshots(),before,'roster detail keeps background scroll');
   assert.ok(await page.evaluate(()=>window.sortScrollProtected===JSON.stringify(state)),'sorting and scrolling do not change saves or RNG');
   setup.expected=await page.evaluate(()=>{
    state.universities[0].reputation=450;renderRivals();
    const order=new Map([...document.querySelector('#rivalUniversity').options].map((option,i)=>[state.universities.find(u=>u.id===option.value).name,i]));
    const ids=new Set(state.favoriteRivals.map(entry=>entry.id));
    return state.world.filter(a=>ids.has(a.id)).slice().sort((a,b)=>order.get(a.organization)-order.get(b.organization)||a.grade-b.grade||a.name.localeCompare(b.name,'ja')||a.id.localeCompare(b.id)).map(a=>a.id);
   });
   await page.locator('#favoriteRivalsBtn').click();assert.deepEqual(await page.locator('[data-favorite-row]').evaluateAll(rows=>rows.map(row=>row.dataset.favoriteRow)),setup.expected);
   await page.evaluate(async()=>{await saveLocal();await navigator.serviceWorker.ready});await context.setOffline(true);await page.reload();await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy);
   await page.locator('#favoriteRivalsBtn').click();assert.deepEqual(await page.locator('[data-favorite-row]').evaluateAll(rows=>rows.map(row=>row.dataset.favoriteRow)),setup.expected);assert.deepEqual(errors,[]);
   if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-sorted-favorites-${label}.png`)})}
  }finally{await context.close()}
 }}finally{await app.close()}
});

test('renaming other schools, universities and adult teams retains every settings scroll position and the active rename button on PC and phones',async()=>{
 const app=await fixture();
 try{for(const [label,options]of [['pc',{viewport:{width:1280,height:900}}],['landscape',{viewport:{width:844,height:390},isMobile:true,hasTouch:true}],['portrait',{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]]){
  const context=await testContext(options),page=await context.newPage(),errors=[],alerts=[];let answer=null;
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async dialog=>{if(dialog.type()==='prompt'){answer===null?await dialog.dismiss():await dialog.accept(answer)}else{alerts.push(dialog.message());await dialog.accept()}});
  try{
   await page.goto(app.url);await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy,null,{timeout:90000});
   await page.locator('.utility-summary').click();await page.locator('#universitiesBtn').click();
   await page.locator('#page-settings .org-edit-list').evaluateAll(lists=>lists.forEach((el,i)=>el.scrollTop=80+i*20));
   const snapshot=()=>page.evaluate(()=>({page:[document.getElementById('gameScroll').scrollTop,document.getElementById('gameScroll').scrollLeft],lists:[...document.querySelectorAll('#page-settings .org-edit-list')].map(el=>[el.scrollTop,el.scrollLeft])}));
   const protectedBefore=await page.evaluate(()=>JSON.stringify([state.rngSeed,state.slot,state.points,state.reputation,state.players.map(a=>[a.id,a.stats,a.bestTimes]),state.world.map(a=>[a.id,a.stats,a.bestTimes]),state.universities.map(u=>[u.id,u.reputation])]));
   const clickRename=async button=>{
    const box=await button.boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
    assert.ok(await button.evaluate(el=>{const b=el.getBoundingClientRect();return el.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2))}),'rename button must be unobscured before measuring scroll');
    if(options.hasTouch)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);
   };
   const renamed=[];
   for(const [category,panel]of [['middle','settingsMiddle'],['high','settingsHigh'],['university','settingsUniversity'],['adult','settingsAdult']]){
    const info=await page.evaluate(category=>{const names=category==='university'?state.universities.map(u=>u.name):organizationNames()[category],index=Math.floor(names.length*.6);return{index,old:names[index]}},category);
    const button=page.locator(`#${panel} [data-index="${info.index}"]`);await button.evaluate(el=>el.scrollIntoView({block:'center',inline:'nearest'}));await button.hover();const before=await snapshot();assert.ok(before.lists.some(([top])=>top>0),'test must include scrolled lists');const handle=await button.elementHandle(),list=await page.locator(`#${panel} .org-edit-list`).elementHandle();
    for(const prefix of ['改称','新称']){
     answer=prefix+info.old.slice(2);await clickRename(button);await page.evaluate(()=>new Promise(requestAnimationFrame));
     assert.match(alerts.at(-1),/変更しました/);assert.equal(await button.locator('..').locator('span').first().innerText(),answer);
     assert.deepEqual(await snapshot(),before,'rename must preserve page and all four list scrolls');
     assert.ok(await handle.evaluate(el=>el.isConnected&&document.activeElement===el));assert.ok(await list.evaluate(el=>el.isConnected));
    }
    renamed.push({category,index:info.index,name:answer});
    if(category==='university'){
     const saved=await page.evaluate(()=>JSON.stringify(state));answer=null;await clickRename(button);assert.equal(await page.evaluate(()=>JSON.stringify(state)),saved);assert.deepEqual(await snapshot(),before);
     answer=await page.evaluate(()=>state.playerUniversity);await clickRename(button);assert.match(alerts.at(-1),/同名の大学/);assert.equal(await page.evaluate(()=>JSON.stringify(state)),saved);assert.deepEqual(await snapshot(),before);
    }
   }
   assert.equal(await page.evaluate(()=>JSON.stringify([state.rngSeed,state.slot,state.points,state.reputation,state.players.map(a=>[a.id,a.stats,a.bestTimes]),state.world.map(a=>[a.id,a.stats,a.bestTimes]),state.universities.map(u=>[u.id,u.reputation])])),protectedBefore);
   await page.evaluate(async()=>{await saveLocal();await navigator.serviceWorker.ready});await context.setOffline(true);await page.reload();await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy);
   assert.deepEqual(await page.evaluate(rows=>rows.map(row=>({category:row.category,index:row.index,name:row.category==='university'?state.universities[row.index].name:organizationNames()[row.category][row.index]})),renamed),renamed);assert.deepEqual(errors,[]);
  }finally{await context.close()}
 }}finally{await app.close()}
});

test('Teijimayama hides all fourth-years in individual and both relay entry stages, clears stale senior selections and retains seniors for other meets',async()=>{
 const app=await fixture();
 try{for(const options of [{viewport:{width:1280,height:900}},{viewport:{width:844,height:390},isMobile:true,hasTouch:true},{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]){
  const context=await testContext(options),page=await context.newPage(),errors=runtimeErrors(page);
  try{
   await page.goto(app.url);await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy,null,{timeout:90000});
   const setup=await page.evaluate(()=>{
    const seniors=state.players.filter(a=>a.year===4),own=state.players.filter(a=>a.year<4).slice(0,4);
    window.teiProtected=JSON.stringify([state.players,state.world,state.rngSeed]);
    openMeetEntry('teijimayama_championship',60,2026,{fr100:[seniors[0].id,own[0].id]},{'4x100fr':[seniors[0].id,...own.slice(0,3).map(a=>a.id)]});
    return{seniors:seniors.map(a=>a.id),own:own.map(a=>a.id),count:state.players.length-seniors.length};
   });
   const assertIndividual=async()=>{assert.equal(await page.locator('#entryMatrix tbody tr').count(),setup.count);for(const id of setup.seniors)assert.equal(await page.locator(`#entryMatrix [data-athlete-id="${id}"]`).count(),0)};
   const assertRelay=async()=>{for(const id of setup.seniors)assert.equal(await page.locator(`.modal-relay-editor option[value="${id}"]`).count(),0)};
   await assertIndividual();assert.match(await page.locator('.modal-meet-entry .notice').innerText(),/大学1〜3年生/);assert.equal(await page.locator('#entryMatrix input:checked').count(),1);
   await page.locator('[data-entry-sort="fr100"]').click();await assertIndividual();await page.locator('#relayBtn').click();await assertRelay();
   assert.deepEqual(await page.locator('select[data-kind="4x100fr"]').evaluateAll(selects=>selects.map(s=>s.value)),['','','','']);
   for(let i=0;i<4;i++)await page.locator(`select[data-kind="4x100fr"][data-i="${i}"]`).selectOption(setup.own[i]);await page.locator('#relayOk').click();await page.locator('#confirmEntry').click();
   const selected=await page.locator('.modal-entry-confirm [data-form-athlete]').evaluateAll(nodes=>nodes.map(n=>n.dataset.formAthlete));assert.ok(selected.every(id=>!setup.seniors.includes(id)));
   await page.locator('#backEntry').click();await page.locator('#entryMatrix').waitFor();await assertIndividual();assert.equal(await page.locator('#entryMatrix input:checked').count(),1);
   await page.evaluate(ids=>{closeModal();openRelayEditor({'4x100fr':ids},()=>{},{kinds:['4x100fr'],roster:relayFinalRoster({meet:'teijimayama_championship'}),required:true,formContext:{meet:'teijimayama_championship',slot:60,season:2026}})},setup.own);await assertRelay();await page.locator('#relayClose').click();
   await page.evaluate(()=>openMeetEntry('japan_open',66,2026));for(const id of setup.seniors)assert.equal(await page.locator(`#entryMatrix [data-athlete-id="${id}"]`).count(),1);
   assert.ok(await page.evaluate(()=>window.teiProtected===JSON.stringify([state.players,state.world,state.rngSeed])));
   await page.evaluate(async()=>{closeModal();await saveLocal();await navigator.serviceWorker.ready});await context.setOffline(true);assert.ok((await page.reload()).fromServiceWorker());await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy);
   await page.evaluate(()=>openMeetEntry('teijimayama_championship',60,2026));await assertIndividual();assert.equal(await page.evaluate(()=>state.players.filter(a=>a.year===4).length),setup.seniors.length);assert.deepEqual(errors,[]);
  }finally{await context.close()}
 }}finally{await app.close()}
});

test('expanded reputation migrates earned saves once, excludes legacy relay counts and restores own and rival evaluations offline on PC and iPhone',async()=>{
 const app=await fixture();
 try{for(const [label,options]of [['pc',{viewport:{width:1280,height:900}}],['iphone',{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]]){
  const context=await testContext(options),page=await context.newPage(),errors=runtimeErrors(page);
  try{
   await page.goto(app.url);await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy,null,{timeout:90000});
   const expected=await page.evaluate(async()=>{
    state.version='pwa-v2.56';delete state.reputationScaleVersion;state.participationModelVersion=1;state.collegeReputationBaselineVersion=1;
    state.reputation=179;
    for(const u of state.universities){u.baseReputation=round2(reputationStrengthValue(u.baseReputation));u.reputation=round2(reputationStrengthValue(u.reputation))}
    const u=state.universities[0];u.baseReputation=250;u.reputation=260;
    state.meetParticipationHistory=['japan_open','japan_championship'].map(meet=>({season:2025,meet,counts:{player:14,[u.id]:15}}));
    state.reputationEvaluations=[{season:2025,meet:'japan_championship',before:179,reputation:179,delta:0,comparisons:[{meet:'japan_open',previous:14,current:14,delta:0},{meet:'japan_championship',previous:14,current:14,delta:0}]}];
    state.favoriteRivals=[{id:state.world.find(a=>a.category==='university').id,name:'登録選手',organization:u.name}];
    const protectedData=JSON.stringify([state.players,state.world,state.rngSeed,state.scoutingCompetition,state.recordRankings,state.teamTop10,state.trainingFocus,state.favoriteRivals]);
    await saveLocal();await navigator.serviceWorker.ready;
    return {protectedData,id:u.id};
   });
   await page.reload();await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&state.reputationScaleVersion===2&&!localSaveBusy,null,{timeout:90000});
   assert.equal(await page.evaluate(()=>state.reputation),331.67);assert.equal(await page.locator('#homeRep').innerText(),'強豪');
   assert.deepEqual(await page.evaluate(id=>{const u=state.universities.find(u=>u.id===id);return [u.baseReputation,u.reputation]},expected.id),[450,466.67]);
   assert.equal(await page.evaluate(()=>JSON.stringify([state.players,state.world,state.rngSeed,state.scoutingCompetition,state.recordRankings,state.teamTop10,state.trainingFocus,state.favoriteRivals])),expected.protectedData,'migration preserves abilities, PBs, records, scouting, favorites and RNG');
   assert.ok(await page.evaluate(()=>state.meetParticipationHistory.every(r=>r.individualOnly===false)));
   await page.locator('#reputationInfoBtn').click();
   const rules=await page.locator('.modal-reputation').innerText();assert.match(rules,/リレーだけの出場者は加点・減点とも対象外/);assert.match(rules,/初期基準評判の±100pt/);assert.match(rules,/旧尺度/);
   assert.deepEqual(await page.locator('.modal-reputation table').first().locator('tbody tr').evaluateAll(rows=>rows.map(row=>row.children[1].textContent)),['±2','±8','±12','±18']);
   if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`v2.75-reputation-${label}.png`)})}
   await page.locator('.modal-reputation #x').click();
   const result=await page.evaluate(async id=>{
    const before=state.reputation,cpuBefore=state.universities.find(u=>u.id===id).reputation;
    const complete=(season,count)=>{for(const meet of ['japan_open','japan_championship'])completeMeet({meet,season,events:{},relays:[],participationCounts:{player:count,[id]:count},participationModelVersion:2})};
    complete(2026,3);const baseline=[state.reputation,state.universities.find(u=>u.id===id).reputation];
    complete(2027,4);const earned=[state.reputation,state.universities.find(u=>u.id===id).reputation];
    const once=JSON.stringify(state);complete(2027,4);const idempotent=once===JSON.stringify(state);renderAll();await saveLocal();
    return {before,cpuBefore,baseline,earned,idempotent,snapshot:JSON.stringify([state.reputation,state.universities,state.meetParticipationHistory,state.reputationEvaluations])};
   },expected.id);
   assert.deepEqual(result.baseline,[331.67,466.67]);assert.deepEqual(result.earned,[361.67,496.67]);assert.ok(result.idempotent);
   await context.setOffline(true);assert.ok((await page.reload({waitUntil:'load'})).fromServiceWorker());await page.waitForFunction(()=>state?.version==='pwa-v2.75'&&!localSaveBusy);
   assert.equal(await page.evaluate(()=>JSON.stringify([state.reputation,state.universities,state.meetParticipationHistory,state.reputationEvaluations])),result.snapshot);assert.deepEqual(errors,[]);
  }finally{await context.close()}
 }}finally{await app.close()}
});

test('settings switches the existing controlled university and restores school assets and favorite athletes offline on PC and iPhone',async()=>{
 const app=await fixture();
 try{for(const [label,options]of [['pc',{viewport:{width:1280,height:900}}],['iphone',{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]]){
  const context=await testContext(options),page=await context.newPage(),errors=runtimeErrors(page);
  try{
   await page.goto(app.url);await page.waitForFunction(()=>state?.players?.length&&!localSaveBusy,null,{timeout:90000});
   const before=await page.evaluate(()=>{
    state.points=123;state.facilities.mental=37;state.reputation=550;
    const u=state.universities.find(u=>u.id==='U08'),a=state.world.find(a=>a.organization===u.name&&a.category==='university');setFavoriteRival(a.id,true);
    window.controlFingerprint=()=>JSON.stringify(activeAthletes().map(a=>[a.id,a.name,a.organization,a.age,a.stats,a.bestTimes,a.potentialType,a.growthProfile]).sort((a,b)=>a[0].localeCompare(b[0])));
    return {fingerprint:controlFingerprint(),rng:state.rngSeed,slot:state.slot,favorite:a.id,target:u.name};
   });
   const settings=async()=>{await page.locator('.utility-menu summary').click();await page.locator('#universitiesBtn').click()};
   await settings();assert.equal(await page.locator('#page-settings #changeControlledUniversity').count(),1);await page.locator('#changeControlledUniversity').click();
   await page.locator('#controlUniversity').selectOption('U08');assert.match(await page.locator('#controlPreview').innerText(),/在籍 32名/);
   if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`university-control-${label}.png`)})}
   await page.locator('#controlApply').click();await page.waitForFunction(()=>state?.players?.length&&controlledUniversityId()==='U08'&&!localSaveBusy);
   await page.locator('.modal-university-control').waitFor({state:'hidden'});assert.match(await page.locator('#controlledUniversityNote').innerText(),new RegExp(before.target));
   assert.deepEqual(await page.evaluate(()=>[state.points,state.facilities.mental,state.universities.length]),[0,0,39]);
   assert.equal(await page.evaluate(()=>controlFingerprint()),before.fingerprint);assert.equal(await page.evaluate(()=>state.rngSeed),before.rng);
   await page.locator('#favoriteRivalsBtn').click();const favorite=page.locator(`[data-favorite-row="${before.favorite}"]`);assert.doesNotMatch(await favorite.innerText(),/現在の選手情報がありません|社会人/);await favorite.locator('button.primary').click();await page.locator('#backToFavoriteRivals').click();await page.locator('#favoriteRivalsClose').click();
   await page.evaluate(async()=>{state.points=19;state.facilities.mental=8;await saveLocal();await navigator.serviceWorker.ready});await page.reload();await page.waitForFunction(()=>state?.players?.length&&controlledUniversityId()==='U08'&&!localSaveBusy);
   assert.equal(await page.evaluate(()=>JSON.stringify(activeAthletes().map(a=>[a.id,a.name,a.organization,a.age,a.stats,a.bestTimes,a.potentialType,a.growthProfile]).sort((a,b)=>a[0].localeCompare(b[0])))),before.fingerprint);
   await settings();await page.locator('#changeControlledUniversity').click();await page.locator('#controlUniversity').selectOption('PLAYER');await page.locator('#controlApply').click();await page.waitForFunction(()=>state?.players?.length&&controlledUniversityId()==='PLAYER'&&!localSaveBusy);await page.locator('.modal-university-control').waitFor({state:'hidden'});
   assert.deepEqual(await page.evaluate(()=>[state.points,state.facilities.mental,state.reputation,state.slot,state.universityControls.U08.points,state.universityControls.U08.facilities.mental]),[123,37,550,before.slot,19,8]);
   await page.evaluate(()=>saveLocal());await context.setOffline(true);assert.ok((await page.reload()).fromServiceWorker());await page.waitForFunction(()=>state?.players?.length&&controlledUniversityId()==='PLAYER'&&!localSaveBusy);
   assert.equal(await page.evaluate(()=>new Set([controlledUniversityId(),...state.universities.map(u=>u.id)]).size),40);assert.deepEqual(errors,[]);
  }finally{await context.close()}
 }}finally{await app.close()}
});

for(const [label,options]of [['pc',{viewport:{width:1280,height:900}}],['iphone',{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]])test(`meet recovery keeps entry drafts, relay drafts, official clocks and race progress after closing the page on ${label}`,async()=>{
 const app=await fixture(),context=await testContext(options),errorLists=[];let page=await context.newPage();errorLists.push(runtimeErrors(page));
 const ready=()=>page.waitForFunction(()=>state?.players?.length&&!localSaveBusy&&!meetCheckpointBusy,null,{timeout:90000});
 const reopen=async(close=false)=>{
  if(close){await page.close();page=await context.newPage();errorLists.push(runtimeErrors(page));await page.goto(app.url)}else await page.reload();
  await ready();
 };
 const fingerprint=()=>page.evaluate(()=>JSON.stringify([state.meetSession.result,state.rngSeed,state.points,state.pointLog,state.meetHistory,state.teamScoreHistory,state.players.map(a=>[a.id,a.stats,a.bestTimes]),state.world.map(a=>[a.id,a.stats,a.bestTimes])]));
 try{
  await page.goto(app.url);await ready();
  const setup=await page.evaluate(async()=>{
   const result=switchControlledUniversity('U08');if(!result.ok)throw new Error(result.msg);
   state.slot=Array.from({length:96},(_,i)=>i+1).find(slot=>meetAt(slotDate(slot))==='intercollege');renderAll();
   const athlete=state.players.find(a=>SPECIALTY_EVENTS.some(e=>qualified(a,'intercollege',e))),event=SPECIALTY_EVENTS.find(e=>qualified(athlete,'intercollege',e));
   const relay=bestRelayMembers(state.players,'4x100fr').map(a=>a.id),slot=state.slot;
   await saveLocal();await navigator.serviceWorker.ready;return {id:athlete.id,event,relay,slot,points:state.points};
  });
  await page.locator('#advanceBtn').click();await page.locator('.modal-training-result #next').click();await page.locator('.modal-meet-entry').waitFor();
  await page.locator(`[data-pid="${setup.id}"][data-event="${setup.event}"]`).check();
  await page.locator('#relayBtn').click();for(let i=0;i<2;i++)await page.locator(`#relayEditorBody select[data-kind="4x100fr"][data-i="${i}"]`).selectOption(setup.relay[i]);
  const entryState=await page.evaluate(()=>JSON.stringify([state.slot,state.rngSeed,state.points,state.players.map(a=>[a.id,a.stats,a.bestTimes]),state.world.map(a=>[a.id,a.stats,a.bestTimes])]));
  // Hold back ordinary saves so restoration specifically exercises the small
  // synchronous draft journal written by each choice, rather than pagehide.
  await page.evaluate(()=>{const write=writeSaveSilently;writeSaveSilently=reason=>reason==='auto'?true:write(reason)});
  await page.locator('#relayEditorBody select[data-kind="4x100fr"][data-i="1"]').selectOption('');await page.locator('#relayEditorBody select[data-kind="4x100fr"][data-i="1"]').selectOption(setup.relay[1]);
  await reopen(true);await page.locator('.modal-relay-editor').waitFor();
  assert.deepEqual(await page.locator('#relayEditorBody select[data-kind="4x100fr"]').evaluateAll(selects=>selects.map(s=>s.value)),[setup.relay[0],setup.relay[1],'','']);
  assert.ok(await page.locator(`[data-pid="${setup.id}"][data-event="${setup.event}"]`).isChecked());
  assert.equal(await page.evaluate(()=>JSON.stringify([state.slot,state.rngSeed,state.points,state.players.map(a=>[a.id,a.stats,a.bestTimes]),state.world.map(a=>[a.id,a.stats,a.bestTimes])])),entryState);
  for(let i=2;i<4;i++)await page.locator(`#relayEditorBody select[data-kind="4x100fr"][data-i="${i}"]`).selectOption(setup.relay[i]);await page.locator('#relayOk').click();
  await page.locator('#confirmEntry').click();await reopen();await page.locator('.modal-entry-confirm').waitFor();assert.deepEqual(await page.evaluate(()=>state.meetSession.relaySel['4x100fr']),setup.relay);
  await page.locator('#goRace').click();await page.locator('#startProgramRace').waitFor({timeout:90000});await ready();const generated=await fingerprint();
  assert.equal(await page.evaluate(()=>state.points),setup.points+1,'the individual entry earns one point before the finals finish');
  assert.equal(await page.evaluate(()=>state.meetHistory.filter(m=>m.meet==='intercollege'&&m.season===2026).length),1);
  await reopen();await page.locator('#startProgramRace').waitFor();assert.equal(await fingerprint(),generated,'program reload keeps official results, PBs, points and RNG');
  await page.locator('#startProgramRace').click();await page.locator('#raceCanvas').waitFor();await page.locator('#pause').click();await ready();const racing=await fingerprint();
  await reopen();await page.locator('#raceCanvas').waitFor();await page.locator('#pause').click();assert.equal(await fingerprint(),racing,'race resumes without recalculation');
  await page.locator('#skipEvent').click();await page.locator('.modal-race-result').waitFor();await ready();const group=await page.locator('.modal-race-result').innerText();
  await reopen();await page.locator('.modal-race-result').waitFor();assert.equal(await page.locator('.modal-race-result').innerText(),group,'completed heat returns to its result');
  await page.locator('#nextGroup').click();
  const progress=async stopAtRelay=>{
   for(let n=0;n<160;n++){
    await page.waitForFunction(()=>document.querySelector('#raceCanvas,#startProgramRace,#nextGroup,#nextEv,#relayOk,#collegeRankingNext,.modal-meet-results'),null,{timeout:90000});
    if(await page.locator('#relayOk').count()){if(stopAtRelay)return;await page.locator('#relayOk').click();continue}
    if(await page.locator('.modal-college-ranking,.modal-meet-results').count()){if(stopAtRelay)throw Error('expected a relay final');return}
    if(await page.locator('#startProgramRace').count())await page.locator('#startProgramRace').click();
    else if(await page.locator('#nextGroup').count())await page.locator('#nextGroup').click();
    else if(await page.locator('#nextEv').count())await page.locator('#nextEv').click();
    else if(await page.locator('#raceCanvas').count())await page.locator('#skipEvent').click();
   }
   throw Error('recovery race program did not terminate');
  };
  await progress(true);assert.match(await page.locator('.modal-relay-editor h2').innerText(),/決勝エントリー/);
  const alternate=await page.locator('#relayEditorBody select[data-i="0"]').evaluate(select=>[...select.options].find(o=>o.value&&!o.disabled&&!o.selected).value);
  const finalSelect=page.locator('#relayEditorBody select[data-i="0"]');
  if(options.hasTouch){
    const index=await finalSelect.evaluate((select,value)=>[...select.options].findIndex(option=>option.value===value),alternate);
    await finalSelect.tap();await page.locator(`#touchSelectOptions [data-option-index="${index}"]`).tap();
  }else await finalSelect.selectOption(alternate);
  await ready();const beforeFinal=await fingerprint();
  await reopen(true);await page.locator('.modal-relay-editor').waitFor();assert.equal(await page.locator('#relayEditorBody select[data-i="0"]').inputValue(),alternate);assert.equal(await fingerprint(),beforeFinal,'uncommitted final lineup is restored without a race draw');
  if(process.env.SWIM_SCREENSHOT_DIR){fs.mkdirSync(process.env.SWIM_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`meet-recovery-relay-${label}.png`)})}
  await page.locator('#relayOk').click();await page.locator('#startProgramRace').waitFor();await ready();const final=await fingerprint();
  await reopen();await page.locator('#startProgramRace').waitFor();assert.equal(await page.locator('.modal-relay-editor').count(),0);assert.equal(await fingerprint(),final,'confirmed final lineup and time do not reroll');
  await progress(false);await ready();
  const earned=await page.evaluate(()=>{const result=state.meetSession.result.data,reward=result.finalPointReward;return{reward,entryPoints:result.entryPoints,points:state.points,log:state.pointLog.at(-1),entryLogs:state.pointLog.filter(row=>row.kind==='entry'&&row.meet==='intercollege'&&row.season===2026),guard:state.meetPointRewardKeys.includes(reward.key)}});
  assert.equal(earned.entryPoints,1);assert.equal(earned.entryLogs.length,1);assert.equal(earned.points,setup.points+earned.entryPoints+earned.reward.points);assert.equal(earned.log.points,earned.reward.points);assert.equal(earned.log.kind,'final_rank');assert.ok(earned.guard);
  const complete=await page.evaluate(()=>JSON.stringify([state.points,state.pointLog,state.meetPointRewardKeys,state.rngSeed,state.completedMeetKeys,state.meetGrowthRewardKeys,state.reputation,state.meetHistory]));
  await reopen();await page.locator('.modal-college-ranking,.modal-meet-results').first().waitFor();assert.equal(await page.evaluate(()=>JSON.stringify([state.points,state.pointLog,state.meetPointRewardKeys,state.rngSeed,state.completedMeetKeys,state.meetGrowthRewardKeys,state.reputation,state.meetHistory])),complete);
  if(await page.locator('#collegeRankingNext').count())await page.locator('#collegeRankingNext').click();
  assert.match(await page.locator('[data-final-point-reward]').innerText(),new RegExp('＋'+(earned.entryPoints+earned.reward.points)+'pt'));
  assert.equal(await page.locator('[data-entry-point-total]').innerText(),'出場 1pt');assert.equal(await page.locator('[data-final-point-total]').innerText(),`決勝順位 ${earned.reward.points}pt`);
  await page.locator('[data-final-point-reward] summary').click();
  if(process.env.SWIM_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.SWIM_SCREENSHOT_DIR,`meet-final-points-${label}.png`)});
  await page.locator('.modal-meet-results #x').click();await acceptMeetGrowth(page);
  while(await page.locator('#seasonNoticeNext').count())await page.locator('#seasonNoticeNext').click();
  await page.evaluate(()=>saveLocal());await context.setOffline(true);await reopen();assert.equal(await page.evaluate(()=>state.meetSession),null);assert.equal(await page.evaluate(()=>state.slot),setup.slot+1);assert.equal(await page.locator('#advanceBtn').isDisabled(),false);assert.deepEqual(errorLists.flat(),[]);
 }finally{await context.close();await app.close()}
});

test('failed school and meet saves preserve the original world and offer retry and a complete export without rerolling a meet',async()=>{
 const app=await fixture(),context=await testContext({viewport:{width:1280,height:900}});let page=await context.newPage();const errors=runtimeErrors(page);
 try{
  await page.goto(app.url);await page.waitForFunction(()=>state?.players?.length&&!localSaveBusy,null,{timeout:90000});
  const original=await page.evaluate(()=>{window.normalWrite=writeSaveSilently;writeSaveSilently=reason=>reason==='control'?false:normalWrite(reason);return JSON.stringify(state)});
  await page.locator('.utility-menu summary').click();await page.locator('#universitiesBtn').click();await page.locator('#changeControlledUniversity').click();await page.locator('#controlUniversity').selectOption('U08');await page.locator('#controlApply').click();
  await page.waitForFunction(()=>document.getElementById('controlMessage')?.textContent.includes('取り消しました'));
  assert.equal(await page.evaluate(()=>JSON.stringify(state)),original);assert.equal(await page.evaluate(()=>typeof Object.getOwnPropertyDescriptor(state.players[0].stats,'im_speed').get),'function');await page.locator('#controlClose').click();
  const entry=await page.evaluate(async()=>{writeSaveSilently=normalWrite;state.slot=9;openMeetEntry('team_trial',8,2026);await saveLocal();return state.players[0].id});
  await page.locator(`[data-pid="${entry}"][data-event="fr100"]`).check();await page.locator('#confirmEntry').click();
  await page.evaluate(()=>{window.checkpointCalls=0;writeSaveSilently=reason=>reason==='checkpoint'&&++checkpointCalls===2?false:normalWrite(reason)});
  await page.locator('#goRace').click();await page.locator('#meetSaveRetry').waitFor({timeout:90000});
  const generated=await page.evaluate(()=>JSON.stringify([state.rngSeed,state.meetSession.result,state.players.map(a=>[a.id,a.stats,a.bestTimes]),state.meetHistory,state.pointLog]));
  const download=page.waitForEvent('download');await page.locator('#meetSaveExport').click();const file=await download,exported=JSON.parse(fs.readFileSync(await file.path(),'utf8'));assert.equal(exported.meetSession.phase,'racing');assert.equal(exported.meetHistory.filter(m=>m.meet==='team_trial').length,1);
  await page.locator('#meetSaveRetry').click();await page.locator('#raceCanvas').waitFor();await page.locator('#pause').click();assert.equal(await page.evaluate(()=>JSON.stringify([state.rngSeed,state.meetSession.result,state.players.map(a=>[a.id,a.stats,a.bestTimes]),state.meetHistory,state.pointLog])),generated);
  await page.reload();await page.waitForFunction(()=>state?.meetSession?.phase==='racing'&&!meetCheckpointBusy&&!localSaveBusy);await page.locator('#raceCanvas').waitFor();assert.equal(await page.evaluate(()=>state.meetHistory.filter(m=>m.meet==='team_trial').length),1);assert.deepEqual(errors,[]);
 }finally{await context.close();await app.close()}
});
