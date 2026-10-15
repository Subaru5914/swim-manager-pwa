const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),cp=require('node:child_process');
const {test}=require('node:test');
const repo=path.join(__dirname,'..'),current=fs.readFileSync(path.join(repo,'index.html'),'utf8');
function game(input=current,seed=5914){
 const source=input.match(/<script>([\s\S]*?)<\/script>/)[1];
 return vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+`
 function trainingAthlete(id,value=125,category='high',grade=1){return attachMedleyStats({id,name:id,category,grade,age:category==='adult'?23:category==='university'?18+grade:15+grade,organization:'検証大学',retired:false,specialty:'fr100',stats:Object.fromEntries(STATS.map(k=>[k,value])),imAptitude:{speed:0,stamina:0},bestTimes:{},accolades:[],raceHistory:[],growthProfile:[1,1,1,1,1],cpuStatCeilings:Object.fromEntries(STATS.map(k=>[k,180]))})}
 return code=>JSON.parse(JSON.stringify(eval(code)))`,['globalThis'])({crypto:{getRandomValues:a=>{a[0]=seed;return a}}});
}
function minimal(){const run=game();run(`state={season:2026,slot:1,rngSeed:5914,cpuCompetitionSeed:5914,cpuDevelopmentVersion:1,playerUniversity:'自大学',players:[],world:[],recruits:[],recordRankings:{},recordBook:{},teamTop10:{},retiredArchive:[],japanTeamHistory:[],universities:[{name:'検証大学',region:'kansai',reputation:150}],facilities:{}};true`);return run}
test('current v2.03 migration and reset preserve every existing ability, IM aptitude, PB and the next random draw',()=>{
 const oldHtml=cp.execFileSync('git',['show','88e8311:index.html'],{cwd:repo,encoding:'utf8',maxBuffer:2000000}),old=game(oldHtml);
 const before=old('(state=createState(),migrateState(),deepClone(state))'),run=game();run(`state=${JSON.stringify(before)};migrateState();true`);
 const migrated=run(`(()=>{const first=JSON.stringify(state),seed=state.rngSeed;migrateState();return{state:deepClone(state),stable:first===JSON.stringify(state)&&seed===state.rngSeed}})()`);
 assert.ok(migrated.stable);assert.equal(migrated.state.version,'pwa-v2.13');
 for(const k of ['season','slot','points','reputation','playerUniversity','rngSeed','trainingFocus','facilities','recruits'])assert.deepEqual(migrated.state[k],before[k],k);
 const reset=game();const generated=reset('(state=createState(),migrateState(),deepClone(state))');
 for(const after of [migrated.state,generated])for(const group of ['world','players']){
  assert.equal(after[group].length,before[group].length);
  after[group].forEach((a,i)=>{const b=before[group][i];assert.equal(a.id,b.id);for(const k of ['stats','imAptitude','bestTimes','specialty'])assert.deepEqual(a[k],b[k],a.id+' '+k)});
 }
 assert.equal(generated.rngSeed,before.rngSeed);
});
test('daily practice accumulates fractional gains, slows at high abilities and gives stronger universities better efficiency',()=>{
 const run=minimal(),r=run(`(()=>{
  const swimmers=[80,125,155,175].map(v=>trainingAthlete('level-'+v,v));
  const strong=trainingAthlete('strong',125,'university'),weak=trainingAthlete('weak',125,'university');strong.organization='名門大学';weak.organization='発展途上大学';
  state.universities=[{name:strong.organization,region:'national',reputation:350},{name:weak.organization,region:'national',reputation:20}];
  const all=[...swimmers,strong,weak];state.world=all;
  for(const a of all){ensureCpuDevelopment(a);a.cpuDevelopment.goals=STATS.map(k=>a.stats[k]+15);a.cpuDevelopment.floors=EVENTS.map(()=>1)}
  const before=all.map(a=>a.stats.fr_speed),pb=JSON.stringify(all.map(a=>a.bestTimes)),random=rng;rng=()=>.5;
  for(let i=0;i<32;i++)all.forEach(applyCpuTraining);rng=random;
  return{gains:all.map((a,i)=>round2(a.stats.fr_speed-before[i])),pb:pb===JSON.stringify(all.map(a=>a.bestTimes)),apt:all.every(a=>a.imAptitude.speed===0&&a.imAptitude.stamina===0)};
 })()`);
 assert.ok(r.pb&&r.apt);for(let i=0;i<3;i++)assert.ok(r.gains[i]>r.gains[i+1],JSON.stringify(r));assert.ok(r.gains[3]>0,'A/S-edge gains must not disappear through rounding');assert.ok(r.gains[4]>r.gains[5],JSON.stringify(r));
});
test('school and career changes initialize practice goals without changing abilities, aptitude or lifetime PBs',()=>{
 const run=minimal(),rows=run(`[['middle','high'],['high','university'],['university','adult']].map(([from,to],i)=>{
  const a=trainingAthlete('transition-'+i,140,from,from==='university'?4:3);a.cpuCompetitionCategory=from;ensureCpuDevelopment(a);for(const e of generatedPBEvents(a))a.bestTimes[e]=coherentCpuPB(a,e);
  const before=JSON.stringify([a.stats,a.imAptitude,a.bestTimes]),seed=state.rngSeed;a.category=to;a.grade=to==='adult'?null:1;a.age=to==='adult'?23:to==='university'?19:16;state.world=[a];maintainWorldPopulation();
  const first=JSON.stringify(a);maintainWorldPopulation();return{from,to,preserved:before===JSON.stringify([a.stats,a.imAptitude,a.bestTimes]),seed:seed===state.rngSeed,stable:first===JSON.stringify(a),category:a.cpuDevelopment.category};
 })`);
 for(const r of rows){assert.ok(r.preserved&&r.seed&&r.stable,JSON.stringify(r));assert.equal(r.category,r.to)}
});
test('monthly CPU measurements use the unchanged shared race clock, update real PBs and records once, and leave own athletes and the RNG sequence alone',()=>{
 const run=minimal(),r=run(`(()=>{
  const a=trainingAthlete('practice',140,'university');state.world=[a];const p=trainingAthlete('own',140,'university');p.year=2;state.players=[p];
  const before=JSON.stringify([a.stats,a.imAptitude,p]),seed=state.rngSeed;state.slot=8;
  const key=state.season+':'+state.slot;state.rngSeed=profileHash(state.cpuCompetitionSeed+':'+key+':cpu-training-swims');
  const expected=withMeetRaceContext('cpu_training',8,2026,()=>Object.fromEntries(generatedPBEvents(a).map(e=>[e,round2(raceTarget(a,e))])));state.rngSeed=seed;
  measureCpuTrainingPBs();const first=JSON.stringify(state);measureCpuTrainingPBs();
  return{expected,actual:a.bestTimes,protected:before===JSON.stringify([a.stats,a.imAptitude,p]),rng:seed===state.rngSeed,stable:first===JSON.stringify(state),record:state.recordRankings.university.fr100[0],medals:playerMainResults(p)};
 })()`);
 assert.deepEqual(r.actual,r.expected);assert.ok(r.protected&&r.rng&&r.stable);assert.equal(r.record.time,r.actual.fr100);assert.equal(r.record.schoolCategory,'university');assert.equal(r.record.gradeAtRecord,1);assert.deepEqual(r.medals,[]);
});
test('advancing the grade renews training room without changing an ability or measured PB on the spot',()=>{
 const run=minimal(),r=run(`(()=>{
  const a=trainingAthlete('progression',125,'high',1);for(const s of ['ba','br','fly'])for(const k of ['speed','stamina','turn'])a.stats[s+'_'+k]=90;state.world=[a];a.bestTimes.fr100=coherentCpuPB(a,'fr100');ensureCpuDevelopment(a);const random=rng;rng=()=>.5;
  for(let i=0;i<96;i++)applyCpuTraining(a);const first=JSON.stringify([a.stats,a.bestTimes]),start=a.stats.fr_speed;a.grade=2;a.age++;maintainWorldPopulation();const unchanged=first===JSON.stringify([a.stats,a.bestTimes]);
  for(let i=0;i<96;i++)applyCpuTraining(a);rng=random;
  return{unchanged,secondYearGain:a.stats.fr_speed-start,stage:a.cpuDevelopment.stage,clocks:EVENTS.map((e,i)=>({event:e,time:expectedTime(a,e),floor:a.cpuDevelopment.floors[i]}))};
 })()`);
 assert.ok(r.unchanged);assert.ok(r.secondYearGain>0,JSON.stringify(r));assert.equal(r.stage,2);
});
test('age-related decline never requires an ability boost on reload to restore a still-reachable lifetime PB',()=>{
 const run=minimal(),r=run(`(()=>{
  const a=trainingAthlete('adult-decline',140,'adult');a.age=29;state.world=[a];
  a.bestTimes.fr100=round2(expectedTime(a,'fr100')-.6-.8);ensureCpuDevelopment(a);const before=a.stats.fr_speed;
  for(let i=0;i<96;i++)applyCpuTraining(a);const stats=JSON.stringify(a.stats),repaired=restoreAthletePaceFromPB(a);
  return{repaired,unchanged:stats===JSON.stringify(a.stats),notIncreased:a.stats.fr_speed<=before,base:expectedTime(a,'fr100'),pb:a.bestTimes.fr100};
 })()`);
 assert.ok(r.unchanged&&r.notIncreased);assert.equal(r.repaired,false);assert.ok(r.base<=r.pb+1.42);
});
test('a real April rollover keeps all surviving abilities and transition PBs, including the eight owned recruits',()=>{
 const run=game(),r=run(`(()=>{
  state=createState();migrateState();const prior=new Map([...state.players,...state.world].map(a=>[a.id,{category:a.category,stats:JSON.stringify(a.stats),apt:JSON.stringify(a.imAptitude||{}),pb:{...a.bestTimes}}]));
  newSeason();const errors=[];for(const a of [...state.players,...state.world]){const b=prior.get(a.id);if(!b)continue;if(JSON.stringify(a.stats)!==b.stats||JSON.stringify(a.imAptitude||{})!==b.apt)errors.push(a.id+' ability');
    if(b.category!==a.category)for(const[e,t]of Object.entries(b.pb))if(validRaceTime(a.bestTimes[e])&&a.bestTimes[e]!==t)errors.push(a.id+' '+e+' PB');
  }
  const first=JSON.stringify(state),seed=state.rngSeed;state=JSON.parse(first);migrateState();
  return{errors,firstYears:state.players.filter(a=>a.year===1).length,stable:first===JSON.stringify(state)&&seed===state.rngSeed};
 })()`);
 assert.deepEqual(r.errors,[]);assert.equal(r.firstYears,8);assert.ok(r.stable);
});
