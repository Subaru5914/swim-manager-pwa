const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const load=vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+
 '\nreturn code=>JSON.parse(JSON.stringify(eval(code)))',['globalThis']);
function engine(){return load({crypto:{getRandomValues:a=>{a[0]=12345;return a}}})}

test('a new mental draw ignores reputation, category, grade and swimming strength and leaves the live RNG alone',()=>{
 const run=engine(),r=run(`(()=>{
  const rows=[];
  for(const reputation of [35,350])for(const category of ['middle','high','university','adult']){
   state={season:2026,slot:1,reputation,rngSeed:5914,cpuCompetitionSeed:12345,serial:1000,playerUniversity:'自大学',universities:[{name:'検証大学',reputation,region:'kansai'}],recruits:[],players:[],world:[]};
   const a=makeAthlete(category,'検証大学',new Set(),category==='adult'?23:19,1,reputation===35?50:90,0);
   rows.push({id:a.id,mental:a.stats.mental,physical:physicalStatValue(a)});
  }
  const seed=state.rngSeed;for(let n=0;n<1000;n++)initialMentalValue('read-'+n);
  return{rows,stable:seed===state.rngSeed};
 })()`);
 assert.ok(r.stable);assert.equal(new Set(r.rows.map(a=>a.id)).size,1);
 assert.equal(new Set(r.rows.map(a=>a.mental)).size,1);
 assert.ok(Math.max(...r.rows.map(a=>a.physical))-Math.min(...r.rows.map(a=>a.physical))>20);
});

test('talent and CPU profile adjustments preserve mental and cannot use high mental as elite swimming ability',()=>{
 const run=engine(),r=run(`(()=>{
  const results=[];
  for(const operation of ['talent','individual','middle','high','university','adult']){
   const pair=[];
   for(const mental of [0,200]){
    state={season:2026,slot:1,rngSeed:5914,cpuCompetitionSeed:12345,playerUniversity:'自大学',reputation:35,universities:[{name:'検証大学',reputation:35,region:'kansai'}],recruits:[]};
    const a=attachMedleyStats({id:'same-athlete',name:'検証選手',year:1,grade:1,age:19,organization:'検証大学',category:operation,
     specialty:'fr100',stats:Object.fromEntries(STATS.map(k=>[k,k==='mental'?mental:80])),bestTimes:{},
     potentialType:'normal',growthProfile:{1:1,2:1,3:1,4:1},cpuStatCeilings:Object.fromEntries(STATS.map(k=>[k,k==='mental'?200:175]))});
    if(operation==='talent')applyProdigyBoost(a);else if(operation==='individual')diversifyCpuIndividual(a);else applyCpuCompetitionProfile(a);
    pair.push({mental:a.stats.mental,physical:PHYSICAL_STATS.map(k=>a.stats[k])});
   }
   results.push({operation,pair});
  }
  return results;
 })()`);
 for(const {operation,pair}of r){assert.deepEqual(pair.map(a=>a.mental),[0,200],operation);assert.deepEqual(pair[0].physical,pair[1].physical,operation)}
});

test('adult decline never raises an initially low mental value to the physical-stat floor',()=>{
 const run=engine(),r=run(`(()=>{
  state={season:2026,slot:1,rngSeed:5914};
  const a={age:28,stats:Object.fromEntries(STATS.map(k=>[k,k==='mental'?5:90])),bestTimes:{}};
  applyCpuCareerDecline(a);return a.stats;
 })()`);
 assert.equal(r.mental,5);assert.ok(r.fr_speed<=90);
});

test('initial rosters, international generation and April newcomers keep independent mental, while continuing players keep earned values',t=>{
 const run=engine(),r=run(`(()=>{
  state=createState();migrateState();ensureInternationalWorld(2027);
  const errors=[],cohorts={own:state.players,...Object.fromEntries(['middle','high','university','adult'].map(c=>[c,state.world.filter(a=>a.category===c)])),international:state.internationalWorld.athletes};
  const summaries=Object.fromEntries(Object.entries(cohorts).map(([category,roster])=>{
   for(const a of roster)if(a.stats.mental!==initialMentalValue(a.id))errors.push(a.id+' altered mental');
   const values=roster.map(a=>[physicalStatValue(a),a.stats.mental]),mean=i=>values.reduce((s,v)=>s+v[i],0)/values.length,mx=mean(0),my=mean(1);
   const corr=values.reduce((s,[x,y])=>s+(x-mx)*(y-my),0)/Math.sqrt(values.reduce((s,[x])=>s+(x-mx)**2,0)*values.reduce((s,[,y])=>s+(y-my)**2,0));
   return[category,{count:roster.length,mean:my,min:Math.min(...values.map(v=>v[1])),max:Math.max(...values.map(v=>v[1])),corr}];
  }));
  // A trained mental value is saved progress, never another generation draw.
  state.players[0].stats.mental=187.65;
  const before=new Map([...state.players,...state.world].map(a=>[a.id,a.stats.mental]));
  newSeason();
  for(const a of [...state.players,...state.world]){
   if(before.has(a.id)){if(a.stats.mental!==before.get(a.id))errors.push(a.id+' rollover changed mental')}
   else if(a.stats.mental!==initialMentalValue(a.id))errors.push(a.id+' newcomer mental');
  }
  const saved=JSON.stringify([state.players,state.world,state.internationalWorld]),seed=state.rngSeed;
  state=JSON.parse(JSON.stringify(state));migrateState();
  return{errors,summaries,stable:saved===JSON.stringify([state.players,state.world,state.internationalWorld])&&seed===state.rngSeed};
 })()`);
 assert.deepEqual(r.errors,[]);assert.ok(r.stable);
 for(const [category,row]of Object.entries(r.summaries)){
  assert.ok(row.min>=0&&row.max<=200,category);
  if(row.count>100){assert.ok(row.min<10&&row.max>190,category);assert.ok(Math.abs(row.corr)<.15,JSON.stringify({category,...row}))}
 }
 t.diagnostic(JSON.stringify(r.summaries));
});
