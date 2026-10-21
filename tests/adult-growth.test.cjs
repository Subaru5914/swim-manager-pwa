const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(){
 return vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+`
 state={season:2026,slot:1,rngSeed:12345,cpuCompetitionSeed:5914,players:[],world:[],universities:[]};
 function adult(id,value=100,age=23){const a=attachMedleyStats({id,name:id,category:'adult',age,grade:null,organization:'検証チーム',specialty:'fr100',stats:Object.fromEntries(STATS.map(k=>[k,value])),imAptitude:{speed:0,stamina:0},bestTimes:{},growthProfile:deepClone(POTENTIAL_TYPES.normal.profile),accolades:[],raceHistory:[]});ensureCpuDevelopment(a);return a}
 return code=>JSON.parse(JSON.stringify(eval(code)));`,['globalThis'])({crypto:{getRandomValues:a=>{a[0]=12345;return a}}});
}

test('adult plateau is a stable personal trait, independent of save/load, age, specialty, alumni status and race RNG',()=>{
 const r=game()(`(()=>{
  const seed=state.rngSeed,rows=Array.from({length:1000},(_,i)=>adult('adult-'+i)),rates=rows.map(a=>a.adultGrowth.rate);
  const a=rows.find(a=>a.adultGrowth.rate===0),profile=JSON.stringify(a.adultGrowth),stats=JSON.stringify(a.stats),pb=JSON.stringify(a.bestTimes);
  a.cpuDevelopment.goals=STATS.map(()=>200);a.cpuDevelopment.carry=STATS.map(()=>.009999);delete a.cpuDevelopment.adultGrowthVersion;
  const carry=JSON.stringify(a.cpuDevelopment.carry);ensureCpuDevelopment(a);
  for(const age of [23,24,25]){a.age=age;a.specialty='im200';a.alumni=true;for(let turn=0;turn<96;turn++)applyCpuTraining(a)}
  const saved=JSON.parse(JSON.stringify(a));attachMedleyStats(saved);ensureCpuDevelopment(saved);applyCpuTraining(saved);
  return{count:rates.filter(v=>v===0).length,rateRange:rates.every(v=>v===0||(v>=.35&&v<=1)),profile:profile===JSON.stringify(saved.adultGrowth),stats:stats===JSON.stringify(saved.stats),pb:pb===JSON.stringify(saved.bestTimes),carry:carry===JSON.stringify(saved.cpuDevelopment.carry),rng:seed===state.rngSeed};
 })()`);
 assert.ok(r.count>300&&r.count<400,JSON.stringify(r));assert.ok(r.rateRange&&r.profile&&r.stats&&r.pb&&r.carry&&r.rng,JSON.stringify(r));
});

test('growing adults retain age and ability diminishing returns even with distant targets; alumni follow the same rules',()=>{
 const rows=game()(`(()=>{rng=()=>.5;const rows=[];
  for(const value of [60,100,125,150,175,188])for(const age of [23,24,25]){
   const a=adult('age-probe',value,age);a.adultGrowth={version:1,rate:.8,rankRoom:.05,floors:EVENTS.map(()=>1)};
   a.cpuDevelopment.floors=EVENTS.map(()=>1);a.cpuDevelopment.goals=STATS.map(()=>200);
   const twin=attachMedleyStats(deepClone(a));twin.alumni=true;const pb=JSON.stringify(a.bestTimes);
   for(let turn=0;turn<96;turn++){applyCpuTraining(a);applyCpuTraining(twin)}
   rows.push({value,age,peak:Math.max(...STATS.map(k=>a.stats[k]-value)),growth:a.stats.fr_speed-value+a.cpuDevelopment.carry[STATS.indexOf('fr_speed')],same:JSON.stringify(a.stats)===JSON.stringify(twin.stats),pb:pb===JSON.stringify(a.bestTimes)});
  }return rows;
 })()`);
 for(const r of rows)assert.ok(r.peak>=0&&r.peak<1&&r.same&&r.pb,JSON.stringify(r));
 for(const value of [60,100,125,150,175,188]){const group=rows.filter(r=>r.value===value);assert.ok(group[0].growth>group[1].growth&&group[1].growth>group[2].growth,JSON.stringify(group))}
 for(const age of [23,24,25]){const group=rows.filter(r=>r.age===age);for(let i=1;i<group.length;i++)assert.ok(group[i-1].growth>group[i].growth,JSON.stringify(group))}
});

test('all fifteen adult career ceilings use local measured-record spacing and never renew the growth budget each year',()=>{
 const r=game()(`(()=>{const rows=[];
  for(const value of [60,100,150,175,188])for(const specialty of ['fr100','ba200','br100','fly200','im200']){
   const a=adult('distribution-'+value+specialty,value);a.specialty=specialty;ensureCpuDevelopment(a);
   const before=JSON.stringify([a.stats,a.bestTimes]),floors=[...a.adultGrowth.floors],profile=JSON.stringify(a.adultGrowth);
   a.cpuDevelopment.goals=STATS.map(()=>200);const projected=cpuDevelopmentProjection(a);
   for(const [i,e]of EVENTS.entries())rows.push({value,e,rate:a.adultGrowth.rate,base:expectedTime(a,e),floor:floors[i],projected:expectedTime(projected,e),referenceFloor:cpuDevelopmentReference(a,e)[0]*.995});
   for(const age of [24,25]){a.age=age;ensureCpuDevelopment(a)}
   if(profile!==JSON.stringify(a.adultGrowth)||before!==JSON.stringify([a.stats,a.bestTimes]))throw Error('age rollover changed earned data or refreshed reference ceilings');
  }return rows;
 })()`);
 assert.equal(r.length,375);assert.ok(r.some(r=>r.rate>0&&r.floor<r.base-.005));
 for(const row of r){assert.ok(row.floor<=row.base+.000001,JSON.stringify(row));assert.ok(row.projected>=row.floor-.00501,JSON.stringify(row));assert.ok(row.floor>=Math.min(row.base,row.referenceFloor)-.000001,JSON.stringify(row));if(row.rate===0)assert.ok(Math.abs(row.floor-row.base)<.000001)}
 // Reference spacing, rather than a uniform percentage or +4 stat target,
 // makes the allowed second gains vary across the actual event distributions.
 assert.ok(new Set(r.filter(r=>r.rate>0).map(r=>(r.base-r.floor).toFixed(4))).size>15);
});

test('current-save migration preserves earned stats, PBs, history and RNG while adding adult future-growth controls once',()=>{
 const r=game()(`(()=>{
  state=createState();migrateState();
  for(const a of state.world.filter(a=>a.category==='adult')){delete a.adultGrowth;delete a.cpuDevelopment.adultGrowthVersion}
  const protectedData=()=>JSON.stringify([state.players,state.world.map(a=>[a.id,a.stats,a.bestTimes,a.raceHistory,a.accolades]),state.recordRankings,state.teamTop10,state.rngSeed]);
  const before=protectedData();migrateState();const kept=before===protectedData(),saved=JSON.stringify(state);
  state=JSON.parse(saved);migrateState();const stable=saved===JSON.stringify(state);
  const adults=state.world.filter(a=>a.category==='adult'),young=adults.filter(a=>a.age<=25),profiles=JSON.stringify(young.map(a=>a.adultGrowth)),pb=JSON.stringify(young.map(a=>a.bestTimes)),initial=new Map(young.map(a=>[a.id,{...a.stats}]));
  for(let turn=0;turn<96;turn++)young.forEach(applyCpuTraining);
  const report=young.map(a=>({age:a.age,plateau:a.adultGrowth.rate===0,peak:Math.max(...STATS.map(k=>a.stats[k]-initial.get(a.id)[k])),bounded:EVENTS.every((e,i)=>expectedTime(a,e)>=a.adultGrowth.floors[i]-.00501)}));
  return{kept,stable,profiles:profiles===JSON.stringify(young.map(a=>a.adultGrowth)),pb:pb===JSON.stringify(young.map(a=>a.bestTimes)),report,adultProfiles:adults.every(a=>a.adultGrowth?.version===1)};
 })()`);
 assert.ok(r.kept&&r.stable&&r.profiles&&r.pb&&r.adultProfiles,JSON.stringify({...r,report:undefined}));
 assert.ok(r.report.length>50&&r.report.some(a=>a.plateau)&&r.report.some(a=>!a.plateau&&a.peak>0));
 for(const a of r.report){assert.ok(a.peak>=0&&a.peak<1&&a.bounded,JSON.stringify(a));if(a.plateau)assert.equal(a.peak,0)}
 console.log('Adult annual gains:',JSON.stringify([23,24,25].map(age=>{const rows=r.report.filter(a=>a.age===age);return{age,count:rows.length,plateau:rows.filter(a=>a.plateau).length,mean:rows.reduce((s,a)=>s+a.peak,0)/rows.length,max:Math.max(...rows.map(a=>a.peak))}})));
});
