const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(full=false){return vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+`
 state=${full?'createState();migrateState()':"{season:2027,slot:1,rngSeed:5914,cpuCompetitionSeed:5914,playerUniversity:'自大学',players:[],world:[],universities:[{id:'K',name:'関西大学',region:'kansai',reputation:150},{id:'N',name:'全国大学',region:'national',reputation:150}],kansaiIds:['K'],interIds:['K','N'],recruits:[],trainingPlans:{},trainingFocus:{},facilities:{},teamTop10:{},recordBook:{},recordRankings:{},retiredArchive:[],japanTeamHistory:[]}"};
 function swimmer(id,organization='関西大学',clock=107){
  const a=attachMedleyStats({id,name:id,category:'university',grade:1,age:19,organization,specialty:'fr200',stats:Object.fromEntries(STATS.map(k=>[k,k==='start'?105:100])),imAptitude:{speed:0,stamina:0},bestTimes:{fr200:clock},recordedPBs:{fr200:clock},raceHistory:[],accolades:[],growthProfile:{1:1,2:1,3:1,4:1},cpuCompetitionCategory:'high',cpuRaceDistributionCategory:'high',cpuStatCeilings:Object.fromEntries(STATS.map(k=>[k,175]))});
  for(const k of ['fr_speed','fr_stamina','fr_turn'])a.stats[k]=170;
  fitCpuAbility(a,['fr200'],['fr_speed','fr_stamina','fr_turn'],abilityForRaceClock('fr200',clock),200);return a;
 }
 return code=>JSON.parse(JSON.stringify(eval(code)))`,['globalThis'])({crypto:{getRandomValues:a=>{a[0]=5914;return a}}});}

test('only listed enrolled athletes are marked; their reference is national and earned data, school records and RNG remain intact',()=>{
 const r=game()(`(()=>{const a=swimmer('listed'),ordinary=swimmer('ordinary'),own=swimmer('own',state.playerUniversity);own.year=1;delete own.grade;state.players=[own];state.world=[a,ordinary];
  const before=JSON.stringify([state.players.map(p=>[p.stats,p.bestTimes]),state.world.map(p=>[p.stats,p.bestTimes]),state.recordRankings,state.rngSeed]);
  saveCollegeAdmissionsNotice([{id:a.id},{id:own.id},{id:'missing'}],2026);initializeCpuDevelopment();
  const first=JSON.stringify(state);markListedCollegeAdmissions(state.pendingCollegeAdmissions.rows);initializeCpuDevelopment();
  return{listed:a.listedCollegeAdmission,ordinary:ordinary.listedCollegeAdmission??null,own:own.listedCollegeAdmission,rows:state.pendingCollegeAdmissions.rows.map(a=>a.id),national:EVENTS.every(e=>cpuDevelopmentReference(a,e)===cpuRaceReference('university',e)),local:cpuDevelopmentReference(ordinary,'fr100')===CPU_KANSAI_RACE_REFERENCE.fr100,kept:before===JSON.stringify([state.players.map(p=>[p.stats,p.bestTimes]),state.world.map(p=>[p.stats,p.bestTimes]),state.recordRankings,state.rngSeed]),stable:first===JSON.stringify(state)};
 })()`);
 assert.deepEqual(r.listed,{version:1,season:2027});assert.deepEqual(r.own,r.listed);assert.equal(r.ordinary,null);assert.deepEqual(r.rows,['listed','own']);assert.ok(r.national&&r.local&&r.kept&&r.stable);
});

test('a nationally strong listed freshman grows through practice after a Kansai ceiling previously held him, without an instant ability or PB change',()=>{
 const r=game()(`(()=>{const a=swimmer('candidate'),ordinary=swimmer('ordinary');state.world=[a,ordinary];ensureCpuDevelopment(a);ensureCpuDevelopment(ordinary);
  const base=expectedTime(a,'fr200'),pb=JSON.stringify(a.bestTimes),protectedData=JSON.stringify([a.stats,a.bestTimes,state.rngSeed]);
  markListedCollegeAdmissions([{id:a.id}]);ensureCpuDevelopment(a);const kept=protectedData===JSON.stringify([a.stats,a.bestTimes,state.rngSeed]),goals=[...a.cpuDevelopment.goals],floors=[...a.cpuDevelopment.floors];
  for(let turn=0;turn<96;turn++){state.rngSeed=5914+turn;applyCpuTraining(a);state.rngSeed=5914+turn;applyCpuTraining(ordinary)}
  const before=JSON.stringify(a);ensureCpuDevelopment(a);return{base,after:expectedTime(a,'fr200'),ordinary:expectedTime(ordinary,'fr200'),kept,pb:pb===JSON.stringify(a.bestTimes),goals:JSON.stringify(goals)===JSON.stringify(a.cpuDevelopment.goals),floors:JSON.stringify(floors)===JSON.stringify(a.cpuDevelopment.floors),within:EVENTS.every((e,i)=>expectedTime(a,e)>=floors[i]-.006)&&STATS.every((k,i)=>a.stats[k]<=goals[i]+.005),stable:before===JSON.stringify(a)};
 })()`);
 assert.ok(r.kept&&r.pb&&r.goals&&r.floors&&r.within&&r.stable);assert.ok(r.after<r.base-.02,JSON.stringify(r));assert.equal(r.ordinary,r.base);
});

test('listed status applies below national qualification too, keeps faster existing goals, renews on promotion once and expires for adult training',()=>{
 const r=game()(`(()=>{const a=swimmer('listed','関西大学',145);state.world=[a];ensureCpuDevelopment(a);a.cpuDevelopment.goals=STATS.map(k=>Math.min(200,a.stats[k]+10));a.cpuDevelopment.floors=EVENTS.map(e=>expectedTime(a,e)*.95);
  const old=deepClone(a.cpuDevelopment),before=JSON.stringify([a.stats,a.bestTimes,state.rngSeed]);markListedCollegeAdmissions([{id:a.id}]);ensureCpuDevelopment(a);
  const retained=old.goals.every((g,i)=>a.cpuDevelopment.goals[i]>=g)&&old.floors.every((f,i)=>a.cpuDevelopment.floors[i]<=f),first=JSON.stringify(a);ensureCpuDevelopment(a);
  const once=first===JSON.stringify(a);a.grade=2;ensureCpuDevelopment(a);const stage=a.cpuDevelopment.listedAdmissionStage,second=JSON.stringify(a);ensureCpuDevelopment(a);
  const renewed=second===JSON.stringify(a);a.category='adult';a.grade=null;a.age=23;ensureCpuDevelopment(a);
  return{retained,once,stage,renewed,kept:before===JSON.stringify([a.stats,a.bestTimes,state.rngSeed]),adult:usesListedCollegeDevelopment(a),reference:cpuDevelopmentReference(a,'fr200')===cpuNonCollegeReference('adult','fr200')};
 })()`);
 assert.ok(r.retained&&r.once&&r.renewed&&r.kept&&r.reference);assert.equal(r.stage,2);assert.equal(r.adult,false);
});

test('regional relay bounds preserve listed personal headroom while still enforcing the national fastest relay bound',()=>{
 const r=game()(`(()=>{const roster=Array.from({length:4},(_,i)=>swimmer('relay-'+i,'関西大学',110));state.world=roster;markListedCollegeAdmissions(roster.map(a=>({id:a.id})));roster.forEach(ensureCpuDevelopment);
  for(const a of roster){a.cpuDevelopment.goals=STATS.map(k=>Math.min(200,a.stats[k]+10));a.cpuDevelopment.floors=EVENTS.map(e=>Math.min(expectedTime(a,e),cpuRaceReference('university',e)[0]*.995))}
  const before=JSON.stringify(roster.map(a=>[a.stats,a.bestTimes])),seed=state.rngSeed,raw=roster.map(cpuDevelopmentProjection),projectedBefore=expectedRelayTime(bestRelayMembers(raw,'4x200fr'),'4x200fr');
  boundCpuDevelopmentRelays();const projected=roster.map(cpuDevelopmentProjection),time=expectedRelayTime(bestRelayMembers(projected,'4x200fr'),'4x200fr'),national=CPU_COLLEGE_RELAY_REFERENCE.national['4x200fr'][0]*.995-.4,regional=CPU_COLLEGE_RELAY_REFERENCE.kansai['4x200fr'][0]*.995-.4;
  return{projectedBefore,time,national,regional,kept:before===JSON.stringify(roster.map(a=>[a.stats,a.bestTimes]))&&seed===state.rngSeed,growth:projected.some((a,i)=>expectedTime(a,'fr200')<expectedTime(roster[i],'fr200')-.01)};
 })()`);
 assert.ok(r.kept&&r.growth);assert.ok(r.time>=r.national-.04,JSON.stringify(r));assert.ok(r.time<r.regional-1,JSON.stringify(r));
});

test('actual April admissions mark exactly the listed students and retain the marker through destination edits, confirmation, reload and the second grade',()=>{
 const r=game(true)(`(()=>{newSeason();const notice=state.pendingCollegeAdmissions,listed=new Set(notice.rows.map(a=>a.id)),all=[...state.players,...state.world.filter(a=>a.category==='university')];
  const exact=all.every(a=>!!a.listedCollegeAdmission===listed.has(a.id)),own=state.players.find(a=>listed.has(a.id));state.scoutingAdmissionsMode='free';const context=collegeAdmissionContext(),target=context.universities.find(u=>u.id!=='player'&&context.counts.get(u.id)<8);
  let bounds=0;const originalBounds=boundCpuDevelopmentRelays;boundCpuDevelopmentRelays=()=>{bounds++;return originalBounds()};
  const protectedData=JSON.stringify([own.stats,own.bestTimes,state.rngSeed]),choice=setCollegeAdmissionChoice(own.id,target.id),applied=applyCollegeAdmissionChoices(),moved=state.world.find(a=>a.id===own.id);boundCpuDevelopmentRelays=originalBounds;
  const preserved=protectedData===JSON.stringify([moved.stats,moved.bestTimes,state.rngSeed]),movedFlag=deepClone(moved.listedCollegeAdmission),cleared=!state.pendingCollegeAdmissions;
  const saved=JSON.stringify(state),signature=()=>JSON.stringify([state.players,state.world,state.rngSeed,state.recordRankings,state.teamTop10]),before=signature();state=JSON.parse(saved);migrateState();const stable=before===signature();
  const a=state.world.find(a=>a.id===own.id);a.grade=2;const stats=JSON.stringify([a.stats,a.bestTimes]);ensureCpuDevelopment(a);
  return{exact,choice:choice.ok,applied:applied.ok,preserved,movedFlag,cleared,stable,stage:a.cpuDevelopment.listedAdmissionStage,promoted:stats===JSON.stringify([a.stats,a.bestTimes]),listed:listed.size,bounds};
 })()`);
 assert.ok(r.listed>20&&r.exact&&r.choice&&r.applied&&r.preserved&&r.cleared&&r.stable&&r.promoted&&r.bounds>0,JSON.stringify(r));assert.deepEqual(r.movedFlag,{version:1,season:2027});assert.equal(r.stage,2);
});

test('a saved pending admissions list restores only its identifiable flags, and a CPU-to-player conversion retains that evidence',()=>{
 const r=game(true)(`(()=>{newSeason();const ids=new Set(state.pendingCollegeAdmissions.rows.map(a=>a.id));for(const a of [...state.players,...state.world])delete a.listedCollegeAdmission;
  const digest=()=>JSON.stringify([state.players.map(a=>[a.id,a.stats,a.bestTimes]),state.world.map(a=>[a.id,a.stats,a.bestTimes]),state.recordRankings,state.teamTop10,state.rngSeed]),before=digest();migrateState();
  const kept=before===digest(),cpu=state.world.find(a=>ids.has(a.id)&&a.category==='university'),player=worldToPlayer(cpu),flag=deepClone(cpu.listedCollegeAdmission),once=JSON.stringify(state);migrateState();
  return{kept,flag,player:player.listedCollegeAdmission,exact:[...state.players,...state.world.filter(a=>a.category==='university')].every(a=>!!a.listedCollegeAdmission===ids.has(a.id)),stable:once===JSON.stringify(state)};
 })()`);
 assert.ok(r.kept&&r.exact&&r.stable);assert.deepEqual(r.flag,{version:1,season:2027});assert.deepEqual(r.player,r.flag);
});
