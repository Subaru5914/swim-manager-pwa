const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function engine(){return vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+`
 let fixture;function reset(){if(!fixture){state=createState();migrateState();fixture=deepClone(state)}state=deepClone(fixture);for(const a of activeAthletes())attachMedleyStats(a)}
 return code=>JSON.parse(JSON.stringify(eval(code)))`,['globalThis'])({crypto:{getRandomValues:a=>{a[0]=12345;return a}}})}
const run=engine();

test('better measured PB rank and higher ability each increase talent demand, bounded to ten distinct CPU schools',()=>{
 const rows=run(`(()=>{state={season:2026,rngSeed:12345,cpuCompetitionSeed:12345,universities:Array.from({length:39},(_,i)=>({id:'U'+i}))};
  return [80,110,140,170].map(value=>[1,8,16,50,100,300].map(rank=>{
   const a=attachMedleyStats({id:'same-prospect',specialty:'fr100',stats:Object.fromEntries(STATS.map(k=>[k,value])),imAptitude:{speed:0,stamina:0},bestTimes:{fr100:50}}),fields=new Map(EVENTS.map(e=>[e,{byId:new Map(e==='fr100'?[[a.id,rank]]:[])}]));
   return{value,rank,quality:scoutingTalentQuality(a,fields),count:scoutingTargetCount(a,fields)};
  }));
 })()`);
 for(const row of rows)for(let i=1;i<row.length;i++){assert.ok(row[i].quality<row[i-1].quality);assert.ok(row[i].count<=row[i-1].count)}
 for(let j=0;j<6;j++)for(let i=1;i<rows.length;i++){assert.ok(rows[i][j].quality>rows[i-1][j].quality);assert.ok(rows[i][j].count>=rows[i-1][j].count)}
 assert.ok(rows[3][0].count>=9&&rows[3][0].count<=10);assert.ok(rows[0][5].count<=1);
});

test('legacy negotiations gain potential rivals once without changing contacts, offers, existing interests, commitments, budgets or RNG',()=>{
 const r=run(`(()=>{reset();const c=state.scoutingCompetition,fields=highSchoolScoutRankings(),highs=state.world.filter(a=>a.category==='high'&&a.grade===3).sort((a,b)=>scoutingTalentQuality(b,fields)-scoutingTalentQuality(a,fields));
  const a=highs[0],record=scoutingRecord(a.id),confirmed=scoutingRecord(highs[1].id);record.cpuTargets=record.cpuTargets.slice(0,3);record.contacts={player:4,[record.cpuTargets[0]]:4};record.offers=[record.cpuTargets[0]];record.interests.player=44;
  confirmed.destination=confirmed.cpuTargets[0];confirmed.offers=[];c.processedMonths=[4];delete c.targetingVersion;
  const before=deepClone(record),done=JSON.stringify(confirmed),protectedData=JSON.stringify([state.rngSeed,c.randomState,c.schools,c.processedMonths,c.notices,activeAthletes().map(a=>[a.id,a.stats,a.bestTimes])]);
  initializeScoutingCompetition();const first=JSON.stringify(state);initializeScoutingCompetition();
  return{before,after:record,done:done===JSON.stringify(confirmed),stable:first===JSON.stringify(state),protected:protectedData===JSON.stringify([state.rngSeed,c.randomState,c.schools,c.processedMonths,c.notices,activeAthletes().map(a=>[a.id,a.stats,a.bestTimes])]),version:c.targetingVersion};
 })()`);
 assert.ok(r.done&&r.stable&&r.protected);assert.equal(r.version,2);assert.ok(r.after.cpuTargets.length>r.before.cpuTargets.length&&r.after.cpuTargets.length<=10);assert.equal(new Set(r.after.cpuTargets).size,r.after.cpuTargets.length);
 for(const k of ['contacts','offers','destination','decision'])assert.deepEqual(r.after[k],r.before[k]);for(const id of r.before.cpuTargets)assert.ok(r.after.cpuTargets.includes(id));for(const [id,interest]of Object.entries(r.before.interests))assert.equal(r.after.interests[id],interest);
});

test('finalized seasons preserve every negotiation and do not reopen recruitment during migration',()=>{
 const r=run(`(()=>{reset();const c=state.scoutingCompetition;c.finalized=true;delete c.targetingVersion;const before=JSON.stringify(c.candidates),seed=state.rngSeed,random=c.randomState;initializeScoutingCompetition();return{same:before===JSON.stringify(c.candidates),rng:seed===state.rngSeed&&random===c.randomState,version:c.targetingVersion}})()`);
 assert.ok(r.same&&r.rng);assert.equal(r.version,2);
});

test('monthly scouting expands rivals when a previously overlooked swimmer improves his measured PB and ability',()=>{
 const r=run(`(()=>{reset();const fields=highSchoolScoutRankings(),a=state.world.filter(a=>a.category==='high'&&a.grade===3).find(a=>scoutingRecord(a.id).cpuTargets.length<=1),record=scoutingRecord(a.id),before=record.cpuTargets.length;
  for(const k of STATS)a.stats[k]=170;a.bestTimes[a.specialty]=coherentCpuPB(a,a.specialty);state.slot=8;processScoutingMonth();return{before,after:record.cpuTargets.length,unique:new Set(record.cpuTargets).size,version:state.scoutingCompetition.targetingVersion};
 })()`);
 assert.ok(r.before<=1&&r.after>=8&&r.after<=10);assert.equal(r.after,r.unique);assert.equal(r.version,2);
});

test('actual monthly contacts and offers concentrate on elite prospects while preserving budgets, eight places and race profiles',()=>{
 const r=run(`(()=>{reset();const fields=highSchoolScoutRankings(),highs=state.world.filter(a=>a.category==='high'&&a.grade===3),ranks=new Map(highs.map(a=>[a.id,Math.min(...EVENTS.map(e=>fields.get(e).byId.get(a.id)??Infinity))]));
  const before=JSON.stringify([state.rngSeed,activeAthletes().map(a=>[a.id,a.stats,a.bestTimes])]),offered=new Map(),original=scoutingOffer;
  scoutingOffer=(id,school,withdraw,...rest)=>{const r=original(id,school,withdraw,...rest);if(r.ok&&school!=='player'&&!withdraw){if(!offered.has(id))offered.set(id,new Set());offered.get(id).add(school)}return r};
  for(let slot=8;slot<=96;slot+=8){state.slot=slot;processScoutingMonth()}
  scoutingOffer=original;
  const summary=rows=>({count:rows.length,contacts:rows.reduce((s,a)=>s+Object.keys(scoutingRecord(a.id).contacts).filter(id=>id!=='player').length,0)/rows.length,offers:rows.reduce((s,a)=>s+(offered.get(a.id)?.size||0),0)/rows.length,max:Math.max(...rows.map(a=>Object.keys(scoutingRecord(a.id).contacts).length))});
  return{top:summary(highs.filter(a=>ranks.get(a.id)<=8)),others:summary(highs.filter(a=>ranks.get(a.id)>50)),protected:before===JSON.stringify([state.rngSeed,activeAthletes().map(a=>[a.id,a.stats,a.bestTimes])]),budgets:Object.values(state.scoutingCompetition.schools).every(b=>b.remaining>=0&&b.remaining<=b.budget),places:scoutingSchools().every(u=>scoutingPlaces(u.id)<=8)};
 })()`);
 assert.ok(r.protected&&r.budgets&&r.places);assert.ok(r.top.count>5&&r.top.contacts>=3&&r.top.offers>=2&&r.top.max>=6,JSON.stringify(r));assert.ok(r.top.contacts>r.others.contacts*3&&r.top.offers>r.others.offers*3);console.log('Elite scout contacts:',JSON.stringify(r));
});
