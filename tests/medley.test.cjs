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

test('each IM swimming ability changes its own leg without changing the other three legs or stored stats',()=>{
  const run=game();
  const rows=run(`(()=>{
    const p={stats:Object.fromEntries(STATS.map(k=>[k,100]))};
    for(const s of MEDLEY_STROKES)for(const k of ['speed','stamina'])p.stats[s+'_'+k]=88;
    const saved=JSON.stringify(p),rows=[];
    for(const event of ['im200','im400'])for(const stroke of MEDLEY_STROKES)for(const component of ['speed','stamina']){
      const raised=deepClone(p);raised.stats[stroke+'_'+component]=163;
      const before=medleySectionTimes(p,event),after=medleySectionTimes(raised,event);
      rows.push({event,stroke,component,before,after,total:expectedTime(raised,event),preserved:JSON.stringify(p)===saved});
    }
    return rows;
  })()`);
  assert.equal(rows.length,16);
  for(const row of rows){
    assert.equal(row.preserved,true);
    assert.ok(Math.abs(row.total-row.after.reduce((sum,s)=>sum+s.time,0))<1e-8);
    for(let i=0;i<4;i++){
      assert.equal(row.after[i].distance,row.event==='im200'?50:100);
      if(row.before[i].stroke===row.stroke)assert.ok(row.after[i].time<row.before[i].time*.93,JSON.stringify(row));
      else assert.equal(row.after[i].time,row.before[i].time,JSON.stringify(row));
    }
  }
});

test('start improves only the opening butterfly while each turn ability improves its own IM leg',()=>{
  const run=game(),rows=run(`(()=>{
    const p={stats:Object.fromEntries(STATS.map(k=>[k,113]))};
    return ['im200','im400'].flatMap(event=>['start',...MEDLEY_STROKES.map(s=>s+'_turn')].map(key=>{
      const raised=deepClone(p);raised.stats[key]+=20;
      return {event,key,before:medleySectionTimes(p,event),after:medleySectionTimes(raised,event)};
    }));
  })()`);
  for(const row of rows)for(let i=0;i<4;i++){
    const affected=row.key==='start'?'fly':row.key.split('_')[0];
    if(row.before[i].stroke===affected)assert.ok(row.after[i].time<row.before[i].time,JSON.stringify(row));
    else assert.equal(row.after[i].time,row.before[i].time,JSON.stringify(row));
  }
});

test('the same displayed IM summary can represent different stroke times and overall times',()=>{
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
    assert.ok(Math.abs(row.aTime-row.bTime)>.2,JSON.stringify(row));
  }
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
