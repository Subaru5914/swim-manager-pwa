const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),cp=require('node:child_process'),crypto=require('node:crypto');
const {test}=require('node:test');
const repo=path.join(__dirname,'..'),html=fs.readFileSync(path.join(repo,'index.html'),'utf8');
function game(input=html){
 const code=input.match(/<script>([\s\S]*?)<\/script>/)[1];
 return vm.compileFunction(code.slice(0,code.indexOf('document.getElementById("nav").addEventListener'))+`
 let testFixture;
 function resetFixture(){if(!testFixture){state=createState();migrateState();testFixture=deepClone(state)}state=deepClone(testFixture);for(const a of activeAthletes())attachMedleyStats(a)}
 function otherEntryPlans(){return ['kansai_college','intercollege','teijimayama_championship','joint_record'].map(meet=>{
  state.rngSeed=5914;
  const entries=COLLEGE_ENTRY_LIMIT_MEETS.has(meet)?buildCpuCollegeEntries(meet):meet==='joint_record'?Object.fromEntries(EVENTS.map(e=>[e,selectJointCpuEntries(state.world.filter(a=>allowedCpu(a,meet)&&cpuEntryEvents(a,meet).includes(e)&&qualified(a,meet,e)),preliminaryHeatCount(meet,e)*8,e).map(a=>a.id)])):buildCpuNationalEntries(meet);
  return{meet,entries,rngSeed:state.rngSeed};
 })}
 return code=>JSON.parse(JSON.stringify(eval(code)))`,['globalThis'])({crypto:{getRandomValues:a=>{a[0]=12345;return a}}});
}
const run=game(),digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
test('college rank allocation is deterministic, PB-ordered and has no eligible faster swimmer willing to take a vacant or slower place',()=>{
 const r=run(`(()=>{
  state={season:2026,slot:1,rngSeed:5914,players:[],world:[],playerUniversity:'自大学',universities:[{id:'K',name:'関西大学'},{id:'N',name:'全国大学'}],kansaiIds:['K'],interIds:['K','N']};
  const errors=[];
  for(let seed=1;seed<=30;seed++){
   const clocks=(id)=>Object.fromEntries(SPECIALTY_EVENTS.map(e=>[e,round2(standardFor('intercollege',e)*(.88+(profileHash(seed+':'+id+':'+e)%1800)/10000))]));
   state.world=state.universities.flatMap(u=>Array.from({length:32},(_,i)=>({id:u.id+i,category:'university',organization:u.name,specialty:SPECIALTY_EVENTS[i%12],bestTimes:clocks(u.id+i)})));
   state.players=Array.from({length:8},(_,i)=>({id:'own'+i,year:1,bestTimes:clocks('own'+i)}));
   for(const meet of ['kansai_college','intercollege']){
    const before=JSON.stringify(state),entries=buildCpuCollegeEntries(meet),fields=categoryPersonalBestRankings('university'),counts={};
    for(const e of SPECIALTY_EVENTS)for(const id of entries[e])counts[id]=(counts[id]||0)+1;
    if(before!==JSON.stringify(state))errors.push('mutation '+seed);
    for(const org of meetUniversities(meet).filter(org=>org!==state.playerUniversity)){
     const roster=state.world.filter(a=>a.organization===org),byId=new Map(roster.map(a=>[a.id,a]));
     for(const e of SPECIALTY_EVENTS){
      const selected=entries[e].filter(id=>byId.has(id)),cutoff=selected.length===3?byId.get(selected.at(-1)).bestTimes[e]:Infinity;
      if(selected.length>3||new Set(selected).size!==selected.length)errors.push('team limit '+seed+e);
      for(const [i,id]of selected.entries())if((counts[id]||0)>3||!qualified(byId.get(id),meet,e)||(i&&byId.get(selected[i-1]).bestTimes[e]>byId.get(id).bestTimes[e]))errors.push('entry rules '+seed+e);
      for(const a of roster)if(qualified(a,meet,e)&&!selected.includes(a.id)&&a.bestTimes[e]<cutoff){
       const current=SPECIALTY_EVENTS.filter(x=>entries[x].includes(a.id));
       if(current.length<3){errors.push('unfilled eligible '+seed+e);continue}
       const rank=fields.get(e).byId.get(a.id);
       if(current.some(x=>fields.get(x).byId.get(a.id)>rank))errors.push('better rank rejected '+seed+e);
      }
     }
    }
    const saved=JSON.stringify(entries);state.world.reverse();const again=buildCpuCollegeEntries(meet);state.world.reverse();
    if(saved!==JSON.stringify(again))errors.push('roster order '+seed);
   }
  }
  return errors;
 })()`);assert.deepEqual(r,[]);
});
test('v2.36 saves and reset generation preserve non-scouting data, existing negotiations and all meet entry plans',()=>{
 const previous=game(cp.execFileSync('git',['show','6ca86e7:index.html'],{cwd:repo,encoding:'utf8',maxBuffer:2000000}));
 const legacy=previous('(resetFixture(),deepClone(state))');
 run('state='+JSON.stringify(legacy)+';migrateState();true');const migrated=run('deepClone(state)');
 assert.equal(migrated.version,'pwa-v2.80');
 const comparable=s=>{s=JSON.parse(JSON.stringify(s));delete s.version;delete s.scoutingCompetition;return s};
 assert.equal(digest(comparable(migrated)),digest(comparable(legacy)));
 for(const key of ['randomState','processedMonths','schools','notices'])assert.deepEqual(migrated.scoutingCompetition[key],legacy.scoutingCompetition[key]);
 for(const [id,before]of Object.entries(legacy.scoutingCompetition.candidates)){const after=migrated.scoutingCompetition.candidates[id];for(const key of ['contacts','offers','destination','decision'])assert.deepEqual(after[key],before[key]);for(const school of before.cpuTargets)assert.ok(after.cpuTargets.includes(school));for(const [school,interest]of Object.entries(before.interests))assert.equal(after.interests[school],interest)}
 run('resetFixture();true');const fresh=run('deepClone(state)');assert.equal(digest(comparable(fresh)),digest(comparable(legacy)));
 assert.deepEqual(run('otherEntryPlans()'),previous('otherEntryPlans()'));
});
test('real Kansai and Intercollege races freeze rank-based entries and retain limits, qualification, relay choices and owned race playback',()=>{
 const r=run(`(()=>{
  resetFixture();const reports=[];
  const own=state.players[0];own.stats=Object.fromEntries(STATS.map(k=>[k,165]));attachMedleyStats(own);own.bestTimes.fr100=round2(expectedTime(own,'fr100'));
  for(const [meet,slot]of [['kansai_college',30],['intercollege',42]]){
   state.slot=slot;state.activeCompetitionSlot=slot;state.activeCompetitionSeason=state.season;
   const before=JSON.stringify(state),expected=buildCpuCollegeEntries(meet),unchanged=before===JSON.stringify(state);
   const manual=Object.fromEntries(EVENTS.map(e=>[e,e==='fr100'?[own.id]:[]])),relays=Object.fromEntries(RELAYS.map(kind=>[kind,state.players.slice(0,4).map(a=>a.id)]));
   const actualBuilder=buildCpuCollegeEntries,actualRelays=runRelays;let builds=0,relayFinals={};buildCpuCollegeEntries=m=>{builds++;return actualBuilder(m)};
   runRelays=(m,...args)=>{
    relayFinals=Object.fromEntries(meetUniversities(m).filter(org=>org!==state.playerUniversity).map(org=>[org,Object.fromEntries(RELAYS.map(kind=>[kind,bestRelayMembers(state.world.filter(a=>!a.retired&&a.category==='university'&&a.organization===org),kind).map(a=>a.id)]))]));
    return actualRelays(m,...args);
   };
   const result=executeMeet(meet,manual,relays,{deferRelayFinalEntries:true});buildCpuCollegeEntries=actualBuilder;runRelays=actualRelays;
   const errors=[],counts={};
   for(const e of SPECIALTY_EVENTS){
    const ids=result.events[e].prelim.filter(r=>r.source==='CPU').map(r=>r.athlete.id).sort();
    if(JSON.stringify(ids)!==JSON.stringify([...expected[e]].sort()))errors.push('changed entries '+e);
    const universities={};for(const row of result.events[e].prelim.filter(r=>r.source==='CPU')){
     const a=row.athlete;counts[a.id]=(counts[a.id]||0)+1;universities[a.organization]=(universities[a.organization]||0)+1;
     if(!qualified(a,meet,e))errors.push('standard '+e);
    }
    if(Object.values(universities).some(n=>n>3))errors.push('university limit '+e);
   }
   if(Object.values(counts).some(n=>n>3))errors.push('athlete limit');
   const queue=buildMeetRaceQueue(result,manual),ownRows=result.events.fr100.prelim.filter(r=>r.source==='PLAYER');
   for(const [kind,finals,meta]of result.relays)for(const team of finals.filter(t=>!ownsRelayTeam(t))){
    if(JSON.stringify(team.members.map(a=>a.id))!==JSON.stringify(relayFinals[team.organization][kind]))errors.push('relay final '+kind);
   }
   reports.push({meet,unchanged,builds,errors,own:ownRows.some(r=>r.athlete.id===own.id),animated:queue.some(q=>q.event==='fr100'&&q.phase==='prelim'),cpu:Object.keys(counts).length,relays:result.relays.length});
   state.activeCompetitionSlot=null;state.activeCompetitionSeason=null;
  }
  return reports;
 })()`);
 for(const row of r){assert.ok(row.unchanged&&row.own&&row.animated&&row.cpu>0);assert.equal(row.builds,1);assert.equal(row.relays,3);assert.deepEqual(row.errors,[],row.meet)}
});
