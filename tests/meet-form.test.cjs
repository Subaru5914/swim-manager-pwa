const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(){
  const context=vm.createContext({crypto:{getRandomValues:a=>{a[0]=12345;return a}}});
  vm.runInContext(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener')),context);
  vm.runInContext('state={rngSeed:12345,cpuCompetitionSeed:7654321,season:2026,slot:1,players:[],world:[],playerUniversity:"自大学"}',context);
  return code=>JSON.parse(vm.runInContext('JSON.stringify('+code+')',context));
}

test('meet form is stable across rerenders, all events and JSON saves without drawing race RNG or changing athletes',()=>{
  const run=game(),result=run(`(()=>{
    const athletes=Array.from({length:500},(_,i)=>({id:'form-'+i,stats:{mental:100}})),before=JSON.stringify(state),players=JSON.stringify(athletes);
    const original=athletes.map(a=>athleteMeetForm(a,'kansai_college',25,2026).level);
    for(const a of athletes)for(const event of EVENTS)meetFormHtml(a,'kansai_college',25,2026);
    const unchanged=JSON.stringify(state)===before&&JSON.stringify(athletes)===players;
    state=JSON.parse(JSON.stringify(state));state.rngSeed=987654;
    return{original,reloaded:athletes.map(a=>athleteMeetForm(a,'kansai_college',25,2026).level),
      nextYear:athletes.map(a=>athleteMeetForm(a,'kansai_college',25,2027).level),
      anotherMeet:athletes.map(a=>athleteMeetForm(a,'intercollege',41,2026).level),unchanged};
  })()`);
  assert.ok(result.unchanged);assert.deepEqual(result.original,result.reloaded);
  assert.equal(new Set(result.original).size,5);
  assert.ok(result.original.filter((level,i)=>level!==result.nextYear[i]).length>150);
  assert.ok(result.original.filter((level,i)=>level!==result.anotherMeet[i]).length>150);
});

test('higher mental increases good and excellent meet form while reducing poor form across a diverse roster',()=>{
  const run=game(),rows=run(`[0,100,150,200].map(mental=>{
    const levels=Array.from({length:10000},(_,i)=>athleteMeetForm({id:'mental-'+i,stats:{mental}},'japan_championship',96,2026).level);
    return{mental,poor:levels.filter(x=>x<0).length/levels.length,good:levels.filter(x=>x>0).length/levels.length,excellent:levels.filter(x=>x===2).length/levels.length};
  })`);
  for(let i=1;i<rows.length;i++){assert.ok(rows[i].poor<rows[i-1].poor,JSON.stringify(rows));assert.ok(rows[i].good>rows[i-1].good,JSON.stringify(rows));assert.ok(rows[i].excellent>rows[i-1].excellent,JSON.stringify(rows))}
  assert.ok(rows[3].poor<.04);assert.ok(rows[0].poor>.25);
  assert.ok(rows[3].good>.65&&rows[3].good<.8);assert.ok(rows[3].excellent>.25&&rows[3].excellent<.35);
});

test('visible form affects individual and CPU times, poor-race rates and every relay leg with a single official clock',()=>{
  const run=game(),result=run(`(()=>{
    const candidates=Array.from({length:500},(_,i)=>({id:'race-'+i,name:'泳者'+i,stats:Object.fromEntries(STATS.map(k=>[k,k==='mental'?80:138])),bestTimes:{}}));
    const roster=MEET_FORMS.map(form=>candidates.find(a=>athleteMeetForm(a,'intercollege',41,2026).level===form.level));
    const originalGauss=gauss,originalRng=rng;gauss=()=>0;rng=()=>.99;
    const rows=withMeetRaceContext('intercollege',41,2026,()=>roster.map(a=>{
      const normal=expectedTime(a,'fr100'),form=athleteMeetForm(a,'intercollege',41,2026),own=simulateRace(a,'fr100',true,true),cpu=simulateMeetRace(a,'fr100','intercollege',true),prelim=simulateMeetRace(a,'fr100','intercollege',false,true);
      return{level:form.level,time:own.total,target:own.physics.targetTime,expected:normal+expectedTime(a,'fr100')*form.timeFactor,cpu:cpu.total,
        tagged:own.physics.meetFormLevel,last:own.cumulative.at(-1),finish:own.trajectory.at(-1),prelim:prelim.total,prelimDelay:prelim.physics.preliminaryDelay};
    }));
    const members=roster.slice(0,4),relays=withMeetRaceContext('intercollege',41,2026,()=>RELAYS.map(kind=>{
      const evs=kind==='4x100fr'?['fr100','fr100','fr100','fr100']:kind==='4x200fr'?['fr200','fr200','fr200','fr200']:['ba100','br100','fly100','fr100'];
      const expected=members.map((a,i)=>simulateRace(a,evs[i],true,true,i>0).total),own=simulateRelay(members,kind,true),cpu=simulateCpuRelay(members,kind,'intercollege');
      return{expected,legs:own.legs,total:own.total,cpu:cpu.total,last:own.cumulativeLegs.at(-1),finish:own.trajectory.at(-1)};
    }));
    gauss=originalGauss;rng=originalRng;
    const rates=withMeetRaceContext('intercollege',41,2026,()=>roster.map(a=>{
      a.bestTimes.fr100=expectedTime(a,'fr100')+30;state.rngSeed=12345;let poor=0;
      for(let i=0;i<5000;i++)if(raceTarget(a,'fr100')>a.bestTimes.fr100)poor++;
      return{level:athleteMeetForm(a,'intercollege',41,2026).level,poor:poor/5000};
    }));
    return{rows,relays,rates,cleared:activeRaceMeetContext===null};
  })()`);
  for(const row of result.rows){
    assert.ok(Math.abs(row.target-row.expected)<1e-9,JSON.stringify(row));assert.equal(row.tagged,row.level);
    assert.equal(row.time,row.cpu);assert.equal(row.last,row.time);assert.ok(Math.abs(row.finish.t-row.time)<1e-8);
    assert.ok(row.prelim>=row.time+.18-.01&&row.prelim<=row.time+.45+.01);
  }
  for(let i=1;i<result.rows.length;i++){assert.ok(result.rows[i].time<result.rows[i-1].time);assert.ok(result.rates[i].poor<result.rates[i-1].poor)}
  for(const row of result.relays){assert.deepEqual(row.legs,row.expected);assert.equal(row.total,row.cpu);assert.equal(row.last,row.total);assert.ok(Math.abs(row.finish.t-row.total)<1e-8)}
  assert.ok(result.cleared);
});

test('domestic and world execution scope form to the right date and restore context after failures',()=>{
  const run=game(),result=run(`(()=>{
    state.activeCompetitionSlot=36;state.activeCompetitionSeason=2027;
    executeMeetWithForm=()=>deepClone(activeRaceMeetContext);executeWorldMeetWithForm=()=>deepClone(activeRaceMeetContext);
    const domestic=executeMeet('japan_open',{},{}),world=executeWorldMeet();
    executeMeetWithForm=()=>{throw new Error('expected')};let threw=false;
    try{executeMeet('intercollege',{},{});}catch(e){threw=e.message==='expected'}
    const nested=withMeetRaceContext('outer',1,2026,()=>{
      const inner=executeWorldMeet(),outer=deepClone(activeRaceMeetContext);return{inner,outer};
    });
    return{domestic,world,nested,threw,cleared:activeRaceMeetContext===null};
  })()`);
  assert.deepEqual(result.domestic,{meet:'japan_open',slot:36,season:2027});assert.deepEqual(result.world,{meet:'world_championship',slot:36,season:2027});
  assert.deepEqual(result.nested.inner,result.world);assert.deepEqual(result.nested.outer,{meet:'outer',slot:1,season:2026});assert.ok(result.threw&&result.cleared);
});

test('a changed relay final lineup retains meet form, laps and the qualifying time',()=>{
  const run=game(),result=run(`(()=>{
    rng=()=>.99;gauss=()=>0;
    const members=Array.from({length:5},(_,i)=>({id:'final-'+i,name:'泳者'+i,year:2,stats:Object.fromEntries(STATS.map(k=>[k,100])),bestTimes:{}}));state.players=members;
    const team={organization:state.playerUniversity,members:members.slice(0,4),prelimTime:240,race:simulateRelay(members.slice(0,4),'4x100fr',true)};
    const result={meet:'intercollege',season:2027,slot:41,events:{},relays:[['4x100fr',[team],{finalEntryPending:true}]]};
    upsertRelayTop10=()=>{};recordRelayResult=()=>{};refreshRecordBook=()=>{};teamScoring=()=>({});
    const expected=withMeetRaceContext('intercollege',41,2027,()=>simulateRelay(members.slice(1),'4x100fr',true));
    const changed=setRelayFinalEntry(result,'4x100fr',members.slice(1).map(a=>a.id));
    return{total:changed.race.total,legs:changed.race.legs,expected:expected.total,expectedLegs:expected.legs,qualifier:changed.prelimTime,ids:result.relayFinalEntries['4x100fr'],pending:result.relays[0][2].finalEntryPending,cleared:activeRaceMeetContext===null};
  })()`);
  assert.equal(result.total,result.expected);assert.deepEqual(result.legs,result.expectedLegs);assert.equal(result.qualifier,240);
  assert.deepEqual(result.ids,['final-1','final-2','final-3','final-4']);assert.equal(result.pending,false);assert.ok(result.cleared);
});
