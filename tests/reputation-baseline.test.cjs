const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const load=vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+`
 state={season:2026,reputation:50,reputationScaleVersion:2,participationModelVersion:2,cpuUniversityRepModelVersion:3,collegeReputationBaselineVersion:2,
  playerUniversity:'自大学',players:[],world:[],universities:[{id:'local',name:'関西大学',region:'kansai',strength:80,baseReputation:460,reputation:490},{id:'other',name:'全国大学',region:'national',strength:80,baseReputation:250,reputation:250}],
  meetParticipationHistory:[],reputationEvaluations:[],completedMeetKeys:[],pendingSeasonNotices:[],rngSeed:5914};
 function attendance(season,meet,counts,individualOnly=true){return {season,meet,counts,individualOnly}}
 awardMeetGrowth=()=>null;
 return code=>JSON.parse(JSON.stringify(eval(code)))`,[]);
function game(){return load()}

test('expanded reputation boundaries, reset value and effect scale remain consistent at every tier',()=>{
 const r=game()(`(()=>{
  const points=[0,49.99,50,149.99,150,299.99,300,499.99,500,1000];
  const samples=[0,15,30,35,79.99,80,159.99,160,279.99,280,355,500,600];
  return {labels:points.map(reputationLabel),budgets:points.map(scoutingBudget),initial:INITIAL_TEAM_REPUTATION,
   converted:samples.map(expandedReputation),roundTrips:samples.map(v=>reputationStrengthValue(expandedReputation(v))-v),
   limits:[expandedReputation(-1),expandedReputation(700)],bonuses:[scoutReputationBonus(149.99,1),scoutReputationBonus(150,1),scoutReputationBonus(843.75,1)]};
 })()`);
 assert.deepEqual(r.labels,['弱小','弱小','発展途上','発展途上','中堅','中堅','強豪','強豪','名門','名門']);
 assert.deepEqual(r.budgets,[30,30,40,40,60,60,80,80,100,100]);assert.equal(r.initial,50);
 assert.deepEqual(r.converted.slice(0,4),[0,25,50,60]);assert.deepEqual(r.limits,[0,1000]);
 assert.ok(r.roundTrips.every(v=>Math.abs(v)<.004));assert.equal(r.bonuses[0],0);assert.equal(r.bonuses[1],.02);assert.ok(Math.abs(r.bonuses[2]-.48)<1e-12);
});

test('individual participants count once across strokes and rounds, with no relay-only or adult entrants',()=>{
 const r=game()(`(()=>{
  const own={id:'own',organization:state.playerUniversity},ownRelay={id:'own-relay'},cpu={id:'cpu',category:'university',organization:'関西大学'},cpuRelay={id:'cpu-relay',category:'university',organization:'関西大学'},adult={id:'adult',category:'adult',organization:'関西大学'};
  const result={events:{fr100:{prelim:[{source:'PLAYER',athlete:own},{source:'CPU',athlete:cpu},{source:'CPU',athlete:adult}],final:[{source:'PLAYER',athlete:own}]},ba100:{prelim:[{source:'CPU',athlete:cpu}],final:[]}},
   relays:[['4x100fr',[{organization:state.playerUniversity,members:[own,ownRelay]}],{prelim:[{organization:'関西大学',members:[cpu,cpuRelay]}]}]]};
  const before=JSON.stringify([state,result]),counts=meetParticipationCounts(result),unchanged=before===JSON.stringify([state,result]);
  result.relays=[];return {counts,same:JSON.stringify(counts)===JSON.stringify(meetParticipationCounts(result)),unchanged};
 })()`);
 assert.deepEqual(r.counts,{player:1,local:1,other:0});assert.ok(r.same&&r.unchanged);
});

test('only own first-year college attendance uses zero; CPU first records and missing individual baselines stay neutral',()=>{
 const r=game()(`(()=>{
  for(const meet of Object.keys(REPUTATION_WEIGHTS))state.meetParticipationHistory.push(attendance(2026,meet,{player:3,local:4,other:4}));
  const own=Object.keys(REPUTATION_WEIGHTS).map(meet=>reputationComparison(2026,meet,'player'));
  const cpu=Object.keys(REPUTATION_WEIGHTS).map(meet=>reputationComparison(2026,meet,'local'));
  state.meetParticipationHistory.push(attendance(2027,'intercollege',{player:2,local:3}));
  return {own,cpu,second:reputationComparison(2027,'intercollege','local'),unrecorded:reputationComparison(2028,'japan_open','player')};
 })()`);
 assert.deepEqual(r.own.map(r=>r.previous),[0,0,null,null]);assert.deepEqual(r.own.map(r=>r.delta),[6,24,0,0]);
 assert.ok(r.cpu.every(r=>r.previous===null&&r.delta===0));assert.equal(r.second.delta,-8);assert.equal(r.unrecorded.delta,0);
});

test('both checkpoints apply the same reduced weights to own and CPU teams, excluding non-Kansai regional attendance',()=>{
 const r=game()(`(()=>{
  state.season=2027;state.reputation=490;
  for(const [meet,previous,current]of [['kansai_college',5,5],['intercollege',8,11],['japan_open',3,4],['japan_championship',2,1]]){
   state.meetParticipationHistory.push(attendance(2026,meet,{player:previous,local:previous,other:previous}),attendance(2027,meet,{player:current,local:current,other:current}));
  }
  const early=settleUniversityReputations(2027,'kansai_college');
  const inter=settleUniversityReputations(2027,'intercollege'),national=settleUniversityReputations(2027,'japan_championship');
  const before=JSON.stringify(state),again=settleUniversityReputations(2027,'japan_championship'),stable=before===JSON.stringify(state);
  state.meetParticipationHistory.find(r=>r.season===2027&&r.meet==='kansai_college').counts.other=32;
  return {early,inter,national,again,stable,
   own:state.reputation,cpu:state.universities.map(u=>u.reputation),label:reputationLabel(state.reputation),excluded:reputationComparison(2027,'kansai_college','other')};
 })()`);
 assert.equal(r.early,null);assert.equal(r.inter.delta,24);assert.equal(r.national.delta,-6);assert.equal(r.own,508);assert.equal(r.label,'名門');
 assert.deepEqual(r.cpu,[508,268]);assert.equal(r.again,null);assert.ok(r.stable);assert.equal(r.excluded.delta,0);assert.equal(r.excluded.eligible,false);
});

test('CPU fixed initial bases bound decades of participation changes and survive renaming without promoting every school',()=>{
 const r=game()(`(()=>{
  const u=state.universities[1],base=u.baseReputation;
  const limits=[boundedCpuReputation(u,-999),boundedCpuReputation(u,9999)];
  for(let year=2027;year<2067;year++){
   state.meetParticipationHistory.push(attendance(year-1,'intercollege',{other:year%2?0:32}),attendance(year,'intercollege',{other:year%2?32:0}));
   settleUniversityReputations(year,'intercollege');
   state.meetParticipationHistory=state.meetParticipationHistory.filter(r=>r.season>year-1);
  }
  u.name='改名大学';return{limits,base:u.baseReputation,initial:base,current:u.reputation,label:reputationLabel(u.reputation),edge:[boundedCpuReputation({baseReputation:20},-999),boundedCpuReputation({baseReputation:980},9999)]};
 })()`);
 assert.deepEqual(r.limits,[150,350]);assert.equal(r.base,r.initial);assert.ok(r.current>=150&&r.current<=350);assert.notEqual(r.label,'名門');assert.deepEqual(r.edge,[0,1000]);
});

test('legacy scales and unread notices convert once while earned data, ordering, RNG and historical evaluations stay intact',()=>{
 const r=game()(`(()=>{
  delete state.reputationScaleVersion;state.reputation=179;state.participationModelVersion=1;
  state.universities=[30,80,160,280,355].map((reputation,i)=>({id:'u'+i,name:'大学'+i,strength:80,baseReputation:reputation,reputation:reputation+10}));
  state.players=[{id:'own',stats:{mental:192.75,fr_speed:121},bestTimes:{fr200:125}}];state.world=[{id:'cpu',stats:{mental:7.25},bestTimes:{fr100:51}}];
  state.reputationEvaluations=[{season:2026,meet:'intercollege',before:79,reputation:89,delta:10,comparisons:[{meet:'intercollege',previous:0,current:1,delta:10}]}];
  state.pendingSeasonNotices=[{evaluation:{before:79,reputation:89,delta:10},retired:[]}];
  const earned=JSON.stringify([state.players,state.world,state.rngSeed]),history=JSON.stringify(state.reputationEvaluations[0].comparisons);
  initializeReputationHistory();migrateUniversityReputationScale();const first=JSON.stringify(state);initializeReputationHistory();migrateUniversityReputationScale();
  return {rep:state.reputation,label:reputationLabel(state.reputation),points:state.universities.map(u=>u.reputation),bases:state.universities.map(u=>u.baseReputation),
   stable:first===JSON.stringify(state),earned:earned===JSON.stringify([state.players,state.world,state.rngSeed]),history:history===JSON.stringify(state.reputationEvaluations[0].comparisons),
   historical:state.reputationEvaluations[0],notice:state.pendingSeasonNotices[0].evaluation};
 })()`);
 assert.equal(r.rep,331.67);assert.equal(r.label,'強豪');assert.ok(r.stable&&r.earned&&r.history);assert.ok(r.points.every((v,i,a)=>!i||v>a[i-1]));
 assert.deepEqual(r.bases.slice(0,4),[50,150,300,500]);assert.equal(r.historical.reputationScaleVersion,1);assert.equal(r.historical.reputation,89);
 assert.equal(r.notice.before,148);assert.equal(r.notice.reputation,166.88);assert.equal(r.notice.delta,18.88);
});

test('relay-inclusive legacy histories and pending checkpoints never cause false penalties; next clean year becomes a baseline',()=>{
 const r=game()(`(()=>{
  state.participationModelVersion=1;state.season=2028;state.reputation=310;
  state.meetParticipationHistory=[attendance(2027,'japan_open',{player:10,local:12},false),attendance(2027,'japan_championship',{player:10,local:12},false)];
  initializeReputationHistory();
  completeMeet({meet:'japan_open',season:2028,events:{},relays:[],participationCounts:{player:10,local:12}});
  completeMeet({meet:'japan_championship',season:2028,events:{},relays:[],participationCounts:{player:10,local:12}});
  const legacy=state.reputation,firstFlags=state.meetParticipationHistory.filter(r=>r.season===2028).map(r=>r.individualOnly);
  const run=(season,count)=>{for(const meet of ['japan_open','japan_championship'])completeMeet({meet,season,events:{},relays:[],participationCounts:{player:count,local:count},participationModelVersion:2})};
  run(2029,3);const baseline=state.reputation;run(2030,4);const earned=state.reputation;
  state=JSON.parse(JSON.stringify(state));const first=JSON.stringify(state);initializeReputationHistory();migrateUniversityReputationScale();
  return{legacy,firstFlags,baseline,earned,stable:first===JSON.stringify(state),history:state.meetParticipationHistory.filter(r=>r.season>=2029).every(r=>r.individualOnly)};
 })()`);
 assert.equal(r.legacy,310);assert.deepEqual(r.firstFlags,[false,false]);assert.equal(r.baseline,310);assert.equal(r.earned,340);assert.ok(r.stable&&r.history);
});
