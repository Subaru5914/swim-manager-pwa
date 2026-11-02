const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(){return vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+`
 state={rngSeed:5914,japanTeam:null,japanTeamHistory:[]};
 return code=>JSON.parse(JSON.stringify(eval(code)))`,['globalThis'])({crypto:{getRandomValues:a=>{a[0]=5914;return a}}})}

test('representative retirement probabilities shift exactly three years, while ordinary rates and late-career retirement remain intact',()=>{
 const r=game()(`(()=>{
  const ages=Array.from({length:25},(_,i)=>20+i);
  return{ordinary:ages.map(age=>adultRetirementProbability(age)),representative:ages.map(age=>adultRetirementProbability(age,true)),reference:ages.map(age=>adultRetirementProbability(age-3)),invalid:[null,undefined,NaN,Infinity,'30'].map(age=>adultRetirementProbability(age,true))};
 })()`);
 assert.deepEqual(r.ordinary.slice(3,16),[0,0,.05,.15,.30,.50,.70,.90,.93,.96,.99,.99,.99]);
 assert.deepEqual(r.representative,r.reference);assert.equal(r.representative[7],0);assert.equal(r.representative[8],.05);assert.equal(r.representative[13],.9);assert.equal(r.representative[16],.99);assert.deepEqual(r.invalid,[0,0,0,0,0]);
});

test('actual individual, relay and additional selections count by ID across old and current teams; candidates and namesakes do not',()=>{
 const r=game()(`(()=>{
  state.japanTeam={year:2029,athletes:[{id:'current',name:'同名'}],individual:{fr100:['individual']},relays:{'4x100fr':['relay']},additionalIndividual:{ba100:['additional']},selectionCandidates:[{id:'candidate',name:'同名'}],selectionFinalists:{fr200:[{id:'finalist'}]},selectionTimes:{fr200:{unselected:110}}};
  state.japanTeamHistory=[{year:2027,athletes:[{id:'past',name:'旧姓'}],individual:{fr100:['current','individual']},relays:{'4x100medley':['relay']},selectionCandidates:[{id:'archive-candidate'}]},
   {year:2025,results:{individual:{fr100:[{athleteId:'record-only',prelim:{time:50}}]},relays:{'4x100fr':{final:{members:[{id:'relay-record-only'}]}}}}}];
  const before=JSON.stringify(state),ids=[...worldRepresentativeAthleteIds()].sort();state=JSON.parse(JSON.stringify(state));
  return{ids,restored:[...worldRepresentativeAthleteIds()].sort(),stable:before===JSON.stringify(state),seed:state.rngSeed};
 })()`);
 assert.deepEqual(r.ids,['additional','current','individual','past','record-only','relay','relay-record-only']);assert.deepEqual(r.ids,r.restored);assert.ok(r.stable);assert.equal(r.seed,5914);
});

test('repeated selections never stack the career extension and missing histories never grant it',()=>{
 const r=game()(`(()=>{
  state.japanTeamHistory=[2027,2029,2031].map(year=>({year,athletes:[{id:'repeat'}],individual:{fr100:['repeat']},relays:{'4x100fr':['repeat']}}));
  const ids=worldRepresentativeAthleteIds(),repeat=adultRetirementProbability(30,ids.has('repeat')),other=adultRetirementProbability(30,ids.has('namesake'));
  state={rngSeed:5914};return{size:ids.size,repeat,other,empty:[...worldRepresentativeAthleteIds()]};
 })()`);
 assert.equal(r.size,1);assert.equal(r.repeat,.3);assert.equal(r.other,.9);assert.deepEqual(r.empty,[]);
});

test('annual retirement extends own alumni and other representatives, preserves draw slots, and still retires older representatives',()=>{
 const run=game(),r=run(`(()=>{
  state=createState();migrateState();
  const highs=state.world.filter(a=>a.category==='high'&&a.grade===3).slice(0,8);highs.forEach(a=>a.scouted=true);state.recruits=highs.map(a=>a.id);state.players=[];
  const template=state.world.find(a=>a.category==='adult');
  const adults=[['young',26],['own',28],['rival',28],['old',32],['ordinary',28],['candidate',28]].map(([id,age])=>({...deepClone(template),id:'career-'+id,name:'同名選手',age}));
  const own=adults.find(a=>a.id==='career-own');Object.assign(own,{alumni:true,almaMater:state.playerUniversity,graduationSeason:2020});
  state.alumniCareer=[{id:own.id,from:state.playerUniversity,season:2020,status:'社会人継続'}];state.world=[...highs,...adults];state.japanTeam=null;
  state.japanTeamHistory=[{year:2027,athletes:[{id:'career-young'},{id:own.id}],individual:{fr100:['career-old']},relays:{'4x100fr':['career-rival']},selectionCandidates:[{id:'career-candidate'}]}];
  const initial=deepClone(state),protectedOwn=JSON.stringify([own.stats,own.bestTimes]);
  for(const key of ['addMiddleSchoolCohort','maintainWorldPopulation','prepareCpuMeetPopulation','refreshRecordBook','refreshRecordRankings','migrateCpuRaceConsistency'])eval(key+'=()=>{}');
  let draws=0;rng=()=>{draws++;return .25};newSeason();
  const first={draws,ids:state.world.filter(a=>a.id.startsWith('career-')).map(a=>a.id),retired:state.pendingSeasonRetirements.rows.map(a=>a.id),career:state.alumniCareer[0].status,intact:protectedOwn===JSON.stringify([state.world.find(a=>a.id===own.id).stats,state.world.find(a=>a.id===own.id).bestTimes])};
  state=deepClone(initial);state.japanTeamHistory=[];draws=0;newSeason();
  return{...first,ordinaryDraws:draws,ordinaryIds:state.world.filter(a=>a.id.startsWith('career-')).map(a=>a.id)};
 })()`);
 assert.deepEqual(r.ids,['career-young','career-own','career-rival']);assert.deepEqual(r.retired.sort(),['career-candidate','career-old','career-ordinary']);assert.equal(r.career,'社会人継続');assert.ok(r.intact);assert.equal(r.draws,r.ordinaryDraws);assert.deepEqual(r.ordinaryIds,[]);
});
