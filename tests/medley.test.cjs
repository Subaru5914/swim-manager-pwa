const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');

const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const source=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const initialization=source.indexOf('document.getElementById("nav").addEventListener');
assert.ok(initialization>0);
function game(){
  const context=vm.createContext({});vm.runInContext(source.slice(0,initialization),context);
  vm.runInContext('state={rngSeed:12345}',context);
  return code=>JSON.parse(vm.runInContext('JSON.stringify('+code+')',context));
}

test('every swimming ability raises the derived IM ability and speed differences redistribute an unchanged total clock',()=>{
  const run=game();
  const rows=run(`(()=>{
    const p={stats:Object.fromEntries(STATS.map(k=>[k,100]))};
    for(const s of MEDLEY_STROKES)for(const k of ['speed','stamina'])p.stats[s+'_'+k]=88;
    const saved=JSON.stringify(p),rows=[];
    for(const event of ['im200','im400'])for(const stroke of MEDLEY_STROKES)for(const component of ['speed','stamina']){
      const raised=deepClone(p);raised.stats[stroke+'_'+component]=163;
      const before=medleySectionTimes(p,event),after=medleySectionTimes(raised,event);
      rows.push({event,stroke,component,before,after,beforeTotal:expectedTime(p,event),total:expectedTime(raised,event),
        beforeIM:medleyStatValue(p,component),afterIM:medleyStatValue(raised,component),preserved:JSON.stringify(p)===saved});
    }
    return rows;
  })()`);
  assert.equal(rows.length,16);
  for(const row of rows){
    assert.equal(row.preserved,true);
    assert.equal(row.afterIM-row.beforeIM,18.75);
    assert.ok(row.total<row.beforeTotal,JSON.stringify(row));
    assert.ok(Math.abs(row.total-row.after.reduce((sum,s)=>sum+s.time,0))<1e-8);
    for(let i=0;i<4;i++){
      assert.equal(row.after[i].distance,row.event==='im200'?50:100);
      const beforeShare=row.before[i].time/row.beforeTotal,afterShare=row.after[i].time/row.total;
      if(row.component==='stamina')assert.ok(Math.abs(beforeShare-afterShare)<1e-10,JSON.stringify(row));
      else if(row.before[i].stroke===row.stroke)assert.ok(afterShare<beforeShare,JSON.stringify(row));
      else assert.ok(afterShare>beforeShare,JSON.stringify(row));
    }
  }
});

test('start and turns give a small timing adjustment without changing derived IM abilities or stroke shares',()=>{
  const run=game(),rows=run(`(()=>{
    const p={stats:Object.fromEntries(STATS.map(k=>[k,113]))};
    return ['im200','im400'].flatMap(event=>['start',...MEDLEY_STROKES.map(s=>s+'_turn')].map(key=>{
      const raised=deepClone(p);raised.stats[key]+=20;
      return {event,key,before:medleySectionTimes(p,event),after:medleySectionTimes(raised,event),
        beforeTotal:expectedTime(p,event),total:expectedTime(raised,event),beforeIM:eventProfile(p,event).slice(0,2),afterIM:eventProfile(raised,event).slice(0,2)};
    }));
  })()`);
  for(const row of rows){
    assert.deepEqual(row.beforeIM,row.afterIM);
    assert.ok(row.total<row.beforeTotal&&row.beforeTotal-row.total<.2,JSON.stringify(row));
    for(let i=0;i<4;i++)assert.ok(Math.abs(row.before[i].time/row.beforeTotal-row.after[i].time/row.total)<1e-10);
  }
});

test('the same derived IM abilities produce the same total while stroke specialties produce different splits',()=>{
  const run=game(),rows=run(`(()=>{
    const a={stats:Object.fromEntries(STATS.map(k=>[k,88]))},b=deepClone(a);
    a.stats.fly_speed=163;b.stats.ba_speed=163;
    return ['im200','im400'].map(event=>({event,aSummary:eventProfile(a,event),bSummary:eventProfile(b,event),
      a:medleySectionTimes(a,event),b:medleySectionTimes(b,event),aTime:expectedTime(a,event),bTime:expectedTime(b,event)}));
  })()`);
  for(const row of rows){
    for(let i=0;i<4;i++)assert.ok(Math.abs(row.aSummary[i]-row.bSummary[i])<1e-8);
    assert.ok(row.a[0].time<row.b[0].time-2,JSON.stringify(row));
    assert.ok(row.b[1].time<row.a[1].time-2,JSON.stringify(row));
    assert.equal(row.aTime,row.bTime,JSON.stringify(row));
  }
});

test('derived IM abilities stay within twenty points of the mean, follow growth, survive JSON and use no random draws',()=>{
  const run=game(),rows=run(`Array.from({length:30},(_,i)=>{
    const p=attachMedleyStats({id:'aptitude-'+i,stats:Object.fromEntries(STATS.map(k=>[k,113])),bestTimes:{im200:120}});
    const seed=state.rngSeed,before={speed:p.stats.im_speed,stamina:p.stats.im_stamina};
    p.stats.fly_speed+=10;
    const after=p.stats.im_speed,saved=JSON.stringify(p),restored=JSON.parse(saved);
    restored.stats.im_speed=999;restored.stats.im_stamina=-999;fixedCapNormalize(restored);
    const unchanged={speed:restored.stats.im_speed,stamina:restored.stats.im_stamina};
    for(const k of STATS)restored.stats[k]=0;const zero=[restored.stats.im_speed,restored.stats.im_stamina];
    for(const k of STATS)restored.stats[k]=200;const cap=[restored.stats.im_speed,restored.stats.im_stamina];
    return {before,after,unchanged,zero,cap,pb:restored.bestTimes.im200,seed:state.rngSeed===seed};
  })`);
  assert.ok(new Set(rows.map(r=>r.before.speed)).size>10);
  assert.ok(rows.some(row=>Math.abs(row.before.speed-113)>15));
  for(const row of rows){
    assert.ok(Math.abs(row.before.speed-113)<=20&&Math.abs(row.before.stamina-113)<=20);
    assert.ok(Math.abs(row.after-row.before.speed-2.5)<1e-8);
    assert.equal(row.unchanged.speed,row.after);assert.equal(row.unchanged.stamina,row.before.stamina);
    assert.deepEqual(row.zero,[0,0]);assert.deepEqual(row.cap,[200,200]);assert.equal(row.pb,120);assert.equal(row.seed,true);
  }
});

test('balanced IM clocks and splits match real Intercollege winning races and the Japanese-record anchors',()=>{
  const run=game(),rows=run(`[138,163,188].flatMap(v=>{
    const p={stats:Object.fromEntries(STATS.map(k=>[k,v])),bestTimes:{}};
    return ['im200','im400'].map(e=>{const r=replayRaceToOfficialTime(p,e,expectedTime(p,e));return {v,e,total:r.total,sections:r.medleySections.map(s=>s.time)}});
  })`);
  const expected={im200:{138:118.84,163:116.58,188:115.07},im400:{138:255.98,163:247.21,188:245.83}};
  for(const row of rows)assert.equal(row.total,expected[row.e][row.v]);
  assert.deepEqual(rows.find(r=>r.e==='im200'&&r.v===163).sections,[25.31,30.50,33.95,26.82]);
  assert.deepEqual(rows.find(r=>r.e==='im400'&&r.v===163).sections,[54.67,63.45,71.61,57.48]);
});

test('every player, domestic cohort and foreign swimmer receives live IM stats, including admissions and save migration',()=>{
  const run=game(),row=run(`(()=>{
    state=createState();const international=ensureInternationalWorld(2027);
    const roster=[...state.players,...state.world,...international.athletes];
    const all=roster.every(a=>Number.isFinite(a.stats.im_speed)&&Number.isFinite(a.stats.im_stamina));
    const categories=[...new Set(roster.map(a=>a.category||'player'))];
    const senior=state.world.find(a=>a.category==='high'&&a.grade===3),freshman=worldToPlayer(senior);
    const same=freshman.stats.im_speed===senior.stats.im_speed&&freshman.stats.im_stamina===senior.stats.im_stamina;
    const base=JSON.stringify([...state.players,...state.world].map(a=>({id:a.id,stats:Object.fromEntries(STATS.map(k=>[k,a.stats[k]])),pb:a.bestTimes})));
    state=JSON.parse(JSON.stringify(state));for(const a of [...state.players,...state.world]){delete a.stats.im_speed;delete a.stats.im_stamina}
    state.version='pwa-v1.63';migrateState();
    return {all,categories,same,preserved:base===JSON.stringify([...state.players,...state.world].map(a=>({id:a.id,stats:Object.fromEntries(STATS.map(k=>[k,a.stats[k]])),pb:a.bestTimes}))),
      migrated:[...state.players,...state.world,...state.internationalWorld.athletes].every(a=>Number.isFinite(a.stats.im_speed)&&Number.isFinite(a.stats.im_stamina))};
  })()`);
  assert.equal(row.all,true);assert.equal(row.same,true);assert.equal(row.preserved,true);assert.equal(row.migrated,true);
  for(const category of ['player','middle','high','university','adult','international'])assert.ok(row.categories.includes(category));
});

test('actual IM trajectories show a butterfly specialist leading there and a backstroke specialist catching him',()=>{
  const run=game(),rows=run(`(()=>{
    const a={stats:Object.fromEntries(STATS.map(k=>[k,100])),bestTimes:{}};
    for(const s of MEDLEY_STROKES)for(const k of ['speed','stamina'])a.stats[s+'_'+k]=88;
    const b=deepClone(a);a.stats.fly_speed=163;b.stats.ba_speed=163;
    return ['im200','im400'].map(event=>{
      const target=event==='im200'?135:285,ra=replayRaceToOfficialTime(a,event,target),rb=replayRaceToOfficialTime(b,event,target);
      const t=ra.medleySections[0].time-1,index=event==='im200'?1:3;
      return {event,target,a:ra.total,b:rb.total,lead:stateAt(ra,t).distance-stateAt(rb,t).distance,
        aBackEnd:ra.cumulative[index],bBackEnd:rb.cumulative[index]};
    });
  })()`);
  for(const row of rows){
    assert.equal(row.a,row.target);assert.equal(row.b,row.target);
    assert.ok(row.lead>3,JSON.stringify(row));
    assert.ok(row.bBackEnd<row.aBackEnd,JSON.stringify(row));
  }
});

test('IM recording and CPU races share exact section clocks, and replay preserves an official result at every wall',()=>{
  const run=game(),rows=run(`(()=>{
    const p={stats:Object.fromEntries(STATS.map(k=>[k,100])),bestTimes:{}};
    for(const s of MEDLEY_STROKES){p.stats[s+'_speed']={fly:163,ba:88,br:138,fr:113}[s];p.stats[s+'_stamina']={fly:113,ba:138,br:88,fr:163}[s]}
    const cpu={...deepClone(p),category:'university'},rows=[];
    for(const event of ['im200','im400']){
      state.rngSeed=73591;const recorded=simulateRace(p,event,true,true);
      state.rngSeed=73591;const unrecorded=simulateMeetRace(cpu,event,'intercollege',false);
      rows.push({event,total:recorded.total,cpuTotal:unrecorded.total,sections:recorded.medleySections,cpuSections:unrecorded.medleySections});
      for(const target of [recorded.total,recorded.total+3,recorded.total-2].map(round2)){
        const replay=replayRaceToOfficialTime(p,event,target),base=medleySectionTimes(p,event),sum=base.reduce((a,b)=>a+b.time,0);
        const perLeg=distanceOf(event)/200;
        const boundaries=replay.cumulative.filter((_,i)=>(i+1)%perLeg===0);
        let elapsed=0;const expected=base.map((leg,i)=>{elapsed+=leg.time/sum*target;return i===3?target:round2(elapsed)});
        const monotonic=replay.trajectory.every((s,i,a)=>!i||(s.t>=a[i-1].t&&s.distance>=a[i-1].distance));
        rows.push({event,total:replay.total,target,boundaries,expected,splits:replay.splits,sections:replay.medleySections,
          monotonic,end:replay.trajectory.at(-1),finish:stateAt(replay,target).distance});
      }
    }
    return rows;
  })()`);
  for(const row of rows){
    if(row.cpuTotal!==undefined){
      assert.equal(row.total,row.cpuTotal);assert.deepEqual(row.sections,row.cpuSections);continue;
    }
    assert.equal(row.total,row.target);assert.deepEqual(row.boundaries,row.expected);
    assert.ok(row.splits.every(t=>t>0));assert.ok(Math.abs(row.splits.reduce((sum,t)=>sum+t,0)-row.total)<1e-8);
    assert.ok(Math.abs(row.sections.reduce((sum,s)=>sum+s.time,0)-row.total)<1e-8);
    assert.equal(row.monotonic,true);assert.equal(row.end.t,row.total);
    assert.equal(row.finish,row.event==='im200'?200:400);
    assert.equal(row.end.distance,row.finish);
  }
});
