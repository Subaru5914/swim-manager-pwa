const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const SwimSaveHistory=require('../save-history.js');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(full=false){
  const context=vm.createContext({crypto:{getRandomValues:a=>{a[0]=12345;return a}}});
  vm.runInContext(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener')),context);
  vm.runInContext(full?'state=createState()':`state={season:2026,slot:73,playerUniversity:'自大学',players:[],world:[],universities:[],facilities:{},trainingFocus:{},lastTrainingGains:[],rngSeed:12345};
    function swimmer(id,value=100,year=1){const p={id,name:id,year,stats:Object.fromEntries(STATS.map(k=>[k,value])),specialty:'fr100',bestTimes:{},growthProfile:{1:1,2:1,3:1,4:1}};attachMedleyStats(p);return p}
    state.players=Array.from({length:7},(_,i)=>swimmer('p'+i));state.facilities=Object.fromEntries(STATS.map(k=>[k,100]));rng=()=>.5;`,context);
  return code=>JSON.parse(vm.runInContext('JSON.stringify('+code+')',context));
}

test('meet awards double ordinary expected training, respecting focus, facilities, growth stage and the B/A/S curve',()=>{
  const run=game(),r=run(`(()=>{
    const outcomes=[];
    for(const [value,facility,year,type] of [[100,100,1,'normal'],[100,0,1,'normal'],[125,100,1,'normal'],[150,100,1,'normal'],[175,100,1,'normal'],[100,100,1,'early'],[100,100,4,'late'],[199.99,100,1,'normal'],[200,100,1,'normal']]){
      const p=swimmer('probe',value,year);p.growthProfile=PLAYER_GROWTH_TYPES[type].profile;state.players=[p];state.trainingFocus[p.id]=['mental'];state.facilities.mental=facility;
      const original=JSON.stringify(p.bestTimes),reward=awardMeetGrowth({meet:'joint_record',season:2026,slot:outcomes.length+1,events:{fr100:{prelim:[{athlete:p}]}},relays:[]});
      outcomes.push({gain:round2(p.stats.mental-value),others:STATS.filter(k=>k!=='mental').every(k=>p.stats[k]===value),pb:original===JSON.stringify(p.bestTimes),rows:reward.gains.length,reported:reward.gains[0].changes});
    }
    return outcomes;
  })()`);
  assert.deepEqual(r.map(x=>x.gain),[5.71,1.61,4.57,1.9,.27,7.42,7.53,0,0]);
  assert.ok(r.every(x=>x.others&&x.pb&&x.rows===1));
  assert.equal(r[0].reported[0].up,5.71);assert.equal(r.at(-1).reported.length,0);
});

test('individuals, prelim relay members and actual final reserves are paid once; unused reserves and CPU are excluded',()=>{
  const run=game(),r=run(`(()=>{
    const p=state.players,cpu=swimmer('cpu');state.world=[cpu];const world=JSON.stringify(state.world),last=JSON.stringify(state.lastTrainingGains);
    const result={meet:'teijimayama_championship',season:2026,slot:60,events:{fr50:{prelim:[{athlete:p[0]},{athlete:cpu}],final:[{athlete:p[0]}]},fr100:{prelim:[{athlete:p[0]}]}},
      relays:[['4x100fr',[{members:p.slice(2,6)}],{prelim:[{members:p.slice(0,4)}],finalEntryPending:true}]]};
    const before=JSON.stringify(p);prepareMeetCompletion(result,{deferRelayFinalEntries:true});const unchanged=before===JSON.stringify(p),pendingBefore=[...state.pendingMeetCompletion.growthParticipantIds];
    result.relays[0][2].finalEntryPending=false;completeMeet(result);const after=JSON.stringify(state);completeMeet({...result,completed:false});
    return {unchanged,pendingBefore,ids:state.pendingMeetGrowthRewards[0].gains.map(g=>g.id),once:after===JSON.stringify(state),changes:p.map(a=>round2(a.stats.fr_speed-100)),cpu:world===JSON.stringify(state.world),last:last===JSON.stringify(state.lastTrainingGains),pending:state.pendingMeetCompletion};
  })()`);
  assert.ok(r.unchanged&&r.once&&r.cpu&&r.last);assert.deepEqual(r.pendingBefore,['p0','p1','p2','p3']);
  assert.deepEqual(r.ids,['p0','p1','p2','p3','p4','p5']);assert.deepEqual(r.changes,[5.71,5.71,5.71,5.71,5.71,5.71,0]);assert.equal(r.pending,null);
});

test('secondary growth still occurs only sometimes and remains subject to diminishing returns and the cap',()=>{
  const run=game(),r=run(`(()=>{
    const samples=[];for(const random of [.5,.1]){
      const p=swimmer('probe');p.stats.fr_stamina=175;p.stats.fr_turn=199.99;state.players=[p];state.trainingFocus[p.id]=['fr_speed'];rng=()=>random;
      applyPlayerTraining(p,{multiplier:2,expected:true,precise:true});samples.push({speed:p.stats.fr_speed,stamina:p.stats.fr_stamina,turn:p.stats.fr_turn});
    }return samples;
  })()`);
  assert.deepEqual(r[0],{speed:105.71,stamina:175,turn:199.99});assert.equal(r[1].speed,105.71);
  assert.equal(r[1].stamina,175.05);assert.equal(r[1].turn,199.99);
});

test('all external meet types earn growth, both winter cups have separate guards, and own trials or non-entry do not',()=>{
  const run=game(),r=run(`(()=>{
    const p=state.players[0];const result=(meet,slot)=>({meet,season:2026,slot,events:{fr100:{prelim:[{athlete:p}]}},relays:[]});
    const before=JSON.stringify(state);completeMeet(result('team_trial',1));const trialSame=before===JSON.stringify(state);
    completeMeet({meet:'joint_record',season:2026,slot:72,events:{},relays:[]});
    for(const [i,meet] of ['kansai_college','intercollege','teijimayama_championship','japan_open','japan_championship','world_championship','joint_record','joint_record'].entries())awardMeetGrowth(result(meet,20+i));
    const beforeYear=state.pendingMeetGrowthRewards.length;awardMeetGrowth({...result('joint_record',26),season:2027});
    return{trialSame,keys:state.meetGrowthRewardKeys.length,beforeYear,notices:state.pendingMeetGrowthRewards.length};
  })()`);
  assert.ok(r.trialSame);assert.equal(r.beforeYear,8);assert.equal(r.keys,9);assert.equal(r.notices,9);
});

test('pending real races restore one award from saved participant IDs, while old completed saves receive no retroactive bonus',()=>{
  const run=game(true),r=run(`(()=>{
    rng=()=>.5;const p=state.players[0];state.trainingFocus[p.id]=['mental'];p.stats.mental=100;p.potentialType='normal';p.growthProfile={1:1,2:1,3:1,4:1};state.facilities.mental=100;
    state.pendingMeetCompletion={meet:'joint_record',season:2026,slot:73,growthParticipantIds:[p.id]};
    state=deepClone(state);migrateState();const gain=round2(state.players.find(a=>a.id===p.id).stats.mental-100),first=JSON.stringify(state);
    state=JSON.parse(first);migrateState();const once=first===JSON.stringify(state),notices=state.pendingMeetGrowthRewards.length,pending=state.pendingMeetCompletion;
    state.pendingMeetGrowthRewards=[];delete state.meetGrowthRewardKeys;delete state.pendingMeetGrowthRewards;state.meetHistory.push({season:2025,slot:73,meet:'joint_record'});
    const stats=JSON.stringify(state.players.map(a=>a.stats));migrateState();
    return{gain,once,notices,pending,oldStats:stats===JSON.stringify(state.players.map(a=>a.stats)),oldNotices:state.pendingMeetGrowthRewards.length};
  })()`);
  assert.equal(r.gain,5.71);assert.ok(r.once&&r.oldStats);assert.equal(r.notices,1);assert.equal(r.pending,null);assert.equal(r.oldNotices,0);
});

test('intercollege seniors obtain the award before retirement and their result remains in its popup',()=>{
  const run=game(true),r=run(`(()=>{
    rng=()=>.5;const p=state.players.find(a=>a.year===4);p.stats.mental=100;p.bestTimes={};p.growthProfile={4:1};state.trainingFocus[p.id]=['mental'];state.facilities.mental=100;
    completeMeet({meet:'intercollege',season:2026,slot:42,events:{fr100:{prelim:[{athlete:p}]}},relays:[]});
    return{gone:!state.players.some(a=>a.id===p.id),award:state.pendingMeetGrowthRewards[0].gains.find(g=>g.id===p.id),notice:state.pendingSeasonNotices[0].retired.some(a=>a.id===p.id)};
  })()`);
  assert.ok(r.gone&&r.notice);assert.equal(r.award.year,4);assert.equal(r.award.changes.find(c=>c.stat==='mental').up,5.71);
});

test('save capacity cleanup preserves awarded guards and unacknowledged growth popups',()=>{
  const save={season:2030,players:[],world:[],retiredArchive:[],meetGrowthRewardKeys:['2024:73:joint_record'],pendingMeetGrowthRewards:[{key:'2024:73:joint_record',gains:[{id:'own',changes:[]}]}],
    meetHistory:[{season:2020,slot:73,meet:'joint_record',padding:'x'.repeat(5000)}]};
  const plan=SwimSaveHistory.plan(save,{triggerBytes:1,targetBytes:1500}),packed=JSON.parse(plan.text);
  assert.ok(plan.removed>0);assert.deepEqual(packed.meetGrowthRewardKeys,save.meetGrowthRewardKeys);assert.deepEqual(packed.pendingMeetGrowthRewards,save.pendingMeetGrowthRewards);
});
