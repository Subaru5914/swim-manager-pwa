const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(seed=12345){
  const context=vm.createContext({crypto:{getRandomValues:a=>{a[0]=seed;return a}}});
  vm.runInContext(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener')),context);
  vm.runInContext('state=createState()',context);
  return code=>JSON.parse(vm.runInContext('JSON.stringify('+code+')',context));
}

test('current university rosters keep saved names, PBs and players without manufacturing extra entrants on reload',()=>{
  const run=game(),r=run(`(()=>{
    state.playerUniversity='保持大学';state.players.forEach(p=>p.organization=state.playerUniversity);
    renameOrganization('university',0,'保持CPU大学');
    const snapshot=()=>JSON.stringify(state.world.map(a=>({id:a.id,name:a.name,organization:a.organization,category:a.category,age:a.age,grade:a.grade,stats:a.stats,pb:a.bestTimes,recorded:a.recordedPBs,scouted:a.scouted})));
    const own=JSON.stringify(state.players),world=snapshot(),serial=state.serial,rng=state.rngSeed;
    migrateState();const first=JSON.stringify(state);migrateState();prepareCpuMeetPopulation();
    return{own:JSON.stringify(state.players)===own,world:snapshot()===world,
      renamed:state.universities[0].name==='保持CPU大学',playerName:state.playerUniversity,
      once:state.serial===serial&&state.rngSeed===rng&&first===JSON.stringify(state),
      kansai:state.kansaiIds.length,inter:state.interIds.length,
      roster:state.universities.every(u=>[1,2,3,4].every(g=>state.world.filter(a=>a.category==='university'&&a.organization===u.name&&a.grade===g&&!a.retired).length===8)),
      standards:SPECIALTY_EVENTS.every(e=>standardFor('kansai_college',e)>=standardFor('intercollege',e)*1.19),
      known:state.world.every(a=>EVENTS.every(e=>validRaceTime(a.bestTimes[e])))};
  })()`);
  for(const k of ['own','world','renamed','once','standards','known','roster'])assert.equal(r[k],true,JSON.stringify(r));
  assert.equal(r.playerName,'保持大学');assert.equal(r.kansai,12);assert.equal(r.inter,39);
});

test('eight subsequent seasons retain legal existing entries and relay rosters without new university actors or annual strength bonuses',()=>{
  const run=game(),rows=run(`(()=>{
    const rows=[];
    for(let year=0;year<9;year++){
      const errors=[],ranks={},byId=new Map(state.world.map(a=>[a.id,a]));
      for(const meet of ['kansai_college','intercollege']){
        const plan=buildCpuCollegeEntries(meet),counts={},schools={};
        for(const e of meetIndividualEvents(meet))for(const id of plan[e]){
          const a=byId.get(id),key=a.organization+'|'+e;
          if(!qualified(a,meet,e)||!allowedCpu(a,meet))errors.push('invalid '+meet+e);
          counts[id]=(counts[id]||0)+1;schools[key]=(schools[key]||0)+1;
        }
        if(Object.values(counts).some(n=>n>3)||Object.values(schools).some(n=>n>3))errors.push('quota '+meet);
      }
      for(const category of ['university','adult'])for(const e of EVENTS){
        const times=state.world.filter(a=>a.category===category&&!a.retired).map(a=>a.bestTimes[e]).filter(validRaceTime).sort((a,b)=>a-b);
        ranks[category+':'+e]=[times[0],times[Math.min(49,times.length-1)]];
      }
      if(state.universities.some(u=>[1,2,3,4].some(grade=>{const n=state.world.filter(a=>a.category==='university'&&!a.retired&&a.organization===u.name&&a.grade===grade).length;return n<8||n>9})))errors.push('cohort');
      processSeniorRetirement(state.season);
      for(const meet of ['kansai_college','intercollege'])for(const org of meetUniversities(meet).slice(1)){
        if(state.world.filter(a=>a.organization===org&&a.category==='university'&&!a.retired).length<4)errors.push('relay:'+org);
      }
      rows.push({season:state.season,errors,ranks,count:state.world.length,
        rareS:state.world.filter(a=>STATS.some(k=>a.stats[k]>=176)).length/state.world.length});
      if(year<8){
        const existingIds=new Set([...state.players,...state.world].map(a=>a.id));newSeason();
        if(state.world.some(a=>!existingIds.has(a.id)&&(a.category!=='middle'||a.grade!==1)))rows.at(-1).errors.push('new actor outside middle pipeline');
      }
    }
    return rows;
  })()`);
  for(const row of rows){
    assert.deepEqual(row.errors,[],JSON.stringify(row));assert.ok(row.count<4500,JSON.stringify(row));assert.ok(row.rareS<.03,JSON.stringify(row));
    for(const [event,[fast,last]] of Object.entries(row.ranks)){
      const initial=rows[0].ranks[event];assert.ok(fast>=initial[0]*.955,event+' '+row.season+' '+fast);
      assert.ok(last>=initial[1]*.94,event+' '+row.season+' '+last);
    }
  }
});

test('adding overseas countries preserves the existing edition and provides complete foreign-only relay fields',()=>{
  const run=game(),r=run(`(()=>{
    const world=ensureInternationalWorld(2027),removed=new Set(WORLD_COUNTRIES.slice(24));
    world.athletes=world.athletes.filter(a=>!removed.has(a.nationality));
    for(const country of removed)delete world.relayTeams[country];delete world.rosterVersion;
    const original=new Map(world.athletes.map(a=>[a.id,JSON.stringify(a)])),relays=JSON.stringify(world.relayTeams);
    const expanded=ensureInternationalWorld(2027),snapshot=JSON.stringify(expanded),serial=state.serial,rng=state.rngSeed;
    const same=expanded.athletes.filter(a=>original.has(a.id)).every(a=>JSON.stringify(a)===original.get(a.id));
    const retainedTeams=Object.entries(JSON.parse(relays)).every(([country,teams])=>JSON.stringify(expanded.relayTeams[country])===JSON.stringify(teams));
    const counts=RELAYS.map(kind=>seedRelayHeats(WORLD_COUNTRIES.map(country=>({organization:country,members:expanded.relayTeams[country][kind].map(id=>expanded.athletes.find(a=>a.id===id))})),kind,'world_championship').map(h=>h.length));
    ensureInternationalWorld(2027);
    return{same,retainedTeams,once:JSON.stringify(expanded)===snapshot&&state.serial===serial&&state.rngSeed===rng,countries:WORLD_COUNTRIES.length,counts,
      allIndividuals:EVENTS.every(e=>expanded.athletes.filter(a=>a.individualEligible&&a.individualEvent===e).length===64),noDigits:expanded.athletes.every(a=>!/[0-9]/.test(a.name))};
  })()`);
  for(const k of ['same','retainedTeams','once','allIndividuals','noDigits'])assert.equal(r[k],true,JSON.stringify(r));
  assert.equal(r.countries,32);assert.deepEqual(r.counts,[[8,8,8,8],[8,8,8],[8,8,8,8]]);
});

test('warming current and legacy timing references preserves generated saves and RNG without growing caches per ability value',()=>{
  const run=game(),r=run(`(()=>{
    const original=JSON.stringify(state),seed=state.rngSeed;
    for(const e of EVENTS){
      for(let ability=0;ability<=200;ability+=.5)for(const legacy of [false,true])abilityBenchmarkTime(e,ability,legacy);
      for(const category of ['middle','high','university','adult']){
        cpuRaceReference(category,e);
        for(const meet of ['kansai_college','intercollege','japan_open','japan_championship'])if(Number.isFinite(standardFor(meet,e)))for(const cap of [175,187])cpuFieldReference(e,category,standardFor(meet,e),cap);
      }
    }
    const untouched=original===JSON.stringify(state)&&seed===state.rngSeed;
    const sizes={benchmarks:abilityBenchmarkAnchorCache.size,races:cpuRaceReferenceCache.size,fields:cpuFieldReferenceCache.size};
    state=createState();
    return{untouched,identical:original===JSON.stringify(state),sizes};
  })()`);
  assert.equal(r.untouched,true);assert.equal(r.identical,true);
  assert.equal(r.sizes.benchmarks,30);assert.equal(r.sizes.races,60);assert.ok(r.sizes.fields<=480);
});

test('incremental top-fifty checks handle cutoffs and ties with the same spans and density as actual sorted rankings',()=>{
  const context=vm.createContext({});vm.runInContext(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener')),context);
  const rows=JSON.parse(vm.runInContext(`JSON.stringify([0,1,48,49,50].flatMap(size=>['fr50','fr100','fr200','fr400'].flatMap(event=>{
    const times=Array.from({length:size},(_,i)=>100+Math.floor(i/3)*.3),before=JSON.stringify(times),field=cpuTop50Context(times,event);
    return [99,100,103.9,104,104.2,104.8,105,120].map(time=>({size,event,time,actual:cpuTop50Impact(field,time),sorted:times.concat(time).sort((a,b)=>a-b).slice(0,50),unchanged:before===JSON.stringify(times)}));
  })))`,context));
  for(const row of rows){
    assert.equal(row.unchanged,true);
    if(row.sorted.length<50){assert.equal(row.actual,null);continue;}
    assert.equal(row.actual.span,row.sorted[49]-row.sorted[0]);
    if(row.event==='fr200'){
      const bins={};for(const t of row.sorted)bins[Math.floor(t)]=(bins[Math.floor(t)]||0)+1;
      assert.equal(row.actual.peak,Math.max(...Object.values(bins)));
    }
  }
});
