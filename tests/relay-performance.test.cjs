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
test('relay laps and records do not change individual PBs, standards or abilities',()=>{
 const run=game(),r=run(`(()=>{
  state.players=Array.from({length:4},(_,i)=>relayAthlete('record-'+i));state.players.forEach(a=>a.bestTimes.fr100=coherentCpuPB(a,'fr100'));
  const before=JSON.stringify(state.players.map(a=>[a.stats,a.bestTimes,a.standardAchievements]));
  const race=withMeetRaceContext('intercollege',44,2026,()=>simulateRelay(state.players,'4x100fr',true));recordRelayResult('4x100fr',{organization:state.playerUniversity,members:state.players,race,rank:1},'intercollege','決勝');
  return{unchanged:before===JSON.stringify(state.players.map(a=>[a.stats,a.bestTimes,a.standardAchievements])),histories:state.players.map(a=>playerRaceHistory(a).filter(h=>h.kind==='relay').map(h=>h.lapTime)),legs:race.legs};
 })()`);
 assert.ok(r.unchanged);r.histories.forEach((rows,i)=>assert.deepEqual(rows,[Math.round(r.legs[i]*100)/100]));
});
