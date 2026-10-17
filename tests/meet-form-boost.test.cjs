const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(){
  const context=vm.createContext({crypto:{getRandomValues:a=>{a[0]=12345;return a}}});
  vm.runInContext(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener')),context);
  vm.runInContext(`state={rngSeed:12345,cpuCompetitionSeed:7654321,season:2026,slot:1,points:10,players:[],world:[],meetHistory:[],playerUniversity:'自大学'};
    function member(id,mental=80){return{id,name:id,year:2,stats:Object.fromEntries(STATS.map(k=>[k,k==='mental'?mental:138])),bestTimes:{fr100:55},specialty:'fr100'}}`,context);
  return code=>JSON.parse(vm.runInContext('JSON.stringify('+code+')',context));
}
test('five points buy exactly one form level up to excellent, persists and does not alter abilities, PBs or race RNG',()=>{
  const run=game(),r=run(`(()=>{
    const a=Array.from({length:500},(_,i)=>member('poor-'+i)).find(a=>athleteMeetForm(a,'intercollege',41,2026).level===-2);state.players=[a];state.points=50;
    const player=JSON.stringify(a),seed=state.rngSeed,steps=[];
    for(let i=0;i<4;i++){const result=improveMeetForm(a.id,'intercollege',41,2026);steps.push({ok:result.ok,before:result.before.level,after:result.after.level,points:state.points})}
    const capped=improveMeetForm(a.id,'intercollege',41,2026),saved=JSON.stringify(state);
    state=JSON.parse(saved);normalizeMeetFormBoosts();
    return{steps,capped:capped.ok,points:state.points,level:athleteMeetForm(a,'intercollege',41,2026).level,count:meetFormBoostCount(a.id,'intercollege',41,2026),same:player===JSON.stringify(a)&&seed===state.rngSeed&&saved===JSON.stringify(state)};
  })()`);
  assert.deepEqual(r.steps,[-2,-1,0,1].map((before,i)=>({ok:true,before,after:before+1,points:45-i*5})));
  assert.equal(r.capped,false);assert.equal(r.points,30);assert.equal(r.level,2);assert.equal(r.count,4);assert.ok(r.same);
});
test('insufficient points, CPU swimmers, recruits, invalid meets and dates never spend points or save a boost',()=>{
  const run=game(),r=run(`(()=>{
    const a=member('own');state.players=[a];state.world=[member('cpu')];state.recruits=['cpu'];
    const invalid=[['cpu','intercollege',41,2026],['missing','intercollege',41,2026],['own','initial_pb',1,2026],['own','missing',1,2026],['own','intercollege',0,2026],['own','intercollege',97,2026],['own','intercollege',41.5,2026],['own','intercollege',41,NaN]];
    const before=JSON.stringify(state),rejected=invalid.map(args=>improveMeetForm(...args).ok),unchanged=before===JSON.stringify(state);
    state.points=4;const empty=JSON.stringify(state),noMoney=improveMeetForm(a.id,'intercollege',41,2026);
    return{rejected,unchanged,noMoney:noMoney.ok,emptySame:empty===JSON.stringify(state)};
  })()`);
  assert.ok(r.rejected.every(ok=>!ok));assert.ok(r.unchanged&&r.emptySame);assert.equal(r.noMoney,false);
});
test('boosts are scoped to the exact meet, date and season, including the two winter record meets',()=>{
  const run=game(),r=run(`(()=>{
    const a=Array.from({length:100},(_,i)=>member('winter-'+i)).find(a=>athleteMeetForm(a,'joint_record',82,2026).level<2);state.players=[a];
    const dates=[['joint_record',82,2026],['joint_record',90,2026],['joint_record',82,2027],['team_trial',82,2026]];
    const before=dates.map(args=>athleteMeetForm(a,...args).level);improveMeetForm(a.id,...dates[0]);
    return{before,after:dates.map(args=>athleteMeetForm(a,...args).level),counts:dates.map(args=>meetFormBoostCount(a.id,...args)),points:state.points};
  })()`);
  assert.deepEqual(r.after,[r.before[0]+1,...r.before.slice(1)]);assert.deepEqual(r.counts,[1,0,0,0]);assert.equal(r.points,5);
});
test('a started meet rejects changes while an earlier winter meet does not block the later cup',()=>{
  const run=game(),r=run(`(()=>{
    const a=Array.from({length:100},(_,i)=>member('start-'+i)).find(a=>athleteMeetForm(a,'joint_record',90,2026).level<2);state.players=[a];
    state.meetHistory=[{meet:'joint_record',slot:82,season:2026}];state.completedMeetKeys=['2026:joint_record'];
    const later=improveMeetForm(a.id,'joint_record',90,2026);state.meetHistory.push({meet:'joint_record',slot:90,season:2026});
    const before=JSON.stringify(state),started=improveMeetForm(a.id,'joint_record',90,2026),same=before===JSON.stringify(state);
    state.meetHistory=[];state.pendingMeetCompletion={meet:'team_trial',slot:1,season:2026};
    const pending=improveMeetForm(a.id,'team_trial',1,2026);return{later:later.ok,started:started.ok,pending:pending.ok,same,points:state.points};
  })()`);
  assert.ok(r.later&&r.same);assert.equal(r.started,false);assert.equal(r.pending,false);assert.equal(r.points,5);
});
test('world representatives allow owned graduates and relay-only members while excluding other Japanese swimmers and other years',()=>{
  const run=game(),r=run(`(()=>{
    const candidates=Array.from({length:200},(_,i)=>member('world-'+i)).filter(a=>athleteMeetForm(a,'world_championship',36,2027).level<2);
    const [graduate,relayOnly,cpu]=candidates;state.season=2027;state.players=[relayOnly];graduate.year=null;graduate.ownAtSelection=true;cpu.year=null;cpu.ownAtSelection=false;
    state.world=[graduate,cpu];state.japanTeam={year:calendarYear(2027,36),athletes:[graduate,relayOnly,cpu],individual:{fr100:[graduate.id,cpu.id]},relays:{'4x100fr':[relayOnly.id]}};
    const ownGrad=improveMeetForm(graduate.id,'world_championship',36,2027),relay=improveMeetForm(relayOnly.id,'world_championship',36,2027);
    const before=JSON.stringify(state),other=improveMeetForm(cpu.id,'world_championship',36,2027),year=improveMeetForm(graduate.id,'world_championship',36,2029);
    return{ownGrad:ownGrad.ok,relay:relay.ok,other:other.ok,year:year.ok,same:before===JSON.stringify(state),points:state.points};
  })()`);
  assert.ok(r.ownGrad&&r.relay&&r.same);assert.equal(r.other,false);assert.equal(r.year,false);assert.equal(r.points,0);
});
test('paid form is used in preliminary and final physics, every relay leg and changed final lineups',()=>{
  const run=game(),r=run(`(()=>{
    const a=Array.from({length:100},(_,i)=>member('pace-'+i)).find(a=>athleteMeetForm(a,'intercollege',41,2026).level===0),others=Array.from({length:4},(_,i)=>member('leg-'+i));state.players=[a,...others];
    gauss=()=>0;rng=()=>.99;
    const simulate=()=>withMeetRaceContext('intercollege',41,2026,()=>({
      prelim:simulateMeetRace(a,'fr200','intercollege',true,true),final:simulateRace(a,'fr200',true,true),
      relays:RELAYS.map(kind=>simulateRelay([a,...others.slice(0,3)],kind,true))}));
    const before=simulate();improveMeetForm(a.id,'intercollege',41,2026);const after=simulate();
    state.meetHistory=[{meet:'intercollege',slot:41,season:2026}];
    const team={organization:state.playerUniversity,members:others,prelimTime:240,race:simulateRelay(others,'4x100fr',true)};
    const result={meet:'intercollege',season:2026,slot:41,events:{},relays:[['4x100fr',[team],{finalEntryPending:true}]]};
    upsertRelayTop10=()=>{};recordRelayResult=()=>{};refreshRecordBook=()=>{};teamScoring=()=>({});
    const changed=setRelayFinalEntry(result,'4x100fr',[a.id,...others.slice(0,3).map(a=>a.id)]);
    return{base:expectedTime(a,'fr200'),individual:['prelim','final'].map(stage=>({stage,before:before[stage].total,after:after[stage].total,targetBefore:before[stage].physics.targetTime,targetAfter:after[stage].physics.targetTime,level:after[stage].physics.meetFormLevel,finish:after[stage].trajectory.at(-1).t})),
      relays:before.relays.map((race,i)=>({before:race.total,after:after.relays[i].total,otherBefore:race.legs.slice(1),otherAfter:after.relays[i].legs.slice(1),last:after.relays[i].cumulativeLegs.at(-1)})),
      changed:changed.race.total,expected:after.relays[0].total,qualifier:changed.prelimTime,points:state.points};
  })()`);
  for(const row of r.individual){assert.ok(row.after<row.before);assert.equal(row.level,1);assert.ok(Math.abs((row.targetBefore-row.targetAfter)-.795)<1e-8);assert.ok(Math.abs(row.finish-row.after)<1e-8)}
  for(const row of r.relays){assert.ok(row.after<row.before);assert.deepEqual(row.otherAfter,row.otherBefore);assert.equal(row.last,row.after)}
  assert.equal(r.changed,r.expected);assert.equal(r.qualifier,240);assert.equal(r.points,5);
});
test('normalization accepts legacy missing data and keeps only valid boosts from the current or future seasons',()=>{
  const run=game(),r=run(`(()=>{
    normalizeMeetFormBoosts();const legacy=deepClone(state.meetFormBoosts);state.season=2027;
    state.meetFormBoosts={'2026:41:intercollege':{a:1},'2027:41:intercollege':{a:2,b:4,c:0,d:5,e:1.5,f:'1'},'2029:36:world_championship':{g:1},'2027:0:team_trial':{a:1},'2027:97:team_trial':{a:1},'2027:1:initial_pb':{a:1},'2027:1:missing':{a:1},'2027:1:joint_record':['a']};
    const seed=state.rngSeed;normalizeMeetFormBoosts();return{legacy,boosts:state.meetFormBoosts,points:state.points,unchanged:seed===state.rngSeed};
  })()`);
  assert.deepEqual(r.legacy,{});assert.deepEqual(r.boosts,{'2027:41:intercollege':{a:2,b:4},'2029:36:world_championship':{g:1}});assert.equal(r.points,10);assert.ok(r.unchanged);
});
test('at the same actual meet form and race RNG, different mental values produce identical individual and relay clocks',()=>{
  const run=game(),groups=run(`[138,173].map(value=>[0,100,200].map(mental=>{
    const p=member('mental-clock',mental);for(const k of STATS)if(k!=='mental')p.stats[k]=value;
    state.players=[p];state.points=40;state.meetFormBoosts={};
    const natural=athleteMeetForm(p,'intercollege',41,2026).level;
    for(let i=natural;i<2;i++)improveMeetForm(p.id,'intercollege',41,2026);
    for(const e of EVENTS)p.bestTimes[e]=expectedTime(p,e)+30;
    return withMeetRaceContext('intercollege',41,2026,()=>{
      const events=['fr50','fr100','fr200','fr400','im200','im400'].map(event=>{
        state.rngSeed=7654321;const prelim=simulateMeetRace(p,event,'intercollege',true,true);
        state.rngSeed=9876543;const final=simulateRace(p,event,true,true);
        return{event,prelim:prelim.total,prelimTarget:prelim.physics.targetTime,prelimFinish:prelim.trajectory.at(-1).t,final:final.total,finalTarget:final.physics.targetTime,finalFinish:final.trajectory.at(-1).t};
      });
      const relays=RELAYS.map(kind=>{state.rngSeed=13579;const race=simulateRelay(Array.from({length:4},()=>p),kind,true,true);return{kind,total:race.total,legs:race.legs,last:race.cumulativeLegs.at(-1)}});
      return{value,mental,natural,level:athleteMeetForm(p,'intercollege',41,2026).level,events,relays};
    });
  }))`);
  for(const rows of groups){
    for(const row of rows){assert.equal(row.level,2);assert.deepEqual(row.events,rows[0].events);assert.deepEqual(row.relays,rows[0].relays)}
    assert.ok(rows[0].natural<=rows[2].natural);
  }
});
