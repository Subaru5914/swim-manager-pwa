const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const load=vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+'\nreturn code=>JSON.parse(JSON.stringify(eval(code)))',['globalThis']);
function game(fresh=false){const run=load({crypto:{getRandomValues:a=>{a[0]=5914;return a}}});run(fresh?'(state=createState(),migrateState(),true)':`(state={players:[],world:[],playerUniversity:'自大学',season:2026,slot:44,rngSeed:5914},true)`);return run}

test('CPU relay choices use event PBs and unique medley swimmers, rather than the ability-clock order',()=>{
 const run=game(),r=run(`(()=>{
   expectedTime=(a,e)=>100-a.bestTimes[e];
   const roster=Array.from({length:6},(_,i)=>({id:'p'+i,bestTimes:{fr100:50+i,fr200:110+i,ba100:60+i,br100:65+i,fly100:55+i}}));
   return RELAYS.map(kind=>({kind,ids:bestRelayMembers(roster,kind).map(a=>a.id)}));
 })()`);
 for(const row of r)assert.deepEqual(row.ids,['p0','p1','p2','p3'],row.kind);
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
 for(const row of r.rows){assert.equal(new Set(row.ids).size,4);assert.deepEqual(row.final,[0,1,2,3].map(i=>row.org+'p'+i));if(row.rest.length)assert.ok(row.worst<=row.cutoff)}
});

test('actual college relay heats and finals retain distinct lineups, PB seeding, lap clocks and fastest final choices',()=>{
 const run=game(true),r=run(`(()=>{
   const ownBefore=JSON.stringify(state.players),profileBefore=JSON.stringify(state.world),rows=[];
   for(const meet of ['kansai_college','intercollege'])withMeetRaceContext(meet,meet==='kansai_college'?28:44,state.season,()=>{
     for(const [kind,finals,meta]of runRelays(meet,{})){
       const preIds=new Map(meta.prelim.map(t=>[t.organization,t.members.map(a=>a.id)]));
       for(const team of finals){
         const roster=state.world.filter(a=>a.category==='university'&&a.organization===team.organization&&!a.retired);
         rows.push({meet,kind,org:team.organization,ids:team.members.map(a=>a.id),best:bestRelayMembers(roster,kind).map(a=>a.id),
           pre:preIds.get(team.organization),kept:team.preliminaryMemberIds,
           time:team.race.total,sum:round2(team.race.legs.reduce((s,t)=>s+t,0)),last:team.race.cumulativeLegs.at(-1)});
       }
       for(const heat of meta.heats){
         const seeded=[...heat].sort((a,b)=>relaySeedScore(a,kind)-relaySeedScore(b,kind));
         if(seeded.some((t,i)=>t.heatLane!==SEEDED_LANES[i]))throw new Error('preliminary lane order');
       }
       for(const team of meta.prelim.filter(t=>t.reservedIds.length)){
         if(!finals.some(t=>t.organization===team.organization))throw new Error('rested team missed the final');
       }
     }
   });
   return{rows,own:ownBefore===JSON.stringify(state.players),cpu:profileBefore===JSON.stringify(state.world)};
 })()`);
 assert.ok(r.own&&r.cpu);assert.equal(r.rows.length,48);assert.ok(r.rows.some(row=>row.ids.some((id,i)=>id!==row.pre[i])));
 for(const row of r.rows){assert.deepEqual(row.ids,row.best);assert.deepEqual(row.kept,row.pre);assert.equal(row.time,row.sum);assert.equal(row.time,row.last)}
});

test('relay ten-best refresh repairs unreachable CPU laps once and preserves own history, abilities, PBs and live randomness',()=>{
 const run=game(true),r=run(`(()=>{
   const u=state.universities.find(u=>u.reputation>=280),members=bestRelayMembers(state.world.filter(a=>a.organization===u.name&&a.category==='university'),'4x100medley');
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
