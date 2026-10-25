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

test('restored universities have eight swimmers in each grade, balanced strokes and reputation-dependent depth',()=>{
  const run=game(),r=run(`(()=>{
    const teams=state.universities.map(u=>{
      const roster=state.world.filter(a=>a.category==='university'&&a.organization===u.name&&!a.retired);
      return {id:u.id,label:reputationLabel(u.reputation),grades:[1,2,3,4].map(g=>roster.filter(a=>a.grade===g).length),
        strokes:MEDLEY_STROKES.concat('im').map(s=>roster.filter(a=>strokeForEvent(a.specialty)===s).length),
        nationalStars:roster.filter(a=>a.cpuUniversityNationalStar).length,mean:roster.reduce((sum,a)=>sum+abilityValue(a,a.specialty)*200,0)/roster.length};
    });
    const entries=buildCpuCollegeEntries('intercollege'),byId=new Map(state.world.map(a=>[a.id,a]));
    const events=Object.fromEntries(meetIndividualEvents('intercollege').map(e=>[e,{final:entries[e].map(id=>({athlete:byId.get(id)})).sort((a,b)=>expectedTime(a.athlete,e)-expectedTime(b.athlete,e)).slice(0,8)}]));
    const scores=teamScoring('intercollege',events,[]);
    return {count:state.universities.length,kansai:state.kansaiIds.length,teams,
      strongScores:state.universities.filter(u=>u.reputation>=300).map(u=>scores[u.name]).sort((a,b)=>a-b),
      otherScores:state.universities.filter(u=>u.reputation<300).map(u=>scores[u.name]).sort((a,b)=>a-b),
      winners:meetIndividualEvents('intercollege').map(e=>reputationLabel(universityReputationByName(events[e].final[0].athlete.organization))),
      regional:CPU_KANSAI_RACE_REFERENCE.fly200.includes(122.29)&&CPU_KANSAI_RACE_REFERENCE.fr400.includes(232.21),
      clocks:meetIndividualEvents('kansai_college').map(e=>{
        const names=new Set(meetUniversities('kansai_college'));
        const times=state.world.filter(a=>a.category==='university'&&names.has(a.organization)&&!a.cpuUniversityNationalStar).map(a=>expectedTime(a,e)).sort((a,b)=>a-b);
        return {e,first:times[0],eighth:times[7]};
      })};
  })()`);
  assert.equal(r.count,39);assert.equal(r.kansai,12);assert.ok(r.regional);
  for(const team of r.teams){assert.deepEqual(team.grades,[8,8,8,8]);assert.ok(team.strokes.every(n=>n>=4),JSON.stringify(team));assert.ok(team.nationalStars<=1,JSON.stringify(team));}
  const named=r.teams.filter(t=>t.label==='名門'),other=r.teams.filter(t=>!['名門','強豪'].includes(t.label));
  const mean=a=>a.reduce((s,t)=>s+t.mean,0)/a.length;
  assert.ok(mean(named)>mean(other)+15);
  assert.ok(r.strongScores[Math.floor(r.strongScores.length/2)]>=8,JSON.stringify(r.strongScores));
  assert.ok(r.otherScores[Math.floor(r.otherScores.length/2)]===0,JSON.stringify(r.otherScores));
  assert.ok(r.winners.filter(label=>label==='名門'||label==='強豪').length>=10);
  const long=r.clocks.filter(row=>['fr200','fr400','fly200'].includes(row.e));
  for(const row of long){
    const reference={fr200:110.46,fr400:232.21,fly200:122.29}[row.e];
    assert.ok(row.first>=reference*.975,JSON.stringify(row));
    assert.ok(row.eighth>=reference*1.015,JSON.stringify(row));
  }
});

test('old expanded rosters migrate once without deleting athletes, custom campuses, earned PBs or representatives',()=>{
  const run=game(),r=run(`(()=>{
    const custom=state.universities[0];custom.name='保存した大学名';
    for(const a of state.world)if(a.organization==='阪神体育大学')a.organization=custom.name;
    const perGrade=new Map();state.world=state.world.filter(a=>{
      if(a.category!=='university')return true;
      const key=a.organization+':'+a.grade,n=perGrade.get(key)||0;perGrade.set(key,n+1);return n<5;
    });
    for(const a of state.world)if(a.category==='university'){delete a.cpuUniversityRosterProfileVersion;a.cpuFieldRoster=true;}
    const used=new Set([...state.players,...state.world].map(a=>a.name));
    const removed={...deepClone(CPU_FIELD_UNIVERSITIES[0]),name:'保存した追加大学名',baseReputation:80,reputation:80};state.universities.push(removed);
    const representative=makeAthlete('university',removed.name,used,20,2,82),recordHolder=makeAthlete('university',removed.name,used,21,3,82);
    state.world.push(representative,recordHolder);
    recordIndividualResult(recordHolder,'fr100',46.85,'japan_championship','決勝');
    state.japanTeam={year:2027,selectedSeason:2026,selectedSlot:96,individual:{fr100:[representative.id]},relays:{},selectionTimes:{fr100:{}},additionalIndividual:{},athletes:[{id:representative.id,ownAtSelection:false,snapshot:deepClone(representative)}],announced:false};
    const signed=state.world.find(a=>a.category==='high'&&a.grade===3);signed.scouted=true;state.recruits=[signed.id];
    const alumni=attachMedleyStats({...deepClone(state.players[0]),id:'roster-alumni',category:'adult',age:26,alumni:true});state.world.push(alumni);
    const snapshots={own:JSON.stringify(state.players),repStats:JSON.stringify(representative.stats),repPB:JSON.stringify(representative.bestTimes),signed:JSON.stringify(signed),alumni:JSON.stringify(alumni),national:JSON.stringify(state.japanTeam),ids:state.world.map(a=>a.id),rep:state.reputation};
    delete state.cpuUniversityRosterModelVersion;migrateState();
    const first=JSON.stringify(state.world),seed=state.rngSeed;state=JSON.parse(JSON.stringify(state));migrateState();
    const byId=new Map(state.world.map(a=>[a.id,a]));
    return {count:state.universities.length,kansai:state.kansaiIds.length,custom:state.universities.find(u=>u.id===custom.id).name,
      noDeletion:snapshots.ids.every(id=>byId.has(id)),validOrganizations:state.world.filter(a=>a.category==='university').every(a=>state.universities.some(u=>u.name===a.organization)),
      own:snapshots.own===JSON.stringify(state.players),repStats:snapshots.repStats===JSON.stringify(byId.get(representative.id).stats),repPB:snapshots.repPB===JSON.stringify(byId.get(representative.id).bestTimes),
      signed:snapshots.signed===JSON.stringify(byId.get(signed.id)),alumni:snapshots.alumni===JSON.stringify(byId.get(alumni.id)),
      national:snapshots.national===JSON.stringify(state.japanTeam),earned:byId.get(recordHolder.id).bestTimes.fr100<=46.85,
      record:state.recordRankings.japan.fr100.some(row=>row.athleteId===recordHolder.id&&row.time===46.85&&row.organization===removed.name),
      once:first===JSON.stringify(state.world),rng:seed===state.rngSeed,reputation:snapshots.rep===state.reputation};
  })()`);
  assert.equal(r.count,39);assert.equal(r.kansai,12);assert.equal(r.custom,'保存した大学名');
  for(const [key,value] of Object.entries(r))if(!['count','kansai','custom'].includes(key))assert.equal(value,true,key);
});

test('each new season progresses existing school IDs into balanced university places and generates only middle first-years',()=>{
  const run=game(),r=run(`(()=>{
    const samples=[];
    for(let year=0;year<5;year++){
      const prior=new Set([...state.players,...state.world].map(a=>a.id)),highs=new Set(state.world.filter(a=>a.category==='high'&&a.grade===3).map(a=>a.id));
      const before=state.world.filter(a=>a.category==='university').map(a=>abilityValue(a,a.specialty)*200).sort((a,b)=>a-b);
      newSeason();
      const cpu=state.world.filter(a=>a.category==='university'),created=state.world.filter(a=>!prior.has(a.id));
      samples.push({season:state.season,count:cpu.length,grades:state.universities.flatMap(u=>[1,2,3,4].map(g=>cpu.filter(a=>a.organization===u.name&&a.grade===g).length)),
        existingFreshmen:cpu.filter(a=>a.grade===1).every(a=>highs.has(a.id)),ownExisting:state.players.filter(a=>a.year===1).every(a=>highs.has(a.id)),
        onlyMiddle:created.every(a=>a.category==='middle'&&a.grade===1&&a.age===13),created:created.length,
        beforeP90:before[Math.floor(before.length*.9)],afterP90:cpu.map(a=>abilityValue(a,a.specialty)*200).sort((a,b)=>a-b)[Math.floor(cpu.length*.9)]});
    }
    return samples;
  })()`);
  for(const row of r){
    assert.equal(row.count,39*32);assert.ok(row.grades.every(n=>n===8));
    assert.ok(row.existingFreshmen&&row.ownExisting&&row.onlyMiddle,JSON.stringify(row));assert.equal(row.created,320);
    assert.ok(Math.abs(row.afterP90-r[0].beforeP90)<12,JSON.stringify(row));
    if(row.season>r[3].season)assert.ok(Math.abs(row.afterP90-r[3].afterP90)<3,JSON.stringify(row));
  }
});


test('college ability profiles vary between fresh game seeds while remaining reproducible for the same seed',()=>{
  const snapshots=[12345,5914,12345].map(seed=>game(seed)(`state.world.filter(a=>a.category==='university').slice(0,64).map(a=>a.stats)`));
  assert.notDeepEqual(snapshots[0],snapshots[1]);
  assert.deepEqual(snapshots[0],snapshots[2]);
});

test('strong and prestigious universities turn their depth into actual intercollege titles, podiums and relay points',()=>{
  const run=game(5914),r=run(`(()=>{
    const byName=new Map(state.universities.map(u=>[u.name,u])),depth=new Map(state.universities.map(u=>{
      const roster=state.world.filter(p=>p.category==='university'&&p.organization===u.name&&!p.retired);
      return[u.name,{roster:roster.length,qualified:roster.filter(p=>meetIndividualEvents('intercollege').some(e=>qualified(p,'intercollege',e))).length}];
    }));
    const meet=executeMeet('intercollege',{},{});
    const standings=Object.entries(meet.teamScores).filter(([name])=>byName.has(name)).sort((a,b)=>b[1]-a[1]).map(([name,points])=>{
      const u=byName.get(name);return{name,label:reputationLabel(u.reputation),points,...depth.get(name)};
    });
    const finalWinners=Object.values(meet.events).filter(e=>e.final.length).map(e=>reputationLabel(universityReputationByName(e.final[0].athlete.organization)));
    const relayWinners=meet.relays.map(([,finals])=>reputationLabel(universityReputationByName(finals[0].organization)));
    return{standings,finalWinners,relayWinners,total:Object.values(meet.teamScores).reduce((sum,p)=>sum+p,0),relayCount:meet.relays.length};
  })()`);
  if(process.env.SWIM_REPORT_COLLEGE)console.log(JSON.stringify({collegeReport:r}));
  assert.ok(r.standings.slice(0,3).every(u=>['強豪','名門'].includes(u.label)),JSON.stringify(r.standings.slice(0,5)));
  assert.ok(r.standings[0].points>=80,JSON.stringify(r.standings[0]));
  assert.ok(r.finalWinners.filter(label=>['強豪','名門'].includes(label)).length>=10,JSON.stringify(r.finalWinners));
  assert.ok(r.relayWinners.every(label=>['強豪','名門'].includes(label)),JSON.stringify(r.relayWinners));
  const strong=r.standings.filter(u=>['強豪','名門'].includes(u.label)),others=r.standings.filter(u=>!['強豪','名門'].includes(u.label));
  const mean=(teams,k)=>teams.reduce((sum,u)=>sum+u[k],0)/teams.length;
  assert.ok(mean(strong,'qualified')>mean(others,'qualified')*2);assert.ok(mean(strong,'points')>mean(others,'points')+15);
  assert.equal(r.relayCount,3);assert.ok(r.standings.every(u=>u.roster===32));
});
