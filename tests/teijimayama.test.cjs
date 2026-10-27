const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const meet='teijimayama_championship';
function game(full=false){
  const context=vm.createContext({crypto:{getRandomValues:a=>{a[0]=12345;return a}}});
  vm.runInContext(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener')),context);
  vm.runInContext(full?'state=createState()':`state={season:2026,slot:60,rngSeed:12345,cpuCompetitionSeed:12345,playerUniversity:'自大学',players:[],world:[],universities:[{id:'K',name:'関西大学',region:'kansai'},{id:'N',name:'関東大学',region:'other'}],kansaiIds:['K'],interIds:['K','N']}`,context);
  return code=>JSON.parse(vm.runInContext('JSON.stringify('+code+')',context));
}

test('Teijimayama runs every November second-week late turn with all 15 individual events and three relays over four days',()=>{
  const run=game(),r=run(`(()=>{
    const meet='${meet}';state.meetParticipationHistory=[];return{dates:[2026,2027,2028].map(season=>({season,date:slotDate(60),meet:meetAt(slotDate(60),season)})),before:meetAt(slotDate(59)),after:meetAt(slotDate(61)),label:meetMonthLabel(meet),
      events:meetIndividualEvents(meet),days:meetEventDays(meet),college:COLLEGE_ENTRY_LIMIT_MEETS.has(meet),restricted:RESTRICTED.has(meet),scoring:TEAM_SCORE_MEETS.has(meet),standards:EVENTS.map(e=>standardFor(meet,e)),
      eligibleWithoutPB:EVENTS.every(e=>qualified({bestTimes:{}},meet,e)),eligibleSlow:EVENTS.every(e=>qualified({bestTimes:{[e]:999}},meet,e)),kansai:meetIndividualEvents('kansai_college'),inter:meetIndividualEvents('intercollege'),
      normalCollegeEligibility:['kansai_college','intercollege'].map(m=>qualified({bestTimes:{fr100:999}},m,'fr100')),comparison:reputationComparison(2026,meet,'player')};
  })()`);
  for(const date of r.dates){assert.deepEqual(date.date,{month:11,week:2,half:'後半'});assert.equal(date.meet,meet)}
  assert.equal(r.before,null);assert.equal(r.after,null);assert.equal(r.label,'11月帝嶋山選手権');
  assert.equal(r.events.length,15);assert.deepEqual(r.days,[['im400','ba200','fr100','fly50'],['fr200','fly200','br100','ba50','4x100fr'],['ba100','im200','fr400','br50','4x100medley'],['fr50','fly100','br200','4x200fr']]);
  assert.ok(r.college&&r.eligibleWithoutPB&&r.eligibleSlow);assert.equal(r.restricted,false);assert.equal(r.scoring,false);assert.ok(r.standards.every(s=>s===null));
  assert.equal(r.kansai.length,12);assert.deepEqual(r.inter,r.kansai);
  assert.deepEqual(r.normalCollegeEligibility,[false,false]);assert.deepEqual(r.comparison,{meet,current:null,previous:null,delta:0});
});

test('regional-only CPU entries use PB order and enforce both three-entry limits without any qualifying time',()=>{
  const run=game(),r=run(`(()=>{
    const meet='${meet}',stats=Object.fromEntries(STATS.map(k=>[k,138]));
    for(let i=0;i<24;i++)state.world.push({id:'K'+String(i).padStart(2,'0'),name:'関西'+i,category:'university',organization:'関西大学',specialty:'fr100',stats,bestTimes:Object.fromEntries(EVENTS.map(e=>[e,standardFor('japan_championship',e)*2+i]))});
    const excluded=[{id:'other-region',category:'university',organization:'関東大学'},{id:'retired',category:'university',organization:'関西大学',retired:true},
      ...['middle','high','adult'].map(category=>({id:category,category,organization:'関西大学'}))].map(a=>({...a,stats,bestTimes:Object.fromEntries(EVENTS.map(e=>[e,1]))}));
    state.world.push(...excluded);
    const original=JSON.stringify(state.world),selected=buildCpuCollegeEntries(meet),counts={};
    for(const e of EVENTS)for(const id of selected[e])counts[id]=(counts[id]||0)+1;
    const initial=selected.fly50.map(id=>state.world.find(a=>a.id===id).bestTimes.fly50);
    const missing={id:'unrecorded',category:'university',organization:'関西大学',stats,bestTimes:{fly50:0}};
    state.world.unshift(missing);const withMissing=buildCpuCollegeEntries(meet);
    return{selected,counts,initial,schools:meetUniversities(meet),same:JSON.stringify(state.world.slice(1))===original,
      excluded:excluded.map(a=>allowedCpu(a,meet)),noMissing:!Object.values(withMissing).flat().includes(missing.id),seed:entrySeedTime({athlete:missing},'fly50'),expected:expectedTime(missing,'fly50')};
  })()`);
  assert.deepEqual(r.schools,['自大学','関西大学']);assert.ok(r.excluded.every(x=>!x));assert.ok(r.same&&r.noMissing);
  for(const ids of Object.values(r.selected)){assert.equal(ids.length,3);assert.equal(new Set(ids).size,3);assert.ok(ids.every(id=>id.startsWith('K')))}
  assert.ok(Object.values(r.counts).every(count=>count<=3));assert.deepEqual(r.initial,[...r.initial].sort((a,b)=>a-b));assert.equal(r.seed,r.expected);
});

test('fourth-year swimmers are excluded from individual, relay and stale entry selections only at Teijimayama',()=>{
 const run=game(),r=run(`(()=>{
  const stats=Object.fromEntries(STATS.map(k=>[k,138]));
  state.players=[1,2,3,4].map(year=>({id:'own'+year,name:'自'+year,year,stats:{...stats},bestTimes:{fr100:50},organization:state.playerUniversity}));
  state.world=[1,2,3,4].map(grade=>({id:'cpu'+grade,name:'他'+grade,grade,category:'university',stats:{...stats},bestTimes:Object.fromEntries(EVENTS.map(e=>[e,100+grade])),organization:'関西大学'}));
  const before=JSON.stringify(state),selections={fr100:['own4','own1']},relays={'4x100fr':['own1','own2','own3','own4']};
  filterMeetEntryGrades('${meet}',selections,relays);
  const eligible=state.world.map(a=>allowedCpu(a,'${meet}')),qualifiedOwn=state.players.map(a=>qualified(a,'${meet}','fr100'));
  const finalIds=relayFinalRoster({meet:'${meet}'}).map(a=>a.id),ownIds=playerMeetRoster('${meet}').map(a=>a.id);
  const noRelays=runRelays('${meet}',{'4x100fr':state.players.map(a=>a.id)}).every(([,finals,meta])=>!finals.length&&!meta.prelim.length);
  const same=before===JSON.stringify(state);
  const entries=buildCpuCollegeEntries('${meet}');
  const otherMeets=['kansai_college','intercollege','japan_open','japan_championship','joint_record'].map(meet=>({meet,own:playerMeetRoster(meet).some(a=>a.year===4),cpu:allowedCpu(state.world[3],meet)}));
  return{eligible,qualifiedOwn,entries,finalIds,ownIds,selections,relays,same,noRelays,otherMeets};
 })()`);
 assert.deepEqual(r.eligible,[true,true,true,false]);assert.deepEqual(r.qualifiedOwn,[true,true,true,false]);
 assert.deepEqual(r.ownIds,['own1','own2','own3']);assert.deepEqual(r.finalIds,r.ownIds);assert.deepEqual(r.selections.fr100,['own1']);assert.deepEqual(r.relays['4x100fr'],[]);
 assert.ok(Object.values(r.entries).flat().every(id=>id!=='cpu4'));assert.ok(r.same&&r.noRelays&&r.otherMeets.every(row=>row.own&&row.cpu));
});

test('a real full regional tournament keeps every entry, daily prelim-first order, relay changes, records and unchanged university scores',()=>{
  const run=game(true),r=run(`(()=>{
    const meet='${meet}';state.slot=61;state.activeCompetitionSlot=60;state.activeCompetitionSeason=2026;
    const own=state.players.slice(0,5);for(const p of own){p.stats=Object.fromEntries(STATS.map(k=>[k,200]));attachMedleyStats(p)}
    const senior=state.players.find(a=>a.year===4);senior.stats=Object.fromEntries(STATS.map(k=>[k,200]));attachMedleyStats(senior);
    for(const a of state.world.filter(a=>a.category==='university'&&a.grade===4)){a.stats=Object.fromEntries(STATS.map(k=>[k,200]));attachMedleyStats(a)}
    const ids=own.slice(0,3).map(a=>a.id),selections=Object.fromEntries(EVENTS.map(e=>[e,SPRINT_EVENTS.includes(e)?[senior.id,...ids]:[]]));
    const relay=Object.fromEntries(RELAYS.map(kind=>[kind,own.slice(0,4).map(a=>a.id)]));
    const rep=state.reputation,scoreHistory=JSON.stringify(state.teamScoreHistory),seniors=state.players.filter(a=>a.year===4).map(a=>a.id);
    const originalBuilder=buildCpuCollegeEntries,originalSeeder=seedRaceHeats,seedClocks=new Map();let selected;
    seedRaceHeats=(entrants,event,meet)=>{const heats=originalSeeder(entrants,event,meet);for(const row of heats.flat())seedClocks.set(row.athlete.id+':'+event,entrySeedTime(row,event));return heats};
    buildCpuCollegeEntries=target=>selected=originalBuilder(target);rng=()=>.5;gauss=()=>0;
    const result=executeMeet(meet,selections,relay,{deferRelayFinalEntries:true});buildCpuCollegeEntries=originalBuilder;seedRaceHeats=originalSeeder;
    const errors=[],counts={},organizations={},schools=new Set(meetUniversities(meet));
    for(const [e,field] of Object.entries(result.events)){
      const cpu=field.prelim.filter(row=>row.source==='CPU').map(row=>row.athlete.id).sort();
      if(JSON.stringify(cpu)!==JSON.stringify([...selected[e]].sort()))errors.push('lost CPU '+e);
      if(!field.heats.length||field.heats.some(h=>h.length>8)||field.heats.length!==Math.ceil(field.prelim.length/8))errors.push('heats '+e);
      for(const heat of field.heats){
        const seeded=[...heat].sort((a,b)=>SEEDED_LANES.indexOf(a.heatLane)-SEEDED_LANES.indexOf(b.heatLane));
        if(seeded.some((row,i)=>i&&seedClocks.get(row.athlete.id+':'+e)<seedClocks.get(seeded[i-1].athlete.id+':'+e))||JSON.stringify(seeded.map(row=>row.heatLane))!==JSON.stringify(SEEDED_LANES.slice(0,heat.length)))errors.push('PB lanes '+e);
      }
      for(const row of [...field.prelim,...field.final]){
        if((row.athlete.year??row.athlete.grade)===4)errors.push('senior individual '+e);
        if(!schools.has(row.athlete.organization))errors.push('wrong school '+e);
        if(row.race.physics.meetFormLevel!==athleteMeetForm(row.athlete,meet,60,2026).level)errors.push('form '+e);
        if(row.race.total!==row.race.cumulative.at(-1)||Math.abs(row.race.total-row.race.splits.reduce((sum,t)=>sum+t,0))>.001)errors.push('clock '+e);
      }
      for(const row of field.prelim){const a=row.athlete;counts[a.id]=(counts[a.id]||0)+1;const key=a.organization+':'+e;organizations[key]=(organizations[key]||0)+1}
      const qualified=field.prelim.slice(0,8).map(row=>row.athlete.id).sort();
      if(JSON.stringify(qualified)!==JSON.stringify(field.final.map(row=>row.athlete.id).sort()))errors.push('finalists '+e);
      for(const row of field.final)if(row.prelimTime!==field.prelim.find(p=>p.athlete.id===row.athlete.id).race.total)errors.push('qualifier clock '+e);
      if(SPRINT_EVENTS.includes(e)&&ids.some(id=>!field.final.some(row=>row.athlete.id===id)))errors.push('own sprint final '+e);
    }
    for(const [kind,finals,meta] of result.relays){
      if(meta.prelim.length!==schools.size||meta.heats.some(heat=>heat.length>8)||!meta.finalEntryPending)errors.push('relay roster '+kind);
      for(const team of meta.prelim)if(!schools.has(team.organization)||new Set(team.members.map(a=>a.id)).size!==4)errors.push('relay school '+kind);
      for(const team of [...meta.prelim,...finals])if([...team.members,...(team.finalMembers||[])].some(a=>(a.year??a.grade)===4))errors.push('senior relay '+kind);
      const savedPrelims=()=>JSON.stringify(meta.prelim.map(team=>({organization:team.organization,members:team.members.map(a=>a.id),heatLane:team.heatLane,rank:team.prelimRank,race:team.race})));
      const before=savedPrelims(),ownFinal=finals.find(ownsRelayTeam),qualifier=ownFinal.prelimTime;
      let rejected=false;try{setRelayFinalEntry(result,kind,[senior.id,...own.slice(0,3).map(a=>a.id)])}catch{rejected=true}
      if(!rejected||savedPrelims()!==before)errors.push('accepted senior relay final '+kind);
      setRelayFinalEntry(result,kind,own.slice(1).map(a=>a.id));
      if(savedPrelims()!==before||ownFinal.prelimTime!==qualifier||meta.finalEntryPending)errors.push('changed prelim '+kind);
      if(Math.abs(ownFinal.race.total-ownFinal.race.legs.reduce((sum,t)=>sum+t,0))>.001||Math.abs(ownFinal.race.trajectory.at(-1).t-ownFinal.race.total)>1e-8)errors.push('relay clock '+kind);
    }
    if(Object.values(counts).some(n=>n>3)||Object.values(organizations).some(n=>n>3))errors.push('entry limits');
    const program=buildMeetProgram(result,selections),queue=buildMeetRaceQueue(result,selections);
    for(const day of [1,2,3,4]){
      const blocks=program.filter(b=>b.day===day),firstFinal=blocks.findIndex(b=>b.phase==='final');
      if(blocks.slice(0,firstFinal).some(b=>b.phase!=='prelim')||blocks.slice(firstFinal).some(b=>b.phase!=='final'))errors.push('day sequence '+day);
    }
    if(SPRINT_EVENTS.some(e=>!queue.some(q=>q.event===e&&q.phase==='prelim')||!queue.some(q=>q.event===e&&q.phase==='final')))errors.push('missing sprint movies');
    completeMeet(result);
    const ownBefore=JSON.stringify(state.players),topBefore=JSON.stringify(state.teamTop10);state=deepClone(state);migrateState();
    return{errors,events:Object.keys(result.events),relays:result.relays.length,teamScores:result.teamScores,scoreHistory:JSON.stringify(state.teamScoreHistory)===scoreHistory,
      reputation:state.reputation===rep,seniors:JSON.stringify(state.players.filter(a=>a.year===4).map(a=>a.id))===JSON.stringify(seniors),points:state.points,entryPoints:result.entryPoints,finalPoints:result.finalPointReward?.points||0,
      ownSaved:JSON.stringify(state.players)===ownBefore,topSaved:JSON.stringify(state.teamTop10)===topBefore,history:state.meetHistory.at(-1).meet,
      ownHistory:own[0].raceHistory.filter(h=>h.meet===meet).length,record:SPRINT_EVENTS.every(e=>state.recordRankings.university[e].some(row=>row.meet===meet)),cleared:activeRaceMeetContext===null};
  })()`);
  assert.deepEqual(r.errors,[]);assert.equal(r.events.length,15);assert.equal(r.relays,3);assert.deepEqual(r.teamScores,{});
  for(const key of ['scoreHistory','reputation','seniors','ownSaved','topSaved','record','cleared'])assert.ok(r[key],key);
  assert.equal(r.entryPoints,9);assert.ok(r.finalPoints>0);assert.equal(r.points,r.entryPoints+r.finalPoints);assert.equal(r.history,meet);assert.ok(r.ownHistory>=6);
});
