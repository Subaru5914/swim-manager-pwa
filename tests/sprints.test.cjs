const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(){
  const context=vm.createContext({crypto:{getRandomValues:a=>{a[0]=12345;return a;}}});
  vm.runInContext(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener')),context);
  const run=code=>vm.runInContext(code,context);run('state=createState()');
  return code=>JSON.parse(run(`JSON.stringify(${code})`));
}

test('50m stroke standards match official men LCM tables and the ability model uses real record anchors',()=>{
  const run=game(),rows=run(`SPRINT_EVENTS.map(e=>({e,standards:['japan_open','japan_championship'].map(m=>standardFor(m,e)),world:dispatchStandard(e),jr:JAPAN_RECORD[e],gold:WORLD_REFERENCE.individual[e],times:[113,138,163,175,188,200].map(v=>expectedTime({stats:Object.fromEntries(STATS.map(k=>[k,v]))},e))}))`);
  const references={ba50:[26.38,26,25.11,24.24,24.05],br50:[28.30,28.08,27.33,26.65,26.29],fly50:[24.42,24.24,23.36,23.06,22.68]};
  for(const r of rows){
    assert.deepEqual([...r.standards,r.world,r.jr,r.gold],references[r.e]);
    assert.equal(r.times[4],r.jr);assert.ok(r.times[5]<=r.jr*.99);
    r.times.forEach((time,i)=>{assert.ok(Number.isFinite(time)&&time>0);if(i)assert.ok(time<r.times[i-1]);});
    assert.ok(r.times[3]*.98<r.world,'strong A racers can clear the world standard with good form');
  }
  const generated=run(`(()=>{const foreign=ensureInternationalWorld(2027).athletes;return{events:EVENTS.length,specialties:SPECIALTY_EVENTS.length,invalid:[...state.players,...state.world,...foreign].filter(a=>!SPECIALTY_EVENTS.includes(a.specialty)).map(a=>a.id),foreign:SPRINT_EVENTS.map(e=>foreign.filter(a=>a.individualEligible&&a.individualEvent===e).length),cpu:state.world.every(a=>SPRINT_EVENTS.every(e=>Number.isFinite(a.bestTimes[e])&&a.bestTimes[e]>0))}})()`);
  assert.equal(generated.events,15);assert.equal(generated.specialties,12);assert.deepEqual(generated.invalid,[]);assert.deepEqual(generated.foreign,[48,48,48]);assert.equal(generated.cpu,true);
});

test('legacy sprint migration repairs nonpositive CPU PBs while preserving valid PBs and the random sequence',()=>{
  const run=game(),result=run(`(()=>{
    const cpu=state.world[0],own=state.players[0];
    cpu.bestTimes.ba50=0;cpu.bestTimes.br50=-1;cpu.bestTimes.fly50=23;
    own.bestTimes.ba50=0;
    const seed=state.rngSeed,stats=JSON.stringify(cpu.stats),original=JSON.stringify(Object.fromEntries(SPECIALTY_EVENTS.map(e=>[e,cpu.bestTimes[e]])));
    migrateSprintEvents();const saved=JSON.stringify(cpu);migrateSprintEvents();
    return {ba:cpu.bestTimes.ba50,br:cpu.bestTimes.br50,fly:cpu.bestTimes.fly50,own:own.bestTimes.ba50,
      stable:saved===JSON.stringify(cpu),rng:state.rngSeed===seed,stats:stats===JSON.stringify(cpu.stats),
      original:original===JSON.stringify(Object.fromEntries(SPECIALTY_EVENTS.map(e=>[e,cpu.bestTimes[e]])))};
  })()`);
  assert.ok(result.ba>0&&result.br>0);assert.equal(result.fly,23);assert.equal(result.own,0);
  assert.ok(result.stable&&result.rng&&result.stats&&result.original);
});

test('new 50m races occupy the fourth daily slot and preserve college events, relay days and daily prelim-first order',()=>{
  const run=game();
  for(const meet of ['japan_open','japan_championship','world_championship']){
    const days=run(`meetEventDays('${meet}')`);assert.deepEqual(days.slice(0,3).map(d=>d[3]),['fly50','ba50','br50']);
    const blocks=run(`(()=>{const row={athlete:state.players[0],source:'PLAYER',race:{total:30}};const events=Object.fromEntries(EVENTS.map(e=>[e,{prelim:[row],final:[row],heats:[[row]]}]));return buildMeetProgram({meet:'${meet}',events,relays:[]},{}).map(b=>({day:b.day,event:b.event,phase:b.phase}))})()`);
    for(let day=1;day<=4;day++){
      const expected=days[day-1].filter(e=>!e.startsWith('4x'));
      assert.deepEqual(blocks.filter(b=>b.day===day).map(b=>b.event),[...expected,...expected]);
      assert.deepEqual(blocks.filter(b=>b.day===day).map(b=>b.phase),[...expected.map(()=>'prelim'),...expected.map(()=>'final')]);
    }
  }
  for(const meet of ['kansai_college','intercollege'])assert.equal(run(`meetEventDays('${meet}').flat().filter(e=>SPRINT_EVENTS.includes(e)).length`),0);
  for(const meet of ['team_trial','joint_record'])assert.equal(run(`meetEventDays('${meet}').flat().filter(e=>EVENTS.includes(e)).length`),15);
  assert.deepEqual(run(`meetEventDays('world_championship').map(day=>day.filter(e=>RELAYS.includes(e)))`),[[],['4x100fr'],['4x100medley'],['4x200fr']]);
});

test('legacy sprint migration only fills absent CPU PBs without changing ability, existing records, identities or randomness',()=>{
  const run=game(),result=run(`(()=>{
    const own=state.players[0],cpu=state.world[0];
    state.world.push({...deepClone(own),id:'sprint-alumni',alumni:true});
    for(const a of [...state.players,...state.world])for(const e of SPRINT_EVENTS)delete a.bestTimes[e];
    cpu.bestTimes.ba50=24.00;
    const before=JSON.stringify([...state.players,...state.world].map(a=>({id:a.id,stats:a.stats,pb:Object.fromEntries(SPECIALTY_EVENTS.map(e=>[e,a.bestTimes[e]])),specialty:a.specialty})));
    const seed=state.rngSeed;migrateSprintEvents();const saved=JSON.stringify(state);migrateSprintEvents();
    return {unchanged:before===JSON.stringify([...state.players,...state.world].map(a=>({id:a.id,stats:a.stats,pb:Object.fromEntries(SPECIALTY_EVENTS.map(e=>[e,a.bestTimes[e]])),specialty:a.specialty}))),rng:seed===state.rngSeed,stable:saved===JSON.stringify(state),kept:cpu.bestTimes.ba50,cpu:state.world.filter(a=>!a.alumni).every(a=>SPRINT_EVENTS.every(e=>Number.isFinite(a.bestTimes[e]))),own:SPRINT_EVENTS.map(e=>own.bestTimes[e]??null),alumni:SPRINT_EVENTS.map(e=>state.world.at(-1).bestTimes[e]??null)};
  })()`);
  assert.ok(result.unchanged&&result.rng&&result.stable&&result.cpu);assert.equal(result.kept,24);assert.deepEqual(result.own,[null,null,null]);assert.deepEqual(result.alumni,[null,null,null]);
});

test('an existing foreign roster keeps all old athletes and relays when the missing sprint fields are added once',()=>{
  const run=game(),result=run(`(()=>{
    const world=ensureInternationalWorld(2027);world.athletes=world.athletes.filter(a=>!SPRINT_EVENTS.includes(a.individualEvent));delete world.sprintEventVersion;
    for(const a of world.athletes){delete a.individualEvent;for(const e of SPRINT_EVENTS)delete a.bestTimes[e];}
    const before=JSON.stringify(world.athletes.map(a=>({id:a.id,name:a.name,stats:a.stats,pb:{...a.bestTimes},specialty:a.specialty}))),relays=JSON.stringify(world.relayTeams);
    const seed=state.rngSeed;migrateSprintEvents();const rngUnchanged=seed===state.rngSeed;
    const count=world.athletes.length,after=ensureInternationalWorld(2027);
    const old=JSON.stringify(after.athletes.slice(0,count).map(a=>({id:a.id,name:a.name,stats:a.stats,pb:Object.fromEntries(SPECIALTY_EVENTS.map(e=>[e,a.bestTimes[e]])),specialty:a.specialty})));
    const saved=JSON.stringify(state);ensureInternationalWorld(2027);
    return{count,total:after.athletes.length,oldPreserved:before===old,relayPreserved:relays===JSON.stringify(after.relayTeams),rngUnchanged,stable:saved===JSON.stringify(state),specialties:after.athletes.every(a=>SPECIALTY_EVENTS.includes(a.specialty)),fields:SPRINT_EVENTS.map(e=>after.athletes.filter(a=>a.individualEligible&&a.individualEvent===e).length)};
  })()`);
  assert.equal(result.count,864);assert.equal(result.total,1008);assert.deepEqual(result.fields,[48,48,48]);assert.ok(result.oldPreserved&&result.relayPreserved&&result.rngUnchanged&&result.stable&&result.specialties);
});

test('new sprint races respect PB qualification, eight finalists, domestic records and final-only world selection',()=>{
  const run=game(),result=run(`(()=>{
    const own=state.players[0];own.stats=Object.fromEntries(STATS.map(k=>[k,200]));
    const checks=SPRINT_EVENTS.map(e=>{own.bestTimes[e]=standardFor('japan_championship',e)+.01;const above=qualified(own,'japan_championship',e);own.bestTimes[e]=standardFor('japan_championship',e);return{above,equal:qualified(own,'japan_championship',e),college:qualified(own,'intercollege',e)}});
    state.activeCompetitionSeason=2026;state.activeCompetitionSlot=94;const original=rng;let meet;
    try{rng=()=>.5;meet=executeMeet('japan_championship',Object.fromEntries(EVENTS.map(e=>[e,SPRINT_EVENTS.includes(e)?[own.id]:[]])),{})}finally{rng=original}
    return{checks,races:SPRINT_EVENTS.map(e=>({e,prelim:meet.events[e].prelim.length,final:meet.events[e].final.length,lanes:meet.events[e].final.map(r=>r.heatLane),selected:meet.selection.individual[e].includes(own.id),record:state.recordRankings.university[e].find(r=>r.athleteId===own.id)?.time,pb:own.bestTimes[e],ranking:ranking(e,'player',50).find(a=>a.id===own.id)?.bestTimes[e]}))};
  })()`);
  for(const c of result.checks)assert.deepEqual(c,{above:false,equal:true,college:false});
  for(const r of result.races){assert.ok(r.prelim>=8);assert.equal(r.final,8);assert.deepEqual(r.lanes.slice().sort((a,b)=>a-b),[1,2,3,4,5,6,7,8]);assert.equal(r.selected,true);assert.equal(r.record,r.pb);assert.equal(r.ranking,r.pb);}
});

test('legacy saves initialize all sprint category top tens from the same PBs as current rankings once',()=>{
  const run=game(),result=run(`(()=>{
    delete state.sprintRecordRankingVersion;
    for(const event of SPRINT_EVENTS){
      for(const book of Object.values(state.recordRankings))delete book[event];
      delete state.recordBook[event];delete state.teamTop10[event];
      for(const a of [...state.players,...state.world])delete a.bestTimes[event];
    }
    const abilities=JSON.stringify([...state.players,...state.world].map(a=>({id:a.id,stats:a.stats,pb:Object.fromEntries(SPECIALTY_EVENTS.map(e=>[e,a.bestTimes[e]]))}))),seed=state.rngSeed;
    migrateState();
    const records=SPRINT_EVENTS.flatMap(event=>['high','university','japan'].map(category=>({event,category,
      actual:state.recordRankings[category][event].map(r=>[r.athleteId,r.time]),
      expected:ranking(event,category==='japan'?'all':category,10).map(a=>[a.id,a.bestTimes[event]])})));
    const saved=JSON.stringify(state);migrateState();
    return{records,version:state.sprintRecordRankingVersion,stable:saved===JSON.stringify(state),rng:seed===state.rngSeed,
      kept:abilities===JSON.stringify([...state.players,...state.world].map(a=>({id:a.id,stats:a.stats,pb:Object.fromEntries(SPECIALTY_EVENTS.map(e=>[e,a.bestTimes[e]]))}))),
      unrecorded:state.players.every(p=>SPRINT_EVENTS.every(e=>p.bestTimes[e]==null))};
  })()`);
  for(const r of result.records){assert.equal(r.actual.length,10);assert.deepEqual(r.actual,r.expected,r.event+' '+r.category);}
  assert.equal(result.version,1);assert.ok(result.stable&&result.rng&&result.kept&&result.unrecorded);
});

test('sprint initialization preserves school-era records and never labels undated admission or foreign PBs as own student results',()=>{
  const run=game(),result=run(`(()=>{
    delete state.sprintRecordRankingVersion;state.recordRankings={};state.teamTop10={};
    const a=state.world.find(a=>a.category==='high'&&a.grade===3),own=state.players[0];
    for(const event of SPRINT_EVENTS){recordIndividualResult(a,event,22,'japan_open','決勝');own.bestTimes[event]=24;}
    const high=JSON.stringify(SPRINT_EVENTS.map(e=>state.recordRankings.high[e].find(r=>r.athleteId===a.id)));a.category='university';a.grade=1;a.age=19;a.organization='進学後の大学';state.season++;
    for(const event of SPRINT_EVENTS)a.bestTimes[event]=25;
    state.world.push({id:'INT-unranked',name:'外国選手',category:'international',nationality:'アメリカ',organization:'アメリカ',bestTimes:Object.fromEntries(SPRINT_EVENTS.map(e=>[e,20]))});
    initializeRecordRankings();const saved=JSON.stringify(state.recordRankings);initializeRecordRankings();
    return{high:high===JSON.stringify(SPRINT_EVENTS.map(e=>state.recordRankings.high[e].find(r=>r.athleteId===a.id))),stable:saved===JSON.stringify(state.recordRankings),
      relabeled:SPRINT_EVENTS.some(e=>(state.recordRankings.university?.[e]||[]).some(r=>r.athleteId===a.id||r.athleteId===own.id)),
      own:SPRINT_EVENTS.map(e=>state.teamTop10[e]||[]),foreign:SPRINT_EVENTS.some(e=>(state.recordRankings.japan?.[e]||[]).some(r=>r.athleteId==='INT-unranked'))};
  })()`);
  assert.ok(result.high&&result.stable);assert.equal(result.relabeled,false);assert.deepEqual(result.own,[[],[],[]]);assert.equal(result.foreign,false);
});

test('missing own sprint top tens recover ten distinct swimmers with original race grades and exclude high-school or post-graduation PBs',()=>{
  const run=game(),result=run(`(()=>{
    state.recordRankings={};state.teamTop10={};
    const own=state.players.slice(0,12);
    for(const [i,a] of own.entries())for(const event of SPRINT_EVENTS){
      a.raceHistory.push({event,time:30+i/10,season:2026,slot:8,meet:'team_trial',stage:'記録会',schoolCategory:'university',gradeAtRecord:a.year,organization:state.playerUniversity});
      a.raceHistory.push({event,time:20,season:2025,meet:'japan_open',stage:'決勝',schoolCategory:'high',gradeAtRecord:3,organization:'以前の高校'});
      a.bestTimes[event]=20;
    }
    const grad={id:'sprint-graduate',name:'卒業後選手',category:'adult',age:24,alumni:true,almaMater:state.playerUniversity,organization:'実業団',bestTimes:{},raceHistory:[]};
    for(const event of SPRINT_EVENTS){grad.bestTimes[event]=19;grad.raceHistory.push({event,time:29,season:2025,slot:42,meet:'intercollege',stage:'決勝',schoolCategory:'university',gradeAtRecord:4,organization:state.playerUniversity});}
    state.world.push(grad);const seed=state.rngSeed;refreshRecordRankings();const saved=JSON.stringify(state.teamTop10);refreshRecordRankings();
    return{own:SPRINT_EVENTS.map(e=>state.teamTop10[e]),stable:saved===JSON.stringify(state.teamTop10),rng:seed===state.rngSeed,grades:own.slice(0,9).map(a=>a.year)};
  })()`);
  for(const rows of result.own){
    assert.equal(rows.length,10);assert.equal(new Set(rows.map(r=>r.athleteId)).size,10);
    assert.deepEqual(rows.map(r=>r.time),[29,30,30.1,30.2,30.3,30.4,30.5,30.6,30.7,30.8]);
    assert.equal(rows[0].season,2025);assert.equal(rows[0].gradeAtRecord,4);assert.deepEqual(rows.slice(1).map(r=>r.gradeAtRecord),result.grades);
  }
  assert.ok(result.stable&&result.rng);
});

test('all sprint rankings include own students in university and own categories and omit invalid or unrecorded PBs',()=>{
  const run=game(),result=run(`(()=>{
    const own=state.players[0];for(const event of SPRINT_EVENTS)own.bestTimes[event]=21;
    const invalid=state.players.slice(1,6),values=[null,NaN,Infinity,0,-1];
    invalid.forEach((a,i)=>SPRINT_EVENTS.forEach(e=>a.bestTimes[e]=values[i]));
    return SPRINT_EVENTS.map(event=>({all:ranking(event,'all',50).map(a=>a.id),students:ranking(event,'university',50).map(a=>a.id),own:ranking(event,'player',50).map(a=>a.id),high:ranking(event,'high',50).map(a=>a.id),id:own.id,invalid:invalid.map(a=>a.id)}));
  })()`);
  for(const r of result){assert.equal(r.all.length,50);assert.equal(r.students.length,50);assert.equal(r.all[0],r.id);assert.equal(r.students[0],r.id);assert.deepEqual(r.own,[r.id]);assert.ok(!r.high.includes(r.id));for(const id of r.invalid)assert.ok(!r.all.includes(id)&&!r.students.includes(id)&&!r.own.includes(id));}
});
