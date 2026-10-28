const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(){return vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+`
 state={season:2026,slot:60,rngSeed:5914,playerUniversity:'自大学',players:[],world:[],universities:[],kansaiIds:[],interIds:[],points:100,reputation:50,pointLog:[],meetHistory:[],teamScoreHistory:[],trainingFocus:{},trainingPlans:{},lastTrainingGains:[]};
 function swimmer(id){return attachMedleyStats({id,name:id,year:2,grade:2,category:'university',organization:state.playerUniversity,specialty:'fr100',stats:Object.fromEntries(STATS.map(k=>[k,150])),bestTimes:Object.fromEntries(EVENTS.map(e=>[e,standardFor('japan_championship',e)||20])),raceHistory:[],accolades:[]})}
 const own=swimmer('own'),reserve=swimmer('reserve');state.players=[own,reserve];
 const row=(id,time,own=false)=>({source:own?'PLAYER':'CPU',athlete:own?state.players.find(a=>a.id===id):{id,name:id,organization:'他大学'},race:{total:time},rank:99});
 const team=(organization,time)=>({organization,members:Array.from({length:4},(_,i)=>({id:'leg'+i})),race:{total:time}});
 function result(meet='teijimayama_championship',slot=60){return{meet,season:2026,slot,entryPoints:0,finalRankPointsVersion:1,pointUniversityId:controlledUniversityId(),pointUniversityName:state.playerUniversity,events:{},relays:[]}}
 awardMeetGrowth=()=>null;refreshRecordBook=()=>{};refreshScoutBoard=()=>{};selectJapanTeam=()=>null;
 return code=>JSON.parse(JSON.stringify(eval(code)))`,[])()}

test('only the three capped college tournament meets earn final-place currency; spring fixed rewards, preliminaries, CPU swimmers and malformed clocks earn none',()=>{
 const r=game()(`(()=>{const outcomes=[];
  for(const meet of ['spring_kansai','kansai_college','intercollege','teijimayama_championship','japan_open','japan_championship','joint_record','world_championship','team_trial']){
   const m=result(meet);m.events.fr100={prelim:[row('own',40,true)],final:[row('own',null,true),row('cpu',49),row('own',50,true)]};
   const before=JSON.stringify([m,state.rngSeed,state.players]),reward=finalMeetPointReward(m);
   outcomes.push({meet,points:reward?.points??null,unchanged:before===JSON.stringify([m,state.rngSeed,state.players])});
  }return outcomes;
 })()`);
 for(const x of r){assert.equal(x.points,['kansai_college','intercollege','teijimayama_championship'].includes(x.meet)?10:null,x.meet);assert.ok(x.unchanged)}
});

test('every individual final and one relay team earn their place once; tied places share the occupied point pool and use official hundredths',()=>{
 const r=game()(`(()=>{const m=result();m.events.fr100={prelim:[row('own',40,true)],final:[row('reserve',60,true),row('cpu',50),row('own',51.001,true),row('tied',51.004),row('c4',54),row('c5',55),row('c6',56),row('c7',57)]};
  m.events.fr200={final:[row('own',100,true),row('cpu2',101)]};m.relays=[['4x100fr',[team(state.playerUniversity,200),team('他大学',201)],{prelim:[team(state.playerUniversity,180)]}]];
  const reward=finalMeetPointReward(m),tie=result();tie.events.fr100={final:[row('c1',50),row('c2',51),row('c3',52),row('own',53,true),row('c5',53),row('c6',53),row('c7',54),row('c8',55)]};
  return{reward,fraction:finalMeetPointReward(tie).points};
 })()`);
 assert.equal(r.reward.points,34);assert.deepEqual(r.reward.awards.map(x=>[x.event,x.rank,x.points]),[['fr100',2,9],['fr100',8,1],['fr200',1,12],['4x100fr',1,12]]);assert.equal(r.fraction,4.33);
});

test('deferred relay finals pay only after the actual lineup finishes and remain paid once through JSON checkpoints and repeated completion',()=>{
 const r=game()(`(()=>{const m=result();m.events.fr100={final:[row('own',50,true)]};m.relays=[['4x100fr',[team('他大学',190),team(state.playerUniversity,200)],{finalEntryPending:true}]];
  m.historyEntry={season:m.season,slot:m.slot,meet:m.meet,pointsAfter:state.points};state.meetHistory.push(m.historyEntry);
  prepareMeetCompletion(m,{deferRelayFinalEntries:true});completeMeet(m);const held=state.points===100&&!m.completed&&!state.pointLog.length;
  m.relays[0][1][1].race.total=180;m.relays[0][2].finalEntryPending=false;cachePendingMeetPointReward(m);
  const packed=packMeetResult(m);state=JSON.parse(JSON.stringify(state));const restored=unpackMeetResult(JSON.parse(JSON.stringify(packed)));completeMeet(restored);
  const paid=state.points,log=state.pointLog,before=JSON.stringify(state);completeMeet({...restored,completed:false});
  return{held,paid,log,once:before===JSON.stringify(state),history:state.meetHistory[0],reward:restored.finalPointReward,summary:finalMeetPointRewardHtml(restored)};
 })()`);
 assert.ok(r.held&&r.once);assert.equal(r.paid,124);assert.equal(r.log.length,1);assert.equal(r.log[0].points,24);assert.equal(r.history.pointsAfter,124);assert.equal(r.history.finalPointReward.points,24);assert.match(r.summary,/＋24pt/);assert.match(r.summary,/獲得ポイントの内訳/);
});

test('a completed pending snapshot recovers its award without races, while old sessions and already-paid university keys do not receive new rewards',()=>{
 const r=game()(`(()=>{const m=result();m.events.fr100={final:[row('own',50,true)]};prepareMeetCompletion(m,{deferRelayFinalEntries:true});
  const pending=JSON.parse(JSON.stringify(state.pendingMeetCompletion));completeMeet({...pending,events:{},relays:[]});const paid=state.points;
  const old=result('intercollege',44);delete old.finalRankPointsVersion;old.events.fr100={final:[row('own',50,true)]};completeMeet(old);
  const before=JSON.stringify(state);completeMeet({...m,completed:false});
  const other=result('teijimayama_championship',61);other.pointUniversityId='U08';other.events.fr100={final:[row('own',50,true)]};awardFinalMeetPoints(other);
  return{paid,points:state.points,log:state.pointLog.length,unchanged:before===JSON.stringify(state),snapshot:pending.finalPointReward.points};
 })()`);
 assert.equal(r.paid,112);assert.equal(r.points,112);assert.equal(r.log,1);assert.equal(r.snapshot,12);assert.ok(r.unchanged);
});

test('real meet execution adds college entry currency to final-place rewards and preserves national and winter currency',()=>{
 const r=game()(`(()=>{const reports=[];runRelays=()=>[];
  runEvent=(meet,event,ids)=>({prelim:ids.map(id=>row(id,50,true)),final:ids.map(id=>row(id,49,true)),heats:[]});
  for(const [meet,slot,expected]of [['spring_kansai',16,30],['kansai_college',28,13],['intercollege',44,13],['teijimayama_championship',60,13],['japan_open',64,1],['japan_championship',94,1],['joint_record',76,30]]){
   state.slot=slot;const before=state.points,entries=Object.fromEntries(EVENTS.map(e=>[e,e==='fr100'?['own']:[]]));markJointScouts=()=>{};
   const m=executeMeetWithForm(meet,entries,{}),after=state.points;completeMeet({...m,completed:false});reports.push({meet,gain:after-before,expected,once:after===state.points,history:m.historyEntry.pointsAfter===state.points});
  }return reports;
 })()`);
 for(const x of r){assert.equal(x.gain,x.expected,x.meet);assert.ok(x.once&&x.history,x.meet)}
});

test('spring Kansai pays exactly 30 for zero, single or unlimited entries and any final rank, once across saved race and completion checkpoints',()=>{
 const r=game()(`(()=>{const reports=[];runRelays=()=>[];
  for(const [i,mode]of ['none','one','all'].entries()){
   state.season=2026+i;state.slot=16;
   runEvent=(meet,event,ids)=>({prelim:ids.map(id=>row(id,50,true)),final:ids.map(id=>row(id,49,true)),heats:[]});
   const entries=Object.fromEntries(EVENTS.map(e=>[e,mode==='all'?['own','reserve']:mode==='one'&&e==='fr100'?['own']:[]])),before=state.points;
   const m=executeMeetWithForm('spring_kansai',entries,{}, {deferRelayFinalEntries:true}),starting=state.points-before,pending=deepClone(state.pendingMeetCompletion);
   const packed=packMeetResult(m);state=JSON.parse(JSON.stringify(state));const restored=unpackMeetResult(JSON.parse(JSON.stringify(packed)));completeMeet(restored);
   const gain=state.points-before,history=deepClone(state.meetHistory.at(-1));state.points-=5;const snapshot=JSON.stringify(state);completeMeet({...restored,completed:false});
   reports.push({mode,starting,gain,pending,history,once:snapshot===JSON.stringify(state),reward:restored.fixedPointReward,rankReward:finalMeetPointReward(restored),html:finalMeetPointRewardHtml(restored),logs:state.pointLog.filter(p=>p.meet==='spring_kansai'&&p.season===state.season).map(p=>[p.kind,p.points])});
  }return reports;
 })()`);
 for(const x of r){assert.equal(x.starting,30,x.mode);assert.equal(x.gain,30,x.mode);assert.ok(x.once,x.mode);assert.equal(x.reward.points,30);assert.equal(x.history.fixedPointReward.points,30);assert.equal(x.history.entryPoints,0);assert.equal(x.rankReward,null);assert.equal(x.pending.fixedPointReward.points,30);assert.deepEqual(x.logs,[['fixed_meet',30]]);assert.match(x.html,/大会獲得ポイント ＋30pt/);assert.match(x.html,/1大会30pt固定/);assert.doesNotMatch(x.html,/data-entry-point-total|data-final-point-total|決勝順位/)}
});

test('an unfinished spring meet settles earlier entry payments to a total of 30; completed meets and another university retain their balance',()=>{
 const r=game()(`(()=>{const outcomes=[];
  for(const [i,paid]of [4,72].entries()){
   state.season=2026+i;state.slot=16;const before=state.points,m=result('spring_kansai',16);m.season=state.season;m.entryPoints=paid;m.events.fr100={prelim:[row('own',50,true)],final:[row('own',49,true)]};
   awardMeetEntryPoints('spring_kansai',paid,m.season,m.slot);m.historyEntry={season:m.season,slot:m.slot,meet:m.meet,entryPoints:paid,pointsAfter:state.points};state.meetHistory.push(m.historyEntry);
   const protectedData=JSON.stringify([state.players,state.rngSeed]);completeMeet(m);const once=JSON.stringify(state);completeMeet({...m,completed:false});
   outcomes.push({paid,gain:state.points-before,delta:state.pointLog.at(-1).points,history:m.historyEntry,once:once===JSON.stringify(state),protected:protectedData===JSON.stringify([state.players,state.rngSeed])});
  }
  const before=JSON.stringify(state),completed=result('spring_kansai',16);completed.completed=true;completeMeet(completed);
  const other=result('spring_kansai',17);other.pointUniversityId='another-university';awardFinalMeetPoints(other);
  return{outcomes,untouched:before===JSON.stringify(state)};
 })()`);
 assert.ok(r.untouched);for(const x of r.outcomes){assert.equal(x.gain,30);assert.equal(x.delta,30-x.paid);assert.equal(x.history.fixedPointReward.points,30);assert.equal(x.history.entryPoints,0);assert.ok(x.once&&x.protected)}
});

test('individual entries earn one per athlete and event even without a final, and saves and duplicate requests never award entry points twice',()=>{
 const r=game()(`(()=>{runRelays=()=>[];runEvent=(meet,event,ids)=>({prelim:ids.map(id=>row(id,50,true)),final:[],heats:[]});
  const entries=Object.fromEntries(EVENTS.map(e=>[e,e==='fr100'?['own','reserve']:e==='fr200'?['own']:[]]));
  const m=executeMeetWithForm('teijimayama_championship',entries,{}, {deferRelayFinalEntries:true});
  const starting=state.points,entry=m.entryPoints,packed=packMeetResult(m);state=JSON.parse(JSON.stringify(state));
  const restored=unpackMeetResult(JSON.parse(JSON.stringify(packed)));completeMeet(restored);const before=JSON.stringify(state);
  awardMeetEntryPoints(m.meet,3,m.season,m.slot);completeMeet({...restored,completed:false});
  return{starting,entry,points:state.points,once:before===JSON.stringify(state),logs:state.pointLog,html:finalMeetPointRewardHtml(restored)};
 })()`);
 assert.equal(r.starting,103);assert.equal(r.entry,3);assert.equal(r.points,103);assert.ok(r.once);assert.deepEqual(r.logs.map(x=>[x.kind,x.points]),[['entry',3],['final_rank',0]]);assert.match(r.html,/＋3pt/);assert.match(r.html,/出場 3pt/);assert.match(r.html,/決勝順位 0pt/);
});

test('rank-only races in progress recover missing actual entries once while completed meets and entry-paid races keep their existing balance',()=>{
 const r=game()(`(()=>{const m=result();delete m.entryPoints;
  m.events={fr100:{prelim:[row('own',50,true),row('own',50,true),row('reserve',51,true),row('cpu',52)],final:[row('own',49,true)]},fr200:{prelim:[row('own',100,true)],final:[]}};
  const archived=deepClone(m);archived.completed=true;completeMeet(archived);const completedUnchanged=state.points===100;
  completeMeet(m);const after=JSON.stringify(state);completeMeet({...archived,completed:false});
  return{completedUnchanged,entry:m.entryPoints,points:state.points,once:after===JSON.stringify(state),logs:state.pointLog.map(x=>[x.kind,x.points]),html:finalMeetPointRewardHtml(m)};
 })()`);
 assert.ok(r.completedUnchanged&&r.once);assert.equal(r.entry,3);assert.equal(r.points,115);assert.deepEqual(r.logs,[['entry',3],['final_rank',12]]);assert.match(r.html,/＋15pt/);
});
