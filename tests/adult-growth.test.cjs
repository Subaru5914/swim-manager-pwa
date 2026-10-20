const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),cp=require('node:child_process'),crypto=require('node:crypto');
const {test}=require('node:test');
const repo=path.join(__dirname,'..'),html=fs.readFileSync(path.join(repo,'index.html'),'utf8');
const previous=cp.execFileSync('git',['show','e996e0f:index.html'],{cwd:repo,encoding:'utf8',maxBuffer:2000000});
function game(input=html){
 const source=input.match(/<script>([\s\S]*?)<\/script>/)[1];
 return vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+`
 function probe(value,age=23,specialty='fr100',type='normal'){
  const a=attachMedleyStats({id:'adult-probe',name:'検証泳者',category:'adult',age,grade:null,organization:'検証チーム',specialty,stats:Object.fromEntries(STATS.map(k=>[k,value])),imAptitude:{speed:0,stamina:0},bestTimes:{},growthProfile:deepClone(POTENTIAL_TYPES[type].profile),accolades:[],raceHistory:[]});
  ensureCpuDevelopment(a);a.cpuDevelopment.goals=STATS.map(()=>200);a.cpuDevelopment.floors=EVENTS.map(()=>1);return a;
 }
 state={season:2026,slot:1,rngSeed:12345,players:[],world:[],universities:[]};
 return code=>JSON.parse(JSON.stringify(eval(code)))`,['globalThis'])({crypto:{getRandomValues:a=>{a[0]=12345;return a}}});
}
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('young adults make only fractional annual gains even with a huge legacy target; older ages and higher ranks grow less',()=>{
 const rows=game()(`(()=>{rng=()=>.9999;const rows=[];
  for(const type of Object.keys(POTENTIAL_TYPES))for(const specialty of ['fr100','im200'])for(const value of [60,100,125,150,175,188])for(const age of [22,23,24,25]){
   const a=probe(value,age,specialty,type),goals=JSON.stringify(a.cpuDevelopment.goals);
   for(let turn=0;turn<96;turn++)applyCpuTraining(a);
   rows.push({type,specialty,value,age,peak:round2(Math.max(...STATS.map(k=>a.stats[k]-value))),speed:round2(a.stats.fr_speed-value),goals:goals===JSON.stringify(a.cpuDevelopment.goals),carry:a.cpuDevelopment.carry.every(v=>v>=0&&v<.01)});
  }return rows;
 })()`);
 for(const r of rows){assert.ok(r.peak>=0&&r.peak<=1.1,JSON.stringify(r));assert.ok(r.goals&&r.carry)}
 for(const type of ['early','normal','late','ready','raw'])for(const specialty of ['fr100','im200']){
  const byAge=rows.filter(r=>r.type===type&&r.specialty===specialty&&r.value===100);
  assert.equal(byAge[0].speed,byAge[1].speed);assert.ok(byAge[1].speed>byAge[2].speed&&byAge[2].speed>byAge[3].speed);
  const byRank=rows.filter(r=>r.type===type&&r.specialty===specialty&&r.age===23);
  for(let i=1;i<byRank.length;i++)assert.ok(byRank[i].speed<byRank[i-1].speed,JSON.stringify(byRank));
 }
});

test('a distant adult target cannot accelerate training, and alumni use exactly the same adult rules without rewriting PBs',()=>{
 const r=game()(`(()=>{rng=()=>.5;
  const near=probe(100),far=probe(100),alumnus=probe(100);near.cpuDevelopment.goals=STATS.map(()=>102);
  alumnus.alumni=true;alumnus.almaMater='自大学';alumnus.year=4;
  for(const a of [near,far,alumnus])a.bestTimes=Object.fromEntries(EVENTS.map(e=>[e,coherentCpuPB(a,e)]));
  const pb=JSON.stringify([near.bestTimes,far.bestTimes,alumnus.bestTimes]);
  for(let turn=0;turn<8;turn++)[near,far,alumnus].forEach(applyCpuTraining);
  return{near:[near.stats,near.cpuDevelopment.carry],far:[far.stats,far.cpuDevelopment.carry],alumnus:[alumnus.stats,alumnus.cpuDevelopment.carry],pb:pb===JSON.stringify([near.bestTimes,far.bestTimes,alumnus.bestTimes]),farGoal:far.cpuDevelopment.goals};
 })()`);
 assert.deepEqual(r.near,r.far);assert.deepEqual(r.alumnus,r.far);assert.ok(r.pb&&r.farGoal.every(v=>v===200));
});

test('v2.37 saves and newly generated rosters keep every field except the application version',()=>{
 const old=game(previous),run=game(),legacy=old('(state=createState(),migrateState(),deepClone(state))');
 run('state='+JSON.stringify(legacy)+';migrateState();true');const migrated=run('deepClone(state)');
 assert.equal(migrated.version,'pwa-v2.38');migrated.version=legacy.version;assert.equal(digest(migrated),digest(legacy));
 run('state=createState();migrateState();true');const fresh=run('deepClone(state)');fresh.version=legacy.version;assert.equal(digest(fresh),digest(legacy));
 const first=run('JSON.stringify(state)');run('migrateState();true');assert.equal(run('JSON.stringify(state)'),first);
});

test('a real graduation keeps established abilities and PBs, then all young adult newcomers grow by less than one point over a year',()=>{
 const r=game()(`(()=>{
  state=createState();migrateState();const prior=new Map(activeAthletes().map(a=>[a.id,{category:a.category,stats:JSON.stringify(a.stats),pb:{...a.bestTimes}}]));newSeason();
  const adults=state.world.filter(a=>a.category==='adult'&&a.age<=25),newcomers=adults.filter(a=>prior.get(a.id)?.category==='university'||a.alumni),errors=[];
  for(const a of newcomers){const old=prior.get(a.id);if(old.stats!==JSON.stringify(a.stats))errors.push(a.id+' transition stats');for(const [e,t]of Object.entries(old.pb))if(a.bestTimes[e]!==t)errors.push(a.id+' transition PB '+e)}
  const before=new Map(adults.map(a=>[a.id,{stats:{...a.stats},pb:JSON.stringify(a.bestTimes)}]));
  for(let turn=0;turn<96;turn++)adults.forEach(applyCpuTraining);
  const report=adults.map(a=>({id:a.id,age:a.age,alumni:!!a.alumni,peak:round2(Math.max(...STATS.map(k=>a.stats[k]-before.get(a.id).stats[k])))}));
  for(const a of adults){if(JSON.stringify(a.bestTimes)!==before.get(a.id).pb)errors.push(a.id+' training PB');if(restoreAthletePaceFromPB(a))errors.push(a.id+' unreachable PB');
   for(const e of EVENTS){const race=simulateRace(a,e,true,false);if(Math.abs(race.total-round2(Math.max(1,race.physics.abilityBase+race.physics.formCorrection+race.physics.raceCorrection)))>.011)errors.push(a.id+' race formula '+e)}
  }
  return{errors,report,newcomers:newcomers.length,alumni:report.filter(a=>a.alumni).length,ownFreshmen:state.players.filter(a=>a.year===1).length};
 })()`);
 assert.deepEqual(r.errors,[]);assert.ok(r.newcomers>50&&r.alumni>0);assert.equal(r.ownFreshmen,8);assert.ok(r.report.every(a=>a.peak>=0&&a.peak<1),JSON.stringify(r.report));
 console.log('Young adult annual peak gains:',JSON.stringify([23,24,25].map(age=>{const rows=r.report.filter(a=>a.age===age);return{age,count:rows.length,average:rows.reduce((s,a)=>s+a.peak,0)/rows.length,max:Math.max(...rows.map(a=>a.peak))}})));
});
