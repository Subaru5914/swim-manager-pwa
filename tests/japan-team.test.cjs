const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(full=false){
  const context=vm.createContext({crypto:{getRandomValues:a=>{a[0]=12345;return a}}});
  vm.runInContext(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener')),context);
  const run=code=>vm.runInContext(code,context);
  run(full?'state=createState()':`state={season:2027,slot:36,playerUniversity:'試験大学',universities:[{id:'U1',name:'他大学'}],players:[{id:'P1',name:'代表 一郎',organization:'試験大学',year:2,category:'university'}],world:[{id:'C1',name:'代表 二郎',organization:'他大学',grade:3,category:'university'}],retiredArchive:[],japanTeamHistory:[],meetHistory:[],recordRankings:{japan:{}}};
    state.japanTeam={year:2027,selectedSeason:2026,selectedSlot:95,individual:{fr100:['P1','C1']},additionalIndividual:{},relays:{},selectionTimes:{fr100:{P1:47.5,C1:47.6}},athletes:[{id:'P1',ownAtSelection:true,snapshot:deepClone(state.players[0])},{id:'C1',ownAtSelection:false,snapshot:deepClone(state.world[0])}]};`);
  return run;
}
const json=(run,code)=>JSON.parse(run(`JSON.stringify(${code})`));
test('annual representative archives keep selection identities and added entries without duplicating years',()=>{
  const run=game();run(`archiveJapanTeam();state.japanTeam.additionalIndividual={fr200:['P1']};archiveJapanTeam();state.japanTeam.year=2029;archiveJapanTeam()`);
  const rows=json(run,'state.japanTeamHistory');assert.equal(rows.length,2);assert.deepEqual(rows[0].individual.fr200,['P1']);
  assert.equal(rows[0].athletes[0].own,true);assert.equal(rows[0].athletes[0].gradeAtRecord,2);assert.equal(rows[0].selectionTimes.fr100.C1,47.6);
});
test('exact individual preliminary/final times, positions and lanes are saved for own and CPU representatives',()=>{
  const run=game();run(`const own=state.players[0],cpu=state.world[0];
    const result={meet:'world_championship',season:2027,slot:36,events:{fr100:{prelim:[{athlete:cpu,nationality:'日本',race:{total:48.1},achievement:{rank:7},heatLane:4},{athlete:own,nationality:'日本',race:{total:49.2},achievement:{rank:12},heatLane:5}],final:[{athlete:cpu,nationality:'日本',race:{total:47.9},achievement:{rank:3},heatLane:7}]}},relays:[]};
    recordJapanWorldResults(result,false);recordJapanWorldResults(result,true);recordJapanWorldResults(result,false)`);
  const entry=json(run,'state.japanTeamHistory[0]');assert.equal(entry.worldStatus,'complete');assert.equal(entry.results.individual.fr100.length,2);
  const own=entry.results.individual.fr100.find(row=>row.athleteId==='P1'),cpu=entry.results.individual.fr100.find(row=>row.athleteId==='C1');
  assert.deepEqual(own.prelim,{rank:12,time:49.2,heatLane:5});assert.equal(own.final,null);assert.deepEqual(cpu.final,{rank:3,time:47.9,heatLane:7});
});
test('relay archives record the actual members and laps independently for preliminaries and changed finals',()=>{
  const run=game();run(`const pre=[state.players[0],state.world[0],{id:'C2',name:'代表 三郎',category:'adult'},{id:'C3',name:'代表 四郎',category:'adult'}];
    const finals=[pre[1],pre[0],pre[3],{id:'C4',name:'代表 五郎',category:'adult'}];
    const result={meet:'world_championship',season:2027,slot:36,events:{},relays:[['4x100fr',[{organization:'日本',members:finals,rank:2,heatLane:5,race:{total:194,legs:[48,47,49,50]}}],{prelim:[{organization:'日本',members:pre,prelimRank:5,heatLane:3,race:{total:196,legs:[49,48,50,49]}}],finalEntryPending:true}]]};
    recordJapanWorldResults(result);const pending=state.japanTeamHistory[0].results.relays['4x100fr'].final;
    result.relays[0][2].finalEntryPending=false;recordJapanWorldResults(result,true)`);
  assert.equal(run('pending'),null);const row=json(run,"state.japanTeamHistory[0].results.relays['4x100fr']");
  assert.deepEqual(row.prelim.members.map(a=>a.id),['P1','C1','C2','C3']);assert.deepEqual(row.final.members.map(a=>a.id),['C1','P1','C3','C4']);
  assert.deepEqual(row.final.legs,[48,47,49,50]);assert.equal(row.final.rank,2);assert.equal(row.prelim.rank,5);
});
test('older saves recover only stored world results, with no invented times from PBs',()=>{
  const run=game();run(`state.players[0].bestTimes={fr100:45};state.players[0].raceHistory=[{meet:'world_championship',season:2027,slot:36,event:'fr100',stage:'予選',rank:12,time:49.4,heatLane:2}];
    initializeJapanTeamHistory();const first=JSON.stringify(state.japanTeamHistory);initializeJapanTeamHistory()`);
  const rows=json(run,'state.japanTeamHistory[0].results.individual.fr100');assert.equal(rows[0].prelim.time,49.4);assert.equal(rows[0].final,undefined);
  assert.ok(!rows.some(row=>row.athleteId==='C1'));assert.equal(run('first===JSON.stringify(state.japanTeamHistory)'),true);assert.equal(run('state.players[0].bestTimes.fr100'),45);
});
test('a partial legacy relay keeps the known swimmer with his original leg and corresponding lap',()=>{
  const run=game();run(`state.players[0].raceHistory=[{meet:'world_championship',season:2027,slot:36,event:'4x100fr',stage:'決勝',rank:4,time:197,legIndex:2,lapTime:48.2,schoolCategory:'university',gradeAtRecord:3}];initializeJapanTeamHistory()`);
  const row=json(run,"state.japanTeamHistory[0].results.relays['4x100fr'].final");assert.equal(row.members.length,1);assert.equal(row.members[0].legIndex,2);assert.equal(row.legs[2],48.2);
  const html=run("japanRelayMembersHtml(state.japanTeamHistory[0].results.relays['4x100fr'].final.members,state.japanTeamHistory[0].results.relays['4x100fr'].final.legs)");
  assert.match(html,/3泳/);assert.match(html,/48.20/);assert.match(html,/確認できたメンバーのみ/);
});
test('player and university renames also update archived representatives and actual relay members',()=>{
  const run=game();run(`archiveJapanTeam();state.japanTeamHistory[0].results.relays['4x100fr']={final:{members:[deepClone(state.japanTeamHistory[0].athletes[0])],time:198}};applyPlayerRename('P1','代表 改名');renameRecordOrganization('試験大学','新大学')`);
  const entry=json(run,'state.japanTeamHistory[0]');assert.equal(entry.athletes[0].name,'代表 改名');assert.equal(entry.results.relays['4x100fr'].final.members[0].name,'代表 改名');assert.equal(entry.athletes[0].organization,'新大学');
});
test('actual world meet and finals editing populate the archive and completion status',()=>{
  const run=game(true);const result=json(run,`(()=>{
    const team=state.players.slice(0,5);for(const p of team){for(const k of STATS)p.stats[k]=185;for(const e of EVENTS)p.bestTimes[e]=expectedTime(p,e);}
    state.season=2027;state.slot=36;state.japanTeam={year:2027,selectedSeason:2026,selectedSlot:95,individual:{fr100:[team[0].id]},additionalIndividual:{},relays:{'4x100fr':team.slice(0,4).map(p=>p.id)},selectionTimes:{},athletes:team.map(p=>({id:p.id,snapshot:deepClone(p),ownAtSelection:true}))};
    const meet=executeWorldMeet({deferRelayFinalEntries:true});
    const before=deepClone(state.japanTeamHistory[0]);const relay=meet.relays.find(row=>row[0]==='4x100fr');
    if(relay[2].finalEntryPending)setRelayFinalEntry(meet,'4x100fr',team.slice(1,5).map(p=>p.id));
    completeMeet(meet);const entry=state.japanTeamHistory[0];
    return{before:before.worldStatus,status:entry.worldStatus,pre:entry.results.individual.fr100[0].prelim,expected:meet.events.fr100.prelim.find(row=>row.athlete.id===team[0].id).race.total,
      changed:relay[2].finalEntryPending===false,relay:entry.results.relays['4x100fr'],ids:team.slice(1,5).map(p=>p.id)};
  })()`);
  assert.equal(result.before,'in_progress');assert.equal(result.status,'complete');assert.equal(result.pre.time,result.expected);
  assert.ok(result.changed);assert.deepEqual(result.relay.final.members.map(member=>member.id),result.ids);assert.equal(result.relay.final.legs.length,4);
});
