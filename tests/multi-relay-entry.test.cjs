const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const load=vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+'\nreturn code=>JSON.parse(JSON.stringify(eval(code)))',['globalThis']);
function game(){
 const run=load({crypto:{getRandomValues:a=>{a[0]=5914;return a}}});
 run(`state={season:2026,slot:16,rngSeed:5914,playerUniversity:'自大学',players:[],world:[],universities:[{id:'K',name:'関西大学'},{id:'N',name:'関東大学'}],kansaiIds:['K','N'],interIds:['K','N'],teamTop10:{},recordRankings:{},recordBook:{},teamPodiumHistory:[]}`);
 return run;
}
function setupRaces(){
 return `(()=>{
  expectedTime=(a,event)=>a.bestTimes[event]??100;
  reactionTime=()=>0;
  cpuRelayPreliminaryEntries=(entries)=>entries;
  simulateRelay=(members,kind)=>{const events=relayLegEvents(kind),legs=members.map((a,i)=>a.bestTimes[events[i]]??100);return{total:round2(legs.reduce((sum,time)=>sum+time,0)),legs}};
  simulateCpuRelay=(members,kind)=>simulateRelay(members,kind);
  recordRelayResult=()=>{};recordSwimOffs=()=>{};
  const athlete=(id,organization,n)=>({id,name:id,category:'university',grade:2,organization,bestTimes:Object.fromEntries(EVENTS.map((event,i)=>[event,40+n*.1+i]))});
  state.players=Array.from({length:16},(_,i)=>athlete('own'+i,state.playerUniversity,i));
  state.world=['関西大学','関東大学'].flatMap(org=>Array.from({length:12},(_,i)=>athlete(org+i,org,i+1)));
  return{own:state.players.map(a=>a.id),springSchools:meetUniversities('spring_kansai'),higaSchools:meetUniversities('joint_record')};
 })()`;
}

test('only Spring Kansai and January Higashikata CUP allow up to three relay squads',()=>{
 const run=game(),r=run(`(()=>({spring:relayTeamLimit('spring_kansai',16),higashikata:relayTeamLimit('joint_record',76),dynamio:relayTeamLimit('joint_record',84),other:relayTeamLimit('kansai_college',28)}))()`);
 assert.deepEqual(r,{spring:3,higashikata:3,dynamio:1,other:1});
});

test('expanded relay meets add heats instead of dropping eligible universities after the old six-heat cap',()=>{
 const run=game(),r=run(`(()=>{
  const entries=Array.from({length:60},(_,i)=>({organization:'大学'+i,teamLabel:['A','B','C'][i%3],members:Array.from({length:4},(_,j)=>({id:i+'-'+j,bestTimes:{fr100:50+i+j*.01,fr200:110+i+j*.01,ba100:60+i+j*.01,br100:65+i+j*.01,fly100:55+i+j*.01}}))}));
  return{spring:seedRelayHeats(entries,'4x100fr','spring_kansai',16).flat().length,higashikata:seedRelayHeats(entries,'4x100fr','joint_record',76).flat().length,dynamio:seedRelayHeats(entries,'4x100fr','joint_record',84).flat().length};
 })()`);
 assert.deepEqual(r,{spring:60,higashikata:60,dynamio:48});
});

test('CPU reserve choices do not reuse swimmers between their A/B/C squads',()=>{
 const run=game(),r=run(`(()=>{
  expectedTime=(a,event)=>a.bestTimes[event];reactionTime=(a,event,takeover=false)=>takeover?.2:.7;activeRaceMeetContext=null;
  const rosters=new Map(),entries=[];
  for(let university=0;university<10;university++){
   const org='大学'+university,base=university===0?50:university===1?53.5:54;
   const roster=Array.from({length:16},(_,i)=>({id:org+'-'+i,bestTimes:Object.fromEntries(['fr100','fr200','ba100','br100','fly100'].map(event=>[event,base+i*.05]))}));rosters.set(org,roster);
   const available=[...roster];for(let index=0;index<3;index++){const members=bestRelayMembers(available,'4x100fr');if(members.length!==4)break;entries.push({organization:org,teamLabel:['A','B','C'][index],members});for(let i=available.length-1;i>=0;i--)if(members.includes(available[i]))available.splice(i,1)}
  }
  const groups=cpuRelayPreliminaryEntries(entries,'4x100fr',rosters).reduce((result,team)=>{(result[team.organization]||(result[team.organization]={final:new Set(),prelim:new Set(),rests:0})).rests+=team.reservedIds.length;for(const member of team.finalMembers||team.members){if(result[team.organization].final.has(member.id))throw Error('reused final member');result[team.organization].final.add(member.id)}for(const member of team.members){if(result[team.organization].prelim.has(member.id))throw Error('reused preliminary member');result[team.organization].prelim.add(member.id)}return result},{});
  return Object.fromEntries(Object.entries(groups).map(([org,team])=>[org,{final:team.final.size,prelim:team.prelim.size,rests:team.rests}]));
 })()`);
 for(const team of Object.values(r)){assert.equal(team.final,12);assert.ok(team.prelim>=12);assert.ok(team.prelim<=16)}
});

test('manual teams stay selectable while CPU universities add B/C squads randomly without skipping a squad',()=>{
 const run=game(),setup=run(setupRaces()),manual={};
 for(const kind of ['4x100fr','4x200fr','4x100medley'])manual[kind]=[
  setup.own.slice(0,4),setup.own.slice(4,8),setup.own.slice(8,12)
 ];
 const report=run(`(()=>{
  const manual=${JSON.stringify(manual)};
  const summarize=(meet,slot)=>withMeetRaceContext(meet,slot,2026,()=>runRelays(meet,manual,false,slot).map(([kind,finals,meta])=>({kind,
    entries:meta.prelim.map(team=>({org:team.organization,label:team.teamLabel||null,ids:team.members.map(a=>a.id)})),
    finals:finals.map(team=>({org:team.organization,label:team.teamLabel||null})),heats:meta.heats.length
  })));
  return{spring:summarize('spring_kansai',16),higa:summarize('joint_record',76),feb:summarize('joint_record',84)};
 })()`);
 const cpuSquadCounts=[];
 for(const meet of ['spring','higa'])for(const relay of report[meet]){
  const own=relay.entries.filter(row=>row.org==='自大学');
  own.sort((a,b)=>a.label.localeCompare(b.label));
  assert.deepEqual(own.map(row=>row.label),['A','B','C'],`${meet} ${relay.kind} own labels`);
  assert.deepEqual(own.map(row=>row.ids),manual[relay.kind],`${meet} ${relay.kind} manual lineups`);
  for(const org of ['関西大学','関東大学']){
   const teams=relay.entries.filter(row=>row.org===org).sort((a,b)=>a.label.localeCompare(b.label));
   const labels=teams.map(row=>row.label);
   assert.equal(labels[0],'A',`${meet} ${relay.kind} ${org} has an A squad`);
   assert.deepEqual(labels,['A','B','C'].slice(0,labels.length),`${meet} ${relay.kind} ${org} squads are contiguous`);
   assert.equal(new Set(teams.flatMap(row=>row.ids)).size,teams.length*4,`${meet} ${relay.kind} ${org} members are not reused`);
   cpuSquadCounts.push(labels.length);
  }
 }
 assert.ok(cpuSquadCounts.some(count=>count===1)&&cpuSquadCounts.some(count=>count>1),'CPU B/C participation varies across university, meet and event');
 for(const relay of report.feb)assert.ok(relay.entries.every(row=>row.label===null),`${relay.kind} in February stays one team per university`);
});

test('final edits target the chosen squad and preserve A/B/C labels in results and saved final snapshots',()=>{
 const run=game();run(setupRaces());
 const result=run(`(()=>{
  simulateRelay=members=>{const legs=members.map(a=>a.bestTimes.fr100);return{total:round2(legs.reduce((sum,time)=>sum+time,0)),legs}};
  recordRelayResult=()=>{};refreshMeetPBComparisons=()=>{};teamScoring=()=>({});refreshRecordBook=()=>{};cachePendingMeetPointReward=()=>{};
  const teams=['A','B','C'].map((teamLabel,index)=>({organization:state.playerUniversity,teamLabel,members:state.players.slice(index*4,index*4+4),race:{total:200+index,legs:[50,50,50,50]}}));
  const result={meet:'spring_kansai',season:2026,slot:16,events:{},relays:[['4x100fr',teams,{prelim:[],finalEntryPending:true}]]};
  setRelayFinalEntry(result,'4x100fr',state.players.slice(12).map(a=>a.id),'B',false);const paused=result.relays[0][2].finalEntryPending;
  setRelayFinalEntry(result,'4x100fr',state.players.slice(0,4).map(a=>a.id),'A',true);
  const final=result.relays[0][1],saved=compactMeetFinalResults(result).relays['4x100fr'],html=relayResultTable(final,'4x100fr');
  return{paused,complete:!result.relays[0][2].finalEntryPending,bIds:final.find(row=>row.teamLabel==='B').members.map(a=>a.id),expected:state.players.slice(12).map(a=>a.id),savedLabels:saved.map(row=>row.teamLabel).sort(),top10Labels:Object.values(state.teamTop10||{}).flat().map(row=>row.teamLabel).filter(Boolean).sort(),displayA:html.includes('Aチーム'),displayB:html.includes('Bチーム'),displayC:html.includes('Cチーム'),unique:new Set(final.flatMap(row=>row.members.map(a=>a.id))).size};
 })()`);
 assert.ok(result.paused&&result.complete);assert.deepEqual(result.bIds,result.expected);assert.deepEqual(result.savedLabels,['A','B','C']);assert.ok(result.top10Labels.includes('A')&&result.top10Labels.includes('B'));assert.ok(result.displayA&&result.displayB&&result.displayC);assert.equal(result.unique,12);
});
