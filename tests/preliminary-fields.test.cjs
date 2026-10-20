const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(){return vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+`
 state={season:2026,slot:43,rngSeed:5914,cpuCompetitionSeed:5914,playerUniversity:'自大学',players:[],world:[],universities:[],kansaiIds:[],interIds:[],teamTop10:{},recordRankings:{},recordBook:{},teamPodiumHistory:[]};
 return code=>JSON.parse(JSON.stringify(eval(code)))`,[])()}

test('all actual entrants qualify irrespective of team, PB rank, ties, missing PBs or roster order without mutation or RNG',()=>{
 const r=game()(`(()=>{
  const rows=Array.from({length:16},(_,i)=>({source:i%3?'CPU':'PLAYER',athlete:{id:'p'+String(i).padStart(2,'0'),bestTimes:i<10?{fr100:50+i}:{}},entryPB:i<10?50+i:null}));
  const outsider={id:'unentered-fastest',bestTimes:{fr100:20}};state.players=rows.filter(r=>r.source==='PLAYER').map(r=>r.athlete);state.world=[outsider,...rows.filter(r=>r.source==='CPU').map(r=>r.athlete)];
  const before=JSON.stringify([state,rows]),rates=withPreliminaryDelayField(rows,'fr100',()=>rows.map(row=>athletePreliminaryProbability(row.athlete,'fr100')));
  const reverse=withPreliminaryDelayField([...rows].reverse(),'fr100',()=>rows.map(row=>athletePreliminaryProbability(row.athlete,'fr100')));
  const absent=withPreliminaryDelayField(rows,'fr100',()=>athletePreliminaryProbability(outsider,'fr100'));
  return{rates,reverse,absent,unchanged:before===JSON.stringify([state,rows]),empty:withPreliminaryDelayField([],'fr100',()=>athletePreliminaryProbability(rows[0].athlete,'fr100'))};
 })()`);
 assert.equal(r.rates.length,16);assert.ok(r.rates.every(p=>p>0&&p<1));assert.deepEqual(r.reverse,r.rates);assert.equal(r.absent,0);assert.equal(r.empty,0);assert.ok(r.unchanged);
});

test('all fifteen events draw both positive and zero delays for every entrant, including own swimmers and unknown PBs',()=>{
 const reports=game()(`EVENTS.map(event=>{
  const rows=Array.from({length:16},(_,i)=>({source:i%2?'CPU':'PLAYER',athlete:{id:'gate-'+i,bestTimes:i<8?{[event]:20+i}:{}}}));state.players=rows.filter(r=>r.source==='PLAYER').map(r=>r.athlete);
  const original=rng;let calls=0;
  const result=withPreliminaryDelayField(rows,event,()=>rows.map(row=>{
   rng=()=>{calls++;return 0};const before=calls,probability=athletePreliminaryProbability(row.athlete,event),delay=samplePreliminaryDelay(row.athlete,event),draws=calls-before;
   rng=()=>{calls++;return .99};const zero=samplePreliminaryDelay(row.athlete,event);return{probability,delay,draws,zero};
  }));rng=original;return{event,result,restored:activePreliminaryDelayField===null};
 })`);
 for(const {event,result,restored}of reports){assert.ok(restored);assert.equal(result.length,16);for(const r of result){assert.ok(r.probability>0&&r.probability<1&&r.delay>0&&r.draws>0,event);assert.equal(r.zero,0,event)}}
});

test('PB changes never affect eligibility; nested fields, cross-event calls and exceptions preserve the actual entrant context',()=>{
 const r=game()(`(()=>{
  const rows=Array.from({length:12},(_,i)=>({athlete:{id:'freeze-'+i,bestTimes:{fr100:50+i}}})),newcomer={id:'later',bestTimes:{fr100:1}};
  let nested,error,restored;const before=state.rngSeed;
  const original=withPreliminaryDelayField(rows,'fr100',()=>{
   rows[11].athlete.bestTimes={};rows.push({athlete:newcomer});
   const frozen={last:athletePreliminaryProbability(rows[11].athlete,'fr100'),later:athletePreliminaryProbability(newcomer,'fr100')};
   nested=withPreliminaryDelayField(rows,'ba100',()=>({later:athletePreliminaryProbability(newcomer,'ba100'),crossEvent:athletePreliminaryProbability(rows[0].athlete,'fr100')}));
   try{withPreliminaryDelayField([],'ba100',()=>{throw Error('fixture')})}catch(e){error=e.message}
   restored=athletePreliminaryProbability(rows[11].athlete,'fr100');return frozen;
  });
  return{original,nested,restored,error,cleared:activePreliminaryDelayField===null,nextField:withPreliminaryDelayField(rows,'fr100',()=>athletePreliminaryProbability(newcomer,'fr100')),noRng:before===state.rngSeed};
 })()`);
 assert.ok(r.original.last>0&&r.original.later===0);assert.equal(r.restored,r.original.last);assert.ok(r.nested.later>0&&r.nested.crossEvent===0);assert.equal(r.error,'fixture');assert.ok(r.cleared&&r.noRng&&r.nextField>0);
});

test('actual domestic and world heats apply the delay to all own and CPU entrants while finals, swim-offs and relays remain clean',()=>{
 const reports=game()(`(()=>{
  const reports=[];
  for(const meet of ['kansai_college','intercollege','teijimayama_championship','joint_record','japan_open','japan_championship','world_championship']){
   const all=Array.from({length:16},(_,i)=>{const a={id:'race-'+String(i).padStart(2,'0'),name:'泳者'+i,category:'university',year:i===0||i===12?2:null,grade:2,organization:i===0||i===12?state.playerUniversity:'大学'+Math.floor(i/3),specialty:'fr100',stats:Object.fromEntries(STATS.map(k=>[k,185])),imAptitude:{speed:0,stamina:0},bestTimes:{},raceHistory:[]};a.bestTimes.fr100=round2(expectedTime(a,'fr100')+i*.01);return a});
   state.players=all.filter(a=>a.year);state.world=all.filter(a=>!a.year);state.universities=[...new Set(state.world.map(a=>a.organization))].map((name,i)=>({id:'U'+i,name}));state.kansaiIds=state.interIds=state.universities.map(u=>u.id);
   const entrants=all.map(athlete=>({source:athlete.year?'PLAYER':'CPU',athlete,entryPB:athlete.bestTimes.fr100}));rng=()=>.01;
   const result=withMeetRaceContext(meet,43,2026,()=>meet==='world_championship'?raceEventField(meet,'fr100',entrants):runEvent(meet,'fr100',state.players.map(a=>a.id),{fr100:state.world.map(a=>a.id)}));
   const relay=withMeetRaceContext(meet,43,2026,()=>simulateRelay(state.players.concat(state.world.slice(0,2)),'4x100fr',false,true));
   reports.push({meet,probabilities:result.prelim.map(r=>r.race.physics.preliminaryProbability),delays:result.prelim.map(r=>r.race.physics.preliminaryDelay),ownDelays:result.prelim.filter(r=>r.source==='PLAYER').map(r=>r.race.physics.preliminaryDelay),heats:result.heats.length,entrants:result.prelim.length,finalsClean:result.final.every(r=>!r.race.physics.preliminaryDelay),swimOffsClean:(result.swimOffs||[]).flat().every(r=>!r.race.physics.preliminaryDelay),cleared:activePreliminaryDelayField===null,relayClean:!relay.preliminaryDelay});
  }return reports;
 })()`);
 for(const r of reports){assert.equal(r.entrants,16,r.meet);assert.equal(r.heats,2);assert.ok(r.probabilities.every(p=>p>0&&p<1));assert.ok(r.delays.every(d=>d>0));assert.ok(r.ownDelays.length===2&&r.ownDelays.every(d=>d>0));assert.ok(r.finalsClean&&r.swimOffsClean&&r.cleared&&r.relayClean)}
});

test('all age categories, overseas entrants and selected own snapshots outside the current roster share the same rules',()=>{
 const r=game()(`(()=>{
  const rows=['middle','high','university','adult','international','selected-own'].map((category,i)=>({source:i===5?'PLAYER':'CPU',athlete:{id:'category-'+i,category,bestTimes:{}}}));
  state.players=[];state.japanTeam={year:2027,athletes:[{id:rows[5].athlete.id,ownAtSelection:true,snapshot:rows[5].athlete}]};
  return withMeetRaceContext('world_championship',36,2027,()=>withPreliminaryDelayField(rows,'fr100',()=>rows.map(row=>athletePreliminaryProbability({...row.athlete},'fr100'))));
 })()`);
 assert.ok(r.every(p=>p>0&&p<1));
});

test('real unmeasured own and CPU entrants can receive delays in all fifteen events and then record coherent first PBs',()=>{
 const rows=game()(`EVENTS.map(event=>{
  const make=(id,own)=>({id,name:id,category:'university',year:own?2:null,grade:2,organization:own?state.playerUniversity:'他大学',stats:Object.fromEntries(STATS.map(k=>[k,138])),imAptitude:{speed:0,stamina:0},bestTimes:{},raceHistory:[],specialty:event});
  const own=make('unmeasured-own',true),cpu=make('unmeasured-cpu',false);state.players=[own];state.world=[cpu];rng=()=>.01;
  const result=withMeetRaceContext('world_championship',36,2027,()=>raceEventField('world_championship',event,[{source:'PLAYER',athlete:own},{source:'CPU',athlete:cpu}]));
  return{event,prelim:result.prelim.map(r=>({entryPB:r.entryPB??null,p:r.race.physics.preliminaryProbability,delay:r.race.physics.preliminaryDelay})),final:result.final.map(r=>r.race.physics.preliminaryDelay??null),pb:[own.bestTimes[event],cpu.bestTimes[event]]};
 })`);
 for(const row of rows){assert.equal(row.prelim.length,2);assert.ok(row.prelim.every(r=>r.entryPB===null&&r.p>0&&r.delay>0),row.event);assert.deepEqual(row.final,[null,null]);assert.ok(row.pb.every(t=>Number.isFinite(t)&&t>0))}
});

test('good and excellent form reduce each personal probability to 70 and 40 percent with no direct mental effect or extra RNG',()=>{
 const r=game()(`(()=>{
  const p={id:'form-probability',stats:{mental:0}},rows=[];state.players=[p];const initial=JSON.stringify(state),original=athleteMeetForm,originalRng=rng;
  for(const event of EVENTS){const base=athletePreliminaryProbability(p,event);
   for(const level of [-2,-1,0,1,2]){athleteMeetForm=()=>MEET_FORMS[level+2];
    const low=withMeetRaceContext('intercollege',43,2026,()=>athletePreliminaryProbability(p,event));p.stats.mental=200;
    const high=withMeetRaceContext('intercollege',43,2026,()=>athletePreliminaryProbability(p,event));p.stats.mental=0;
    rng=()=>base*.85;const upperGate=withMeetRaceContext('intercollege',43,2026,()=>samplePreliminaryDelay(p,event));
    rng=()=>base*.55;const lowerGate=withMeetRaceContext('intercollege',43,2026,()=>samplePreliminaryDelay(p,event));
    rows.push({event,level,base,low,high,upperGate,lowerGate});
   }
  }athleteMeetForm=original;rng=originalRng;return{rows,unchanged:initial===JSON.stringify(state)};
 })()`);
 assert.ok(r.unchanged);for(const row of r.rows){assert.equal(row.low,row.high);assert.ok(Math.abs(row.low-row.base*({'-2':1,'-1':1,0:1,1:.7,2:.4}[row.level]))<1e-12);assert.ok(row.low>0&&row.low<1);assert.equal(row.upperGate>0,row.level<=0);assert.equal(row.lowerGate>0,row.level<=1)}
});
