const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8'),source=html.match(/<script>([\s\S]*?)<\/script>/)[1];
function game(){return vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+`
 state={season:2026,slot:43,rngSeed:5914,playerUniversity:'自大学',players:[],world:[],universities:[],kansaiIds:[],interIds:[],teamTop10:{},recordRankings:{},recordBook:{},teamPodiumHistory:[],meetHistory:[],teamScoreHistory:[],pointLog:[],points:0};
 function swimmer(i,org=state.playerUniversity){return{id:'p'+i,name:'選手'+i,category:'university',year:2,grade:2,organization:org,specialty:'fr100',stats:Object.fromEntries(STATS.map(k=>[k,130])),bestTimes:{fr100:40},raceHistory:[],accolades:[]}}
 return code=>JSON.parse(JSON.stringify(eval(code)))`,[])()}

test('official hundredths share competition places; local heat places do not reuse the overall rank or mutate rows',()=>{
 const run=game(),r=run(`(()=>{
  const rows=[50.001,50.004,50.01,51,51,51,52].map((total,i)=>({athlete:swimmer(i),race:{total},rank:90+i}));
  const before=JSON.stringify(rows),ranks=racePlacings(rows),html=resultRankingRows(rows,'fr100');
  return{ranks,unchanged:before===JSON.stringify(rows),display:[...html.matchAll(/<tr[^>]*><td>(\\d+)<\\/td>/g)].map(x=>+x[1]),subgroup:racePlacings(rows.slice(3)),invalid:racePlacings([{},{},{race:{total:50}},{race:{total:50}}]),assigned:assignRaceRanks(rows).map(r=>r.rank)};
 })()`);
 assert.deepEqual(r.ranks,[1,1,3,4,4,4,7]);assert.deepEqual(r.display,r.ranks);assert.deepEqual(r.assigned,r.ranks);assert.deepEqual(r.subgroup,[1,1,1,4]);assert.deepEqual(r.invalid,[1,2,3,3]);assert.ok(r.unchanged);
});

test('all domestic individual races and world races retain tied ranks in results, histories, medals and the original qualifying times',()=>{
 const run=game(),reports=run(`(()=>{
  const reports=[];simulateRace=(a,e,champ,record,takeover,preliminary)=>({total:preliminary?a.pre:a.fin});simulateMeetRace=(a,e,m,r,preliminary)=>simulateRace(a,e,true,r,false,preliminary);
  for(const meet of ['kansai_college','intercollege','teijimayama_championship','joint_record','japan_open','japan_championship','world_championship']){
   state.universities=[{id:'cpu',name:'他大学'}];state.kansaiIds=['cpu'];state.interIds=['cpu'];
   state.players=Array.from({length:8},(_,i)=>Object.assign(swimmer(i),{pre:[50,50,51,52,53,54,55,56][i],fin:[48,49,49,50,51,52,53,54][i]}));
   state.world=[8,9].map(i=>Object.assign(swimmer(i,'他大学'),{pre:i===8?56:60,fin:i===8?55:60}));state.teamPodiumHistory=[];
   const result=meet==='world_championship'?raceEventField(meet,'fr100',[...state.players.map(athlete=>({source:'PLAYER',athlete})),...state.world.map(athlete=>({source:'CPU',athlete}))]):runEvent(meet,'fr100',state.players.map(a=>a.id),{fr100:state.world.map(a=>a.id)});
   const program={meet,events:{fr100:result},relays:[]},manual={fr100:state.players.map(a=>a.id)},queue=buildMeetRaceQueue(program,manual);
   reports.push({meet,pre:result.prelim.map(r=>r.achievement.rank),final:result.final.map(r=>r.achievement.rank),finalIds:result.final.map(r=>r.athlete.id),swimOffs:result.swimOffs.length,
    history:state.players[2].raceHistory.find(r=>r.stage==='A決勝').rank,medal:state.players[2].accolades.find(r=>r.event==='fr100').rank,
    ownOriginal:result.prelim.find(r=>r.athlete.id==='p7').race.total,ownFinalPre:result.final.find(r=>r.athlete.id==='p7').prelimTime,
    swimOffPlayback:queue.some(q=>q.swimOff&&q.rows.some(row=>row.athlete.id==='p7')),pbFromSwimOff:state.players[7].raceHistory.some(r=>r.stage.startsWith('スイムオフ')),world:japanWorldRaceRecord(result.final.find(r=>r.athlete.id==='p2'),2).rank});
  }return reports;
 })()`);
 for(const r of reports){assert.deepEqual(r.pre,[1,1,3,4,5,6,7,8,8,10],r.meet);assert.deepEqual(r.final,[1,2,2,4,5,6,7,8],r.meet);assert.ok(r.finalIds.includes('p7')&&!r.finalIds.includes('p8'));assert.equal(r.swimOffs,1);assert.equal(r.history,2);assert.equal(r.medal,2);assert.equal(r.world,2);assert.equal(r.ownOriginal,56);assert.equal(r.ownFinalPre,56);assert.ok(r.swimOffPlayback&&r.pbFromSwimOff)}
});

test('team trials and podium summaries retain every swimmer tied within the first three places',()=>{
 const run=game(),r=run(`(()=>{
  state.players=Array.from({length:5},(_,i)=>Object.assign(swimmer(i),{clock:[50,51,52,52,53][i]}));
  simulateRace=a=>({total:a.clock});runRelays=()=>[];refreshRecordBook=()=>{};prepareMeetCompletion=()=>{};refreshScoutBoard=()=>{};
  const result=executeMeetWithForm('team_trial',{fr100:state.players.map(a=>a.id)},{});
  return{ranks:result.events.fr100.prelim.map(r=>r.achievement.rank),history:state.players[3].raceHistory[0].rank,podiums:state.meetHistory[0].podiums.fr100};
 })()`);
 assert.deepEqual(r.ranks,[1,2,3,3,5]);assert.equal(r.history,3);assert.deepEqual(r.podiums.map(r=>r.rank),[1,2,3,3]);assert.equal(r.podiums.length,4);
});

test('individual and double relay points share the tied positions and preserve total points and mathematically tied university totals',()=>{
 const run=game(),r=run(`(()=>{
  state.universities=Array.from({length:8},(_,i)=>({id:'U'+i,name:'大学'+i}));state.interIds=state.universities.map(u=>u.id);
  const clocks=[50,51,51,53,54,55,56,57],final=clocks.map((total,i)=>({athlete:swimmer(i,'大学'+i),race:{total}})),events=()=>Object.fromEntries(EVENTS.map(e=>[e,{final:[]}]));
  const individual=events();individual.fr100.final=final;
  const a=teamScoring('intercollege',individual,[]),b=teamScoring('intercollege',events(),[['4x100fr',final.map(r=>({organization:r.athlete.organization,race:r.race}))]]);
  const fractional=events();fractional.fr100.final=clocks.map((_,i)=>({athlete:swimmer(i,i===3?'大学0':i===4?'大学1':'他大学'),race:{total:i>=3&&i<=5?53:50+i}}));
  const shifted=JSON.parse(JSON.stringify(fractional.fr100.final));[shifted[3].athlete.organization,shifted[4].athlete.organization]=[shifted[4].athlete.organization,shifted[3].athlete.organization];fractional.fr200.final=shifted;
  return{a,b,empty:teamScoring('japan_open',individual,[]),fractional:teamScoring('intercollege',fractional,[])};
 })()`);
 const expected=[12,9,9,6,4,3,2,1];for(let i=0;i<8;i++){assert.equal(r.a['大学'+i],expected[i]);assert.equal(r.b['大学'+i],expected[i]*2)}assert.equal(Object.values(r.a).reduce((a,b)=>a+b,0),46);assert.deepEqual(r.empty,{});assert.equal(r.fractional['大学0'],r.fractional['大学1']);
});

test('swim-offs keep eight finalists, retain all ties, consume no draw without a cutoff tie and terminate repeated ties',()=>{
 const run=game(),r=run(`(()=>{
  const make=(i,total)=>({source:'CPU',athlete:swimmer(i,'他大学'),race:{total}});
  const before=state.rngSeed,none=selectRaceFinalists(Array.from({length:10},(_,i)=>make(i,50+i)),'fr100','japan_open'),untouched=before===state.rngSeed;
  simulateRace=()=>({total:50});const all=Array.from({length:25},(_,i)=>make(i,50)),copy=JSON.stringify(all),repeated=selectRaceFinalists(all,'fr100','japan_open');
  return{untouched,none:none.swimOffs.length,finals:repeated.qualifiers.length,unique:new Set(repeated.qualifiers.map(r=>r.athlete.id)).size,groups:repeated.swimOffs.length,maxGroup:Math.max(...repeated.swimOffs.map(g=>g.length)),rounds:[...new Set(repeated.swimOffs.flat().map(r=>r.swimOffRound))],unchanged:copy===JSON.stringify(all),ranks:racePlacings(all)};
 })()`);
 assert.ok(r.untouched&&r.unchanged);assert.equal(r.none,0);assert.equal(r.finals,8);assert.equal(r.unique,8);assert.equal(r.groups,12);assert.ok(r.maxGroup<=8);assert.deepEqual(r.rounds,[1,2,3]);assert.ok(r.ranks.every(rank=>rank===1));
});

test('college and world relay races save tied places and swim-off advancement for all members',()=>{
 const run=game(),reports=run(`(()=>{
  const reports=[];bestRelayMembers=roster=>roster.slice(0,4);cpuRelayPreliminaryEntries=entries=>entries;
  for(const world of [false,true]){
   const organizations=world?WORLD_COUNTRIES.concat('日本'):Array.from({length:9},(_,i)=>i===8?state.playerUniversity:'大学'+i),ownOrg=world?'日本':state.playerUniversity;
   const index=org=>world?(org==='日本'?8:WORLD_COUNTRIES.indexOf(org)<8?WORLD_COUNTRIES.indexOf(org):WORLD_COUNTRIES.indexOf(org)+1):org===state.playerUniversity?8:+org.slice(2);
   const members=org=>Array.from({length:4},(_,j)=>swimmer(index(org)*4+j,org)),rosters=new Map(organizations.map(org=>[org,members(org)]));
   state.players=rosters.get(ownOrg);state.world=organizations.filter(org=>org!==ownOrg).flatMap(org=>rosters.get(org));
   state.universities=organizations.filter(org=>org!==ownOrg).map((name,i)=>({id:'U'+i,name}));state.interIds=state.universities.map(u=>u.id);state.teamPodiumHistory=[];
   simulateRelay=(members,kind,record,preliminary)=>{const i=index(members[0].organization),total=preliminary?(i>=7&&i<=8?207:200+i):(i===8?190:i===1||i===2?192:191+i);return{total,legs:Array(4).fill(total/4)}};
   if(world){
    state.japanTeam={year:2027,athletes:state.players.map(snapshot=>({id:snapshot.id,snapshot,ownAtSelection:true}))};
    japanTeamAthlete=id=>state.players.find(a=>a.id===id);
    worldAutoEntries=()=>({relays:Object.fromEntries(RELAYS.map(k=>[k,state.players.map(a=>a.id)]))});
    ensureInternationalWorld=()=>({athletes:state.world,relayTeams:Object.fromEntries(WORLD_COUNTRIES.map(country=>[country,Object.fromEntries(RELAYS.map(k=>[k,rosters.get(country).map(a=>a.id)]))]))});
   }
   const entries=world?runWorldRelays(2027):runRelays('intercollege',Object.fromEntries(RELAYS.map(k=>[k,state.players.map(a=>a.id)])));
   for(const [kind,finals,meta]of entries){
    const own=finals.find(t=>t.organization===ownOrg),pre=meta.prelim.find(t=>t.organization===ownOrg);
    reports.push({world,kind,pre:pre.prelimRank,ranks:finals.map(r=>r.rank),own:own.rank,history:state.players.map(a=>a.raceHistory.find(h=>h.event===kind&&h.stage==='決勝').rank),swimOffs:meta.swimOffs.length,finals:finals.length,originalTime:pre.race.total,finalPre:own.prelimTime});
   }
  }return reports;
 })()`);
 for(const r of reports){assert.equal(r.pre,8);assert.deepEqual(r.ranks,[1,2,3,3,5,6,7,8]);assert.equal(r.own,1);assert.deepEqual(r.history,[1,1,1,1]);assert.equal(r.swimOffs,1);assert.equal(r.finals,8);assert.equal(r.originalTime,207);assert.equal(r.finalPre,207)}
});

test('relay final lineup changes recompute tied places, split points and current CPU snapshots without rewriting earlier records',()=>{
 const run=game(),r=run(`(()=>{
  const kind='4x100fr';state.players=Array.from({length:5},(_,i)=>swimmer(i));
  state.universities=[{id:'U1',name:'大学1'},{id:'U2',name:'大学2'}];state.interIds=['U1','U2'];
  state.world=state.universities.flatMap((u,i)=>Array.from({length:4},(_,j)=>swimmer(10+i*4+j,u.name)));
  const own={organization:state.playerUniversity,members:state.players.slice(0,4),rank:1,heatLane:4,race:{total:199,legs:[49,50,50,50]}};
  const cpus=state.universities.map(u=>({organization:u.name,members:state.world.filter(a=>a.organization===u.name),rank:2,race:{total:200,legs:[50,50,50,50]}}));
  cpus.forEach(team=>recordRelayResult(kind,team,'intercollege','決勝'));
  state.recordRankings.japan[kind].find(r=>r.organization==='大学1').season=2025;
  const result={meet:'intercollege',season:2026,slot:43,events:Object.fromEntries(EVENTS.map(e=>[e,{final:[]}])),relays:[[kind,[own,...cpus],{prelim:[],heats:[],finalEntryPending:true}]],historyEntry:{},teamScoreEntry:{}};
  simulateRelay=()=>({total:200,legs:[50,50,50,50]});refreshRecordBook=()=>{};
  const team=setRelayFinalEntry(result,kind,state.players.slice(1,5).map(a=>a.id));
  return{ranks:result.relays[0][1].map(t=>t.rank),points:result.teamScores,current:state.recordRankings.university[kind].filter(r=>r.organization!==state.playerUniversity).map(r=>r.rank),old:state.recordRankings.japan[kind].find(r=>r.organization==='大学1').rank,ownHistory:team.members.map(a=>a.raceHistory.find(h=>h.event===kind&&h.stage==='決勝').rank)};
 })()`);
 assert.deepEqual(r.ranks,[1,1,1]);assert.deepEqual(r.current,[1,1]);assert.equal(r.old,2);assert.deepEqual(r.ownHistory,[1,1,1,1]);for(const points of Object.values(r.points))assert.equal(points,20);
});

test('a genuine swim-off PB is committed to the swimmer, school and national records without recording a final medal',()=>{
 const run=game(),r=run(`(()=>{
  const a=swimmer(0);a.bestTimes.fr100=50;state.players=[a];
  const row={source:'PLAYER',athlete:a,rank:1,swimOffRound:1,race:{total:49}};recordSwimOffs([[row]],'fr100','japan_open');
  state.players.push(...[1,2,3].map(i=>swimmer(i)));recordSwimOffs([[{organization:state.playerUniversity,members:state.players,rank:1,swimOffRound:1,race:{total:200,legs:[49,50,50,51]}}]],'4x100fr','intercollege');
  return{pb:a.bestTimes.fr100,achievement:row.achievement.pb,history:a.raceHistory[0],team:state.teamTop10.fr100[0].time,national:state.recordRankings.japan.fr100[0].time,relay:state.teamTop10['4x100fr'][0].time,medals:state.teamPodiumHistory.length};
 })()`);
 assert.equal(r.pb,49);assert.ok(r.achievement);assert.equal(r.history.stage,'スイムオフ（1回目）');assert.equal(r.team,49);assert.equal(r.national,49);assert.equal(r.relay,200);assert.equal(r.medals,0);
});
