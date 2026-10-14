const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(full=false){
 const run=vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+'\nreturn code=>JSON.parse(JSON.stringify(eval(code)))',['globalThis'])({crypto:{getRandomValues:a=>{a[0]=5914;return a;}}});
 run(full?'state=createState();migrateState();true':'state={season:2026,rngSeed:5914,reputation:35,players:[],world:[],alumniCareer:[]}');return run;
}
test('every national-standard graduate continues without a lottery, and own graduates preserve IM aptitude, PB and the next-year age',()=>{
 const run=game(),r=run(`(()=>{
  let draws=0;rng=()=>{draws++;return .999999};
  const stats=Object.fromEntries(STATS.map(k=>[k,163])),p=attachMedleyStats({id:'graduate',name:'継続泳者',year:4,age:22,stats,imAptitude:{speed:20,stamina:-20},bestTimes:{},specialty:'im200',growthProfile:[1,1,1,1],raceHistory:[],accolades:[]});
  const cases=EVENTS.map(e=>{p.bestTimes={[e]:standardFor('japan_open',e)};return graduateToAdult(p)});
  for(const e of EVENTS)p.bestTimes[e]=round2(expectedTime(p,e));
  const before=JSON.stringify([p.stats,p.bestTimes,p.imAptitude]),adult=alumniAdultFromPlayer(p,'社会人チーム');
  const intact=before===JSON.stringify([adult.stats,adult.bestTimes,adult.imAptitude]);
  const weak={stats:Object.fromEntries(STATS.map(k=>[k,40])),bestTimes:{}};
  return{cases,drawsBeforeWeak:draws,weak:graduateToAdult(weak),intact,age:adult.age,id:adult.id,alumni:adult.alumni,
    im:EVENTS.filter(e=>e.startsWith('im')).every(e=>expectedTime(p,e)===expectedTime(adult,e))};
 })()`);
 assert.ok(r.cases.every(Boolean));assert.equal(r.drawsBeforeWeak,0);assert.equal(r.weak,false);assert.ok(r.intact&&r.im&&r.alumni);assert.equal(r.age,23);assert.equal(r.id,'graduate');
});
test('a real April transition retains all strong seniors, announces actual college assignments, and uses those affiliations in national and college races',()=>{
 const run=game(true),r=run(`(()=>{
  const senior=state.players.find(p=>p.year===4);senior.stats=Object.fromEntries(STATS.map(k=>[k,163]));senior.imAptitude={speed:20,stamina:-20};attachMedleyStats(senior);
  for(const e of EVENTS)senior.bestTimes[e]=round2(expectedTime(senior,e));
  const seniorBefore=JSON.stringify([senior.stats,senior.bestTimes,senior.imAptitude]);
  const weak=state.world.find(a=>a.category==='university'&&a.grade===4&&!eligibleAfterIntercollege(a));weak.bestTimes={};
  const strong=state.world.filter(a=>a.category==='university'&&a.grade===4&&eligibleAfterIntercollege(a)).map(a=>({id:a.id,name:a.name,pb:{...a.bestTimes}}));
  const leaders=graduatingHighSchoolLeaders(),signed=state.world.find(a=>a.id===leaders[0].id);signed.scouted=true;state.recruits=[signed.id];
  const originalRng=rng,originalAdd=addMiddleSchoolCohort;rng=()=>.999999;
  addMiddleSchoolCohort=()=>{rng=originalRng;originalAdd()};newSeason();addMiddleSchoolCohort=originalAdd;rng=originalRng;
  const errors=[],byId=new Map(activeAthletes().map(a=>[a.id,a])),notice=state.pendingCollegeAdmissions;
  for(const a of strong){const adult=byId.get(a.id);if(!adult||adult.category!=='adult'||adult.name!==a.name||!organizationNames().adult.includes(adult.organization)||EVENTS.some(e=>adult.bestTimes[e]>a.pb[e]+.005))errors.push('graduate '+a.id)}
  const alumni=byId.get(senior.id);if(!alumni?.alumni||alumni.age!==23||seniorBefore!==JSON.stringify([alumni.stats,alumni.bestTimes,alumni.imAptitude]))errors.push('own graduate');
  if(byId.has(weak.id))errors.push('weak graduate');
  if(notice.fromSeason!==2026||notice.toSeason!==2027||notice.rows.length!==leaders.length)errors.push('notice count');
  for(const row of notice.rows){const a=byId.get(row.id),old=leaders.find(a=>a.id===row.id);if(!a||row.to!==a.organization||row.from!==old.from||row.specialtyPB!==old.specialtyPB||JSON.stringify(row.rankedEvents)!==JSON.stringify(old.rankedEvents))errors.push('admission '+row.id)}
  if(!notice.rows.find(a=>a.id===signed.id)?.own||state.players.filter(a=>a.year===1).length!==8)errors.push('own admission');
  const college=buildCpuCollegeEntries('intercollege'),announced=new Set(notice.rows.filter(a=>!a.own).map(a=>a.id));let collegeEntries=0;
  for(const ids of Object.values(college))for(const id of ids)if(announced.has(id)){const a=byId.get(id),row=notice.rows.find(r=>r.id===id);collegeEntries++;if(a.organization!==row.to||!allowedCpu(a,'intercollege'))errors.push('college affiliation')}
  const result=executeMeet('japan_open',{},{});let nationalEntries=0,adultEntries=0;
  for(const [e,field] of Object.entries(result.events)){
   for(const row of field.prelim){const announced=notice.rows.find(a=>a.id===row.athlete.id);if(announced){nationalEntries++;if(row.athlete.organization!==announced.to||row.athlete.category!=='university')errors.push('national affiliation')}if(strong.some(a=>a.id===row.athlete.id)){adultEntries++;if(row.athlete.category!=='adult')errors.push('adult affiliation')}}
   for(const row of notice.rows.filter(a=>!a.own)){const a=byId.get(row.id);if(qualified(a,'japan_open',e)&&!field.prelim.some(r=>r.athlete.id===a.id))errors.push('missing entrant')}
  }
  const protectedData=()=>JSON.stringify([state.pendingCollegeAdmissions,state.players,state.world.map(a=>{const {discovered,...saved}=a;return saved})]);const snapshot=protectedData();state=JSON.parse(JSON.stringify(state));migrateState();
  return{errors,strong:strong.length,leaders:leaders.length,collegeEntries,nationalEntries,adultEntries,stable:snapshot===protectedData()};
 })()`);
 assert.deepEqual(r.errors,[]);assert.ok(r.strong>0&&r.leaders>0&&r.collegeEntries>0&&r.nationalEntries>0&&r.adultEntries>0);assert.ok(r.stable);
});
test('adult retirement starts at 25, reaches 90 percent at 30, and actual retirement preserves records while removing active eligibility',()=>{
 const run=game(true),r=run(`(()=>{
  const rates=Array.from({length:13},(_,i)=>adultRetirementProbability(23+i));
  const highs=state.world.filter(a=>a.category==='high'&&a.grade===3).slice(0,8);highs.forEach(a=>a.scouted=true);state.recruits=highs.map(a=>a.id);state.players=[];
  const template=state.world.find(a=>a.category==='adult'),ages=[23,24,28,29,30];
  const adults=ages.map(age=>({...deepClone(template),id:'retire-'+age,name:'引退検証'+age,age}));
  const alumnus={...deepClone(adults.find(a=>a.age===29)),id:'retire-own',alumni:true,almaMater:state.playerUniversity,graduationSeason:2019};adults.push(alumnus);
  state.alumniCareer=[{id:alumnus.id,status:'社会人継続',season:2019}];state.world=[...highs,...adults];
  state.recordRankings={japan:{fr100:[{athleteId:alumnus.id,name:alumnus.name,time:49.99}]}};state.teamTop10={fr100:[{athleteId:alumnus.id,name:alumnus.name,time:49.99}]};
  const records=JSON.stringify([state.recordRankings,state.teamTop10]);
  for(const key of ['addMiddleSchoolCohort','maintainWorldPopulation','assignInterhigh','prepareCpuMeetPopulation','refreshRecordBook','migrateCpuRaceConsistency'])eval(key+'=()=>{}');
  rng=()=>.85;newSeason();
  return{rates,remaining:state.world.filter(a=>a.id.startsWith('retire-')).map(a=>a.id),career:state.alumniCareer[0].status,archive:state.retiredArchive.some(a=>a.id===alumnus.id),
    records:records===JSON.stringify([state.recordRankings,state.teamTop10]),stillAlumnus:ownAlumniIds().has(alumnus.id),active:activeAthletes().some(a=>a.id===alumnus.id)};
 })()`);
 assert.deepEqual(r.rates,[0,0,.05,.15,.30,.50,.70,.90,.93,.96,.99,.99,.99]);assert.deepEqual(r.remaining,['retire-23','retire-24','retire-28']);assert.equal(r.career,'社会人引退');assert.ok(r.archive&&r.records&&r.stillAlumnus&&!r.active);
});
test('alumni tags distinguish active adult age from record-time school grade and survive retirement and university renaming',()=>{
 const run=game(),r=run(`(()=>{
  state.playerUniversity='改名前';const a={id:'former',name:'卒業泳者',category:'adult',year:4,age:27,alumni:true,almaMater:'改名前',stats:{}};state.world=[a];state.alumniCareer=[{id:a.id,status:'社会人継続'}];state.playerUniversity='改名後';
  const record={athleteId:a.id,name:a.name,schoolCategory:'university',gradeAtRecord:4};
  const current=recordRankingAthleteHtml(record,a,false,ownAlumniIds().has(a.id)),team=top10AthleteName(a.id,a.name);
  state.world=[];state.alumniCareer[0].status='社会人引退';const retired=recordRankingAthleteHtml(record,null,false,ownAlumniIds().has(a.id));
  return{current,team,retired};
 })()`);
 for(const s of [r.current,r.team,r.retired])assert.match(s,/卒業生/);
 assert.match(r.current,/大4/);assert.match(r.current,/現役 27歳/);assert.match(r.team,/現役 27歳/);assert.doesNotMatch(r.retired,/active-athlete/);assert.match(r.retired,/★/);
});
