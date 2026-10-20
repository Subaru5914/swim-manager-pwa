const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(){return vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+`
 state={season:2026,slot:43,rngSeed:5914,playerUniversity:'自大学',players:[],world:[],universities:[],kansaiIds:[],interIds:[],teamTop10:{},recordRankings:{},recordBook:{},teamPodiumHistory:[]};
 return code=>JSON.parse(JSON.stringify(eval(code)))`,[])()}

test('only CPUs inside the first eight actual entrant PBs qualify; own places, missing PBs and entry snapshots are respected without mutation or RNG',()=>{
 const run=game(),r=run(`(()=>{
  const rows=Array.from({length:12},(_,i)=>({source:[0,3,7].includes(i)?'PLAYER':'CPU',athlete:{id:'p'+String(i).padStart(2,'0'),bestTimes:{fr100:100-i}},entryPB:50+i}));
  rows.push({source:'CPU',athlete:{id:'missing',bestTimes:{fr100:40}},entryPB:null},{source:'CPU',athlete:{id:'estimated-fastest',stats:Object.fromEntries(STATS.map(k=>[k,200])),bestTimes:{}}});
  state.players=rows.filter(r=>r.source==='PLAYER').map(r=>r.athlete);state.world=[...rows.filter(r=>r.source==='CPU').map(r=>r.athlete),{id:'unentered-fastest',bestTimes:{fr100:30}}];
  const before=JSON.stringify([state,rows]),ids=preliminaryDelayCandidates(rows,'fr100').map(r=>r.athlete.id),reverse=preliminaryDelayCandidates([...rows].reverse(),'fr100').map(r=>r.athlete.id);
  return{ids,reverse,unchanged:before===JSON.stringify([state,rows]),unmeasured:preliminaryDelayCandidates(rows.map(({source,athlete})=>({source,athlete})),'ba100').length};
 })()`);
 assert.deepEqual(r.ids,['p01','p02','p04','p05','p06']);assert.deepEqual(r.reverse,r.ids);assert.ok(r.unchanged);assert.equal(r.unmeasured,0);
});

test('equal PBs use a stable athlete order to keep eight slots and short fields contain only their recorded CPU entrants',()=>{
 const run=game(),r=run(`(()=>{
  const rows=Array.from({length:10},(_,i)=>({source:'CPU',athlete:{id:'p'+i,bestTimes:{fr100:i<7?50+i:57}}}));
  const short=rows.slice(0,3);short[1].source='PLAYER';
  return{ties:preliminaryDelayCandidates(rows,'fr100').map(r=>r.athlete.id),reverse:preliminaryDelayCandidates([...rows].reverse(),'fr100').map(r=>r.athlete.id),short:preliminaryDelayCandidates(short,'fr100').map(r=>r.athlete.id),empty:preliminaryDelayCandidates([],'fr100')};
 })()`);
 assert.deepEqual(r.ties,['p0','p2','p3','p4','p5','p6','p7']);assert.deepEqual(r.reverse,r.ties);assert.deepEqual(r.short,['p0','p2']);assert.deepEqual(r.empty,[]);
});

test('every individual event gates the existing probability to the whole-meet PB top eight, without drawing for excluded swimmers',()=>{
 const run=game(),reports=run(`EVENTS.map(event=>{
  const rows=Array.from({length:12},(_,i)=>({source:i<2?'PLAYER':'CPU',athlete:{id:'gate-'+i,bestTimes:{[event]:20+i}}}));state.players=rows.slice(0,2).map(r=>r.athlete);
  const original=rng;let calls=0;rng=()=>{calls++;return 0};
  const result=withPreliminaryDelayField(rows,event,()=>rows.map((row,i)=>{
   const before=calls,probability=athletePreliminaryProbability(row.athlete,event),delay=samplePreliminaryDelay(row.athlete,event);
   return{i,probability,delay,draws:calls-before};
  }));rng=original;
  return{event,result,restored:activePreliminaryDelayField===null};
 })`);
 for(const {event,result,restored}of reports){assert.ok(restored);for(const r of result){if(r.i>=2&&r.i<8){assert.ok(r.probability>0&&r.probability<1&&r.delay>0&&r.draws>0,event)}else{assert.equal(r.probability,0);assert.equal(r.delay,0);assert.equal(r.draws,0)}}}
});

test('PB improvements cannot move the frozen eligibility, and nested fields or errors restore the previous context',()=>{
 const run=game(),r=run(`(()=>{
  const rows=Array.from({length:10},(_,i)=>({source:'CPU',athlete:{id:'freeze-'+i,bestTimes:{fr100:50+i,ba100:60-i}}}));
  let nested,restored,error;
  const before=state.rngSeed,original=withPreliminaryDelayField(rows,'fr100',()=>{
   rows[9].athlete.bestTimes.fr100=1;
   const frozen=athletePreliminaryProbability(rows[9].athlete,'fr100');
   nested=withPreliminaryDelayField(rows,'ba100',()=>({last:athletePreliminaryProbability(rows[9].athlete,'ba100'),other:athletePreliminaryProbability(rows[0].athlete,'ba100'),crossEvent:athletePreliminaryProbability(rows[0].athlete,'fr100')}));
   try{withPreliminaryDelayField(rows,'ba100',()=>{throw Error('fixture')})}catch(e){error=e.message}
   restored=athletePreliminaryProbability(rows[9].athlete,'fr100');return frozen;
  });
  return{original,nested,restored,error,cleared:activePreliminaryDelayField===null,nextField:withPreliminaryDelayField(rows,'fr100',()=>athletePreliminaryProbability(rows[9].athlete,'fr100')),noRng:before===state.rngSeed};
 })()`);
 assert.equal(r.original,0);assert.equal(r.restored,0);assert.ok(r.nested.last>0&&r.nested.other===0&&r.nested.crossEvent===0);assert.equal(r.error,'fixture');assert.ok(r.cleared&&r.noRng&&r.nextField>0);
});

test('actual domestic and world preliminary races use one PB field across all circle-seeded heats; finals and relays retain no delay',()=>{
 const run=game(),reports=run(`(()=>{
  const reports=[];
  for(const meet of ['kansai_college','intercollege','teijimayama_championship','joint_record','japan_open','japan_championship','world_championship']){
   const all=Array.from({length:16},(_,i)=>{const a={id:'race-'+String(i).padStart(2,'0'),name:'泳者'+i,category:'university',year:i===0||i===4?2:null,grade:2,organization:i===0||i===4?state.playerUniversity:'大学'+Math.floor(i/3),specialty:'fr100',stats:Object.fromEntries(STATS.map(k=>[k,185])),imAptitude:{speed:0,stamina:0},bestTimes:{},raceHistory:[]};a.bestTimes.fr100=round2(expectedTime(a,'fr100')+i*.01);return a});
   state.players=all.filter(a=>a.year);state.world=all.filter(a=>!a.year);state.universities=[...new Set(state.world.map(a=>a.organization))].map((name,i)=>({id:'U'+i,name}));state.kansaiIds=state.interIds=state.universities.map(u=>u.id);
   const entrants=all.map(athlete=>({source:athlete.year?'PLAYER':'CPU',athlete,entryPB:athlete.bestTimes.fr100})),wanted=preliminaryDelayCandidates(entrants,'fr100').map(r=>r.athlete.id).sort();
   const result=meet==='world_championship'?raceEventField(meet,'fr100',entrants):runEvent(meet,'fr100',state.players.map(a=>a.id),{fr100:state.world.map(a=>a.id)});
   const eligible=result.prelim.filter(r=>r.race.physics.preliminaryProbability>0).map(r=>r.athlete.id).sort();
   const errors=result.prelim.filter(r=>!wanted.includes(r.athlete.id)&&(r.race.physics.preliminaryProbability!==0||r.race.physics.preliminaryDelay!==0)).map(r=>r.athlete.id);
   const relay=simulateRelay(state.players.concat(state.world.slice(0,2)),'4x100fr',false,true);
   reports.push({meet,wanted,eligible,errors,heats:result.heats.length,entrants:result.prelim.length,finalsClean:result.final.every(r=>!r.race.physics.preliminaryDelay),cleared:activePreliminaryDelayField===null,relayClean:!relay.preliminaryDelay});
  }return reports;
 })()`);
 for(const r of reports){assert.equal(r.entrants,16,r.meet);assert.equal(r.heats,2);assert.equal(r.wanted.length,6);assert.deepEqual(r.eligible,r.wanted,r.meet);assert.deepEqual(r.errors,[]);assert.ok(r.finalsClean&&r.cleared&&r.relayClean)}
});

test('world representatives outside the current roster still count as own places, alongside Japanese CPU and overseas entrants',()=>{
 const run=game(),r=run(`(()=>{
  const own={id:'selected-own',category:'adult',bestTimes:{fr100:47}},japanese={id:'japanese-cpu',category:'adult',bestTimes:{fr100:47.1}};
  state.players=[];state.japanTeam={year:2027,athletes:[{id:own.id,ownAtSelection:true,snapshot:own}]};
  const rows=[{source:'PLAYER',athlete:{...own}},{source:'CPU',athlete:japanese},...Array.from({length:10},(_,i)=>({source:'CPU',athlete:{id:'foreign-'+i,category:'international',bestTimes:{fr100:47.2+i*.1}}}))];
  return withMeetRaceContext('world_championship',36,2027,()=>withPreliminaryDelayField(rows,'fr100',()=>rows.map(row=>athletePreliminaryProbability(row.athlete,'fr100'))));
 })()`);
 assert.equal(r[0],0);assert.ok(r.slice(1,8).every(p=>p>0));assert.ok(r.slice(8).every(p=>p===0));
});
