const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(){
  const context=vm.createContext({crypto:{getRandomValues:a=>{a[0]=12345;return a}}});
  vm.runInContext(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener')),context);
  const run=code=>vm.runInContext(code,context);run(`state=createState();for(const p of state.players.filter(p=>p.year===4))p.bestTimes.fr100=standardFor('japan_open','fr100');
    function participationResult(meet,ids,season=state.season){return {meet,season,events:{fr100:{prelim:ids.map(id=>({source:'PLAYER',athlete:state.players.find(p=>p.id===id)})),final:[]}},relays:[]}}`);
  return run;
}
const json=(run,code)=>JSON.parse(run('JSON.stringify('+code+')'));

test('four meets compare their own previous-year counts and only the two checkpoints change reputation, once',()=>{
  const run=game();
  const r=json(run,`(()=>{
    state.reputation=75;const ids=state.players.slice(0,4).map(p=>p.id),cpu=state.universities[0];
    state.meetParticipationHistory=['kansai_college','intercollege','japan_open','japan_championship'].map((meet,i)=>({season:2025,meet,counts:{player:[3,2,3,2][i],[cpu.id]:1}}));
    const counts=[];completeMeet(participationResult('kansai_college',ids));counts.push(state.reputation);
    completeMeet(participationResult('intercollege',ids));counts.push(state.reputation);
    const first=JSON.stringify(state);completeMeet(participationResult('intercollege',ids));const once=first===JSON.stringify(state);
    completeMeet(participationResult('japan_open',ids.slice(0,1)));counts.push(state.reputation);
    completeMeet(participationResult('japan_championship',ids.slice(0,2)));counts.push(state.reputation);
    const evaluations=deepClone(state.reputationEvaluations),notices=deepClone(state.pendingSeasonNotices);
    const rep=state.reputation;newSeason();return {counts,once,evaluations,notices,annualSame:state.reputation===rep};
  })()`);
  assert.deepEqual(r.counts,[75,97,97,67]);assert.ok(r.once&&r.annualSame);
  assert.equal(r.evaluations.length,2);assert.deepEqual(r.evaluations.map(e=>e.delta),[22,-30]);
  assert.deepEqual(r.evaluations[0].comparisons.map(c=>[c.previous,c.current,c.delta]),[[3,4,2],[2,4,20]]);
  assert.deepEqual(r.evaluations[1].comparisons.map(c=>[c.previous,c.current,c.delta]),[[3,1,-30],[2,2,0]]);
  assert.equal(r.notices.length,2);assert.deepEqual(r.notices.map(n=>[n.evaluation.before,n.evaluation.reputation]),[[75,97],[97,67]]);
});

test('participation counts distinct swimmers across individual events, relay heats and final reserves; CPU identity survives renaming',()=>{
  const run=game();
  const r=json(run,`(()=>{
    const own=state.players.slice(0,6),u=state.universities[0],cpu=state.world.filter(a=>a.category==='university'&&a.organization===u.name).slice(0,4);
    const events={fr100:{prelim:[{source:'PLAYER',athlete:own[0]},{source:'CPU',athlete:cpu[0]}],final:[{source:'PLAYER',athlete:own[0]}]},fr50:{prelim:[{source:'PLAYER',athlete:own[0]}],final:[]}};
    const result={meet:'kansai_college',season:2026,events,relays:[['4x100fr',[{organization:state.playerUniversity,members:[own[2],own[3],own[4],own[5]]}],{prelim:[{organization:state.playerUniversity,members:own.slice(0,4)},{organization:u.name,members:cpu}]}]]};
    const first=meetParticipationCounts(result);completeMeet(result);renameOrganization('university',0,'改名大学');
    const current=state.meetParticipationHistory[0].counts;
    const adult={...deepClone(cpu[0]),id:'adult-not-a-student',category:'adult'};result.events.fr200={prelim:[{source:'CPU',athlete:adult}],final:[]};
    return {first,current,id:u.id,after:meetParticipationCounts(result),rep:state.reputation};
  })()`);
  assert.equal(r.first.player,6);assert.equal(r.first[r.id],4);assert.deepEqual(r.current,r.first);
  assert.equal(r.after[r.id],4);assert.equal(r.rep,35);
});

test('first-year baselines and equal attendance have no bonus or penalty, and April never changes reputation',()=>{
  const run=game();
  const r=json(run,`(()=>{
    const ids=state.players.slice(0,2).map(p=>p.id);
    for(const meet of RESTRICTED)completeMeet(participationResult(meet,ids));
    const initial=state.reputationEvaluations.map(e=>({delta:e.delta,previous:e.comparisons.map(c=>c.previous)}));
    state.season++;state.completedMeetKeys=[];
    for(const meet of RESTRICTED)completeMeet(participationResult(meet,ids));
    const equal=state.reputationEvaluations.slice(-2).map(e=>e.delta);
    state.reputation=137.5;state.universities[0].reputation=state.universities[0].baseReputation+17;
    const before=state.universities.map(u=>u.reputation);newSeason();
    return {initial,equal,own:state.reputation,cpu:JSON.stringify(before)===JSON.stringify(state.universities.map(u=>u.reputation)),notices:state.pendingSeasonNotices.length};
  })()`);
  assert.deepEqual(r.initial,[{delta:0,previous:[null,null]},{delta:0,previous:[null,null]}]);
  assert.deepEqual(r.equal,[0,0]);assert.equal(r.own,137.5);assert.ok(r.cpu);assert.equal(r.notices,0);
});

test('intercollege retirees are deleted from rosters and plans while qualified seniors and historical records remain',()=>{
  const run=game();
  const r=json(run,`(()=>{
    const seniors=state.players.filter(p=>p.year===4);seniors.forEach(p=>p.bestTimes={});
    seniors[0].bestTimes.fr100=standardFor('japan_open','fr100');seniors[1].bestTimes.br200=standardFor('japan_championship','br200');
    const retired=seniors[2];retired.bestTimes.fr100=(standardFor('intercollege','fr100')+standardFor('japan_open','fr100'))/2;
    selectedTrainingId=retired.id;state.lastTrainingGains=[{id:retired.id,name:retired.name,year:4,changes:[]}];
    state.world.forEach(a=>a.accolades=[]);state.recordRankings={};recordIndividualResult(retired,'fr100',70,'intercollege','予選');
    state.teamTop10={};upsertIndividualTop10('fr100',retired,70,'intercollege','予選');
    const records=JSON.stringify(state.recordRankings),top=JSON.stringify(state.teamTop10);
    state.japanTeam={athletes:[{id:retired.id,snapshot:deepClone(retired)}],individual:{fr100:[retired.id]},relays:{}};
    const cpu=state.world.filter(a=>a.category==='university'&&a.grade===4).slice(0,2);cpu[0].bestTimes={};cpu[1].bestTimes={fr100:standardFor('japan_open','fr100')};
    completeMeet(participationResult('intercollege',[]));
    const first=JSON.stringify(state);migrateState();const remaining=state.players.filter(p=>p.year===4).map(p=>p.id);
    return {remaining,expected:seniors.slice(0,2).map(p=>p.id),deleted:seniors.slice(2).every(p=>!state.players.some(a=>a.id===p.id)&&!state.world.some(a=>a.id===p.id)&&!state.retiredArchive.some(a=>a.id===p.id)&&!state.trainingPlans[p.id]&&!state.trainingFocus[p.id]),
      cpuGone:!state.world.some(a=>a.id===cpu[0].id),cpuKept:state.world.some(a=>a.id===cpu[1].id),selected:selectedTrainingId,training:state.lastTrainingGains.length,
      records:records===JSON.stringify(state.recordRankings),top:top===JSON.stringify(state.teamTop10),snapshots:state.japanTeam.athletes.length,notice:state.pendingSeasonNotices[0].retired.length,
      reload:seniors.slice(2).every(p=>!state.players.some(a=>a.id===p.id))};
  })()`);
  assert.deepEqual(r.remaining,r.expected);assert.ok(r.deleted&&r.cpuGone&&r.cpuKept&&r.records&&r.top&&r.reload);
  assert.equal(r.selected,null);assert.equal(r.training,0);assert.equal(r.snapshots,0);assert.equal(r.notice,6);
});

test('deferred races keep fourth-year entrants until all races finish, then complete once using the competition season',()=>{
  const run=game();
  const r=json(run,`(()=>{
    const p=state.players.find(a=>a.year===4);p.stats=Object.fromEntries(STATS.map(k=>[k,40]));p.bestTimes={fr100:(standardFor('intercollege','fr100')+standardFor('japan_open','fr100'))/2};
    const entries=Object.fromEntries(EVENTS.map(e=>[e,e==='fr100'?[p.id]:[]]));
    state.activeCompetitionSeason=2026;state.activeCompetitionSlot=42;
    const result=executeMeet('intercollege',entries,{}, {deferRelayFinalEntries:true});
    const alive=state.players.some(a=>a.id===p.id),pending=state.pendingMeetCompletion?.participationCounts.player,unsettled=state.reputationEvaluations.length===0;
    state.activeCompetitionSeason=null;state.activeCompetitionSlot=null;completeMeet(result);
    const first=JSON.stringify(state);completeMeet(result);
    return {alive,pending,unsettled,gone:!state.players.some(a=>a.id===p.id),completed:result.completed,pendingCleared:!state.pendingMeetCompletion,once:first===JSON.stringify(state),season:state.reputationEvaluations[0].season,participants:state.meetParticipationHistory[0].counts.player};
  })()`);
  assert.ok(r.alive&&r.unsettled&&r.gone&&r.completed&&r.pendingCleared&&r.once);assert.equal(r.pending,1);assert.equal(r.participants,1);assert.equal(r.season,2026);
});

test('reload completes a saved pending checkpoint and retains an undismissed notice without double counting',()=>{
  const run=game();
  const r=json(run,`(()=>{
    state.reputation=79;state.meetParticipationHistory=[{season:2025,meet:'intercollege',counts:{player:0}}];
    state.pendingMeetCompletion={meet:'intercollege',season:2026,participationCounts:{player:1}};
    state=JSON.parse(JSON.stringify(state));migrateState();const first=JSON.stringify(state);state=JSON.parse(first);migrateState();
    return {rep:state.reputation,evaluations:state.reputationEvaluations.length,notices:state.pendingSeasonNotices.length,pending:state.pendingMeetCompletion,once:first===JSON.stringify(state)};
  })()`);
  assert.equal(r.rep,89);assert.equal(r.evaluations,1);assert.equal(r.notices,1);assert.equal(r.pending,null);assert.ok(r.once);
});

test('legacy attendance migrates as comparison data without replaying bonuses or changing earned abilities',()=>{
  const run=game();
  const r=json(run,`(()=>{
    delete state.participationModelVersion;delete state.meetParticipationHistory;state.reputationParticipation=[{season:2025,meet:'intercollege',athletes:3,delta:40},{season:2025,meet:'japan_open',athletes:2,delta:33}];
    state.reputation=179;const stats=JSON.stringify(state.players.map(p=>[p.id,p.stats,p.bestTimes])),rngSeed=state.rngSeed;
    migrateState();const first=JSON.stringify(state);migrateState();
    return {counts:state.meetParticipationHistory.map(r=>r.counts.player),rep:state.reputation,stats:stats===JSON.stringify(state.players.map(p=>[p.id,p.stats,p.bestTimes])),rng:rngSeed===state.rngSeed,once:first===JSON.stringify(state),notices:state.pendingSeasonNotices.length};
  })()`);
  assert.deepEqual(r.counts,[3,2]);assert.equal(r.rep,179);assert.ok(r.stats&&r.rng&&r.once);assert.equal(r.notices,0);
});

test('an old save after intercollege retires ineligible seniors once using saved PBs without replaying reputation',()=>{
  const run=game();
  const r=json(run,`(()=>{
    const p=state.players.find(p=>p.year===4);p.bestTimes={};
    delete state.participationModelVersion;delete state.seniorRetirementSeasons;
    state.reputationParticipation=[{season:2026,meet:'intercollege',athletes:4,delta:80}];state.slot=60;state.reputation=175;
    const others=JSON.stringify(state.players.filter(a=>a.id!==p.id).map(a=>[a.id,a.stats,a.bestTimes])),rngSeed=state.rngSeed;
    migrateState();const first=JSON.stringify(state);migrateState();
    return {gone:!state.players.some(a=>a.id===p.id),others:others===JSON.stringify(state.players.map(a=>[a.id,a.stats,a.bestTimes])),rep:state.reputation,
      notices:state.pendingSeasonNotices.length,retired:state.pendingSeasonNotices[0].retired.map(a=>a.id),once:first===JSON.stringify(state),rng:rngSeed===state.rngSeed};
  })()`);
  assert.ok(r.gone&&r.others&&r.once&&r.rng);assert.equal(r.rep,175);assert.equal(r.notices,1);assert.equal(r.retired.length,1);
});

test('three saved player types exclude early growth below entry average 100 and preserve that entry value after training',()=>{
  const run=game();
  const r=json(run,`(()=>{
    const initial=state.players.every(p=>['early','normal','late'].includes(p.potentialType)&&(p.entryAbilityAverage>=100||p.potentialType!=='early'));
    const stats=value=>Object.fromEntries(STATS.map(k=>[k,value])),low={id:'low-entry',stats:stats(80),potentialType:'early'},ready={id:'ready-entry',stats:stats(120),potentialType:'ready'},raw={id:'raw-entry',stats:stats(80),potentialType:'raw'};
    const rngSeed=state.rngSeed;ensurePlayerGrowthType(low);ensurePlayerGrowthType(ready);ensurePlayerGrowthType(raw);low.stats=stats(150);ensurePlayerGrowthType(low);
    const first=JSON.stringify([low,ready,raw]);[low,ready,raw].forEach(ensurePlayerGrowthType);
    return {initial,low:low.potentialType,entry:low.entryAbilityAverage,ready:ready.potentialType,raw:raw.potentialType,rng:rngSeed===state.rngSeed,once:first===JSON.stringify([low,ready,raw])};
  })()`);
  assert.ok(r.initial&&r.rng&&r.once);assert.notEqual(r.low,'early');assert.equal(r.entry,80);assert.equal(r.ready,'early');assert.equal(r.raw,'late');
});

test('actual focused training peaks early for early types, stays even for normal types and increases by year for late types',()=>{
  const run=game();
  const r=json(run,`(()=>{
    const rows={};rng=()=>.5;
    for(const type of ['early','normal','late'])rows[type]=[1,2,3,4].map(year=>{
      const p={id:type+'-'+year,name:'成長確認',year,potentialType:type,entryAbilityAverage:120,stats:Object.fromEntries(STATS.map(k=>[k,80]))};ensurePlayerGrowthType(p);
      state.players=[p];state.world=[];state.facilities={fr_speed:100};state.trainingFocus={[p.id]:['fr_speed']};state.slot=1;
      for(let turn=0;turn<8;turn++){state.slot=turn+1;trainCommand()}
      return round2(p.stats.fr_speed-80);
    });return rows;
  })()`);
  assert.ok(r.early.every((v,i)=>i===0||v<r.early[i-1]),JSON.stringify(r));
  assert.ok(r.late.every((v,i)=>i===0||v>r.late[i-1]),JSON.stringify(r));
  assert.ok(r.normal.every(v=>v===r.normal[0]));assert.ok(r.normal[0]>=28&&r.normal[0]<=32);
  assert.ok(r.early[0]>r.normal[0]&&r.normal[0]>r.late[0]);assert.ok(r.late[3]>r.normal[3]&&r.normal[3]>r.early[3]);
});
