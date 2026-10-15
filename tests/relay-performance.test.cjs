const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const load=vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+`
 function relayAthlete(id){return attachMedleyStats({id,name:id,year:2,category:'university',age:20,grade:2,organization:'検証大学',stats:Object.fromEntries(STATS.map(k=>[k,138])),imAptitude:{speed:0,stamina:0},bestTimes:{},raceHistory:[],accolades:[]})}
 return code=>JSON.parse(JSON.stringify(eval(code)))`,[]);
function game(){const run=load();run(`(state={season:2026,slot:44,rngSeed:5914,players:[],world:[],playerUniversity:'自大学',recordRankings:{},teamTop10:{},retiredArchive:[]},true)`);return run}
test('relay ranges retain each form\'s fastest limit and execution draws while favoring faster, form-dependent laps',()=>{
 const run=game(),rows=run(`(()=>{
  const p=relayAthlete('correction');let form=0;athleteMeetForm=()=>MEET_FORMS[form+2];
  return withMeetRaceContext('intercollege',44,2026,()=>[-2,-1,0,1,2].flatMap(level=>{form=level;return[100,200].map(d=>{
   const event='fr'+d;state.rngSeed=5914;const individual=Array.from({length:1000},()=>raceTimeCorrections(p,event));state.rngSeed=5914;const relay=Array.from({length:1000},()=>raceTimeCorrections(p,event,true));
   return{level,d,old:MEET_FORM_TIME_RANGES[d][level+2],now:RELAY_FORM_TIME_RANGES[d][level+2],sameBase:relay.every((r,i)=>r.base===individual[i].base),sameExecution:relay.every((r,i)=>r.raceCorrection===individual[i].raceCorrection),faster:relay.every((r,i)=>r.formCorrection<=individual[i].formCorrection),strict:relay.filter((r,i)=>r.formCorrection<individual[i].formCorrection).length};
  })}));
 })()`);
 for(const r of rows){assert.equal(r.now[0],r.old[0]);assert.ok(r.now[1]<r.old[1]);assert.ok(r.sameBase&&r.sameExecution&&r.faster);assert.equal(r.strict,1000)}
});
test('ordinary relay legs more often beat and approach reachable PBs, including the first swimmer',()=>{
 const run=game(),rows=run(`(()=>{
  const p=relayAthlete('pb-frequency'),rows=[];athleteMeetForm=()=>MEET_FORMS[2];
  withMeetRaceContext('intercollege',44,2026,()=>{for(const d of [100,200])for(const flying of [false,true]){
   const event='fr'+d,base=expectedTime(p,event),pb=base-(d===100?.2:.3),takeover=flying?reactionTime(p,event)-reactionTime(p,event,true):0,profiles=[];
   p.bestTimes[event]=round2(pb);
   for(const relay of [false,true]){state.rngSeed=5914;let beaten=0,near=0,sum=0;const count=20000;for(let i=0;i<count;i++){const c=raceTimeCorrections(p,event,relay),time=c.base+c.formCorrection+c.raceCorrection-takeover;beaten+=time<pb;near+=time<=pb+(d===100?.5:1);sum+=time-pb}profiles.push({beaten:beaten/count,near:near/count,gap:sum/count})}
   rows.push({d,flying,old:profiles[0],now:profiles[1]});
  }});return rows;
 })()`);
 for(const r of rows){assert.ok(r.now.beaten>r.old.beaten+.1,JSON.stringify(r));assert.ok(r.now.near>r.old.near+.1,JSON.stringify(r));assert.ok(r.now.gap<r.old.gap-.3,JSON.stringify(r));assert.ok(r.now.beaten<1&&r.now.beaten>0)}
});
test('all relay kinds use the dedicated ranges for every leg, retain takeover gains and share the same own/CPU clock',()=>{
 const run=game(),r=run(`(()=>{
  const members=Array.from({length:4},(_,i)=>relayAthlete('leg-'+i));state.players=members;const before=JSON.stringify(members);rng=()=>.5;gauss=()=>0;
  samplePreliminaryDelay=()=>{throw Error('Relay must not draw preliminary delay')};
  return{rows:RELAYS.map(kind=>{
   const evs=relayLegEvents(kind),expected=members.map((a,i)=>simulateRace(a,evs[i],true,true,i>0,false,true)),own=simulateRelay(members,kind,true,true),cpu=simulateCpuRelay(members,kind,'intercollege',true),bounds=cpuRelayTimeBounds(members,kind);
   return{kind,expected:expected.map(r=>r.total),legs:own.legs,cpu:cpu.legs,total:own.total,last:own.cumulativeLegs.at(-1),sum:round2(own.legs.reduce((s,t)=>s+t,0)),finish:own.trajectory.at(-1),distance:own.distance,bounds,
    physics:expected.map((r,i)=>({base:r.physics.abilityBase,expected:expectedTime(members[i],evs[i]),form:r.physics.formCorrection,relay:r.physics.relayLeg,target:r.physics.targetTime,gain:i?reactionTime(members[i],evs[i])-reactionTime(members[i],evs[i],true):0}))};
  }),untouched:before===JSON.stringify(members)};
 })()`);
 assert.ok(r.untouched);for(const row of r.rows){assert.deepEqual(row.legs,row.expected);assert.deepEqual(row.cpu,row.legs);assert.equal(row.total,row.last);assert.equal(row.total,row.sum);assert.ok(Math.abs(row.finish.t-row.total)<1e-8);assert.equal(row.finish.distance,row.distance);assert.ok(row.total>=row.bounds.low&&row.total<=row.bounds.high);for(const p of row.physics){assert.ok(p.relay);assert.equal(p.base,p.expected);assert.equal(p.form,0);assert.ok(Math.abs(p.target-(p.base-p.gain))<1e-8)}}
});
test('official first legs update individual PBs and applicable records for own, CPU and international swimmers only',()=>{
 for(const category of ['own','middle','high','university','adult','international'])for(const kind of ['4x100fr','4x200fr','4x100medley']){
  const run=game(),r=run(`(()=>{
   const category=${JSON.stringify(category)},kind=${JSON.stringify(kind)},events=relayLegEvents(kind),legs=kind==='4x200fr'?[110,109,108,107]:kind==='4x100medley'?[55,60,52,49]:[50,49,48,47];
   const members=Array.from({length:4},(_,i)=>{const a=relayAthlete(category+i);a.category=category==='own'?'university':category;a.organization=category==='own'?state.playerUniversity:'検証チーム';a.bestTimes[events[i]]=legs[i]+.5;ensureStandardAchievements(a);return a});
   if(category==='own')state.players=members;else if(category==='international')state.internationalWorld={athletes:members};else state.world=members;
   const stats=JSON.stringify(members.map(a=>a.stats)),team={members,organization:members[0].organization,rank:1,race:{total:round2(legs.reduce((s,t)=>s+t,0)),legs}};
   recordRelayResult(kind,team,'intercollege','決勝');
   const before=JSON.stringify(state);recordRelayResult(kind,team,'intercollege','決勝');
   return{event:events[0],time:legs[0],pb:members[0].bestTimes[events[0]],stats:stats===JSON.stringify(members.map(a=>a.stats)),otherPBs:members.slice(1).map((a,i)=>a.bestTimes[events[i+1]]),expected:legs.slice(1).map(t=>t+.5),
    stable:before===JSON.stringify(state),standards:members[0].standardAchievements[events[0]],expectedStandards:standardsCleared(events[0],legs[0]),
    japan:state.recordRankings.japan?.[events[0]]||[],school:state.recordRankings[category==='own'?'university':category]?.[events[0]]||[],own:state.teamTop10[events[0]]||[],
    falsePodiums:members.flatMap(a=>playerMainResults(a)).filter(h=>!RELAYS.includes(h.event))};
  })()`);
  assert.equal(r.pb,r.time);assert.ok(r.stats&&r.stable);assert.deepEqual(r.otherPBs,r.expected);assert.ok(r.expectedStandards.every(s=>r.standards.includes(s)));assert.deepEqual(r.falsePodiums,[]);
  if(category==='international')assert.deepEqual(r.japan,[]);else {assert.equal(r.japan[0].time,r.time);assert.match(r.japan[0].stage,/リレー第1泳者/);if(['own','high','university'].includes(category))assert.equal(r.school[0].time,r.time)}
  assert.equal(r.own.length,category==='own'?1:0);
 }
});
test('slower, tied, missing or invalid first-leg clocks never erase a PB or register a flying leg',()=>{
 const run=game(),r=run(`(()=>{
  state.players=Array.from({length:4},(_,i)=>relayAthlete('guard-'+i));const members=state.players;members.forEach(a=>a.bestTimes.fr100=50);
  for(const time of [51,50,49.999,null,undefined,0,-1,.001,NaN,Infinity,201])recordRelayResult('4x100fr',{members,organization:state.playerUniversity,rank:1,race:{total:200,legs:[time,48,48,48]}},'intercollege','決勝');
  const before=JSON.stringify(members.map(a=>a.bestTimes));simulateRelay(members,'4x100fr',true);
  return{pbs:members.map(a=>a.bestTimes.fr100),unchanged:before===JSON.stringify(members.map(a=>a.bestTimes))};
 })()`);
 assert.deepEqual(r.pbs,[50,50,50,50]);assert.ok(r.unchanged);
});
test('pending relay final first legs are registered only after confirming the final lineup',()=>{
 const run=game(),r=run(`(()=>{
  const members=Array.from({length:5},(_,i)=>relayAthlete('pending-'+i));state.players=members;state.universities=[];state.interIds=[];state.recordBook={};members.forEach(a=>a.bestTimes.fr100=80);
  rng=()=>.5;gauss=()=>0;
  const team={organization:state.playerUniversity,members:members.slice(0,4),rank:1,race:simulateRelay(members.slice(0,4),'4x100fr',true)},meta={finalEntryPending:true};
  const result={meet:'intercollege',slot:44,season:2026,events:Object.fromEntries(EVENTS.map(e=>[e,{final:[]}])),relays:[['4x100fr',[team],meta]]};
  const provisional=team.race.legs[0],before=members[0].bestTimes.fr100;
  setRelayFinalEntry(result,'4x100fr',members.slice(1).map(a=>a.id));
  return{before,oldFirst:members[0].bestTimes.fr100,pbs:members.slice(1).map(a=>a.bestTimes.fr100),lap:round2(team.race.legs[0]),pending:meta.finalEntryPending};
 })()`);
 assert.equal(r.before,80);assert.equal(r.oldFirst,80);assert.equal(r.pbs[0],r.lap);assert.deepEqual(r.pbs.slice(1),[80,80,80]);assert.equal(r.pending,false);
});
