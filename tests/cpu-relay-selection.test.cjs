const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const load=vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+'\nreturn code=>JSON.parse(JSON.stringify(eval(code)))',['globalThis']);
function game(fresh=false){const run=load({crypto:{getRandomValues:a=>{a[0]=5914;return a}}});run(fresh?'(state=createState(),migrateState(),true)':`(state={players:[],world:[],playerUniversity:'自大学',season:2026,slot:44,rngSeed:5914},true)`);return run}

test('CPU relay choices use event PBs and unique medley swimmers, rather than the ability-clock order',()=>{
 const run=game(),r=run(`(()=>{
   expectedTime=(a,e)=>100-a.bestTimes[e];
   const roster=Array.from({length:6},(_,i)=>({id:'p'+i,bestTimes:{fr100:50+i,fr200:110+i,ba100:60+i,br100:65+i,fly100:55+i}}));
   return RELAYS.map(kind=>({kind,ids:bestRelayMembers(roster,kind).map(a=>a.id),calibration:bestRelayMembers(roster,kind,false).map(a=>a.id)}));
 })()`);
 for(const row of r){assert.deepEqual(row.ids,['p0','p1','p2','p3'],row.kind);assert.deepEqual(row.calibration,['p5','p4','p3','p2'],row.kind)}
});

test('deep relay rosters can rest two first choices, while a bubble team keeps its fastest four',()=>{
 const run=game(),r=run(`(()=>{
   expectedTime=(a,e)=>a.bestTimes[e];reactionTime=(a,e,takeover=false)=>takeover?.2:.7;
   const rosters=new Map(),entries=[];
   for(let u=0;u<10;u++){
     const org='u'+u,base=u===0?50:u===1?53.5:54;
     const roster=Array.from({length:6},(_,i)=>({id:org+'p'+i,bestTimes:Object.fromEntries(['fr100','fr200','ba100','br100','fly100'].map(e=>[e,base+i*.05]))}));
     rosters.set(org,roster);entries.push({organization:org,members:bestRelayMembers(roster,'4x100fr')});
   }
   const before=JSON.stringify(entries),seed=state.rngSeed;
   const planned=cpuRelayPreliminaryEntries(entries,'4x100fr',rosters);
   return{unchanged:before===JSON.stringify(entries)&&seed===state.rngSeed,rows:planned.map(t=>({org:t.organization,ids:t.members.map(a=>a.id),final:t.finalMembers.map(a=>a.id),rest:t.reservedIds,
     worst:cpuRelayTimeBounds(t.members,'4x100fr').high,cutoff:entries.filter(e=>e.organization!==t.organization).map(e=>cpuRelayTimeBounds(e.members,'4x100fr').low).sort((a,b)=>a-b)[7]-.3}))};
 })()`);
 assert.ok(r.unchanged);assert.equal(r.rows[0].rest.length,2);assert.equal(r.rows[1].rest.length,0);
 for(const row of r.rows){assert.equal(new Set(row.ids).size,4);assert.deepEqual(row.final,[0,2,3,1].map(i=>row.org+'p'+i));if(row.rest.length)assert.ok(row.worst<=row.cutoff)}
});

test('CPU freestyle order places the fastest PB first and second fastest last without changing member selection, medley order or calibration',()=>{
 const r=game()(`(()=>{
  expectedTime=(a,e)=>1000-a.bestTimes[e];
  const roster=Array.from({length:8},(_,i)=>({id:'p'+i,bestTimes:{fr100:50+i,fr200:120-i,ba100:60+i,br100:65+i,fly100:55+i}})),before=JSON.stringify(roster),seed=state.rngSeed;
  return{rows:RELAYS.map(kind=>{const selected=bestRelayMembers(roster,kind);return{kind,selected:selected.map(a=>a.id),ordered:orderCpuFreestyleRelay(selected,kind).map(a=>a.id),calibration:bestRelayMembers(roster,kind,false).map(a=>a.id)}}),unchanged:before===JSON.stringify(roster)&&seed===state.rngSeed};
 })()`);
 assert.ok(r.unchanged);assert.deepEqual(r.rows[0].ordered,['p0','p2','p3','p1']);assert.deepEqual(r.rows[1].ordered,['p7','p5','p4','p6']);assert.deepEqual(r.rows[2].ordered,r.rows[2].selected);
 for(const row of r.rows)assert.deepEqual(row.ordered.slice().sort(),row.selected.slice().sort());
 assert.deepEqual(r.rows[0].calibration,['p7','p6','p5','p4']);assert.deepEqual(r.rows[1].calibration,['p0','p1','p2','p3']);
});

test('safe deep rosters can reserve two, three or four main swimmers in every relay and keep fast freestyle ends in both rounds',()=>{
 const r=game()(`(()=>{
  expectedTime=(a,e)=>a.bestTimes[e];reactionTime=(a,e,takeover=false)=>takeover?.2:.7;
  return RELAYS.flatMap(kind=>[6,7,8].map(size=>{
   const event=relayLegEvent(kind,0),base=kind==='4x200fr'?110:50,rosters=new Map(),entries=[];
   for(let n=0;n<10;n++){
    const organization='u'+n,roster=Array.from({length:n===0?size:8},(_,i)=>({id:organization+'p'+i,bestTimes:Object.fromEntries(EVENTS.map(e=>[e,base+(n?20:0)+i*.05]))}));
    rosters.set(organization,roster);entries.push({organization,members:bestRelayMembers(roster,kind)});
   }
   const before=JSON.stringify(entries),seed=state.rngSeed,planned=cpuRelayPreliminaryEntries(entries,kind,rosters)[0];
   return{kind,size,rest:planned.reservedIds,ids:planned.members.map(a=>a.id),final:planned.finalMembers.map(a=>a.id),worst:cpuRelayTimeBounds(planned.members,kind).high,cutoff:entries.slice(1).map(e=>cpuRelayTimeBounds(e.members,kind).low).sort((a,b)=>a-b)[7]-(kind==='4x200fr'?.6:.3),unchanged:before===JSON.stringify(entries)&&seed===state.rngSeed,
    first:planned.members[0].bestTimes[event],anchor:planned.members[3].bestTimes[event],ranked:planned.members.map(a=>a.bestTimes[event]).sort((a,b)=>a-b)};
  }));
 })()`);
 for(const row of r){assert.equal(row.rest.length,row.size-4,JSON.stringify(row));assert.equal(new Set(row.ids).size,4);assert.ok(row.worst<=row.cutoff&&row.unchanged);assert.deepEqual(row.final,(row.kind==='4x100medley'?[0,1,2,3]:[0,2,3,1]).map(i=>'u0p'+i));if(row.kind!=='4x100medley'){assert.equal(row.first,row.ranked[0]);assert.equal(row.anchor,row.ranked[1])}}
});

test('resting leaves own manual entries unchanged, uses only available reserves and keeps a bubble team at full strength',()=>{
 const r=game()(`(()=>{
  expectedTime=(a,e)=>a.bestTimes[e];reactionTime=(a,e,takeover=false)=>takeover?.2:.7;
  const kind='4x100fr',rosters=new Map(),entries=[];
  for(let n=0;n<10;n++){
   const organization=n===0?state.playerUniversity:'u'+n,base=n===1?64.9:65,roster=Array.from({length:8},(_,i)=>({id:organization+'p'+i,bestTimes:{fr100:base+i*.05}}));
   rosters.set(organization,roster);entries.push({organization,members:n===0?roster.slice(0,4).reverse():bestRelayMembers(roster,kind)});
  }
  const before=JSON.stringify(entries),own=entries[0],planned=cpuRelayPreliminaryEntries(entries,kind,rosters);
  return{own:planned[0]===own,unchanged:before===JSON.stringify(entries),bubble:planned[1].reservedIds,ids:planned[1].members.map(a=>a.id),final:planned[1].finalMembers.map(a=>a.id)};
 })()`);
 assert.ok(r.own&&r.unchanged);assert.deepEqual(r.bubble,[]);assert.deepEqual(r.ids,r.final);
});

test('actual college relay heats and finals retain distinct lineups, PB seeding, lap clocks and fastest final choices',()=>{
 const run=game(true),r=run(`(()=>{
   const ownBefore=JSON.stringify(state.players),profileBefore=JSON.stringify(state.world.map(a=>a.stats)),rows=[],planned=new Map(),seeds=new Map(),originalPlan=cpuRelayPreliminaryEntries;
   cpuRelayPreliminaryEntries=(entries,kind,rosters)=>{const result=originalPlan(entries,kind,rosters);for(const team of result){planned.set(kind+team.organization,team.finalMembers.map(a=>a.id));seeds.set(kind+team.organization,relaySeedScore(team,kind))}return result};
   for(const meet of ['kansai_college','intercollege'])withMeetRaceContext(meet,meet==='kansai_college'?28:44,state.season,()=>{
     for(const [kind,finals,meta]of runRelays(meet,{})){
       const preIds=new Map(meta.prelim.map(t=>[t.organization,t.members.map(a=>a.id)]));
       for(const team of finals){
         rows.push({meet,kind,org:team.organization,ids:team.members.map(a=>a.id),best:planned.get(kind+team.organization),
           pre:preIds.get(team.organization),kept:team.preliminaryMemberIds,
           time:team.race.total,sum:round2(team.race.legs.reduce((s,t)=>s+t,0)),last:team.race.cumulativeLegs.at(-1)});
       }
       for(const heat of meta.heats){
         // Equal combined PBs may keep either team's original seed position.
         const seeded=[...heat].sort((a,b)=>seeds.get(kind+a.organization)-seeds.get(kind+b.organization)||SEEDED_LANES.indexOf(a.heatLane)-SEEDED_LANES.indexOf(b.heatLane));
         if(seeded.some((t,i)=>t.heatLane!==SEEDED_LANES[i]))throw new Error('preliminary lane order');
       }
       for(const team of meta.prelim.filter(t=>t.reservedIds.length)){
         if(!finals.some(t=>t.organization===team.organization))throw new Error('rested team missed the final');
       }
     }
   });
   return{rows,own:ownBefore===JSON.stringify(state.players),cpu:profileBefore===JSON.stringify(state.world.map(a=>a.stats))};
 })()`);
 assert.ok(r.own&&r.cpu);assert.equal(r.rows.length,48);assert.ok(r.rows.some(row=>row.ids.some((id,i)=>id!==row.pre[i])));
 for(const row of r.rows){assert.deepEqual(row.ids,row.best);assert.deepEqual(row.kept,row.pre);assert.equal(row.time,row.sum);assert.equal(row.time,row.last)}
});

test('relay ten-best refresh repairs unreachable CPU laps once and preserves own history, abilities, PBs and live randomness',()=>{
 const run=game(true),r=run(`(()=>{
   const u=[...state.universities].sort((a,b)=>b.reputation-a.reputation)[0],members=bestRelayMembers(state.world.filter(a=>a.organization===u.name&&a.category==='university'),'4x100medley');
   const bad={kind:'relay',event:'4x100medley',organization:u.name,time:150,legs:[30,40,40,40],members:members.map(a=>({id:a.id,name:a.name})),season:2024,slot:28,meet:'kansai_college',stage:'決勝'};
   const own={...deepClone(bad),organization:state.playerUniversity,members:state.players.slice(0,4).map(a=>({id:a.id,name:a.name}))};
   const archived={...deepClone(bad),organization:'過去大学',members:[0,1,2,3].map(i=>({id:'old'+i,name:'卒業選手'}))};
   for(const category of ['university','japan'])state.recordRankings[category]['4x100medley']=[deepClone(bad),deepClone(own),deepClone(archived)];
   state.teamTop10['4x100medley']=[deepClone(own)];
   const profiles=JSON.stringify([state.players,state.world,state.teamTop10]),seed=state.rngSeed,progress=JSON.stringify([state.season,state.slot,state.points,state.reputation,state.completedMeetKeys,state.japanTeam]);
   delete state.cpuRelayRankingVersion;refreshCpuRelayRankings();
   const first=JSON.stringify(state.recordRankings);refreshCpuRelayRankings();
   return{protected:profiles===JSON.stringify([state.players,state.world,state.teamTop10])&&progress===JSON.stringify([state.season,state.slot,state.points,state.reputation,state.completedMeetKeys,state.japanTeam]),
     once:first===JSON.stringify(state.recordRankings)&&state.rngSeed===seed,
     rows:['university','japan'].map(category=>({category,record:state.recordRankings[category]['4x100medley'].find(r=>r.organization===u.name),
       own:state.recordRankings[category]['4x100medley'].find(r=>r.organization===state.playerUniversity),archive:state.recordRankings[category]['4x100medley'].find(r=>r.organization==='過去大学')})),
     reference:RELAYS.map(kind=>({kind,count:state.recordRankings.university[kind].length,valid:state.recordRankings.university[kind].every(r=>r.time===round2(r.legs.reduce((s,t)=>s+t,0)))}))};
 })()`);
 assert.ok(r.protected&&r.once);assert.deepEqual(r.rows[0].record,r.rows[1].record);assert.ok(r.rows[0].record.time>200);
 for(const row of r.rows){assert.equal(row.own.time,150);assert.equal(row.archive.time,150);assert.equal(row.own.season,2024)}
 for(const row of r.reference){assert.equal(row.count,10);assert.ok(row.valid)}
});
