const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(){return vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+`
 state={season:2026,slot:43,rngSeed:5914,playerUniversity:'自大学',players:[],world:[],universities:[{id:'cpu',name:'他大学'}],kansaiIds:['cpu'],interIds:['cpu'],teamTop10:{},recordRankings:{},recordBook:{},teamPodiumHistory:[],meetHistory:[],teamScoreHistory:[],pointLog:[],points:0};
 function swimmer(id,event,pb,pre,fin,own=true){return {id,name:id,category:'university',year:2,grade:2,organization:own?state.playerUniversity:'他大学',specialty:event,stats:Object.fromEntries(STATS.map(k=>[k,138])),bestTimes:pb==null?{}:{[event]:pb},raceHistory:[],accolades:[],pre,fin}}
 simulateRace=(a,e,champ,record,takeover,preliminary)=>({total:preliminary?a.pre:a.fin});
 simulateMeetRace=(a,e,m,r,preliminary)=>simulateRace(a,e,true,r,false,preliminary);
 return code=>JSON.parse(JSON.stringify(eval(code)))`,[])()}

test('all domestic and world overall results compare prelims to entry PB and finals to the PB before the final',()=>{
 const run=game(),r=run(`['kansai_college','intercollege','teijimayama_championship','joint_record','japan_open','japan_championship','world_championship'].map(meet=>{
  const event='fr200',own=swimmer('own',event,110,109,108),unchanged=swimmer('unchanged',event,105,111,110),cpu=swimmer('cpu',event,109.5,112,111,false);
  state.players=[own,unchanged];state.world=[cpu];
  const result=meet==='world_championship'?raceEventField(meet,event,[{source:'PLAYER',athlete:own,entryPB:110},{source:'PLAYER',athlete:unchanged,entryPB:105},{source:'CPU',athlete:cpu,entryPB:109.5}]):runEvent(meet,event,['own','unchanged'],{fr200:['cpu']});
  const first=stage=>result[stage].find(r=>r.athlete.id==='own'),other=stage=>result[stage].find(r=>r.athlete.id==='unchanged');
  return {meet,pb:own.bestTimes.fr200,pre:first('prelim').entryPB,fin:first('final').entryPB,
   preliminary:resultEntryPBCell(first('prelim'),event),final:resultEntryPBCell(first('final'),event),
   unchanged:['prelim','final'].map(stage=>other(stage).entryPB),cpu:resultEntryPBCell(result.prelim.find(r=>r.source==='CPU'),event),
   header:resultRankingTable(result.final,event).includes('<th>レース前PB</th>'),
   frozen:JSON.stringify(result)===JSON.stringify((resultRankingTable(result.prelim,event,result.final),result))};
 })`);
 for(const row of r){
  assert.equal(row.pre,110,row.meet);assert.equal(row.fin,109,row.meet);assert.equal(row.pb,108,row.meet);
  assert.match(row.preliminary,/>1:50\.00</,row.meet);assert.match(row.final,/>1:49\.00</,row.meet);
  assert.deepEqual(row.unchanged,[105,105]);assert.match(row.cpu,/>—</);assert.ok(row.header&&row.frozen);
 }
});

test('an unmeasured entry stays unmeasured in prelim comparison after first PB, JSON round trips and later improvements',()=>{
 const run=game(),r=run(`(()=>{
  const p=swimmer('first-clock','fr200',null,109,108);state.players=[p];state.world=[];
  const result=runEvent('joint_record','fr200',[p.id]),saved=JSON.parse(JSON.stringify(result));
  saved.prelim[0].athlete.bestTimes.fr200=90;saved.final[0].athlete.bestTimes.fr200=90;
  return{entry:saved.prelim[0].entryPB,finalEntry:saved.final[0].entryPB,pre:resultEntryPBCell(saved.prelim[0],'fr200'),fin:resultEntryPBCell(saved.final[0],'fr200')};
 })()`);
 assert.equal(r.entry,null);assert.equal(r.finalEntry,109);assert.match(r.pre,/>-</);assert.match(r.fin,/>1:49\.00</);
});

test('saved rows without entry PB recover previous PB, preserve an unmeasured entry and render short times',()=>{
 const run=game(),r=run(`(()=>{
  const p=swimmer('saved','fr100',48,47,46),row={source:'PLAYER',athlete:p,race:{total:47},achievement:{previousPB:50}};
  const before=JSON.stringify(row),normal=resultEntryPBCell(row,'fr100');row.achievement.previousPB=null;
  const unmeasured=resultEntryPBCell(row,'fr100'),unknown=resultEntryPBCell({source:'PLAYER',athlete:p,race:{total:47}},'fr100');
  row.entryPB=49;row.swimOffRound=1;row.achievement.previousPB=48.5;
  return{normal,unmeasured,unknown,swimOff:resultEntryPBCell(row,'fr100'),before};
 })()`);
 assert.match(r.normal,/>50\.00</);assert.match(r.unmeasured,/>-</);assert.match(r.unknown,/>-</);assert.match(r.swimOff,/>48\.50</);
});

test('a relay lead-off PB updates only later individual comparisons, including finals faster or slower than that split',()=>{
 const r=game()(`(()=>{
  return [53,55].map(finalTime=>{
   const event='ba100',own=swimmer('own',event,60,56,finalTime),members=[own,...Array.from({length:3},(_,i)=>swimmer('leg'+i,event,60,60,60))];state.players=members;state.world=[];
   const individual=runEvent('intercollege',event,[own.id],{}),team={organization:state.playerUniversity,members,prelimRank:1,race:{total:220,legs:[54,56,55,55]}};
   recordRelayResult('4x100medley',team,'intercollege','予選');
   const result={meet:'intercollege',season:2026,slot:43,events:{[event]:individual},relays:[['4x100medley',[],{prelim:[team],heats:[[team]]}]]};
   const protectedData=JSON.stringify([state.players.map(a=>[a.stats,a.bestTimes]),state.rngSeed,state.teamTop10,state.recordRankings]);
   refreshMeetPBComparisons(result);const first=JSON.stringify(result);refreshMeetPBComparisons(result);
   const restored=unpackMeetResult(JSON.parse(JSON.stringify(packMeetResult(result))));
   return{finalTime,pre:individual.prelim[0].entryPB,final:individual.final[0].entryPB,finalPB:individual.final[0].achievement.pb,lead:team.leadOffAchievement,
    history:own.raceHistory.filter(h=>h.event===event).map(h=>h.pb),restored:restored.events[event].final[0].entryPB,
    stable:first===JSON.stringify(result),unchanged:protectedData===JSON.stringify([state.players.map(a=>[a.stats,a.bestTimes]),state.rngSeed,state.teamTop10,state.recordRankings])};
  });
 })()`);
 for(const row of r){assert.equal(row.pre,60);assert.equal(row.final,54);assert.equal(row.finalPB,row.finalTime<54);assert.equal(row.lead.previousPB,56);assert.ok(row.lead.pb);assert.deepEqual(row.history,[true,row.finalTime<54]);assert.equal(row.restored,54);assert.ok(row.stable&&row.unchanged)}
});

test('all lead-off strokes propagate to later single-day finals while flying legs, equal splits and earlier races never overwrite PB comparisons',()=>{
 const r=game()(`(()=>{
  return RELAYS.map(kind=>{
   const event=relayLegEvent(kind,0),own=swimmer(kind,event,120,118,117),members=[own,...Array.from({length:3},(_,i)=>swimmer(kind+'leg'+i,event,120,118,117))];state.players=members;state.world=[];
   const race=runEvent('joint_record',event,[own.id],{}),team={organization:state.playerUniversity,members,prelimRank:1,race:{total:400,legs:[116,90,95,99]}};
   recordRelayResult(kind,team,'joint_record','予選');
   const result={meet:'joint_record',season:2026,slot:43,events:{[event]:race},relays:[[kind,[],{prelim:[team],heats:[[team]]}]]};refreshMeetPBComparisons(result);
   const earlier=race.prelim[0].entryPB,later=race.final[0].entryPB,pb=race.final[0].achievement.pb,other=members.slice(1).map(a=>a.bestTimes[event]);
   team.race.legs[0]=118;refreshMeetPBComparisons(result);const equal=race.final[0].entryPB;
   return{kind,earlier,later,pb,other,equal};
  });
 })()`);
 for(const row of r){assert.equal(row.earlier,120);assert.equal(row.later,116);assert.equal(row.pb,false);assert.deepEqual(row.other,[120,120,120]);assert.equal(row.equal,118)}
});

test('four-day freestyle relays after the individual event keep the completed preliminary and final comparisons unchanged',()=>{
 const r=game()(`(()=>{
  return ['4x100fr','4x200fr'].map(kind=>{
   const event=relayLegEvent(kind,0),own=swimmer(kind,event,120,118,117),members=[own,...Array.from({length:3},(_,i)=>swimmer('leg'+i,event,120,118,117))];state.players=members;
   const race=runEvent('intercollege',event,[own.id],{}),team={organization:state.playerUniversity,members,prelimRank:1,race:{total:470,legs:[116,118,118,118]}};
   recordRelayResult(kind,team,'intercollege','予選');refreshMeetPBComparisons({meet:'intercollege',season:2026,slot:43,events:{[event]:race},relays:[[kind,[],{prelim:[team],heats:[[team]]}]]});
   return{pre:race.prelim[0].entryPB,final:race.final[0].entryPB,finalPB:race.final[0].achievement.pb,lead:team.leadOffAchievement};
  });
 })()`);
 for(const row of r){assert.equal(row.pre,120);assert.equal(row.final,118);assert.ok(row.finalPB&&row.lead.pb);assert.equal(row.lead.previousPB,117)}
});

test('a deferred relay final rebuilds later PB snapshots from the committed lineup and survives saved rows with separate heat objects',()=>{
 const r=game()(`(()=>{
  const event='ba100',own=swimmer('own',event,60,56,55),members=[own,...Array.from({length:3},(_,i)=>swimmer('leg'+i,event,60,60,60))];state.players=members;
  const race=runEvent('joint_record',event,[own.id],{}),pre={organization:state.playerUniversity,members,prelimRank:1,race:{total:225,legs:[57,56,56,56]}},fin={organization:state.playerUniversity,members,rank:1,race:{total:215,legs:[53,54,54,54]}};
  recordRelayResult('4x100medley',pre,'joint_record','予選');
  const result={meet:'joint_record',season:2026,slot:43,events:{[event]:race},relays:[['4x100medley',[fin],{prelim:[pre],heats:[[pre]],finalEntryPending:true}]]};
  refreshMeetPBComparisons(result);const pending=race.final[0].entryPB;
  const saved=unpackMeetResult(JSON.parse(JSON.stringify(packMeetResult(result))));saved.relays[0][2].finalEntryPending=false;recordRelayResult('4x100medley',saved.relays[0][1][0],'joint_record','決勝');refreshMeetPBComparisons(saved);
  return{pending,final:saved.events[event].final[0].entryPB,pre:saved.events[event].prelim[0].entryPB,heat:saved.events[event].heats[0][0].entryPB,pb:own.bestTimes[event],lateFinal:saved.relays[0][1][0].leadOffAchievement};
 })()`);
 assert.equal(r.pending,56);assert.equal(r.final,56,'a relay final after the individual final must not change its earlier comparison');assert.equal(r.pre,60);assert.equal(r.heat,60);assert.equal(r.pb,53);assert.equal(r.lateFinal.previousPB,55);assert.ok(r.lateFinal.pb);
});
