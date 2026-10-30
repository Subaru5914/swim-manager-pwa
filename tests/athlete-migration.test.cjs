const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];

test('missing and invalid CPU specialties load without losing earned abilities, PBs, identities or the next random draw',()=>{
 const result=vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+`
  state=createState();migrateState();const initial=JSON.stringify(state),reports=[];
  for(const invalid of [undefined,null,'','invalid-event']){
   state=JSON.parse(initial);const a=state.world.find(a=>a.category==='university');
   if(invalid===undefined)delete a.specialty;else a.specialty=invalid;
   const own=JSON.stringify(state.players),seed=state.rngSeed;
   const earned=new Map(state.world.map(a=>[a.id,JSON.stringify([a.name,a.stats,a.bestTimes])]));
   const specialties=new Map(state.world.filter(p=>p!==a).map(p=>[p.id,p.specialty]));
   migrateState();
   const preserved=state.world.length===earned.size&&state.world.every(p=>{
    const [name,stats,pbs]=JSON.parse(earned.get(p.id));
    return p.name===name&&JSON.stringify(p.stats)===JSON.stringify(stats)&&Object.entries(pbs).every(([e,t])=>p.bestTimes[e]===t);
   });
   const first=JSON.stringify(state);state=JSON.parse(first);migrateState();
   reports.push({valid:SPECIALTY_EVENTS.includes(state.world.find(p=>p.id===a.id).specialty),preserved,
    own:own===JSON.stringify(state.players),random:seed===state.rngSeed,
    others:state.world.every(p=>!specialties.has(p.id)||p.specialty===specialties.get(p.id)),stable:first===JSON.stringify(state)});
  }
  return reports;
 `,['globalThis'])({crypto:{getRandomValues:a=>{a[0]=5914;return a}}});
 for(const report of result)assert.ok(Object.values(report).every(Boolean),JSON.stringify(report));
});
