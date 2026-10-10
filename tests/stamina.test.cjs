const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');

const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const initialization=source.indexOf('document.getElementById("nav").addEventListener');
assert.ok(initialization>0);
function game(){
  const context=vm.createContext({});vm.runInContext(source.slice(0,initialization),context);
  vm.runInContext('state={rngSeed:12345}',context);
  return code=>JSON.parse(vm.runInContext('JSON.stringify('+code+')',context));
}

test('endurance matters more than speed in 200m strokes and 400m races, with a larger effect at 400m',()=>{
  const run=game(),rows=run(`EVENTS.filter(e=>distanceOf(e)>=200).map(e=>{
    const p={stats:Object.fromEntries(STATS.map(k=>[k,113]))},base=expectedTime(p,e),speed=deepClone(p),stamina=deepClone(p);
    const strokes=strokeForEvent(e)==='im'?MEDLEY_STROKES:[strokeForEvent(e)];
    for(const s of strokes){speed.stats[s+'_speed']+=10;stamina.stats[s+'_stamina']+=10}
    return {e,speedGain:base-expectedTime(speed,e),staminaGain:base-expectedTime(stamina,e)};
  })`);
  for(const row of rows){
    assert.ok(row.speedGain>0&&row.staminaGain>0,JSON.stringify(row));
    const ratio=row.staminaGain/row.speedGain;
    if(row.e==='im200')assert.ok(ratio>.65&&ratio<.68,JSON.stringify(row));
    else if(row.e.endsWith('200'))assert.ok(ratio>1.15&&ratio<1.3,JSON.stringify(row));
    else assert.ok(ratio>1.7&&ratio<2.1,JSON.stringify(row));
  }
});

test('low endurance costs more time at 200m and 400m while balanced benchmarks and 200m IM stay intact',()=>{
  const run=game(),rows=run(`(()=>{
    const rows=[];
    for(const e of ['fr200','ba200','br200','fly200','fr400']){
      const p={stats:Object.fromEntries(STATS.map(k=>[k,163]))},weak=deepClone(p);
      weak.stats[strokeForEvent(e)+'_stamina']=88;
      rows.push({e,base:expectedTime(p,e),oldBase:expectedTime(p,e,true),weak:expectedTime(weak,e),oldWeak:expectedTime(weak,e,true)});
    }
    const p={stats:Object.fromEntries(STATS.map(k=>[k,163])),bestTimes:{}};
    const race=replayRaceToOfficialTime(p,'im200',expectedTime(p,'im200'));
    return {rows,im200:{total:race.total,splits:race.splits,mid:round2(stateAt(replayRaceToOfficialTime(p,'im200',135),67.5).distance)}};
  })()`);
  for(const row of rows.rows){
    assert.equal(row.base,row.oldBase,JSON.stringify(row));
    assert.ok(row.weak-row.base>(row.oldWeak-row.oldBase)*1.5,JSON.stringify(row));
  }
  assert.equal(rows.im200.total,115.89);
  assert.deepEqual(rows.im200.splits,[25.50,28.97,32.45,28.97]);
  assert.equal(rows.im200.mid,107.59);
});

test('all 200m strokes and 400m freestyle visibly fade with low endurance instead of merely starting more slowly',()=>{
  const run=game(),rows=run(`['fr200','ba200','br200','fly200','fr400'].map(e=>{
    const profiles=[60,88,138,163].map(stamina=>{
      const p={stats:Object.fromEntries(STATS.map(k=>[k,163])),bestTimes:{}};p.stats[strokeForEvent(e)+'_stamina']=stamina;
      const target=distanceOf(e)===400?270:135,race=replayRaceToOfficialTime(p,e,target);
      return {stamina,fade:round2(race.splits.at(-1)-race.splits[1]),mid:stateAt(race,target*.5).distance,
        late:stateAt(race,target*.9).distance,total:race.total,splits:race.splits};
    });
    return {e,profiles};
  })`);
  for(const row of rows){
    const [weak,, ,strong]=row.profiles;
    assert.ok(weak.fade>strong.fade+2,JSON.stringify(row));
    for(let i=1;i<row.profiles.length;i++)assert.ok(row.profiles[i].fade<row.profiles[i-1].fade,JSON.stringify(row));
    const midLead=weak.mid-strong.mid,lateLead=weak.late-strong.late;
    assert.ok(midLead>5&&lateLead<midLead*.7,JSON.stringify(row));
    for(const profile of row.profiles)assert.ok(Math.abs(profile.splits.reduce((a,b)=>a+b,0)-profile.total)<1e-8);
  }
  assert.ok(rows.at(-1).profiles[0].fade>rows[0].profiles[0].fade*1.5);
});

test('400m IM keeps four distinct stroke clocks and low endurance makes the back half of later legs fade',()=>{
  const run=game(),rows=run(`[60,163].map(stamina=>{
    const p={stats:Object.fromEntries(STATS.map(k=>[k,163])),bestTimes:{}};
    for(const stroke of MEDLEY_STROKES)p.stats[stroke+'_stamina']=stamina;
    const r=replayRaceToOfficialTime(p,'im400',270);
    return {total:r.total,sections:r.medleySections,splits:r.splits,fade:MEDLEY_STROKES.map((_,i)=>round2(r.splits[2*i+1]-r.splits[2*i]))};
  })`);
  for(let i=1;i<4;i++)assert.ok(rows[0].fade[i]>rows[1].fade[i]+.5,JSON.stringify(rows));
  assert.ok(rows[0].fade[3]>rows[0].fade[1],JSON.stringify(rows));
  for(const row of rows){
    assert.deepEqual(row.sections.map(s=>s.stroke),['fly','ba','br','fr']);
    assert.ok(Math.abs(row.sections.reduce((a,b)=>a+b.time,0)-row.total)<1e-8);
  }
});

test('player and CPU endurance races share official clocks and extreme endurance still finishes every lap monotonically',()=>{
  const run=game(),rows=run(`['fr200','ba200','br200','fly200','fr400','im400'].flatMap(e=>[0,60,163,200].map(stamina=>{
    const p={id:'endurance-player',stats:Object.fromEntries(STATS.map(k=>[k,163])),bestTimes:{}};
    for(const stroke of MEDLEY_STROKES)p.stats[stroke+'_stamina']=stamina;
    const cpu={...deepClone(p),category:'university'};
    state.rngSeed=56789;const a=simulateMeetRace(p,e,'intercollege',true);
    state.rngSeed=56789;const b=simulateMeetRace(cpu,e,'intercollege',false);
    const r=replayRaceToOfficialTime(p,e,b.total);
    return {e,stamina,total:a.total,cpu:b.total,replay:r.total,count:r.splits.length,last:r.cumulative.at(-1),
      sum:round2(r.splits.reduce((s,t)=>s+t,0)),finish:r.trajectory.at(-1),
      monotonic:r.trajectory.every((s,i,a)=>s.velocity>=0&&(!i||(s.t>=a[i-1].t&&s.distance>=a[i-1].distance)))};
  }))`);
  for(const row of rows){
    assert.equal(row.total,row.cpu,JSON.stringify(row));assert.equal(row.replay,row.total);
    assert.equal(row.last,row.total);assert.equal(row.sum,row.total);
    assert.equal(row.count,Number(row.e.match(/\d+/)[0])/50);
    assert.equal(row.finish.t,row.total);assert.equal(row.finish.distance,row.count*50);
    assert.equal(row.monotonic,true,JSON.stringify(row));
  }
});

test('each 4x200m freestyle relay swimmer gets endurance pacing and completes his own leg',()=>{
  const run=game(),row=run(`(()=>{
    const members=Array.from({length:4},(_,i)=>({id:'relay-endurance-'+i,name:'リレー'+i,stats:Object.fromEntries(STATS.map(k=>[k,163])),bestTimes:{}}));
    for(const p of members)p.stats.fr_stamina=60;
    const race=simulateRelay(members,'4x200fr',true);
    const legs=members.map((_,i)=>{
      const samples=race.trajectory.filter(s=>s.legIndex===i);
      const clock=distance=>{const n=samples.findIndex(s=>s.distance>=i*200+distance),b=samples[n],a=samples[Math.max(0,n-1)];return a.t+(b.t-a.t)*(i*200+distance-a.distance)/Math.max(.000001,b.distance-a.distance)};
      return {fade:(clock(200)-clock(150))-(clock(100)-clock(50)),finish:samples.at(-1).distance};
    });
    return {legs,total:race.total,sum:round2(race.legs.reduce((a,b)=>a+b,0)),last:race.cumulativeLegs.at(-1),finish:race.trajectory.at(-1).distance};
  })()`);
  for(let i=0;i<4;i++){assert.ok(row.legs[i].fade>2,JSON.stringify(row));assert.equal(row.legs[i].finish,(i+1)*200)}
  assert.equal(row.total,row.sum);assert.equal(row.last,row.total);assert.equal(row.finish,800);
});
