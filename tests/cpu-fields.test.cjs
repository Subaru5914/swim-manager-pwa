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

test('legacy CPU expansion preserves every original swimmer, saved names and PBs and runs once',()=>{
  const run=game(),r=run(`(()=>{
    const added=new Set(CPU_FIELD_UNIVERSITIES.map(u=>u.id)),names=new Set(state.universities.filter(u=>added.has(u.id)).map(u=>u.name));
    state.universities=state.universities.filter(u=>!added.has(u.id));
    state.world=state.world.filter(a=>!a.cpuFieldRoster&&!names.has(a.organization));
    state.interIds=state.interIds.slice(0,30);delete state.cpuMeetPopulationVersion;delete state.cpuMeetPopulationSeason;
    state.playerUniversity='保持大学';state.players.forEach(p=>p.organization=state.playerUniversity);
    const renamed=state.universities[0];renameOrganization('university',0,'保持CPU大学');
    const old=new Map(state.world.map(a=>[a.id,{stats:JSON.stringify(a.stats),pb:JSON.stringify(a.bestTimes),name:a.name,organization:a.organization}]));
    const own=JSON.stringify(state.players);migrateState();
    const kept=state.world.filter(a=>old.has(a.id));const serial=state.serial,rng=state.rngSeed,size=state.world.length;
    const unchanged=kept.every(a=>{const b=old.get(a.id);return b.stats===JSON.stringify(a.stats)&&b.pb===JSON.stringify(a.bestTimes)&&b.name===a.name&&b.organization===a.organization});
    migrateState();prepareCpuMeetPopulation();
    return{unchanged,allKept:kept.length===old.size,own:JSON.stringify(state.players)===own,
      renamed:state.universities.find(u=>u.id===renamed.id).name==='保持CPU大学',playerName:state.playerUniversity,
      once:state.serial===serial&&state.rngSeed===rng&&state.world.length===size,
      newCount:size-old.size,kansai:state.kansaiIds.length,inter:state.interIds.length,
      standards:SPECIALTY_EVENTS.every(e=>standardFor('kansai_college',e)>=standardFor('intercollege',e)*1.19),
      known:state.world.every(a=>!a.cpuFieldRoster||EVENTS.every(e=>validRaceTime(a.bestTimes[e])))};
  })()`);
  for(const k of ['unchanged','allKept','own','renamed','once','standards','known'])assert.equal(r[k],true,JSON.stringify(r));
  assert.equal(r.playerName,'保持大学');assert.equal(r.kansai,48);assert.equal(r.inter,75);assert.ok(r.newCount>144);
});

test('eight subsequent seasons retain qualified full fields and year-round relays without annual strength bonuses',()=>{
  const run=game(),rows=run(`(()=>{
    const rows=[];
    for(let year=0;year<9;year++){
      const errors=[],ranks={};
      for(const meet of ['kansai_college','intercollege','japan_open','japan_championship']){
        const plan=COLLEGE_ENTRY_LIMIT_MEETS.has(meet)?buildCpuCollegeEntries(meet):null;
        for(const e of meetIndividualEvents(meet)){
          const n=plan?plan[e].length:state.world.filter(a=>allowedCpu(a,meet)&&cpuEntryEvents(a).includes(e)&&qualified(a,meet,e)).length;
          if(n<preliminaryHeatCount(meet,e)*8)errors.push(meet+':'+e+':'+n);
        }
      }
      for(const category of ['university','adult'])for(const e of EVENTS){
        const times=state.world.filter(a=>a.category===category&&!a.retired).map(a=>a.bestTimes[e]).sort((a,b)=>a-b);
        ranks[category+':'+e]=[times[0],times[49]];
      }
      processSeniorRetirement(state.season);
      for(const meet of ['kansai_college','intercollege'])for(const org of meetUniversities(meet).slice(1)){
        if(state.world.filter(a=>a.organization===org&&a.category==='university'&&!a.retired).length<4)errors.push('relay:'+org);
      }
      const newIds=new Set(state.world.map(a=>a.id));
      rows.push({season:state.season,errors,ranks,count:state.world.length,reserves:state.world.filter(a=>a.cpuFieldRoster).length,
        rareS:state.world.filter(a=>STATS.some(k=>a.stats[k]>=176)).length/state.world.length});
      if(year<8){newSeason();if(state.world.some(a=>!newIds.has(a.id)&&a.cpuFieldRoster&&a.category==='university'&&a.grade!==1))rows.at(-1).errors.push('new cohort grade')}
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
