const assert=require('node:assert/strict');
const {test}=require('node:test');
const History=require('../save-history.js');
const copy=value=>JSON.parse(JSON.stringify(value));
const size=save=>History.bytes(JSON.stringify(save));
function fixture(){
  return {season:2035,slot:40,players:[{id:'P1',stats:{fr_speed:170},bestTimes:{fr100:48},raceHistory:[]}],world:[],retiredArchive:[],
    trainingPlans:{P1:{fr_speed:1}},trainingFocus:{P1:'fr_speed'},recordRankings:{high:{},university:{},japan:{}},teamTop10:{},recordBook:{},
    japanTeam:{year:2035,athletes:[{id:'P1',snapshot:{raceHistory:[{season:2026,time:50}]}}]},japanTeamHistory:[{year:2027,results:{individual:{fr100:[{time:48}]}}}],
    meetParticipationHistory:[{season:2026,count:3},{season:2034,count:4}],reputationParticipation:[{season:2034,count:4}],completedMeetKeys:['2034:intercollege'],reputationEvaluations:[{season:2034}],pointLog:[{season:2026,points:1}],meetHistory:[],teamScoreHistory:[]};
}
const race=(season,time=60,extra={})=>({season,slot:20,meet:'joint_record',event:'fr100',time,...extra});
test('under 15MiB keeps every old result and does not create cleanup metadata',()=>{
  const save=fixture();save.players[0].raceHistory=[race(2026)];const original=copy(save),plan=History.plan(save);
  assert.equal(plan.removed,0);assert.equal(plan.apply(save),0);assert.deepEqual(save,original);assert.equal(plan.text,JSON.stringify(save));
});
test('oldest details are removed first while the current and previous four seasons remain',()=>{
  const save=fixture();save.players[0].raceHistory=[race(2034),race(2026),race(2030),race(2031),race(2028),{event:'fr100',time:70}];
  const original=copy(save),oneRow=size(save.players[0].raceHistory[1])+1;
  const plan=History.plan(save,{triggerBytes:1,targetBytes:size(save)-oneRow+1024});
  assert.deepEqual(save,original);assert.equal(plan.removed,1);assert.equal(plan.apply(save),1);
  assert.deepEqual(save.players[0].raceHistory.map(row=>row.season),[2034,2030,2031,2028,undefined]);
  const rest=History.plan(save,{triggerBytes:1,targetBytes:1});rest.apply(save);
  assert.deepEqual(save.players[0].raceHistory.map(row=>row.season),[2034,2031,undefined]);
});
test('all top tens, PB source results, Japan information and reputation inputs survive cleanup unchanged',()=>{
  const save=fixture(),p=save.players[0];p.raceHistory=[race(2026,48),race(2027,49),race(2028,50),race(2029,51),race(2026,200,{event:'4x100fr'}),race(2027,52,{meet:'world_championship'}),race(2028,75)];
  save.recordRankings.high.fr100=[{athleteId:p.id,event:'fr100',time:49,season:2027,meet:'joint_record',slot:20}];
  save.recordRankings.university.fr100=[{athleteId:p.id,event:'fr100',time:50}];
  save.recordRankings.japan['4x100fr']=[{members:[{id:p.id}],time:200,event:'4x100fr'}];
  save.teamTop10.fr100=[{athleteId:p.id,time:51}];save.recordBook.fr100={athleteId:p.id,time:51};
  save.meetHistory=[{season:2027,slot:20,meet:'joint_record'},{season:2026,meet:'world_championship'},{season:2028,meet:'joint_record'}];
  save.teamScoreHistory=[{season:2026,meet:'intercollege',scores:{自大学:83,他大学:95}},{season:2028,meet:'kansai_college',scores:{自大学:105,他大学:100}}];
  const original=copy(save),plan=History.plan(save,{triggerBytes:1,targetBytes:1});plan.apply(save);
  assert.deepEqual(p.raceHistory,original.players[0].raceHistory.slice(0,-1));
  assert.deepEqual(save.meetHistory,original.meetHistory.slice(0,-1));assert.deepEqual(save.teamScoreHistory,original.teamScoreHistory);
  for(const field of ['recordRankings','teamTop10','recordBook','japanTeam','japanTeamHistory','trainingPlans','trainingFocus','meetParticipationHistory','reputationParticipation','reputationEvaluations','completedMeetKeys','pointLog'])assert.deepEqual(save[field],original[field],field);
  assert.deepEqual(p.stats,original.players[0].stats);assert.deepEqual(p.bestTimes,original.players[0].bestTimes);
});
test('insufficient eligible history never removes protected data to meet the size target',()=>{
  const save=fixture();save.players[0].raceHistory=[race(2026),race(2031,{padding:'x'.repeat(10000)})];
  const plan=History.plan(save,{triggerBytes:1,targetBytes:100});assert.equal(plan.removed,1);assert.ok(plan.afterBytes>100);plan.apply(save);
  assert.equal(save.players[0].raceHistory.length,1);assert.equal(save.players[0].raceHistory[0].season,2031);
  assert.equal(History.plan(save,{triggerBytes:1,targetBytes:100}).removed,0);
});
test('deferred apply preserves new progress and does nothing after switching to a different save',()=>{
  const save=fixture();save.players[0].raceHistory=[race(2026)];const plan=History.plan(save,{triggerBytes:1,targetBytes:1});
  assert.equal(plan.apply(copy(save)),0);assert.equal(save.players[0].raceHistory.length,1);
  const fresh=race(2035);save.players[0].raceHistory.push(fresh);save.players[0].stats.fr_speed=175;
  plan.apply(save);assert.deepEqual(save.players[0].raceHistory,[fresh]);assert.equal(save.players[0].stats.fr_speed,175);assert.equal(plan.apply(save),0);
});
test('duplicate identities protect PB sources in every copy before candidates are selected',()=>{
  const save=fixture();save.players[0].raceHistory=[race(2026,46),race(2026,80)];
  save.retiredArchive=[{id:'P1',bestTimes:{fr100:46},raceHistory:[]}];
  History.plan(save,{triggerBytes:1,targetBytes:1}).apply(save);assert.equal(save.players[0].raceHistory.length,1);assert.equal(save.players[0].raceHistory[0].time,46);
});
test('real 15MiB trigger targets 12MiB with UTF-8 sizing and leaves five seasons and all records intact',()=>{
  const save=fixture();save.players[0].raceHistory=Array.from({length:100},(_,i)=>race(i<80?2026+i%5:2031+i%5,60+i,{notes:'記'.repeat(60000)}));
  const original=size(save);assert.ok(original>History.TRIGGER_BYTES);
  const plan=History.plan(save);assert.ok(plan.afterBytes<=History.TARGET_BYTES);assert.ok(plan.removed>0);
  const packed=JSON.parse(plan.text);assert.equal(packed.players[0].raceHistory.filter(row=>row.season>=2031).length,20);
  assert.deepEqual(packed.japanTeam,save.japanTeam);assert.deepEqual(packed.japanTeamHistory,save.japanTeamHistory);
  assert.equal(plan.beforeBytes,original);assert.equal(plan.afterBytes,History.bytes(plan.text));
  plan.apply(save);assert.equal(size(save),plan.afterBytes);
});
