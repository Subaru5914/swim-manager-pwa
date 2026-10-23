const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),cp=require('node:child_process');
const {test}=require('node:test');
const repo=path.join(__dirname,'..'),html=fs.readFileSync(path.join(repo,'index.html'),'utf8');
function engine(input=html,seed=12345){
 const code=input.match(/<script>([\s\S]*?)<\/script>/)[1];
 return vm.compileFunction(code.slice(0,code.indexOf('document.getElementById("nav").addEventListener'))+'\nlet fixture;return code=>JSON.parse(JSON.stringify(eval(code)))',['globalThis'])({crypto:{getRandomValues:a=>{a[0]=seed;return a}}});
}
const run=engine();
function reset(){run('if(!fixture){state=createState();migrateState();fixture=deepClone(state)}state=deepClone(fixture);for(const a of activeAthletes())attachMedleyStats(a);true')}

test('fresh cohorts contain exactly 320 per grade, CPU competition is capped and board reads preserve both random streams',()=>{
 reset();const r=run(`(()=>{
  const before=JSON.stringify(state);for(const id of Object.keys(state.scoutingCompetition.candidates))scoutingCompetitionRows(id);initializeScoutingCompetition();
  return{counts:['middle','high'].flatMap(category=>[1,2,3].map(grade=>state.world.filter(a=>a.category===category&&a.grade===grade).length)),
   stable:before===JSON.stringify(state),mode:state.scoutingAdmissionsMode,size:Object.keys(state.scoutingCompetition.candidates).length,
   targets:Object.values(state.scoutingCompetition.candidates).every(r=>r.cpuTargets.length<=10&&new Set(r.cpuTargets).size===r.cpuTargets.length),
   budgets:Object.entries(state.scoutingCompetition.schools).every(([id,b])=>b.budget===scoutingBudget(state.universities.find(u=>u.id===id).reputation)&&b.remaining===b.budget)};
 })()`);
 assert.deepEqual(r.counts,[320,320,320,320,320,320]);assert.equal(r.size,320);assert.equal(r.mode,'competition');assert.ok(r.stable&&r.targets&&r.budgets);
});
test('contact costs five points only once a month, offers reserve eight places, withdrawal frees a place and reload never rerolls',()=>{
 reset();const r=run(`(()=>{
  const ids=Object.keys(state.scoutingCompetition.candidates).slice(0,9),raceSeed=state.rngSeed,abilities=JSON.stringify(activeAthletes().map(a=>[a.id,a.stats,a.bestTimes]));
  state.points=4;const before=JSON.stringify(state),blocked=scoutingContact(ids[0]);const noCharge=before===JSON.stringify(state);
  state.points=100;const first=scoutingContact(ids[0]),saved=JSON.stringify(state),duplicate=scoutingContact(ids[0]);const noRepeat=saved===JSON.stringify(state);
  state=JSON.parse(saved);const restored=JSON.stringify(state)===saved,offer=scoutingOffer(ids[0]);
  for(const id of ids.slice(1,8)){scoutingContact(id);scoutingOffer(id)}
  scoutingContact(ids[8]);const full=scoutingOffer(ids[8]),reserved=scoutingPlaces('player');
  const withdrawn=scoutingOffer(ids[0],'player',true),retry=scoutingOffer(ids[8]);state.slot=9;const next=scoutingContact(ids[0]);
  return{blocked,noCharge,first,duplicate,noRepeat,restored,offer,full,reserved,withdrawn,retry,next,points:state.points,
   protected:abilities===JSON.stringify(activeAthletes().map(a=>[a.id,a.stats,a.bestTimes])),raceSeed:raceSeed===state.rngSeed};
 })()`);
 assert.ok(!r.blocked.ok&&r.noCharge&&r.first.ok&&!r.duplicate.ok&&r.noRepeat&&r.restored&&r.offer.ok&&!r.full.ok&&r.withdrawn.ok&&r.retry.ok&&r.next.ok&&r.protected&&r.raceSeed);assert.equal(r.reserved,8);assert.equal(r.points,50);assert.ok(r.first.after>r.first.before);
});
test('uncontested offers can close immediately while competing offers wait for the early thresholds; confirmations are immutable',()=>{
 reset();const r=run(`(()=>{
  const ids=Object.keys(state.scoutingCompetition.candidates).slice(0,4),cpu=state.universities[0].id;
  for(const [i,id] of ids.entries()){
   const r=scoutingRecord(id);r.interests={player:i===0?50:i===1?78:i===2?69:79,[cpu]:i===1?65:i===2?40:70};r.contacts=i===0?{player:4}:{player:4,[cpu]:4};r.offers=[];
   if(i)scoutingOffer(id,cpu,false,{immediate:false});scoutingOffer(id);
  }
  const immediate=scoutingRecord(ids[0]).destination;processScoutingDecisions();
  const destinations=ids.map(id=>scoutingRecord(id).destination),before=JSON.stringify(scoutingRecord(ids[1]));
  const refused=scoutingContact(ids[1],cpu),again=scoutingOffer(ids[1],cpu);processScoutingDecisions();
  return{immediate,destinations,refused,again,stable:before===JSON.stringify(scoutingRecord(ids[1])),joined:ids.slice(0,2).every(id=>state.recruits.includes(id)&&state.world.find(a=>a.id===id).scouted)};
 })()`);
 assert.equal(r.immediate,'player');assert.deepEqual(r.destinations,['player','player',null,null]);assert.ok(!r.refused.ok&&!r.again.ok&&r.stable&&r.joined);
});
test('final decisions use saved weighted draws, enforce the minimum score and are idempotent',()=>{
 reset();const r=run(`(()=>{
  const ids=Object.keys(state.scoutingCompetition.candidates).slice(0,3),cpu=state.universities[0].id;
  for(const [i,id]of ids.entries()){const r=scoutingRecord(id);r.interests={player:i===2?75:39,[cpu]:68};r.contacts={player:3,[cpu]:3};r.offers=i===2?['player',cpu]:['player']}
  const saved=deepClone(state),raceSeed=state.rngSeed;processScoutingDecisions(true);const once=JSON.stringify(state);processScoutingDecisions(true);
  const stable=once===JSON.stringify(state),destination=scoutingRecord(ids[2]).destination,below=ids.slice(0,2).every(id=>!scoutingRecord(id).destination&&!scoutingRecord(id).offers.length);
  state=deepClone(saved);processScoutingDecisions(true);return{stable,below,replay:once===JSON.stringify(state),destination,raceSeed:raceSeed===state.rngSeed};
 })()`);
 assert.ok(r.stable&&r.below&&r.replay&&r.raceSeed);assert.ok(r.destination);
});
test('final decisions keep a ten-point lead near 60:40, share equal offers evenly and exclude ineligible schools',()=>{
 const run=engine(),r=run(`(()=>{
  const originalRoll=scoutingRoll;
  const trial=(interests,draw,offers=Object.keys(interests))=>{
   state={season:2026,rngSeed:5914,playerUniversity:'自大学',universities:['U1','U2','U3'].map(id=>({id,name:id})),recruits:[],world:[{id:'candidate',name:'検証選手'}],
    scoutingCompetition:{season:2026,notices:[],candidates:{candidate:{interests,offers:[...offers],contacts:Object.fromEntries(Object.keys(interests).map(id=>[id,3])),destination:null}}}};
   scoutingRoll=()=>draw;processScoutingDecisions(true);return scoutingRecord('candidate').destination;
  };
  try{
   const distributions=[{player:80,U1:70},{player:80,U1:60},{player:70,U1:70},{player:80,U1:70,U2:60}].map(interests=>{
    const counts=Object.fromEntries(Object.keys(interests).map(id=>[id,0]));
    // Evenly spaced draws measure the actual selection intervals without
    // statistical flakiness or duplicating the weighting formula in the test.
    for(let n=0;n<10000;n++)counts[trial(interests,(n+.5)/10000)]++;
    return counts;
   });
   const eligible=new Set();
   for(let n=0;n<1000;n++)eligible.add(trial({player:80,U1:70,U2:100,U3:39},(n+.5)/1000,['player','U1','U3']));
   return{distributions,eligible:[...eligible].sort()};
  }finally{scoutingRoll=originalRoll}
 })()`);
 const [close,wider,equal,three]=r.distributions;
 assert.ok(close.player>=5900&&close.player<=6100,JSON.stringify(close));assert.equal(close.player+close.U1,10000);
 assert.ok(wider.player>=6800&&wider.player<=7000,JSON.stringify(wider));assert.ok(wider.player>close.player);
 assert.deepEqual(equal,{player:5000,U1:5000});
 assert.ok(three.player>three.U1&&three.U1>three.U2&&three.U2>2000,JSON.stringify(three));
 assert.equal(Object.values(three).reduce((sum,n)=>sum+n,0),10000);
 assert.deepEqual(r.eligible,['U1','player']);
});
test('CPU monthly negotiations spend bounded budgets, never duplicate months or places, and survive save/reload',()=>{
 reset();const r=run(`(()=>{
  const raceSeed=state.rngSeed;for(let slot=8;slot<=96;slot+=8){state.slot=slot;processScoutingMonth()}
  const c=state.scoutingCompetition,before=JSON.stringify(state);processScoutingMonth(96);const duplicate=before===JSON.stringify(state);
  const counts=scoutingSchools().map(u=>scoutingPlaces(u.id)),signed=Object.values(c.candidates).filter(r=>r.destination).length;
  state=JSON.parse(before);initializeScoutingCompetition();processScoutingMonth(96);
  return{duplicate,reload:before===JSON.stringify(state),counts,signed,months:c.processedMonths.length,
   budgets:Object.values(c.schools).every(b=>b.remaining>=0&&b.remaining<=b.budget&&(b.budget-b.remaining)%5===0),
   spent:Object.values(c.schools).reduce((s,b)=>s+b.budget-b.remaining,0),raceSeed:raceSeed===state.rngSeed};
 })()`);
 assert.ok(r.duplicate&&r.reload&&r.budgets&&r.raceSeed&&r.counts.every(n=>n<=8));assert.equal(r.months,12);assert.ok(r.signed>30&&r.spent>0);
});
test('sixteen surplus seniors are completely removed from athletes, PB references, relays, history and negotiation data; signed places survive',()=>{
 reset();const r=run(`(()=>{
  const template=state.world.find(a=>a.category==='high'&&a.grade===3),added=[];
  for(let i=0;i<16;i++){const a=deepClone(template);a.id='surplus-'+i;a.name='余剰削除'+i;a.stats=Object.fromEntries(STATS.map(k=>[k,20+i]));a.bestTimes={fr100:100+i};a.scouted=false;state.world.push(a);added.push(a)}
  const protectedOne=added[0];protectedOne.scouted=true;state.recruits.push(protectedOne.id);
  const weakest=state.world.filter(a=>a.category==='high'&&a.grade===3&&!a.scouted).sort((a,b)=>recruitAbility(a)-recruitAbility(b)||a.id.localeCompare(b.id)).slice(0,16),ids=weakest.map(a=>a.id),names=weakest.map(a=>a.name);
  const deleted=weakest[0],other=template;
  state.recordRankings.high.fr100=[{athleteId:deleted.id,name:deleted.name,time:40,kind:'individual',event:'fr100',season:2026}];
  state.teamTop10['4x100free']=[{kind:'relay',event:'4x100free',time:180,members:[{id:deleted.id,name:deleted.name},{id:other.id,name:other.name}],memberKey:[deleted.id,other.id].join('|')}];
  state.recordBook.fr100={athleteId:deleted.id,name:deleted.name,time:40};state.testReferences={nested:[{athlete:deepClone(deleted),time:40}],byId:{[deleted.id]:{PB:40}}};
  state.scoutingCompetition.candidates[deleted.id]={interests:{player:30},contacts:{player:4},offers:[],cpuTargets:[],destination:null};
  state.scoutingCompetition.notices.push({id:deleted.id,name:deleted.name,schoolId:'player'});
  const preserved=JSON.stringify(state.world.filter(a=>!ids.includes(a.id)).map(a=>[a.id,a.stats,a.bestTimes])),raceSeed=state.rngSeed,removed=trimGraduatingCohort(),text=JSON.stringify(state);
  const stable=text===JSON.stringify((trimGraduatingCohort(),state));
  return{removed,count:state.world.filter(a=>a.category==='high'&&a.grade===3).length,
   absent:ids.concat(names).every(id=>!text.includes('"'+id+'"')),protected:state.world.some(a=>a.id===protectedOne.id)&&state.recruits.includes(protectedOne.id),
   preserved:preserved===JSON.stringify(state.world.map(a=>[a.id,a.stats,a.bestTimes])),raceSeed:raceSeed===state.rngSeed,stable};
 })()`);
 assert.equal(r.removed,16);assert.equal(r.count,320);assert.ok(r.absent&&r.protected&&r.preserved&&r.raceSeed&&r.stable,JSON.stringify(r));
});
test('full deletion uses athlete IDs and preserves an unrelated historical swimmer with the same name',()=>{
 reset();const r=run(`(()=>{
  const a=state.world.find(a=>a.category==='high'&&a.grade===3),name=a.name;
  state.duplicateNameHistory={athleteId:'different-historical-id',name,time:52.5};
  const expected=JSON.stringify(state.duplicateNameHistory);purgeAthleteData(new Set([a.id]));
  return{preserved:JSON.stringify(state.duplicateNameHistory)===expected,deleted:!state.world.some(p=>p.id===a.id)};
 })()`);assert.ok(r.preserved&&r.deleted);
});
test('v2.27 save migration protects existing own recruits, settings, abilities and race RNG and is stable on a second load',()=>{
 const old=engine(cp.execFileSync('git',['show','a571aae:index.html'],{cwd:repo,encoding:'utf8',maxBuffer:2000000}));
 const legacy=old(`(()=>{state=createState();migrateState();const a=state.world.filter(a=>a.category==='high'&&a.grade===3).sort((a,b)=>recruitAbility(a)-recruitAbility(b))[0];a.scouted=true;state.recruits=[a.id];return state})()`);
 const before=new Map(legacy.world.map(a=>[a.id,a]));
 run('state='+JSON.stringify(legacy)+';migrateState();true');const migrated=run('deepClone(state)'),once=JSON.stringify(migrated);run('state=JSON.parse('+JSON.stringify(once)+');migrateState();true');
 assert.equal(JSON.stringify(run('deepClone(state)')),once);assert.equal(migrated.scoutingAdmissionsMode,'free');assert.equal(migrated.rngSeed,legacy.rngSeed);
 assert.deepEqual(migrated.players,legacy.players);assert.deepEqual(migrated.recruits,legacy.recruits);assert.equal(migrated.scoutingCompetition.candidates[legacy.recruits[0]].destination,'player');
 assert.equal(migrated.world.filter(a=>a.category==='high'&&a.grade===3).length,320);
 for(const a of migrated.world){const b=before.get(a.id);assert.deepEqual(a.stats,b.stats,a.id);for(const [e,t]of Object.entries(a.bestTimes))assert.equal(t,b.bestTimes[e],a.id+' '+e)}
 for(const key of ['trainingFocus','trainingPlans','facilities','points','playerUniversity','universities'])assert.deepEqual(migrated[key],legacy[key],key);
});
test('confirmed CPU destinations become real affiliations and every university admits exactly eight over eight rollovers',()=>{
 reset();const rows=run(`(()=>{
  const rows=[];
  for(let year=0;year<8;year++){
   const oldIds=new Set(activeAthletes().map(a=>a.id));for(let slot=8;slot<=96;slot+=8){state.slot=slot;processScoutingMonth()}
   const committed=new Map(Object.entries(state.scoutingCompetition.candidates).filter(([,r])=>r.destination).map(([id,r])=>[id,r.destination]));
   const before=new Map(activeAthletes().map(a=>[a.id,JSON.stringify([a.stats,a.bestTimes])]));
   newSeason();const own=state.players.filter(a=>a.year===1),cpu=state.world.filter(a=>a.category==='university'&&a.grade===1),byId=new Map(own.concat(cpu).map(a=>[a.id,a]));
   rows.push({year,own:own.length,cpu:state.universities.map(u=>cpu.filter(a=>a.organization===u.name).length),
    commitments:[...committed].every(([id,u])=>byId.get(id)?.organization===(u==='player'?state.playerUniversity:state.universities.find(s=>s.id===u).name)),
    preserved:[...byId.values()].every(a=>before.get(a.id)===JSON.stringify([a.stats,a.bestTimes])),
    newCount:state.world.filter(a=>!oldIds.has(a.id)).length,newOnly:state.world.filter(a=>!oldIds.has(a.id)).every(a=>a.category==='middle'&&a.grade===1),unique:new Set(activeAthletes().map(a=>a.id)).size===activeAthletes().length});
  }
  return rows;
 })()`);
 for(const row of rows){assert.equal(row.own,8);assert.ok(row.cpu.every(n=>n===8));assert.equal(row.newCount,320);for(const k of ['commitments','preserved','newOnly','unique'])assert.equal(row[k],true,JSON.stringify(row))}
});
