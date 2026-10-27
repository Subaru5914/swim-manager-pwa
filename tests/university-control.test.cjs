const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const load=vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+'\nscheduleAutoSave=()=>{};return code=>JSON.parse(JSON.stringify(eval(code)))',['globalThis','localStorage']);
let initial;
function game(){const storage=new Map(),run=load({crypto:{getRandomValues:a=>{a[0]=12345;return a}}},{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)});if(!initial){run('state=createState();migrateState();true');initial=run('JSON.stringify(state)')}else run('state='+initial+';for(const a of activeAthletes())attachMedleyStats(a);true');return run}

test('university control swaps existing rosters, preserves world identity, clocks, reputations and RNG, and restores school assets after reload',()=>{
 const r=game()(`(()=>{
  state.points=123;state.facilities.fr_speed=37;state.reputation=550;
  const target=state.universities.find(u=>u.id==='U08'),name=state.playerUniversity;
  const fingerprint=()=>JSON.stringify(activeAthletes().map(a=>[a.id,a.name,a.organization,a.age,a.stats,a.bestTimes,a.potentialType,a.growthProfile]).sort((a,b)=>a[0].localeCompare(b[0])));
  const before=fingerprint(),beforeRows=JSON.parse(fingerprint()),records=JSON.stringify([state.recordRankings,state.recordBook,state.meetHistory,state.japanTeamHistory]),rng=state.rngSeed,slot=state.slot;
  const originalIds=state.players.map(a=>a.id),targetIds=rivalUniversityRoster(target.id).map(a=>a.id).sort();
  const first=switchControlledUniversity(target.id),incoming=state.players.map(a=>a.id).sort();
  const switched=fingerprint()===before;state.points=19;state.facilities.fr_speed=8;
  const save=JSON.stringify(state);state=JSON.parse(save);migrateState();const retained=fingerprint()===before,differences=JSON.parse(fingerprint()).flatMap((row,i)=>JSON.stringify(row)!==JSON.stringify(beforeRows[i])?[{id:row[0],fields:row.map((v,j)=>JSON.stringify(v)!==JSON.stringify(beforeRows[i][j])?j:null).filter(v=>v!==null),before:beforeRows[i],after:row}]:[]).slice(0,3);
  const second=switchControlledUniversity('PLAYER'),recovered=state.players.map(a=>a.id);
  const own=[state.points,state.facilities.fr_speed,state.reputation],same=fingerprint()===before;
  state=JSON.parse(JSON.stringify(state));migrateState();
  return {differences,first,second,switched,retained,same,own,originalIds,recovered,targetIds,incoming,
   identity:state.universities.length===39&&new Set([controlledUniversityId(),...state.universities.map(u=>u.id)]).size===40,
   names:new Set([state.playerUniversity,...state.universities.map(u=>u.name)]).size,
   archived:state.universityControls.U08.points===19&&state.universityControls.U08.facilities.fr_speed===8,
   reputation:state.reputation,records:records===JSON.stringify([state.recordRankings,state.recordBook,state.meetHistory,state.japanTeamHistory]),rng:rng===state.rngSeed,slot:slot===state.slot};
 })()`);
 assert.ok(r.first.ok&&r.second.ok);for(const key of ['switched','retained','same','identity','archived','records','rng','slot'])assert.ok(r[key],key+JSON.stringify(r.differences));
 assert.equal(r.names,40);assert.deepEqual(r.own,[123,37,550]);assert.equal(r.reputation,550);assert.deepEqual(r.targetIds,r.incoming);assert.deepEqual(r.originalIds,r.recovered);
});

test('scouting destinations and attendance stay with their university when the player role changes',()=>{
 const r=game()(`(()=>{
  const id=Object.keys(state.scoutingCompetition.candidates)[0],r=scoutingRecord(id),a=state.world.find(a=>a.id===id);
  r.interests={player:80,U08:70,U09:60};r.contacts={player:4,U08:4};r.offers=['player','U08'];r.cpuTargets=['U08','U09'];r.destination='player';a.scouted=true;state.recruits=[id];
  state.meetParticipationHistory=[{season:2025,meet:'intercollege',individualOnly:true,counts:{player:3,U08:7,U09:2}}];
  const rng=state.rngSeed,scoutRng=state.scoutingCompetition.randomState;
  const first=switchControlledUniversity('U08'),away={destination:r.destination,counts:state.meetParticipationHistory[0].counts,interests:r.interests,recruits:state.recruits,scouted:a.scouted};
  const second=switchControlledUniversity('PLAYER');
  return {first,second,away,returned:{destination:r.destination,counts:state.meetParticipationHistory[0].counts,interests:r.interests,recruits:state.recruits,scouted:a.scouted},rng:rng===state.rngSeed&&scoutRng===state.scoutingCompetition.randomState};
 })()`);
 assert.ok(r.first.ok&&r.second.ok&&r.rng);assert.equal(r.away.destination,'PLAYER');assert.deepEqual(r.away.counts,{PLAYER:3,player:7,U09:2});assert.deepEqual(r.away.interests,{PLAYER:80,player:70,U09:60});assert.deepEqual(r.away.recruits,[]);assert.equal(r.away.scouted,false);
 assert.equal(r.returned.destination,'player');assert.deepEqual(r.returned.counts,{player:3,U08:7,U09:2});assert.deepEqual(r.returned.interests,{player:80,U08:70,U09:60});assert.equal(r.returned.recruits.length,1);assert.equal(r.returned.scouted,true);
});

test('inactive managed schools retain results and fixed training room; a running meet blocks switching',()=>{
 const r=game()(`(()=>{
  const p=state.players[0],id=p.id;const first=switchControlledUniversity('U08');
  const original=state.world.find(a=>a.id===id),goals=JSON.stringify(original.cpuDevelopment.goals);
  for(let n=0;n<8;n++){switchControlledUniversity('PLAYER');switchControlledUniversity('U08')}
  const noRenewal=goals===JSON.stringify(state.world.find(a=>a.id===id).cpuDevelopment.goals);
  const a=state.world.find(a=>a.id===id),time=round2(Math.min(a.bestTimes.fr100??Infinity,expectedTime(a,'fr100')));
  updateResultHistory(a,'fr100',time,'intercollege','A決勝',1);
  const archive=state.universityControls.PLAYER,recorded=archive.teamTop10.fr100.some(r=>r.athleteId===id&&r.time===time),medal=archive.teamPodiumHistory.some(r=>r.athleteId===id&&r.meet==='intercollege');
  const clean=!state.teamPodiumHistory.some(r=>r.athleteId===id);
  beginMeetSession('team_trial',8,2026);const before=JSON.stringify(state),blocked=switchControlledUniversity('PLAYER');
  return{first,noRenewal,recorded,medal,clean,blocked,unchanged:before===JSON.stringify(state)};
 })()`);
 assert.ok(r.first.ok&&r.noRenewal&&r.recorded&&r.medal&&r.clean&&r.unchanged,JSON.stringify(r));assert.equal(r.blocked.ok,false);
});

test('expanded domestic name pools keep rare surname weights and 0.1 percent mixed names without changing swimmer abilities',()=>{
 const r=game()(`(()=>{
  const used=new Set(),before=JSON.stringify(state.players),n=100000;let mixed=0;
  for(let i=0;i<n;i++){const name=newName(used),[last,first]=name.split(' ');if(MIXED_LAST.includes(last)||MIXED_FIRST.includes(first))mixed++}
  const surnames=new Set([...used].map(name=>name.split(' ')[0])),givenNames=new Set([...used].map(name=>name.split(' ')[1]));
  return{n,mixed,unique:used.size,rate:MIXED_NAME_RATE,unchanged:before===JSON.stringify(state.players),
   common:['木下','原','大島','佐久間','細川','河原'].every(name=>surnames.has(name))&&['正樹','浩平','祐司','健司','将生'].every(name=>givenNames.has(name)),
   weights:['木下','原','大島','小鳥遊','西園寺'].map(name=>WEIGHTED_LAST.filter(value=>value===name).length),
   pools:[FIRST.length,LAST.length],distinct:FIRST.length===new Set(FIRST).size&&LAST.length===new Set(LAST).size};
 })()`);
 assert.equal(r.rate,.001);assert.equal(r.unique,r.n);assert.ok(r.mixed>=65&&r.mixed<=140,JSON.stringify(r));assert.ok(r.unchanged);
 assert.ok(r.common&&r.distinct);assert.deepEqual(r.weights,[3,3,3,1,1]);
 console.log('Name pool sizes:',JSON.stringify(r.pools),'mixed names in sample:',r.mixed);
});

test('meet result snapshots preserve official clocks and entry PBs, omit animations, and relink live athletes and histories',()=>{
 const r=game()(`(()=>{
  const a=state.players[0],b=state.world.find(a=>a.category==='university');
  const result={meet:'intercollege',season:2026,slot:42,events:{fr200:{prelim:[{source:'PLAYER',athlete:a,entryPB:null,race:{total:125,trajectory:[{t:1}]}},{source:'CPU',athlete:b,race:{total:123}}],final:[{source:'PLAYER',athlete:a,entryPB:125,race:{total:124}}]}},relays:[],historyEntry:{meet:'intercollege',season:2026,slot:42},teamScoreEntry:{meet:'intercollege',season:2026,scores:{}}};
  state.meetHistory.push(result.historyEntry);state.teamScoreHistory.push(result.teamScoreEntry);
  const before=JSON.stringify([state.rngSeed,a.stats,a.bestTimes]),packed=packMeetResult(result),restored=unpackMeetResult(JSON.parse(JSON.stringify(packed)));
  return{size:JSON.stringify(packed).length,animation:JSON.stringify(packed).includes('trajectory'),same:restored.events.fr200.prelim[0].athlete===a&&restored.events.fr200.final[0].athlete===a&&restored.events.fr200.prelim[1].athlete===b,
   history:restored.historyEntry===result.historyEntry&&restored.teamScoreEntry===result.teamScoreEntry,clocks:[restored.events.fr200.prelim[0].entryPB,restored.events.fr200.final[0].entryPB,restored.events.fr200.final[0].race.total],untouched:before===JSON.stringify([state.rngSeed,a.stats,a.bestTimes])};
 })()`);
 assert.ok(r.same&&r.history&&r.untouched);assert.equal(r.animation,false);assert.deepEqual(r.clocks,[null,125,124]);assert.ok(r.size<10000,r.size);
});

test('extra-university control survives April with forty distinct universities, eight freshmen per school and no instant ability changes',()=>{
 const r=game()(`(()=>{
  switchControlledUniversity('CPUU101');
  const before=new Map(activeAthletes().map(a=>[a.id,JSON.stringify(a.stats)]));
  newSeason();const changed=activeAthletes().filter(a=>before.has(a.id)&&JSON.stringify(a.stats)!==before.get(a.id)).map(a=>a.id);
  const freshmen=[state.players.filter(a=>a.year===1).length,...state.universities.map(u=>state.world.filter(a=>a.category==='university'&&a.organization===u.name&&a.grade===1).length)];
  const snapshot=JSON.stringify([state.players,state.world,state.recordRankings,state.rngSeed]),saved=deepClone(state);state=JSON.parse(JSON.stringify(state));migrateState();
  const differences=["players","world"].flatMap(key=>state[key].flatMap(a=>{const old=saved[key].find(p=>p.id===a.id);return old&&JSON.stringify(a)!==JSON.stringify(old)?[{key,id:a.id,fields:Object.keys(a).filter(k=>JSON.stringify(a[k])!==JSON.stringify(old[k]))}]:[]})).slice(0,8);
  return{differences,changed,freshmen,stable:snapshot===JSON.stringify([state.players,state.world,state.recordRankings,state.rngSeed]),count:state.universities.length,unique:new Set([controlledUniversityId(),...state.universities.map(u=>u.id)]).size,own:controlledUniversityId(),duplicates:state.universities.some(u=>u.id==='CPUU101')};
 })()`);
 assert.deepEqual(r.changed,[]);assert.ok(r.freshmen.every(n=>n===8),JSON.stringify(r.freshmen));assert.ok(r.stable,JSON.stringify(r));assert.equal(r.count,39);assert.equal(r.unique,40);assert.equal(r.own,'CPUU101');assert.equal(r.duplicates,false);
});

test('an existing save without control metadata upgrades without regenerating names, abilities, PBs, records or RNG',()=>{
 const r=game()(`(()=>{
  delete state.controlledUniversityId;delete state.playerUniversityProfile;delete state.universityControls;state.version='pwa-v2.57';
  const before=JSON.stringify([state.players,state.world,state.recordRankings,state.reputation,state.points,state.rngSeed]);
  migrateState();const once=JSON.stringify(state);migrateState();
  return{same:before===JSON.stringify([state.players,state.world,state.recordRankings,state.reputation,state.points,state.rngSeed]),stable:once===JSON.stringify(state),id:controlledUniversityId(),count:state.universities.length};
 })()`);
 assert.ok(r.same&&r.stable);assert.equal(r.id,'PLAYER');assert.equal(r.count,39);
});

test('a former controlled college keeps national relay medals and highlights only its own members on return',()=>{
 const r=game()(`(()=>{
  const former=state.players[0];switchControlledUniversity('U08');const members=[former,...state.players.slice(0,3)];
  state.season=2027;state.activeCompetitionSeason=2027;state.activeCompetitionSlot=36;
  state.japanTeam={year:2027,athletes:members.map(a=>({id:a.id,snapshot:deepClone(a),universityId:a.id===former.id?'PLAYER':'U08',ownAtSelection:a.id!==former.id}))};
  recordRelayResult('4x100fr',{organization:'日本',members,rank:1,race:{total:round2(expectedRelayTime(members,'4x100fr')),legs:members.map(a=>round2(expectedTime(a,'fr100')))}},'world_championship','決勝');
  const rows=state.universityControls.PLAYER.teamPodiumHistory.filter(r=>r.event==='4x100fr'&&r.meet==='world_championship');
  const kept=rows.length===1&&rows[0].members.filter(m=>m.own).map(m=>m.id).join()===former.id;
  state.activeCompetitionSlot=null;state.activeCompetitionSeason=null;switchControlledUniversity('PLAYER');
  return{kept,record:state.teamTop10['4x100fr'].some(r=>r.meet==='world_championship'),own:state.teamPodiumHistory.filter(r=>r.meet==='world_championship'&&r.event==='4x100fr').map(r=>r.members.filter(m=>m.own).map(m=>m.id)),expected:former.id};
 })()`);
 assert.ok(r.kept&&r.record);assert.deepEqual(r.own,[[r.expected]]);
});

test('history cleanup protects an inactive university top-ten clock after it leaves the global rankings',()=>{
 const History=require('../save-history.js');
 const save={season:2035,players:[],world:[{id:'old-player',bestTimes:{fr100:65},raceHistory:[{season:2026,meet:'intercollege',event:'fr100',time:60},{season:2026,meet:'team_trial',event:'fr100',time:64}]}],universityControls:{PLAYER:{teamTop10:{fr100:[{kind:'individual',athleteId:'old-player',event:'fr100',time:60,season:2026,meet:'intercollege'}]}}},recordRankings:{},teamTop10:{},recordBook:{}};
 const cleanup=History.plan(save,{triggerBytes:0,targetBytes:0});assert.equal(cleanup.removed,1);cleanup.apply(save);assert.deepEqual(save.world[0].raceHistory.map(r=>r.time),[60]);assert.equal(save.universityControls.PLAYER.teamTop10.fr100[0].time,60);
});

test('reopened selection drafts have monotonic revisions so an older saved draft cannot hide the latest choice',()=>{
 const data=new Map(),run=load({}, {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)});
 const r=run(`(()=>{
  state={gameId:'same-world',controlledUniversityId:'PLAYER',slot:10};
  beginMeetSession('world_championship',36,2027,'worldEntry');updateMeetDraft('worldEntry',{worldSelections:{fr100:['first']}});
  const old=deepClone(state),revision=state.meetSession.revision;
  clearMeetSession();beginMeetSession('world_championship',36,2027,'worldEntry');updateMeetDraft('worldEntry',{worldSelections:{fr100:['latest']}});
  state=old;restoreMeetDraftJournal();const restored=state.meetSession.worldSelections.fr100[0],newRevision=state.meetSession.revision;
  updateMeetDraft('worldEntry',{worldSelections:{fr100:['next']}});
  return{restored,revision,newRevision,last:state.meetSession.revision,slot:state.slot};
 })()`);
 assert.equal(r.restored,'latest');assert.ok(r.newRevision>r.revision&&r.last>r.newRevision);assert.equal(r.slot,10);
});

test('world relay members retain their university at selection after graduation and a change of controlled university',()=>{
 const run=load({}, {getItem:()=>null,setItem(){},removeItem(){}});
 const r=run(`(()=>{
  state={controlledUniversityId:'U08',playerUniversity:'他大学',universities:[{id:'PLAYER',name:'元の大学'}],japanTeam:{athletes:[{id:'graduate',universityId:'PLAYER'}]}};
  const member=japanRepresentativeMember({id:'graduate',name:'卒業選手',category:'adult',organization:'実業団',age:23},'graduate',false);
  const other=representativeBelongsToControl(member);state.controlledUniversityId='PLAYER';state.playerUniversity='元の大学';
  return{universityId:member.universityId,other,own:representativeBelongsToControl(member),organization:member.organization};
 })()`);
 assert.equal(r.universityId,'PLAYER');assert.equal(r.other,false);assert.equal(r.own,true);assert.equal(r.organization,'実業団');
});
