const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),cp=require('node:child_process');
const {test}=require('node:test');
const repo=path.join(__dirname,'..'),html=fs.readFileSync(path.join(repo,'index.html'),'utf8');
function game(input=html){
 const source=input.match(/<script>([\s\S]*?)<\/script>/)[1];
 return vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+`
 function protectedData(){return JSON.stringify([state.players,state.world,state.trainingPlans,state.trainingFocus,state.teamTop10,state.recordRankings,state.rngSeed,state.points])}
 function identities(){return [...activeAthletes()].map(a=>({id:a.id,stats:a.stats,imAptitude:a.imAptitude,pb:a.bestTimes,history:a.raceHistory})).sort((a,b)=>a.id.localeCompare(b.id))}
 return code=>JSON.parse(JSON.stringify(eval(code)))`,['globalThis'])({crypto:{getRandomValues:a=>{a[0]=12345;return a}}});
}
function fixture(){
 const run=game();run(`
 state={season:2027,slot:1,rngSeed:12345,cpuCompetitionSeed:12345,cpuDevelopmentVersion:1,playerUniversity:'自大学',reputation:35,points:321,
   universities:[{id:'U1',name:'甲大学',region:'kansai',reputation:200},{id:'U2',name:'乙大学',region:'national',reputation:100},{id:'U3',name:'丙大学',region:'national',reputation:80}],
   players:[],world:[],interIds:['U1','U2','U3'],kansaiIds:['U1'],trainingFocus:{},trainingPlans:{},teamTop10:{fr100:[{athleteId:'historical',time:49,season:2025}]},recordRankings:{high:{fr100:[{athleteId:'a0',time:50,season:2026,organization:'出身高校'}]}},recordBook:{},recruits:[]};
 function entrant(id,organization,own=false){
   const a=attachMedleyStats({id,name:id,organization,age:19,gender:'M',stats:Object.fromEntries(STATS.map(k=>[k,140])),imAptitude:{speed:10,stamina:-10},potentialType:'normal',growthProfile:{1:1,2:1,3:1,4:1},specialty:'fr100',bestTimes:{},condition:65,fatigue:0,raceHistory:[],accolades:[],cpuUniversityRosterProfileVersion:2,cpuCompetitionCategory:'university',cpuRaceDistributionCategory:'university'});
   a.bestTimes.fr100=round2(expectedTime(a,'fr100'));if(own)a.year=1;else{a.category='university';a.grade=1}return a;
 }
 state.players=Array.from({length:8},(_,i)=>entrant('p'+i,state.playerUniversity,true));
 state.world=state.universities.flatMap((u,j)=>Array.from({length:8},(_,i)=>({...entrant(['a','b','c'][j]+i,u.name),cpuUniversityCohortSlot:i})));
 state.players.forEach(p=>{state.trainingFocus[p.id]=['mental'];state.trainingPlans[p.id]=defaultPlan()});
 const leaders=[...state.players.slice(0,2),...state.world.filter(a=>!a.id.startsWith('c')||a.id==='c0'||a.id==='c1')].map((a,i)=>({id:a.id,name:a.name,from:'出身高校',specialty:a.specialty,specialtyPB:a.bestTimes.fr100,rankedEvents:[{event:'fr100',rank:i+1,time:a.bestTimes.fr100}]}));
 const playerProfiles=Object.fromEntries(state.players.map(p=>[p.id,{...deepClone(p),category:'high',grade:3,organization:'出身高校'}]));
 saveCollegeAdmissionsNotice(leaders,2026,{signedIds:['p7'],playerProfiles});state.pendingFreshmenWelcome=freshmanWelcomeRows(state.players);
 `);return run;
}
test('automatic destinations are reproducible and free editing preserves affiliations and meet entry rules',()=>{
 const initial=game()('(state=createState(),migrateState(),deepClone(state))');
 const snapshot=`(()=>{state=${JSON.stringify(initial)};migrateState();newSeason();const notice=deepClone(state.pendingCollegeAdmissions);return{rngSeed:state.rngSeed,roster:activeAthletes().map(a=>[a.id,a.organization,a.category??'university',a.grade??a.year]).sort((a,b)=>a[0].localeCompare(b[0])),rows:notice.rows,fromSeason:notice.fromSeason,toSeason:notice.toSeason}})()`;
 const old=game()(snapshot);
 const run=game(),current=run(snapshot);assert.deepEqual(current,old);
 const moved=run(`(()=>{
  state.scoutingAdmissionsMode='free';const context=collegeAdmissionContext(),row=context.notice.rows.find(r=>!r.own&&qualified(context.byId.get(r.id),'japan_open',r.specialty)),a=context.byId.get(row.id);
  const target=context.universities.find(u=>u.id!=='player'&&u.name!==a.organization&&context.counts.get(u.id)<8),seed=state.rngSeed;
  const before=JSON.stringify(identities());setCollegeAdmissionChoice(a.id,target.id);const result=applyCollegeAdmissionChoices();migrateState();
  const preserved=before===JSON.stringify(identities()),random=seed===state.rngSeed,meet=executeMeet('japan_open',{},{});
  return{result,preserved,random,target:target.name,affiliations:Object.values(meet.events).flatMap(e=>e.prelim.filter(r=>r.athlete.id===a.id).map(r=>r.athlete.organization))};
 })()`);
 assert.ok(moved.result.ok&&moved.preserved&&moved.random);assert.ok(moved.affiliations.length>0);assert.ok(moved.affiliations.every(name=>name===moved.target));
});
test('draft selections do not change affiliations or clocks; the ninth choice is rejected and reset preserves automatic choices',()=>{
 const run=fixture(),r=run(`(()=>{
  const before=protectedData(),blocked=setCollegeAdmissionChoice('b0','U1'),first=setCollegeAdmissionChoice('a0','U3'),eighth=setCollegeAdmissionChoice('b0','U1'),ninth=setCollegeAdmissionChoice('b1','U1');
  const retained=protectedData()===before,choices=Object.fromEntries(collegeAdmissionContext().choices),count=collegeAdmissionContext().counts.get('U1');
  delete state.pendingCollegeAdmissions.choices;const reset=protectedData()===before&&collegeAdmissionContext().choices.get('a0')==='U1';
  const result=applyCollegeAdmissionChoices();return{blocked,first,eighth,ninth,retained,count,choices,reset,result,untouched:before===protectedData(),closed:state.pendingCollegeAdmissions===null};
 })()`);
 assert.ok(!r.blocked.ok&&r.first.ok&&r.eighth.ok&&!r.ninth.ok&&r.retained&&r.reset&&r.untouched&&r.closed);assert.equal(r.count,8);assert.equal(r.choices.a0,'U3');assert.equal(r.choices.b0,'U1');assert.deepEqual(r.result,{ok:true,changed:0});
});
test('confirming CPU choices reallocates ordinary freshmen without changing swimmers, records, university sizes or entry rules',()=>{
 const run=fixture(),r=run(`(()=>{
  const before=JSON.stringify(identities()),records=JSON.stringify([state.teamTop10,state.recordRankings]),seed=state.rngSeed;
  setCollegeAdmissionChoice('a0','U3');setCollegeAdmissionChoice('b0','U1');const result=applyCollegeAdmissionChoices();
  const byId=new Map(activeAthletes().map(a=>[a.id,a])),entries=buildCpuCollegeEntries('intercollege');
  return{result,preserved:before===JSON.stringify(identities()),records:records===JSON.stringify([state.teamTop10,state.recordRankings]),seed:seed===state.rngSeed,
   affiliations:[byId.get('a0').organization,byId.get('b0').organization],sizes:state.universities.map(u=>state.world.filter(a=>a.organization===u.name).length),own:state.players.length,
   entries:entries.fr100.map(id=>({id,organization:byId.get(id).organization})),welcome:state.pendingFreshmenWelcome.length,again:applyCollegeAdmissionChoices()};
 })()`);
 assert.ok(r.result.ok&&r.preserved&&r.records&&r.seed);assert.deepEqual(r.affiliations,['丙大学','甲大学']);assert.deepEqual(r.sizes,[8,8,8]);assert.equal(r.own,8);assert.equal(r.welcome,8);assert.ok(!r.again.ok);
 for(const organization of ['甲大学','乙大学','丙大学'])assert.equal(r.entries.filter(a=>a.organization===organization).length,3);
});
test('own-team arrivals and departures keep eight freshmen, signed places, stats, PBs, training setup and valid CPU profiles',()=>{
 const run=fixture(),r=run(`(()=>{
  state.players[0].bestTimes.fr100+=1;state.players[0].bestTimes.ba100=coherentCpuPB(state.players[0],'ba100');
  const before=JSON.stringify(identities()),seed=state.rngSeed;setCollegeAdmissionChoice('p0','U3');setCollegeAdmissionChoice('a0','player');
  const result=applyCollegeAdmissionChoices(),own=state.players.map(a=>a.id),cpu=state.world.find(a=>a.id==='p0'),after=JSON.stringify(identities());
  maintainWorldPopulation();
  return{result,own,cpu:{organization:cpu.organization,category:cpu.category,grade:cpu.grade,year:cpu.year??null,profile:cpu.cpuUniversityRosterProfileVersion,specialty:cpu.specialty},
   preserved:before===after,afterPracticeSetup:before===JSON.stringify(identities()),seed:seed===state.rngSeed,
   plans:!!state.trainingPlans.a0&&!state.trainingPlans.p0,focus:state.trainingFocus.a0,departedFocus:state.trainingFocus.p0??null,
   sizes:state.universities.map(u=>state.world.filter(a=>a.organization===u.name).length),welcome:state.pendingFreshmenWelcome.map(a=>a.id)};
 })()`);
 assert.ok(r.result.ok&&r.preserved&&r.afterPracticeSetup&&r.seed&&r.plans);assert.equal(r.own.length,8);assert.ok(r.own.includes('a0')&&!r.own.includes('p0')&&r.own.includes('p7'));assert.deepEqual(r.cpu,{organization:'丙大学',category:'university',grade:1,year:null,profile:2,specialty:'ba100'});assert.deepEqual(r.focus,['fr_speed']);assert.equal(r.departedFocus,null);assert.deepEqual(r.sizes,[8,8,8]);assert.deepEqual([...r.welcome].sort(),[...r.own].sort());
});
test('invalid or over-capacity saved choices are rejected atomically; signed own places also count toward eight',()=>{
 const run=fixture(),r=run(`(()=>{
  const before=protectedData();state.pendingCollegeAdmissions.choices={b0:'U1'};const over=applyCollegeAdmissionChoices(),safe1=before===protectedData();
  state.pendingCollegeAdmissions.choices={a0:'missing'};const invalid=applyCollegeAdmissionChoices(),safe2=before===protectedData();
  delete state.pendingCollegeAdmissions.choices;state.pendingCollegeAdmissions.rows=state.pendingCollegeAdmissions.rows.filter(a=>!a.id.startsWith('p'));state.pendingCollegeAdmissions.signedIds=state.players.map(a=>a.id);
  const full=setCollegeAdmissionChoice('a0','player');state.slot=2;const stale=setCollegeAdmissionChoice('a0','U3');
  return{over,invalid,safe1,safe2,full,stale};
 })()`);
 assert.ok(!r.over.ok&&!r.invalid.ok&&r.safe1&&r.safe2&&!r.full.ok&&!r.stale.ok);
});
test('drafts survive serialization and old pending notices can change affiliations without extra profile snapshots',()=>{
 const run=fixture(),r=run(`(()=>{
  delete state.pendingCollegeAdmissions.signedIds;delete state.pendingCollegeAdmissions.playerProfiles;
  setCollegeAdmissionChoice('p0','U3');setCollegeAdmissionChoice('a0','player');const before=JSON.stringify(identities());
  state=JSON.parse(JSON.stringify(state));for(const a of activeAthletes())attachMedleyStats(a);
  const draft=Object.fromEntries(collegeAdmissionContext().choices),result=applyCollegeAdmissionChoices();maintainWorldPopulation();
  return{draft,result,preserved:before===JSON.stringify(identities()),own:state.players.map(a=>a.id),cpu:state.world.find(a=>a.id==='p0').organization};
 })()`);
 assert.ok(r.result.ok&&r.preserved);assert.equal(r.draft.p0,'U3');assert.equal(r.draft.a0,'player');assert.equal(r.cpu,'丙大学');assert.equal(r.own.length,8);assert.ok(r.own.includes('a0'));
});
