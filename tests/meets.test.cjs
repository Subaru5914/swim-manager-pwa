const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const end = source.indexOf('document.getElementById("nav").addEventListener');
function game(seed = 12345) {
  const context = vm.createContext({ crypto: { getRandomValues: a => { a[0] = seed; return a; } } });
  vm.runInContext(source.slice(0, end), context);
  const run = code => vm.runInContext(code, context);
  run('state=createState()');
  return run;
}
const json = (run, code) => JSON.parse(run(`JSON.stringify(${code})`));

test('college totals rank ties consistently and distinguish medals, places and scoreless teams',()=>{
  const run=game();
  const result=json(run,`collegePointRankings({優勝校:100,銀校:90,銅校:80,同点校:80,五位校:60,六位校:50,七位校:40,八位校:30,九位校:20,無得点校:0})`);
  assert.deepEqual(result.map(r=>r.rank),[1,2,3,3,5,6,7,8,9,10]);
  assert.deepEqual(result.map(r=>r.award),['総合優勝','第2位','第3位','第3位','入賞','入賞','入賞','入賞','','']);
  assert.equal(result.at(-1).points,0);
  assert.equal(json(run,'collegePointRankings({無得点校:0})')[0].award,'');
});

test('individual top-ten records retain school-era results through university, adulthood, retirement and reload',()=>{
  const run=game();
  const result=json(run,`(()=>{
    state.recordRankings={};state.teamTop10={};state.world.forEach(a=>a.accolades=[]);
    let a={id:'career-record',name:'記録選手',category:'high',grade:3,organization:'記録高校',bestTimes:{}};
    recordIndividualResult(a,'fr100',50,'全国高校総体','決勝');
    a.category='university';a.organization='記録大学';state.season++;
    recordIndividualResult(a,'fr100',49,'intercollege','決勝');
    recordIndividualResult(a,'fr100',52,'intercollege','予選');
    a.category='adult';a.organization='記録チーム';state.season++;
    recordIndividualResult(a,'fr100',48,'japan_championship','決勝');
    recordIndividualResult({...a,id:'foreign-record',category:'international',nationality:'USA'},'fr100',40,'world_championship','決勝');
    let before=JSON.stringify(state.recordRankings);
    state=JSON.parse(JSON.stringify(state));migrateState();
    return {before,after:JSON.stringify(state.recordRankings),high:state.recordRankings.high.fr100,
      university:state.recordRankings.university.fr100,japan:state.recordRankings.japan.fr100};
  })()`);
  assert.equal(result.before,result.after);
  assert.deepEqual(result.high.map(r=>[r.time,r.organization,r.season]),[[50,'記録高校',2026]]);
  assert.deepEqual(result.university.map(r=>[r.time,r.organization,r.season]),[[49,'記録大学',2027]]);
  assert.deepEqual(result.japan.map(r=>[r.time,r.organization,r.season]),[[48,'記録チーム',2028]]);
});

test('record grades stay at the race year after progression, graduation and save reload',()=>{
  const run=game();
  const result=json(run,`(()=>{
    state.recordRankings={};
    let a={id:'grade-career',name:'学年記録選手',category:'high',grade:3,age:18,organization:'記録高校'};
    recordIndividualResult(a,'fr100',50,'全国高校総体','決勝');
    state.season++;a.category='university';a.grade=1;a.age=19;a.organization='記録大学';
    recordIndividualResult(a,'fr100',49,'intercollege','決勝');
    state.season+=3;a.grade=4;a.age=22;
    recordIndividualResult(a,'fr100',51,'intercollege','決勝');
    state.season++;a.category='adult';a.grade=null;a.age=23;a.organization='記録チーム';
    recordIndividualResult(a,'fr100',48,'japan_championship','決勝');
    let own=state.players.find(p=>p.year===4);recordIndividualResult(own,'fr50',20,'intercollege','決勝');
    let before=JSON.stringify(state.recordRankings);newSeason();
    state=deepClone(state);migrateState();
    return{before,after:JSON.stringify(state.recordRankings),labels:['high','university','japan'].map(k=>recordSchoolLabel(state.recordRankings[k].fr100.find(r=>r.athleteId===a.id))),
      own:state.recordRankings.university.fr50.find(r=>r.athleteId===own.id)};
  })()`);
  // New-season high-school records can be added; the tested athletes retain their snapshots.
  for(const category of ['high','university','japan']){
    const before=JSON.parse(result.before)[category].fr100.find(r=>r.athleteId==='grade-career');
    const after=JSON.parse(result.after)[category].fr100.find(r=>r.athleteId==='grade-career');
    assert.deepEqual(after,before);
  }
  assert.deepEqual(result.labels,['高3年','大1年','社会人']);
  assert.equal(result.own.gradeAtRecord,4);assert.equal(result.own.schoolCategory,'university');
});

test('relay records preserve each member grade and capture a faster replacement lineup separately',()=>{
  const run=game();
  const result=json(run,`(()=>{
    state.recordRankings={};
    const members=[1,2,3,4].map(year=>state.players.find(p=>p.year===year));
    recordRelayResult('4x100fr',{organization:state.playerUniversity,members,race:{total:200}},'intercollege','予選');
    const prelim=deepClone(state.recordRankings.university['4x100fr'][0]);
    state.season++;members.forEach(p=>p.year++);
    let replacement=state.players.find(p=>!members.includes(p)&&p.year===1);
    recordRelayResult('4x100fr',{organization:state.playerUniversity,members:[...members.slice(0,3),replacement],race:{total:199}},'intercollege','決勝');
    const final=deepClone(state.recordRankings.university['4x100fr'][0]);
    members.forEach(p=>p.year=4);replacement.year=4;state=deepClone(state);migrateState();
    return{prelim,final,saved:state.recordRankings.university['4x100fr'][0]};
  })()`);
  assert.deepEqual(result.prelim.members.map(m=>m.gradeAtRecord),[1,2,3,4]);
  assert.deepEqual(result.final.members.map(m=>m.gradeAtRecord),[2,3,4,1]);
  assert.deepEqual(result.saved,result.final);assert.equal(result.final.time,199);
});

test('legacy record grades recover from school cohorts and graduation seasons without inventing unknown grades',()=>{
  const run=game();
  const result=json(run,`(()=>{
    state.season=2027;state.recordRankings={high:{fr100:[]},university:{fr100:[]},japan:{fr100:[]}};state.teamTop10={};state.world.forEach(a=>a.accolades=[]);
    const own=state.players.find(p=>p.year===2);
    const record=(id,season,time,organization=state.playerUniversity)=>({kind:'individual',event:'fr100',athleteId:id,name:'旧記録選手',season,time,organization,meet:'PB集計',stage:'PB'});
    state.retiredArchive.push({id:'grade-retired',name:'卒業記録選手',season:2026,reason:'大学卒業・競技終了',organization:state.playerUniversity,bestTimes:{},accolades:[]});
    const high=record(own.id,2025,50,'高校在籍時'),student=record(own.id,2026,49),retired=record('grade-retired',2024,48),missing=record('grade-missing',2023,47,'不明大学');
    state.recordRankings.high.fr100=[high];state.recordRankings.university.fr100=[student,retired,missing];
    state.recordRankings.japan.fr100=[deepClone(high),deepClone(student),deepClone(retired),deepClone(missing)];
    state.recordRankings.university['4x100fr']=[{kind:'relay',event:'4x100fr',organization:state.playerUniversity,time:200,season:2026,meet:'intercollege',members:[{id:own.id,name:own.name},{id:'grade-retired',name:'卒業記録選手'},{id:'grade-missing',name:'不明選手'},{id:state.players.find(p=>p.year===3).id,name:'上級生'}]}];
    const original=deepClone(state.recordRankings);migrateState();const first=JSON.stringify(state.recordRankings);
    state.season++;state.players.forEach(p=>p.year++);state=deepClone(state);migrateState();
    return{original,records:state.recordRankings,once:first===JSON.stringify(state.recordRankings),
      labels:state.recordRankings.japan.fr100.map(recordSchoolLabel)};
  })()`);
  assert.deepEqual(result.labels,['学年不明','大2年','大1年']);
  assert.equal(result.records.high.fr100[0].gradeAtRecord,3);
  assert.deepEqual(result.records.university['4x100fr'][0].members.map(m=>m.gradeAtRecord),[1,4,null,2]);
  assert.ok(result.once);
  for(const category of ['high','university','japan'])for(const old of result.original[category].fr100){
    const saved=result.records[category].fr100.find(r=>r.athleteId===old.athleteId&&r.time===old.time);
    if(category==='japan'&&result.original.japan.fr100.some(r=>r.athleteId===old.athleteId&&r.time<old.time)){
      assert.equal(saved,undefined);continue;
    }
    const {schoolCategory,gradeAtRecord,...unchanged}=saved;assert.deepEqual(unchanged,old);
  }
});

test('graduated Japan representatives record world races as post-graduation results',()=>{
  const run=game();
  const result=json(run,`(()=>{
    state.recordRankings={};let snapshot=deepClone(state.players.find(p=>p.year===4));
    snapshot.id='graduated-representative';state.japanTeam={selectedSeason:2026,athletes:[{id:snapshot.id,snapshot}]};state.season=2027;
    recordIndividualResult(snapshot,'fr100',47,'world_championship','決勝');
    return{record:state.recordRankings.japan.fr100[0],label:recordSchoolLabel(state.recordRankings.japan.fr100[0]),student:state.recordRankings.university?.fr100||[]};
  })()`);
  assert.equal(result.label,'卒業後');assert.equal(result.record.gradeAtRecord,null);assert.deepEqual(result.student,[]);
});

test('record tables keep only ten distinct fastest swimmers and relay teams and exclude mixed-school relays from school records',()=>{
  const run=game();
  const result=json(run,`(()=>{
    state.recordRankings={};
    for(let i=0;i<15;i++)recordIndividualResult({id:'top'+i,name:'選手'+i,category:'high',organization:'高校'},'fr50',30-i*.1,'全国高校総体','決勝');
    let students=Array.from({length:5},(_,i)=>({id:'relay'+i,name:'泳者'+i,category:'university',organization:'記録大学'}));
    recordRelayResult('4x100fr',{organization:'記録大学',members:students.slice(0,4),race:{total:200}},'intercollege','予選');
    recordRelayResult('4x100fr',{organization:'記録大学',members:students.slice(1),race:{total:199}},'intercollege','決勝');
    students[0].organization='別大学';
    recordRelayResult('4x100fr',{organization:'日本',members:students.slice(0,4),race:{total:190}},'world_championship','決勝');
    recordRelayResult('4x100fr',{organization:'海外',members:students.slice(0,4).map(a=>({...a,category:'international'})),race:{total:180}},'world_championship','決勝');
    return {individual:state.recordRankings.high.fr50,studentRelays:state.recordRankings.university['4x100fr'],nationalRelays:state.recordRankings.japan['4x100fr']};
  })()`);
  assert.equal(result.individual.length,10);assert.deepEqual(result.individual.map(r=>r.time),[28.6,28.7,28.8,28.9,29,29.1,29.2,29.3,29.4,29.5]);
  assert.equal(result.studentRelays.length,1);assert.equal(result.studentRelays[0].time,199);
  assert.deepEqual(result.studentRelays[0].members.map(a=>a.id),['relay1','relay2','relay3','relay4']);
  assert.deepEqual(result.nationalRelays.map(r=>[r.organization,r.time]),[['日本',190],['記録大学',199]]);
});

test('legacy records migrate once with high-school medals and graduate university records intact',()=>{
  const run=game();
  const result=json(run,`(()=>{
    delete state.recordRankings;delete state.recordRankingVersion;
    let a=state.players[0];a.accolades.push({competition:'全国高校総体',event:'fr50',time:20,season:2023});
    upsertIndividualTop10('fr50',{id:'retired-record',name:'卒業選手'},21,'intercollege','決勝');
    migrateState();
    let first=JSON.stringify(state.recordRankings),high=state.recordRankings.high.fr50.find(r=>r.athleteId===a.id),graduate=state.recordRankings.university.fr50.find(r=>r.athleteId==='retired-record');
    a.bestTimes.fr50=19;migrateState();
    return{high,graduate,unchanged:first===JSON.stringify(state.recordRankings),count:state.recordRankings.japan.fr50.length};
  })()`);
  assert.equal(result.high.time,20);assert.equal(result.high.season,2023);assert.equal(result.high.organization,'高校在籍時');
  assert.equal(result.graduate.time,21);assert.equal(result.graduate.name,'卒業選手');
  assert.ok(result.unchanged);assert.equal(result.count,10);
});

test('historic record migration recovers retired PBs and old Japanese records while excluding foreign records',()=>{
  const run=game();
  const result=json(run,`(()=>{
    delete state.recordRankings;delete state.recordRankingVersion;
    state.retiredArchive.push({id:'retired-student-record',name:'引退学生',organization:state.playerUniversity,season:2025,reason:'大学卒業・競技終了',bestTimes:{fr100:45},accolades:[]});
    state.recordBook.fr100={event:'fr100',time:44,athleteId:'legacy-record',name:'旧記録保持者',organization:state.universities[0].name,season:2024,meet:'PB集計'};
    state.recordBook.fr50={event:'fr50',time:19,athleteId:'INT-foreign-record',name:'Foreign Swimmer',organization:WORLD_COUNTRIES[0],season:2024,meet:'world_championship'};
    migrateState();
    return{student:state.recordRankings.university.fr100.find(r=>r.athleteId==='retired-student-record'),
      national:state.recordRankings.japan.fr100.slice(0,2),foreign:state.recordRankings.japan.fr50.some(r=>r.athleteId==='INT-foreign-record')};
  })()`);
  assert.equal(result.student.time,45);assert.equal(result.student.season,2025);
  assert.deepEqual(result.national.map(r=>[r.athleteId,r.time,r.season]),[['legacy-record',44,2024],['retired-student-record',45,2025]]);
  assert.equal(result.foreign,false);
});

test('v1.32 record repairs retain existing categories and run only once without reseeding current PBs',()=>{
  const run=game();
  const result=json(run,`(()=>{
    state.recordRankings={};state.recordBook={};state.teamTop10={};state.world.forEach(a=>a.accolades=[]);
    let own=state.players[0];recordIndividualResult(own,'fr100',48,'intercollege','決勝');
    state.recordRankingVersion=1;own.bestTimes.fr100=40;
    state.retiredArchive.push({id:'retired-adult-record',name:'引退社会人',organization:state.playerUniversity,season:2025,reason:'社会人引退',bestTimes:{fr100:47},accolades:[]});
    migrateState();let first=JSON.stringify(state.recordRankings);migrateState();
    return{version:state.recordRankingVersion,once:first===JSON.stringify(state.recordRankings),
      student:state.recordRankings.university.fr100,national:state.recordRankings.japan.fr100};
  })()`);
  assert.equal(result.version,2);assert.ok(result.once);assert.deepEqual(result.student.map(r=>r.time),[48]);
  assert.deepEqual(result.national.map(r=>r.time),[47,48]);
});

test('all relay finals can change swimmers without altering prelims, lane seeding or abandoned top-ten records',()=>{
  const run=game();
  const result=json(run,`(()=>{
    state.players.slice(0,4).forEach(p=>{p.stats=Object.fromEntries(STATS.map(k=>[k,200]));EVENTS.forEach(e=>p.bestTimes[e]=expectedTime(p,e))});
    state.players.slice(4,8).forEach(p=>p.stats=Object.fromEntries(STATS.map(k=>[k,50])));
    const original=state.players.slice(0,4).map(p=>p.id),replacements=state.players.slice(4,8).map(p=>p.id);
    const entries=Object.fromEntries(RELAYS.map(k=>[k,[...original]]));
    const relays=runRelays('intercollege',entries,true),events=Object.fromEntries(EVENTS.map(e=>[e,{prelim:[],final:[]} ]));
    const result={meet:'intercollege',events,relays,relayEntries:entries,historyEntry:{},teamScoreEntry:{}};
    return RELAYS.map(kind=>{
      const entry=relays.find(r=>r[0]===kind),own=entry[1].find(ownsRelayTeam),prelim=JSON.stringify(entry[2].prelim);
      const lane=own.heatLane,abandonedTime=own.race.total;
      const ownPrelim=entry[2].prelim.find(ownsRelayTeam),beforeRecord=state.recordRankings.university[kind].find(r=>r.organization===state.playerUniversity).time;
      let rejected=false;try{setRelayFinalEntry(result,kind,[original[0],original[0],original[1],original[2]])}catch(e){rejected=true}
      let unchangedAfterReject=prelim===JSON.stringify(entry[2].prelim)&&entry[2].finalEntryPending;
      setRelayFinalEntry(result,kind,replacements);
      return {kind,rejected,unchangedAfterReject,prelimUnchanged:prelim===JSON.stringify(entry[2].prelim),
        initial:entries[kind],members:own.members.map(p=>p.id),replacements,lane,finalLane:own.heatLane,rank:own.rank,
        ranks:entry[1].map(t=>t.rank),scoresAgree:JSON.stringify(result.teamScores)===JSON.stringify(result.historyEntry.teamScores)&&JSON.stringify(result.teamScores)===JSON.stringify(result.teamScoreEntry.scores),
        pending:entry[2].finalEntryPending,abandonedSaved:state.teamTop10[kind].some(r=>r.memberKey===original.join('|')&&r.time===abandonedTime),
        replacementSaved:state.teamTop10[kind].some(r=>r.memberKey===replacements.join('|')&&r.time===own.race.total),
        beforeRecord,prelimTime:round2(ownPrelim.race.total),nationalRecord:state.recordRankings.japan[kind].find(r=>r.organization===state.playerUniversity).time,
        expectedRecord:Math.min(round2(ownPrelim.race.total),round2(own.race.total))};
    });
  })()`);
  for(const row of result){
    assert.ok(row.rejected&&row.unchangedAfterReject&&row.prelimUnchanged&&row.scoresAgree);
    assert.deepEqual(row.members,row.replacements);assert.notDeepEqual(row.initial,row.replacements);
    assert.equal(row.finalLane,row.lane);assert.equal(row.pending,false);assert.equal(row.rank,8);
    assert.deepEqual(row.ranks,[1,2,3,4,5,6,7,8]);
    assert.equal(row.abandonedSaved,false);assert.equal(row.replacementSaved,true);
    assert.equal(row.beforeRecord,row.prelimTime);assert.equal(row.nationalRecord,row.expectedRecord);
  }
});

test('world relay final replacements are restricted to selected Japanese representatives and can remove the own race',()=>{
  const run=game();
  const result=json(run,`(()=>{
    let own=state.players[0],cpu=state.world.filter(p=>p.category==='university').slice(0,7),members=[own,...cpu.slice(0,3)];
    state.japanTeam={year:2027,athletes:[own,...cpu].map(p=>({id:p.id,snapshot:deepClone(p),ownAtSelection:p.id===own.id}))};
    let preliminary={organization:'日本',members:[...members],heatLane:4,race:{total:210}},final={...preliminary,members:[...members],race:simulateRelay(members,'4x100fr',false)};
    let meta={prelim:[preliminary],heats:[[preliminary]],finalEntryPending:true};
    let result={meet:'world_championship',events:Object.fromEntries(EVENTS.map(e=>[e,{prelim:[],final:[]} ])),relays:[['4x100fr',[final],meta]],relayEntries:{'4x100fr':members.map(p=>p.id)}};
    let rejected=false;try{setRelayFinalEntry(result,'4x100fr',state.players.slice(0,4).map(p=>p.id))}catch(e){rejected=true}
    let qualified=meta.finalEntryPending&&ownsRelayTeam(final),prelim=JSON.stringify(preliminary);
    setRelayFinalEntry(result,'4x100fr',cpu.slice(3,7).map(p=>p.id));
    let program=buildMeetProgram(result,{}),queue=buildMeetRaceQueue(result,{});
    return{rejected,qualified,prelimUnchanged:prelim===JSON.stringify(preliminary),
      members:final.members.map(p=>p.id),wanted:cpu.slice(3,7).map(p=>p.id),
      finalOwn:ownsRelayTeam(final),finalShown:queue.some(q=>q.phase==='final'),prelimShown:queue.some(q=>q.phase==='prelim'),
      finalExists:program.some(p=>p.phase==='final'),pending:meta.finalEntryPending};
  })()`);
  assert.ok(result.rejected&&result.qualified&&result.prelimUnchanged);
  assert.deepEqual(result.members,result.wanted);assert.equal(result.finalOwn,false);
  assert.equal(result.finalShown,false);assert.equal(result.prelimShown,true);assert.equal(result.finalExists,true);assert.equal(result.pending,false);
});

test('domestic heats use 6/5/4 groups, world heats use 4/3/2, each with at most eight lanes', () => {
  const run = game();
  const rows = json(run, `['joint_record','kansai_college','intercollege','japan_open','japan_championship','world_championship'].flatMap(meet=>EVENTS.map(e=>{
    let target=preliminaryHeatCount(meet,e),field=Array.from({length:target*8},(_,i)=>({athlete:{id:i,bestTimes:{[e]:100+i}}}));
    let heats=seedRaceHeats(field,e,meet);
    return {meet,e,target,count:heats.length,lanes:heats.map(h=>h.length),unique:new Set(heats.flat().map(x=>x.athlete.id)).size};
  }))`);
  for (const row of rows) {
    const distance = Number(row.e.match(/\d+/)[0]);
    const expected = row.meet === 'world_championship'
      ? (distance <= 100 ? 4 : distance <= 200 ? 3 : 2)
      : (distance <= 100 ? 6 : distance <= 200 ? 5 : 4);
    assert.equal(row.target, expected);
    assert.equal(row.count, expected);
    assert.equal(row.unique, expected * 8);
    assert.ok(row.lanes.every(n => n === 8));
  }
  assert.equal(run(`seedRaceHeats(Array.from({length:17},(_,i)=>({athlete:{id:i,bestTimes:{fr100:100}}})),'fr100','team_trial').length`), 3);
});

test('CPU college entries follow specialties and three-per-event / three-per-athlete limits', () => {
  const run = game();
  const entries = json(run, `['kansai_college','intercollege'].map(meet=>{
    let entries=buildCpuCollegeEntries(meet),counts={},organizations={};
    for(let e of EVENTS)for(let id of entries[e]){
      let a=state.world.find(x=>x.id===id);
      if(!cpuEntryEvents(a).includes(e)||!qualified(a,meet,e))throw Error('invalid CPU entry');
      counts[id]=(counts[id]||0)+1;
      let k=a.organization+'|'+e;organizations[k]=(organizations[k]||0)+1;
    }
    return {athletes:Object.values(counts),events:Object.values(organizations)};
  })`);
  for (const row of entries) {
    assert.ok(row.athletes.length > 0);
    assert.ok(row.athletes.every(n => n <= 3));
    assert.ok(row.events.every(n => n <= 3));
  }
});

test('the eight fastest swimmers across all prelim heats qualify for the final', () => {
  const run = game();
  const result = json(run, `(()=>{
    let r=runEvent('joint_record','fr100',[state.players[0].id]);
    return {groups:r.heats.length,prelim:r.prelim.slice(0,8).map(x=>x.athlete.id).sort(),final:r.final.map(x=>x.athlete.id).sort(),times:r.prelim.map(x=>x.race.total)};
  })()`);
  assert.equal(result.groups, 6);
  assert.deepEqual(result.final, result.prelim);
  assert.deepEqual(result.times, [...result.times].sort((a, b) => a - b));
});

test('college final points are 12/10/8/6/4/3/2/1 and relay points double', () => {
  const run = game();
  const rows = json(run, `['kansai_college','intercollege'].map(meet=>{
    let orgs=Array.from({length:8},(_,i)=>'team'+i),results=Object.fromEntries(EVENTS.map(e=>[e,{final:[]}])) ;
    results.fr100.final=orgs.map(organization=>({athlete:{organization}}));
    let individual=teamScoring(meet,results,[]);
    let relay=teamScoring(meet,Object.fromEntries(EVENTS.map(e=>[e,{final:[]} ])),[['4x100fr',orgs.map(organization=>({organization}))]]);
    return {individual:orgs.map(o=>individual[o]),relay:orgs.map(o=>relay[o])};
  })`);
  for (const row of rows) {
    assert.deepEqual(row.individual, [12, 10, 8, 6, 4, 3, 2, 1]);
    assert.deepEqual(row.relay, [24, 20, 16, 12, 8, 6, 4, 2]);
  }
});

test('empty and multiple legacy training selections become exactly one valid item', () => {
  const run=game();
  const result=json(run,`(()=>{
    return [[],['mental','start'],['mental','fr_speed','fr_stamina'],STATS,['bogus']].map(focus=>{
      let p=state.players[0];p.specialty='fr100';state.trainingFocus[p.id]=focus;
      return ensureTrainingFocus(p);
    });
  })()`);
  assert.deepEqual(result,[['fr_speed'],['mental'],['fr_speed'],['fr_speed'],['fr_speed']]);
});

test('world editions start in 2027 and March belongs to the next calendar year', () => {
  const run = game();
  assert.equal(run(`meetAt({month:8,week:2,half:'後半'},2026)`), null);
  assert.equal(run(`meetAt({month:8,week:2,half:'後半'},2027)`), 'world_championship');
  assert.equal(run(`meetAt({month:8,week:2,half:'後半'},2028)`), null);
  assert.equal(run(`meetAt({month:8,week:2,half:'後半'},2029)`), 'world_championship');
  assert.equal(run(`calendarYear(2026,94)`), 2027);
  assert.equal(run(`calendarYear(2027,36)`), 2027);
});

// Artificial thresholds isolate the selection rule; they do not stand in for official standards.
const selectionFixture = `
  PANPAC_2026_DISPATCH.times=Object.fromEntries(EVENTS.map(e=>[e,100]));
  const fixtureSwimmers=[state.players.find(p=>p.year===4),...state.players.slice(0,3),...state.world.slice(0,4)];
  const fixtureResults=Object.fromEntries(EVENTS.map((e,index)=>[e,{final:fixtureSwimmers.map((a,i)=>({athlete:a,race:{total:98+i},source:state.players.includes(a)?'PLAYER':'CPU'}))}]));
  for(let [e,index] of [['ba100',4],['br100',5],['fly100',6]]){
    fixtureResults[e].final=fixtureSwimmers.map((a,i)=>({athlete:a,race:{total:a===fixtureSwimmers[index]?97:99+i}})).sort((a,b)=>a.race.total-b.race.total);
  }
  state.activeCompetitionSeason=2026;state.activeCompetitionSlot=94;
`;

test('Japan selects up to two standard-clearing finalists, top four freestyle finalists, and medley winners', () => {
  const run = game();
  run(selectionFixture);
  const result = json(run, `(()=>{
    let team=selectJapanTeam(fixtureResults,2027);
    let answer={individual:team.individual.fr100,free:team.relays['4x100fr'],free200:team.relays['4x200fr'],medley:team.relays['4x100medley'],expected:fixtureSwimmers.map(a=>a.id)};
    fixtureResults.fr50.final.forEach((x,i)=>x.race.total=101+i);
    answer.none=selectJapanTeam(fixtureResults,2027).individual.fr50;
    return answer;
  })()`);
  assert.deepEqual(result.individual, result.expected.slice(0, 2));
  assert.deepEqual(result.free, result.expected.slice(0, 4));
  assert.deepEqual(result.free200, result.expected.slice(0, 4));
  assert.deepEqual(result.medley, [result.expected[4], result.expected[5], result.expected[6], result.expected[0]]);
  assert.deepEqual(result.none, []);
  assert.equal(run(`selectJapanTeam(fixtureResults,2028)`), null);
});

test('a double medley champion keeps his specialist stroke and the other runner-up enters automatically', () => {
  for(const specialty of ['fr100','fr200','ba100','ba200']){
    const run=game();run(selectionFixture);
    const result=json(run,`(()=>{
      fixtureSwimmers[0].specialty=${JSON.stringify(specialty)};
      let rows=fixtureResults.ba100.final;
      [rows[0].athlete,rows[1].athlete]=[rows[1].athlete,rows[0].athlete];
      let team=selectJapanTeam(fixtureResults,2027),roles=team.relays['4x100medley'];
      let memberIds=team.athletes.map(a=>a.id);
      state=JSON.parse(JSON.stringify(state));migrateState();
      return {roles,automatic:worldAutoEntries(2027).relays['4x100medley'],memberIds,expected:fixtureSwimmers.map(a=>a.id),individual:team.individual.fr100,free:team.relays['4x100fr']};
    })()`);
    const ids=result.expected,expected=specialty.startsWith('fr')?[ids[4],ids[5],ids[6],ids[0]]:[ids[0],ids[5],ids[6],ids[1]];
    assert.deepEqual(result.roles,expected,specialty);
    assert.deepEqual(result.automatic,expected,specialty);
    assert.equal(new Set(result.roles).size,4,specialty);
    assert.ok(result.roles.every(id=>result.memberIds.includes(id)),specialty);
    assert.deepEqual(result.individual,ids.slice(0,2),specialty);
    assert.deepEqual(result.free,ids.slice(0,4),specialty);
  }
});

test('medley selection resolves two double champions and one triple champion without reusing swimmers', () => {
  for(const triple of [false,true]){
    const run=game();run(selectionFixture);
    const result=json(run,`(()=>{
      fixtureSwimmers[0].specialty=${JSON.stringify(triple?'br200':'fr200')};
      fixtureSwimmers[1].specialty='br100';
      let winners=${JSON.stringify(triple?[0,0,0,3]:[0,1,1,0])};
      for(let [i,e] of ['ba100','br100','fly100','fr100'].entries()){
        let order=[winners[i],4+i];
        fixtureResults[e].final=order.map((index,rank)=>({athlete:fixtureSwimmers[index],race:{total:98+rank}}));
      }
      let team=selectJapanTeam(fixtureResults,2027);
      return {roles:team.relays['4x100medley'],expected:fixtureSwimmers.map(a=>a.id)};
    })()`);
    const ids=result.expected;
    assert.deepEqual(result.roles,triple?[ids[4],ids[0],ids[6],ids[3]]:[ids[4],ids[1],ids[6],ids[0]]);
    assert.equal(new Set(result.roles).size,4);
  }
});

test('medley selection does not put a retained champion in another leg as its runner-up', () => {
  const run=game();run(selectionFixture);
  const result=json(run,`(()=>{
    fixtureSwimmers[0].specialty='fr100';
    fixtureResults.ba100.final=[0,5,4].map((index,rank)=>({athlete:fixtureSwimmers[index],race:{total:97+rank}}));
    return selectJapanTeam(fixtureResults,2027).relays['4x100medley'];
  })()`);
  assert.deepEqual(result,[]);
});

test('Japan team survives April, missing graduated swimmers, and save migration', () => {
  const run = game();
  run(selectionFixture);
  const result = json(run, `(()=>{
    let team=selectJapanTeam(fixtureResults,2027),id=team.individual.fr100[0],selected=JSON.stringify(team);
    state.activeCompetitionSeason=null;state.activeCompetitionSlot=null;newSeason();
    state.players=state.players.filter(p=>p.id!==id);state.world=state.world.filter(p=>p.id!==id);
    state=JSON.parse(JSON.stringify(state));migrateState();
    return {season:state.season,selection:JSON.stringify(state.japanTeam),selected,id,found:japanTeamAthlete(id)?.id,own:ownJapanAthlete(id),entry:worldAutoEntries(2027).individual.fr100,wrong:worldAutoEntries(2029).individual.fr100};
  })()`);
  assert.equal(result.season, 2027);
  assert.equal(result.selection, result.selected);
  assert.equal(result.found, result.id);
  assert.equal(result.own, true);
  assert.ok(result.entry.includes(result.id));
  assert.deepEqual(result.wrong, []);
});

const additionalFixture=`
  const additionalOwn=state.players.slice(0,3),additionalCpu=state.world.slice(0,4);
  additionalOwn[1].bestTimes.fr200=dispatchStandard('fr200')+30;
  const additionalIndividual=Object.fromEntries(EVENTS.map(e=>[e,e==='fr100'?[additionalOwn[0].id,additionalCpu[0].id]:e==='fr200'?[additionalCpu[0].id]:[]]));
  const additionalRelays={'4x100fr':[additionalOwn[1].id,...additionalCpu.slice(0,3).map(a=>a.id)]};
  state.japanTeam={year:2027,selectedSeason:2026,selectedSlot:94,individual:additionalIndividual,relays:additionalRelays,
    athletes:[...additionalOwn.slice(0,2),...additionalCpu.slice(0,3)].map(a=>({id:a.id,snapshot:deepClone(a),ownAtSelection:additionalOwn.includes(a)}))};
`;

test('registered individuals and relay-only own representatives can add every vacant individual event without a swimmer limit',()=>{
  const run=game();run(additionalFixture);
  const r=json(run,`(()=>{
    const selected=JSON.stringify([state.japanTeam.individual,state.japanTeam.relays,state.japanTeam.athletes]),seed=state.rngSeed;
    const options=worldAdditionalEntryOptions(2027),entries=Object.fromEntries(EVENTS.map(e=>[e,e==='fr100'?[]:e==='fr200'?[additionalOwn[1].id]:additionalOwn.slice(0,2).map(a=>a.id)]));
    const combined=setWorldAdditionalEntries(2027,entries),own=worldOwnEntries(2027);
    return {eligible:options.athletes.map(a=>a.id),expected:additionalOwn.slice(0,2).map(a=>a.id),vacancies:options.vacancies,combined,entries,own,
      unchanged:selected===JSON.stringify([state.japanTeam.individual,state.japanTeam.relays,state.japanTeam.athletes]),rng:seed===state.rngSeed,
      tooSlow:additionalOwn[1].bestTimes.fr200>dispatchStandard('fr200'),wrong:worldAutoEntries(2029)};
  })()`);
  assert.deepEqual(r.eligible,r.expected);assert.equal(r.vacancies.fr100,0);assert.equal(r.vacancies.fr200,1);assert.equal(r.vacancies.fr50,2);
  assert.equal(r.combined.individual.fr200.length,2);assert.ok(r.combined.individual.fr200.includes(r.expected[1]));
  for(const event of Object.keys(r.entries))assert.deepEqual(r.own.individual[event],event==='fr100'?[r.expected[0]]:r.entries[event]);
  assert.ok(Object.values(r.own.individual).filter(ids=>ids.includes(r.expected[1])).length>3);
  assert.ok(r.unchanged&&r.rng&&r.tooSlow,JSON.stringify(r));assert.ok(Object.values(r.wrong.individual).every(ids=>ids.length===0));
});

test('additional entries reject full events, duplicates, unselected own swimmers and CPU entrants without replacing a valid choice',()=>{
  const run=game();run(additionalFixture);
  const r=json(run,`(()=>{
    setWorldAdditionalEntries(2027,{fr50:[additionalOwn[0].id]});const saved=JSON.stringify(state.japanTeam);
    const invalid=[{fr100:[additionalOwn[1].id]},{fr200:additionalOwn.slice(0,2).map(a=>a.id)},
      {fr50:[additionalOwn[0].id,additionalOwn[0].id]},{fr50:[additionalOwn[2].id]},{fr50:[additionalCpu[0].id]},{fr50:'bad'}];
    const rejected=invalid.map(entries=>{try{setWorldAdditionalEntries(2027,entries);return false}catch(error){return saved===JSON.stringify(state.japanTeam)}});
    state.japanTeam.additionalIndividual={fr100:[additionalOwn[1].id],fr200:additionalOwn.slice(0,2).map(a=>a.id),
      fr50:[additionalOwn[2].id,additionalCpu[0].id,additionalOwn[0].id,additionalOwn[0].id,additionalOwn[1].id],ba100:'bad'};
    const sanitized=worldAutoEntries(2027);setWorldAdditionalEntries(2027,{});
    return {rejected,sanitized,expected:additionalOwn.slice(0,2).map(a=>a.id),cleared:Object.values(state.japanTeam.additionalIndividual).every(ids=>!ids.length)};
  })()`);
  assert.ok(r.rejected.every(Boolean));assert.equal(r.sanitized.individual.fr100.length,2);assert.equal(r.sanitized.individual.fr200.length,2);
  assert.deepEqual(r.sanitized.individual.fr50,r.expected);assert.deepEqual(r.sanitized.individual.ba100,[]);assert.ok(r.cleared);
});

test('extra entries survive legacy save migration and missing graduate snapshots, enter real world heats and join the own race queue',()=>{
  const run=game();run(additionalFixture);
  const r=json(run,`(()=>{
    const graduate=additionalOwn[1];setWorldAdditionalEntries(2027,{fr50:[graduate.id],ba100:[additionalOwn[0].id]});
    const selected=JSON.stringify(state.japanTeam);
    state.season=2027;state.slot=36;state.players=state.players.filter(a=>a.id!==graduate.id);state.world=state.world.filter(a=>a.id!==graduate.id);
    state=deepClone(state);migrateState();const survived=selected===JSON.stringify(state.japanTeam);
    state.activeCompetitionSeason=2027;state.activeCompetitionSlot=36;
    const result=executeMeet('world_championship',{},{}),queue=buildMeetRaceQueue(result,result.entries);
    return {survived,snapshot:japanTeamAthlete(graduate.id).id,graduate:graduate.id,
      original:state.japanTeam.individual.fr50,extra:result.events.fr50.prelim.filter(r=>r.athlete.id===graduate.id).map(r=>[r.athlete.id,r.source,r.nationality]),
      own:result.entries.fr50,queue:queue.some(q=>q.event==='fr50'&&q.phase==='prelim'&&q.rows.some(r=>r.athlete.id===graduate.id)),
      count:result.events.fr50.heats.length,capacity:result.events.fr50.heats.every(h=>h.length<=8)};
  })()`);
  assert.ok(r.survived);assert.equal(r.snapshot,r.graduate);assert.deepEqual(r.original,[]);assert.deepEqual(r.own,[r.graduate]);
  assert.deepEqual(r.extra,[[r.graduate,'PLAYER','日本']]);assert.ok(r.queue&&r.capacity);assert.equal(r.count,4);
});

test('foreign swimmers are random, edition-stable, event specialists and stronger than the domestic field', () => {
  const run = game();
  const result = json(run, `(()=>{
    let international=ensureInternationalWorld(2027),same=international===ensureInternationalWorld(2027);
    let means=EVENTS.map(e=>{
      let foreign=international.athletes.filter(a=>a.individualEligible&&(a.individualEvent||a.specialty)===e).map(a=>expectedTime(a,e)).sort((a,b)=>a-b).slice(0,8);
      let domestic=state.world.filter(a=>allowedCpu(a,'japan_championship')&&cpuEntryEvents(a).includes(e)).map(a=>expectedTime(a,e)).sort((a,b)=>a-b).slice(0,8);
      return {e,foreign:foreign.reduce((a,b)=>a+b)/foreign.length,domestic:domestic.reduce((a,b)=>a+b)/domestic.length};
    });
    let relays=RELAYS.map(k=>WORLD_COUNTRIES.map(c=>expectedRelayTime(international.relayTeams[c][k].map(id=>international.athletes.find(a=>a.id===id)),k)).sort((a,b)=>a-b)[0]/WORLD_REFERENCE.relays[k]);
    let oldIds=international.athletes.map(a=>a.id).join(','),next=ensureInternationalWorld(2029);
    return {same,count:international.athletes.length,countries:new Set(international.athletes.map(a=>a.organization)).size,valid:international.athletes.every(a=>STATS.every(k=>a.stats[k]>=0&&a.stats[k]<=200)),changed:oldIds!==next.athletes.map(a=>a.id).join(','),means,relays};
  })()`);
  assert.equal(result.same, true);
  assert.equal(result.count, 1008);
  assert.equal(result.countries, 24);
  assert.equal(result.valid, true);
  assert.equal(result.changed, true);
  for (const row of result.means) assert.ok(row.foreign < row.domestic, JSON.stringify(row));
  for (const ratio of result.relays) assert.ok(ratio >= .985 && ratio < 1.04, ratio);
});

test('a complete world meet keeps automatic Japan entries and animates only owned individuals and national relays', () => {
  const run = game();
  run(selectionFixture);
  const result = json(run, `(()=>{
    let team=selectJapanTeam(fixtureResults,2027);state.season=2027;state.slot=36;state.activeCompetitionSeason=2027;state.activeCompetitionSlot=36;
    let automatic=worldAutoEntries(2027),own=worldOwnEntries(2027);
    let meet=executeMeet('world_championship',Object.fromEntries(EVENTS.map(e=>[e,[]])),{});
    let queue=buildMeetRaceQueue(meet,own.individual);
    let groups=EVENTS.map(e=>({e,count:meet.events[e].heats.length,expected:preliminaryHeatCount('world_championship',e),japan:meet.events[e].prelim.filter(x=>x.nationality==='日本').map(x=>x.athlete.id),automatic:automatic.individual[e],top:meet.events[e].prelim.slice(0,8).map(x=>x.athlete.id).sort(),final:meet.events[e].final.map(x=>x.athlete.id).sort()}));
    let onlyOwn=queue.every(q=>q.rows.some(x=>x.source==='PLAYER'));
    let mixedRelay=queue.some(q=>q.event==='4x100medley'&&q.rows.some(x=>x.athlete.organization==='日本'&&x.source==='PLAYER'));
    state.japanTeam.athletes.forEach(a=>a.ownAtSelection=false);state.players=[];
    let cpuOnly=worldOwnEntries(2027),empty=buildMeetRaceQueue({...meet,relayEntries:cpuOnly.relays},cpuOnly.individual);
    let cpuProgram=buildMeetProgram({...meet,relayEntries:cpuOnly.relays},cpuOnly.individual);
    return {groups,onlyOwn,mixedRelay,empty:empty.length,cpuProgram:cpuProgram.length,history:state.meetHistory.at(-1).meet,points:state.points};
  })()`);
  for (const row of result.groups) {
    assert.equal(row.count, row.expected);
    assert.deepEqual([...row.japan].sort(), [...row.automatic].sort());
    assert.deepEqual(row.top, row.final);
  }
  assert.equal(result.onlyOwn, true);
  assert.equal(result.mixedRelay, true);
  assert.equal(result.empty, 0);
  assert.equal(result.cpuProgram, 36);
  assert.equal(result.history, 'world_championship');
  assert.equal(result.points, 0);
});

test('four-day meets finish every daily prelim before finals and place all three relays on the requested days', () => {
  const run=game();
  const rows=json(run,`(()=>{
    const athlete=state.players[0],members=state.players.slice(0,4),race={total:60,trajectory:[{t:0,distance:0}],legs:[15,15,15,15]};
    const individual={source:'PLAYER',athlete,heatLane:4,race};
    const team={organization:state.playerUniversity,members,heatLane:4,race};
    const selections=Object.fromEntries(EVENTS.map(e=>[e,[athlete.id]]));
    return ['kansai_college','intercollege','japan_open','japan_championship','world_championship','joint_record','team_trial'].map(meet=>{
      const result={meet,events:Object.fromEntries(EVENTS.map(e=>[e,{prelim:[individual],final:meet==='team_trial'?[]:[individual],heats:[[individual]]}])),
        relays:RELAY_MEETS.has(meet)?RELAYS.map(e=>[e,[team],{prelim:[team],heats:[[team]]}]):[],
        relayEntries:RELAY_MEETS.has(meet)?Object.fromEntries(RELAYS.map(e=>[e,members.map(p=>p.id)])):{} };
      const program=buildMeetProgram(result,selections),queue=buildMeetRaceQueue(result,selections);
      return {meet,program:program.map(({day,event,phase,showOverview})=>({day,event,phase,showOverview})),
        races:queue.map(({day,event,phase,eventEnd})=>({day,event,phase,eventEnd})),days:meetEventDays(meet)};
    });
  })()`);
  const fourDays=[['im400','ba200','fr100','fly50'],['fr200','fly200','br100','ba50','4x100fr'],['ba100','im200','fr400','br50','4x100medley'],['fr50','fly100','br200','4x200fr']];
  const singles=['fr50','fr100','fr200','fr400','ba50','ba100','ba200','br50','br100','br200','fly50','fly100','fly200','im200','im400'];
  for(const row of rows){
    const four=!['joint_record','team_trial'].includes(row.meet),relays=['kansai_college','intercollege','world_championship','joint_record'].includes(row.meet);
    const days=four?fourDays.map(events=>events.filter(e=>(relays||!e.startsWith('4x'))&&(!['kansai_college','intercollege'].includes(row.meet)||!['ba50','br50','fly50'].includes(e)))):[[...singles,...(relays?['4x100fr','4x200fr','4x100medley']:[])]];
    const phases=row.meet==='team_trial'?['team_trial']:['prelim','final'];
    const expected=days.flatMap((events,i)=>phases.flatMap(phase=>events.map(event=>({day:i+1,event,phase}))));
    assert.deepEqual(row.days,days,row.meet);
    assert.deepEqual(row.program.map(({day,event,phase})=>({day,event,phase})),expected,row.meet);
    assert.ok(row.program.every(p=>p.showOverview===four),row.meet);
    assert.deepEqual(row.races.map(({day,event,phase})=>({day,event,phase})),expected,row.meet);
    assert.ok(row.races.every(r=>r.eventEnd),row.meet);
  }
});

test('race result PB and first-standard badges are shown only for own swimmers', () => {
  const run=game();
  const rows=json(run,`['PLAYER','CPU'].map(source=>({source,html:achievementBadges({source,achievement:{pb:true,newlyCleared:['日本選手権']}},'fr100')}))`);
  assert.match(rows[0].html,/自己PB/);
  assert.match(rows[0].html,/初突破/);
  assert.doesNotMatch(rows[1].html,/自己PB/);
  assert.doesNotMatch(rows[1].html,/初突破/);
  assert.equal(rows[1].html,'—');
});

test('dispatch data matches all twelve user-provided 2026 Pan Pacific standards', () => {
  const run = game();
  assert.equal(run('dispatchStandardsReady()'), true);
  assert.equal(run('PANPAC_2026_DISPATCH.year'), 2026);
  assert.equal(run('PANPAC_2026_DISPATCH.sourceType'), 'user_provided');
  assert.deepEqual(json(run, 'SPECIALTY_EVENTS.map(dispatchStandard)'), [21.64,47.64,105.60,224.33,52.57,115.64,59.27,129.32,50.88,114.62,117.23,251.52]);
  assert.match(run('PANPAC_2026_DISPATCH.source'), /^https:\/\//);
});

test('prelim lanes follow PB and final lanes follow prelim times in 4,5,3,6,2,7,1,8 order', () => {
  const run=game();
  const result=json(run,`(()=>{
    let field=Array.from({length:8},(_,i)=>({athlete:{id:String(i),bestTimes:{fr100:60-i},stats:Object.fromEntries(STATS.map(k=>[k,130]))}}));
    let heat=seedRaceHeats(field,'fr100','team_trial')[0];
    let p=state.players[0];p.stats=Object.fromEntries(STATS.map(k=>[k,173]));p.bestTimes.fr100=48;
    let race=runEvent('joint_record','fr100',[p.id]);
    let finals=race.prelim.slice(0,8).map(pre=>race.final.find(x=>x.athlete.id===pre.athlete.id).heatLane);
    const members=Array.from({length:4},(_,i)=>({...p,id:'m'+i}));
    let teams=Array.from({length:8},(_,i)=>({organization:'Team '+i,members:members.map(p=>({...p,bestTimes:{fr100:50+i}}))}));
    let relay=seedRelayHeats(teams,'4x100fr','joint_record').flat();
    return {heat:heat.map(x=>({id:x.athlete.id,lane:x.heatLane})),finals,relay:relay.map(t=>({score:relaySeedScore(t,'4x100fr'),lane:t.heatLane,heat:t.heatNo}))};
  })()`);
  assert.deepEqual(result.heat.map(x=>x.id),['7','6','5','4','3','2','1','0']);
  assert.deepEqual(result.heat.map(x=>x.lane),[4,5,3,6,2,7,1,8]);
  assert.deepEqual(result.finals,[4,5,3,6,2,7,1,8]);
  for(const heat of new Set(result.relay.map(t=>t.heat))){
    const lanes=result.relay.filter(t=>t.heat===heat).sort((a,b)=>a.score-b.score).map(t=>t.lane);
    assert.deepEqual(lanes,[4,5,3,6,2,7,1,8].slice(0,lanes.length));
  }
});

test('reputation rules explain previous-year attendance and the two calculation dates',()=>{
  const run=game(),text=run('reputationRuleHtml()');
  assert.match(text,/前年度/);assert.match(text,/同人数なら変化なし/);assert.match(text,/インカレ終了時/);assert.match(text,/日本選手権終了時/);
  assert.match(text,/基準記録のみ/);assert.doesNotMatch(text,/エントリー1件|自然減衰。未出場/);
});

test('international names contain no numeric IDs, remain unique, and old names are cleaned once', () => {
  const run=game();
  const result=json(run,`(()=>{
    let world=ensureInternationalWorld(2027);
    let names=world.athletes.map(a=>a.name),id=world.athletes[0].id;
    world.athletes[0].name='Alex Miller 001';world.athletes[1].name='Alex Miller 002';
    state.meetHistory=[{meet:'world_championship',podiums:{fr100:[{name:'Alex Miller 001',organization:'アメリカ',time:47.12},{name:'代表 123',organization:'日本',time:47.2}]}}];
    state=JSON.parse(JSON.stringify(state));migrateState();
    let first=JSON.stringify(state.internationalWorld.athletes.map(a=>({id:a.id,name:a.name,stats:a.stats,pb:a.bestTimes})));
    migrateState();
    return {count:names.length,unique:new Set(names).size,numeric:names.some(n=>/\\d/.test(n)),oldId:state.internationalWorld.athletes[0].id,name:state.internationalWorld.athletes[0].name,podium:state.meetHistory[0].podiums.fr100,once:first===JSON.stringify(state.internationalWorld.athletes.map(a=>({id:a.id,name:a.name,stats:a.stats,pb:a.bestTimes})))};
  })()`);
  assert.equal(result.count,1008);assert.equal(result.unique,1008);assert.equal(result.numeric,false);
  assert.equal(result.name,'Alex Miller');assert.equal(result.once,true);assert.match(result.oldId,/^INT/);
  assert.deepEqual(result.podium,[{name:'Alex Miller',organization:'アメリカ',time:47.12},{name:'代表 123',organization:'日本',time:47.2}]);
});
