const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test'),SaveHistory=require('../save-history.js');
const repo=path.join(__dirname,'..'),html=fs.readFileSync(path.join(repo,'index.html'),'utf8');
function game(input=html){
  const source=input.match(/<script>([\s\S]*?)<\/script>/)[1];
  return vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+`
    function own(i,year=2){return attachMedleyStats({id:'own-'+i,name:'表彰選手'+i,category:'university',year,age:18+year,organization:state.playerUniversity,specialty:'fr100',stats:Object.fromEntries(STATS.map(k=>[k,120])),imAptitude:{speed:0,stamina:0},bestTimes:{fr100:65},raceHistory:[],accolades:[]})}
    return code=>JSON.parse(JSON.stringify(eval(code)))`,['globalThis','SaveHistory'])({crypto:{getRandomValues:a=>{a[0]=5914;return a}}},SaveHistory);
}
function minimal(){const run=game();run(`state={season:2026,slot:43,rngSeed:5914,playerUniversity:'自大学',players:[],world:[],retiredArchive:[],japanTeamHistory:[],teamTop10:{},recordRankings:{},recordBook:{},trainingPlans:{},trainingFocus:{},lastTrainingGains:[],teamPodiumHistory:[],teamPodiumHistoryVersion:1};true`);return run}
test('major-meet medals include only own actual A-final podiums and corrected places, without changing athletes or race RNG',()=>{
  const run=minimal(),r=run(`(()=>{
    const p=own(0),cpu={...own(1),organization:'他大学'},adult={...own(2),year:null,category:'adult',alumni:true,organization:'社会人'};state.players=[p];state.world=[cpu,adult];
    const protectedData=JSON.stringify([...state.players,...state.world].map(a=>[a.stats,a.bestTimes,a.raceHistory]).concat(state.rngSeed));
    for(const meet of TEAM_PODIUM_MEETS)recordAthleteMainResult(p,{season:2026,slot:43,meet,event:'fr100',stage:'A決勝',rank:2,time:60});
    for(const [meet,stage,rank]of [['team_trial','決勝',1],['joint_record','決勝',1],['intercollege','予選',1],['intercollege','B決勝',1],['intercollege','A決勝',4]])recordAthleteMainResult(p,{season:2026,slot:43,meet,event:'ba100',stage,rank,time:65});
    for(const a of [cpu,adult])recordAthleteMainResult(a,{season:2026,slot:43,meet:'japan_open',event:'br100',stage:'決勝',rank:1,time:70});
    const first=deepClone(state.teamPodiumHistory);
    recordAthleteMainResult(p,{season:2026,slot:43,meet:'intercollege',event:'fr100',stage:'決勝',rank:1,time:59});
    const corrected=state.teamPodiumHistory.find(r=>r.meet==='intercollege');
    recordAthleteMainResult(p,{season:2026,slot:43,meet:'japan_open',event:'fr100',stage:'決勝',rank:4,time:61});
    return{first,corrected,remaining:state.teamPodiumHistory,protected:protectedData===JSON.stringify([...state.players,...state.world].map(a=>[a.stats,a.bestTimes,a.raceHistory]).concat(state.rngSeed))};
  })()`);
  assert.equal(r.first.length,6);assert.ok(r.first.every(x=>x.athleteId==='own-0'&&x.rank===2&&x.gradeAtRecord===2));assert.equal(r.corrected.rank,1);assert.equal(r.corrected.time,59);assert.equal(r.remaining.length,5);assert.ok(!r.remaining.some(x=>x.meet==='japan_open'));assert.ok(r.protected);
});
test('relay medals save one result with the actual final lineup, each lap and frozen grades; prelims and CPU teams do not add medals',()=>{
  const run=minimal(),r=run(`(()=>{
    state.players=Array.from({length:6},(_,i)=>own(i,i%4+1));
    for(const event of RELAYS){
      recordRelayResult(event,{organization:state.playerUniversity,members:state.players.slice(0,4),prelimRank:1,race:{total:210,legs:[50,51,54,55]}},'intercollege','予選');
      const team={organization:state.playerUniversity,members:state.players.slice(2,6),rank:3,race:{total:200,legs:[49,50,50,51]}};
      recordRelayResult(event,team,'intercollege','A決勝');recordRelayResult(event,team,'intercollege','A決勝');
      recordRelayResult(event,{...team,organization:'他大学',members:team.members.map(a=>({...a,id:'cpu-'+a.id}))},'intercollege','決勝');
    }
    const first=deepClone(state.teamPodiumHistory);state.season++;state.players.forEach(a=>a.year++);
    const copy=JSON.stringify(state.teamPodiumHistory);state=JSON.parse(JSON.stringify(state));initializeTeamPodiumHistory();
    return{first,stable:copy===JSON.stringify(state.teamPodiumHistory)};
  })()`);
  assert.equal(r.first.length,3);assert.ok(r.stable);for(const row of r.first){assert.equal(row.rank,3);assert.equal(row.time,200);assert.deepEqual(row.members.map(a=>a.id),['own-2','own-3','own-4','own-5']);assert.deepEqual(row.members.map(a=>a.gradeAtRecord),[3,4,1,2]);assert.deepEqual(row.legs,[49,50,50,51]);assert.ok(row.members.every(a=>a.own))}
});
test('representative medals distinguish own swimmers from other universities and alumni, and use only the final relay members',()=>{
  const run=minimal(),r=run(`(()=>{
    const p=own(0),other={...own(1),id:'cpu',organization:'他大学'},alumni={...own(2),year:null,category:'adult',alumni:true,organization:'社会人'};state.players=[p];state.world=[other,alumni];
    state.japanTeam={year:2026,selectedSeason:2026,athletes:[{id:p.id,ownAtSelection:true,snapshot:deepClone(p)},{id:other.id,ownAtSelection:false,snapshot:other},{id:alumni.id,ownAtSelection:false,snapshot:alumni}]};
    for(const a of state.japanTeam.athletes.map(a=>a.snapshot))recordAthleteMainResult(a,{season:2026,slot:36,meet:'world_championship',event:'fr100',stage:'決勝',rank:2,time:48});
    const members=[p,other,alumni,{...other,id:'cpu-2'}],team={organization:'日本',members,rank:1,race:{total:190,legs:[47,48,48,47]}};
    recordRelayResult('4x100fr',team,'world_championship','決勝');const first=deepClone(state.teamPodiumHistory);
    recordRelayResult('4x100fr',{...team,members:members.map(a=>a.id===p.id?{...other,id:'cpu-3'}:a)},'world_championship','決勝');
    return{first,remaining:state.teamPodiumHistory};
  })()`);
  assert.equal(r.first.length,2);assert.equal(r.first[0].athleteId,'own-0');assert.deepEqual(r.first[1].members.filter(a=>a.own).map(a=>a.id),['own-0']);assert.equal(r.remaining.length,1);
});
test('legacy migration restores current, graduated, deleted and national medalists without fabricating prelim medals or missing relay swimmers',()=>{
  const run=minimal(),r=run(`(()=>{
    delete state.teamPodiumHistoryVersion;state.season=2028;const p=own(0,3),alumni={...own(1),year:null,category:'adult',grade:null,age:24,alumni:true,graduationSeason:2026,organization:'社会人'},retired={id:'deleted',name:'引退選手',organization:state.playerUniversity,season:2026,age:22,bestTimes:{},accolades:[],raceHistory:[]};
    const medal={season:2026,slot:43,meet:'intercollege',stage:'A決勝',rank:1,time:60,schoolCategory:'university',gradeAtRecord:1};
    p.raceHistory=[{...medal,event:'im200',rank:4},{...medal,event:'fr100'},{...medal,event:'ba100',stage:'予選'},{...medal,event:'br100',stage:'B決勝'},{...medal,event:'fly100',schoolCategory:'high',gradeAtRecord:3}];
    alumni.accolades=[{...medal,event:'br100',kind:'podium',gradeAtRecord:4},{...medal,event:'ba100',kind:'podium',schoolCategory:'adult',gradeAtRecord:null}];
    retired.raceHistory=[{...medal,event:'4x100fr',time:200,gradeAtRecord:4,legIndex:2,legEvent:'fr100',lapTime:50}];
    state.players=[p];state.world=[alumni];state.retiredArchive=[retired];state.recordRankings={university:{'4x200fr':[{...medal,event:'4x200fr',kind:'relay',time:450,organization:state.playerUniversity,members:Array.from({length:4},(_,i)=>({id:'gone-'+i,name:'全員削除'+i,schoolCategory:'university',gradeAtRecord:i+1})),legs:[110,111,112,117]}]}};
    state.meetHistory=[{season:2025,slot:26,meet:'kansai_college',podiums:{fr100:[{name:'データ削除済み',organization:state.playerUniversity,rank:3,time:60},{name:'CPU',organization:'他大学',rank:1,time:50}]}},{season:2026,slot:43,meet:'intercollege',podiums:{fr100:[{name:p.name,organization:state.playerUniversity,rank:1,time:60}],im200:[{name:p.name,organization:state.playerUniversity,rank:1,time:60}]}}];
    state.japanTeamHistory=[{year:2027,worldSeason:2027,worldSlot:36,athletes:[{id:'old-own',name:'過去代表',own:true},{id:'old-cpu',name:'他大学代表',own:false}],results:{individual:{fr100:[{athleteId:'old-own',final:{rank:2,time:48}},{athleteId:'old-cpu',final:{rank:1,time:47}}]},relays:{'4x100medley':{final:{rank:3,time:210,members:[{id:'old-own',name:'過去代表',own:true,schoolCategory:'university',gradeAtRecord:3},{id:'old-cpu',name:'他大学代表',own:false}],legs:[52,58]}}}}}];
    const before=JSON.stringify([state.players,state.world,state.retiredArchive,state.meetHistory,state.japanTeamHistory,state.rngSeed]);initializeTeamPodiumHistory();const first=JSON.stringify(state);initializeTeamPodiumHistory();
    return{rows:state.teamPodiumHistory,stable:first===JSON.stringify(state),protected:before===JSON.stringify([state.players,state.world,state.retiredArchive,state.meetHistory,state.japanTeamHistory,state.rngSeed])};
  })()`);
  assert.ok(r.stable&&r.protected);assert.equal(r.rows.length,7);const orphan=r.rows.find(a=>a.event==='4x200fr');assert.deepEqual(orphan.members.map(a=>a.id),['gone-0','gone-1','gone-2','gone-3']);assert.deepEqual(orphan.legs,[110,111,112,117]);assert.ok(!r.rows.some(a=>a.event==='fly100'||a.event==='ba100'||a.event==='im200'));assert.equal(r.rows.find(a=>a.athleteId==='own-1').gradeAtRecord,4);const relay=r.rows.find(a=>a.event==='4x100fr');assert.deepEqual(relay.members.map(a=>a.id),['deleted']);assert.equal(relay.members[0].legIndex,2);assert.equal(relay.legs[2],50);assert.equal(r.rows.find(a=>a.name==='データ削除済み').gradeAtRecord,null);assert.ok(!r.rows.some(a=>a.name==='他大学代表'&&a.kind==='individual'));
});
test('team medals survive actual senior deletion, capacity cleanup and save reload even when all source histories are gone',()=>{
  const run=minimal(),r=run(`(()=>{
    const p=own(0,4);state.players=[p];updateResultHistory(p,'fr100',66,'kansai_college','決勝',1);const first=deepClone(state.teamPodiumHistory);
    const retired=retireIneligibleSeniors();state.season=2035;state.meetHistory=[{season:2026,slot:26,meet:'kansai_college',podiums:{}}];state.recordRankings={};state.teamTop10={};
    const plan=SaveHistory.plan(state,{triggerBytes:1,targetBytes:1});plan.apply(state);state=JSON.parse(JSON.stringify(state));initializeTeamPodiumHistory();const saved=JSON.stringify(state);initializeTeamPodiumHistory();
    return{first,retired,removed:plan.removed,sourceGone:!state.players.length&&!state.retiredArchive.length&&!state.meetHistory.length,rows:state.teamPodiumHistory,stable:saved===JSON.stringify(state)};
  })()`);
  assert.equal(r.retired.length,1);assert.ok(r.removed>0&&r.sourceGone&&r.stable);assert.deepEqual(r.rows,r.first);assert.equal(r.rows[0].gradeAtRecord,4);
});
test('2030 rival medals remain on rival profiles without entering the own-team podium history',()=>{
 const r=minimal()(`(()=>{
  state.season=2030;const p=own(0),cpu={...own(1),id:'rival-2030',organization:'他大学',year:null,grade:2};state.players=[p];state.world=[cpu];
  for(const [i,meet]of RIVAL_PODIUM_MEETS.entries()){
   recordAthleteMainResult(p,{season:2030,slot:43,meet,event:EVENTS[i],stage:'A決勝',rank:2,time:55});
   recordAthleteMainResult(cpu,{season:2030,slot:43,meet,event:EVENTS[i],stage:'A決勝',rank:1,time:54});
  }
  return{own:state.teamPodiumHistory,rival:rivalMainResults(cpu)};
 })()`);
 assert.equal(r.own.length,4);assert.ok(r.own.every(row=>row.athleteId==='own-0'));assert.equal(r.rival.length,4);
});

test('existing mixed 2030 podium saves remove identifiable rivals across careers while keeping deleted own medalists and all underlying results',()=>{
 const r=minimal()(`(()=>{
  state.season=2034;const p=own(0),namesake={...own(1),id:'rival-live',name:p.name,organization:'他大学'},adult={...own(2),id:'rival-adult',category:'adult',year:null,organization:'社会人',almaMater:'他大学'},alumni={...own(3),year:null,category:'adult',alumni:true,organization:'社会人'};
  state.players=[p];state.world=[namesake,adult,alumni];state.retiredArchive=[{id:'own-retired',name:'引退済み自チーム',organization:'社会人'}];state.alumniCareer=[{id:'own-graduate',from:state.playerUniversity}];
  const medal=(athleteId,name=athleteId,extra={})=>({kind:'individual',season:2030,slot:43,meet:'intercollege',event:'fr100',stage:'決勝',rank:2,time:55,schoolCategory:'university',gradeAtRecord:2,athleteId,name,...extra});
  state.teamPodiumHistory=[medal(p.id,p.name),medal(namesake.id,namesake.name),medal(adult.id),medal(alumni.id),medal('rival-deleted'),medal('rival-record-book'),medal('own-retired'),medal('own-graduate'),medal('own-deleted-all-sources'),medal(null,'古い自チームの匿名成績'),medal('world-rival','他大学代表',{meet:'world_championship'}),medal('world-own','過去の自チーム代表',{meet:'world_championship'})];
  state.meetHistory=[{season:2030,meet:'intercollege',podiums:{fr100:[{athleteId:'rival-deleted',name:'引退済み他大学',organization:'他大学',rank:2,time:55}]}}];
  state.recordRankings={university:{fr100:[{athleteId:'rival-record-book',name:'他大学記録',organization:'他大学',season:2030,meet:'intercollege',event:'fr100',stage:'決勝',rank:2,time:55}]}};
  state.japanTeamHistory=[{year:2030,worldSeason:2030,athletes:[{id:'world-rival',own:false},{id:'world-own',own:true}]}];
  state.teamTop10={fr100:[{athleteId:namesake.id,meet:'initial_pb'}],'4x100fr':[{kind:'relay',meet:'world_championship',members:[{id:p.id},{id:namesake.id}]}]};
  const protectedData=JSON.stringify([state.players,state.world,state.retiredArchive,state.meetHistory,state.recordRankings,state.alumniCareer,state.japanTeamHistory,state.rngSeed]);
  initializeTeamPodiumHistory();const first=JSON.stringify(state);initializeTeamPodiumHistory();
  return{ids:state.teamPodiumHistory.map(row=>row.athleteId),stable:first===JSON.stringify(state),version:state.teamPodiumHistoryVersion,protected:protectedData===JSON.stringify([state.players,state.world,state.retiredArchive,state.meetHistory,state.recordRankings,state.alumniCareer,state.japanTeamHistory,state.rngSeed])};
 })()`);
 assert.deepEqual(r.ids,['own-0','own-3','own-retired','own-graduate','own-deleted-all-sources',null,'world-own']);assert.ok(r.stable&&r.protected);assert.equal(r.version,2);
});

test('podium ownership migration and reset preserve current abilities, PBs, training settings and the next race draw',()=>{
  const run=game(),before=run('(state=createState(),migrateState(),deepClone(state))');before.teamPodiumHistoryVersion=1;before.version='pwa-previous-release';
  run('state='+JSON.stringify(before)+';migrateState();true');
  const after=run('deepClone(state)');for(const [key,value]of Object.entries(before))if(!['version','teamPodiumHistoryVersion'].includes(key))assert.deepEqual(after[key],value,key);
  assert.equal(after.teamPodiumHistoryVersion,2);assert.deepEqual(after.teamPodiumHistory,[]);
  const generated=run('(state=createState(),migrateState(),deepClone(state))');for(const key of ['players','rngSeed','teamTop10','facilities','trainingFocus'])assert.deepEqual(generated[key],before[key],key);
  assert.deepEqual(generated.world.map(a=>[a.id,a.stats,a.imAptitude]),before.world.map(a=>[a.id,a.stats,a.imAptitude]));
  const saved=run('JSON.stringify(state)');run('migrateState();true');assert.equal(run('JSON.stringify(state)'),saved);
});
