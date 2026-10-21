const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(){
 return vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+`
 state={rngSeed:5914,cpuCompetitionSeed:5914,season:2026,slot:1,players:[],world:[],recruits:[],universities:[]};
 function swimmer(value=100,id='clock'){return attachMedleyStats({id,name:id,category:'adult',age:23,specialty:'fr100',stats:Object.fromEntries(STATS.map(k=>[k,value])),imAptitude:{speed:0,stamina:0},bestTimes:{},accolades:[],raceHistory:[]})}
 return code=>JSON.parse(JSON.stringify(eval(code)));`,[])();
}

test('one current ability model covers all 15 events, remains monotone, and never gives mental a direct clock weight',()=>{
 const r=game()(`(()=>{
  const rows=[];for(const e of EVENTS){let last=Infinity;for(let value=0;value<=200;value++){
   const p=swimmer(value),time=expectedTime(p,e),balanced=abilityBenchmarkTime(e,value);
   p.stats.mental=200-value;
   rows.push({e,value,time,balanced,mental:expectedTime(p,e),monotone:time<=last+1e-9});last=time;
  }}
  const weights=[50,100,200,400].map(d=>{const e='fr'+d,p=swimmer(100);Object.assign(p.stats,{fr_speed:137,fr_stamina:89,fr_turn:121,start:76});const w=strokeAbilityWeights(d);return{d,actual:abilityValue(p,e)*200,weighted:w.speed*137+w.stamina*89+w.turn*121+w.start*76}});
  return{rows,weights};
 })()`);
 assert.ok(!/legacyModel|legacyIm/.test(source),'race and PB calculations must not select historical formulae');
 for(const r0 of r.rows){assert.ok(r0.time>0&&r0.monotone,JSON.stringify(r0));assert.ok(Math.abs(r0.time-r0.balanced)<1e-8);assert.equal(r0.mental,r0.time)}
 for(const w of r.weights)assert.ok(Math.abs(w.actual-w.weighted)<1e-9,JSON.stringify(w));
});

test('sampled bootstrap PBs exactly match actual initial-meet races with personal form and execution at every distance',()=>{
 const rows=game()(`(()=>{const rows=[];
  for(const value of [0,40,100,150,188,200])for(const draw of [0,.5,.999999]){
   const a=swimmer(value);rng=()=>draw;const stats=JSON.stringify(a.stats);withMeetRaceContext('intercollege',42,2026,()=>refreshCpuPBs(a));
   for(const e of EVENTS){const d=distanceOf(e),level=athleteMeetForm(a,'initial_pb',state.slot,state.season).level,range=MEET_FORM_TIME_RANGES[d][level+2],base=expectedTime(a,e),radius=RACE_EXECUTION_RANGE[d];
    const race=withMeetRaceContext('initial_pb',state.slot,state.season,()=>simulateRace(a,e,true,false));
    rows.push({e,value,draw,pb:a.bestTimes[e],simulated:race.total,low:base+range[0]-radius,high:base+range[1]+radius,stats:stats===JSON.stringify(a.stats)});
   }
   const earned=Object.fromEntries(EVENTS.map(e=>[e,round2(expectedTime(a,e)-.1)]));a.bestTimes={...earned};rng=()=>.999999;refreshCpuPBs(a);
   if(JSON.stringify(a.bestTimes)!==JSON.stringify(earned))throw Error('a slower bootstrap overwrote an earned PB');
  }return rows;
 })()`);
 assert.equal(rows.length,270);
 for(const r of rows){assert.equal(r.pb,r.simulated);assert.ok(r.stats&&r.pb>=r.low-.00501&&r.pb<=r.high+.00501,JSON.stringify(r))}
});

test('deterministic PBs and actual prelim/final clocks use the same current ability without a PB feedback boost',()=>{
 const r=game()(`(()=>{const rows=[],seed=state.rngSeed;
  for(const value of [40,100,163,188])for(const e of EVENTS){const a=swimmer(value,value+e),stats=JSON.stringify(a.stats),before=state.rngSeed;
   a.bestTimes[e]=coherentCpuPB(a,e);state.world=[a];
   if(before!==state.rngSeed)throw Error('deterministic PB consumed race RNG');
   for(const preliminary of [false,true]){const base=expectedTime(a,e),race=simulateRace(a,e,true,true,false,preliminary),q=race.physics;
    rows.push({value,e,base,actual:q.abilityBase,formula:round2(base+q.formCorrection+q.raceCorrection+(q.preliminaryDelay||0)),total:race.total,splits:round2(race.splits.reduce((s,t)=>s+t,0)),finish:race.trajectory.at(-1).t,stats:stats===JSON.stringify(a.stats)});
   }
  }return rows;
 })()`);
 assert.equal(r.length,120);for(const row of r){assert.equal(row.base,row.actual);assert.equal(row.total,row.formula);assert.equal(row.total,row.splits);assert.equal(row.total,row.finish);assert.ok(row.stats,JSON.stringify(row))}
});

test('overseas bootstrap PBs remain reachable at every event and representative world races keep their ability clocks',()=>{
 const r=game()(`(()=>{
  state.serial=1000;const edition=ensureInternationalWorld(2027),bad=[],races=[];
  for(const a of edition.athletes)for(const e of Object.keys(a.bestTimes)){
   const base=expectedTime(a,e),d=distanceOf(e),level=athleteMeetForm(a,'initial_pb',state.slot,state.season).level,range=MEET_FORM_TIME_RANGES[d][level+2],radius=RACE_EXECUTION_RANGE[d],pb=a.bestTimes[e];
   if(pb<base+range[0]-radius-.00501||pb>base+range[1]+radius+.00501){if(bad.length<10)bad.push({id:a.id,e,pb,base})}
  }
  for(const e of EVENTS){const a=edition.athletes.find(a=>a.individualEvent===e&&a.individualEligible),before=JSON.stringify(a.stats),base=expectedTime(a,e),race=withMeetRaceContext('world_championship',36,2027,()=>simulateRace(a,e,true,true)),q=race.physics;
   races.push({e,base,actual:q.abilityBase,total:race.total,formula:round2(base+q.formCorrection+q.raceCorrection),finish:race.trajectory.at(-1).t,stats:before===JSON.stringify(a.stats)});
  }
  return{count:edition.athletes.length,bad,races};
 })()`);
 assert.ok(r.count>1000);assert.deepEqual(r.bad,[]);assert.equal(r.races.length,15);
 for(const row of r.races){assert.equal(row.base,row.actual);assert.equal(row.total,row.formula);assert.equal(row.total,row.finish);assert.ok(row.stats,JSON.stringify(row))}
});

test('monthly CPU PB measurements exactly match actual final races across all events and categories with dated form and execution draws',()=>{
 const r=game()(`(()=>{
  Object.assign(state,{playerUniversity:'自大学',recordRankings:{},recordBook:{},teamTop10:{},retiredArchive:[],japanTeamHistory:[],facilities:{}});
  const categories=['middle','high','university','adult','adult'];
  state.world=categories.map((category,i)=>{const a=swimmer(130,'monthly-'+i);Object.assign(a,{category,age:category==='adult'?23:category==='university'?20:category==='high'?18:15,grade:category==='adult'?null:category==='university'?2:3,organization:'測定チーム'+i,alumni:i===4});a.bestTimes=Object.fromEntries(EVENTS.map(e=>[e,0]));return a});
  const retired=swimmer(130,'retired-monthly');retired.retired=true;state.world.push(retired);
  const own=swimmer(130,'own-monthly');own.year=2;state.players=[own];
  const protectedData=JSON.stringify([state.players,state.world.map(a=>a.stats),retired]),seed=state.rngSeed;
  state.slot=7;const offMonth=JSON.stringify(state);measureCpuTrainingPBs();const notDue=offMonth===JSON.stringify(state);
  const rows=[],forms=[],draws=[];
  for(const slot of [8,16,24]){
   state.slot=slot;const key=state.season+':'+slot;state.rngSeed=profileHash(state.cpuCompetitionSeed+':'+key+':cpu-training-swims');
   const expected=withMeetRaceContext('cpu_training',slot,state.season,()=>state.world.filter(a=>!a.retired).map(a=>{
    forms.push(athleteMeetForm(a,'cpu_training',slot,state.season).level);
    const events=a.category==='high'?['fr100',...EVENTS.filter(e=>e!=='fr100')]:EVENTS;
    return{a,pbs:Object.fromEntries(events.map(e=>{
     const race=simulateRace(a,e,true,false),q=race.physics;draws.push(q.raceCorrection);
     if(Math.abs(race.total-round2(q.abilityBase+q.formCorrection+q.raceCorrection))>.000001)throw Error('final race formula drift');
     return[e,Math.min(validRaceTime(a.bestTimes[e])?a.bestTimes[e]:Infinity,race.total)];
    }))};
   }));
   state.rngSeed=seed;measureCpuTrainingPBs();
   rows.push(...expected.map(({a,pbs})=>({id:a.id,expected:pbs,actual:{...a.bestTimes}})));
   const first=JSON.stringify(state);measureCpuTrainingPBs();if(first!==JSON.stringify(state))throw Error('same-month measurement rerolled');
   if(state.rngSeed!==seed||activeRaceMeetContext!==null)throw Error('monthly measurements leaked their seed or meet context');
  }
  return{notDue,rows,protected:protectedData===JSON.stringify([state.players,state.world.map(a=>a.stats),retired]),forms:[...new Set(forms)],variedExecution:new Set(draws).size>100,key:state.cpuTrainingMeasurementKey};
 })()`);
 assert.ok(r.notDue&&r.protected&&r.variedExecution);assert.ok(r.forms.length>1,'monthly measurements must include date-specific forms');
 assert.equal(r.rows.length,15);assert.equal(r.key,'2026:24');
 for(const row of r.rows){assert.equal(Object.keys(row.actual).length,15);assert.deepEqual(row.actual,row.expected,row.id)}
});

test('repeatable initial PB repair uses actual race form and execution with an isolated seed, preserving live RNG and outer context',()=>{
 const r=game()(`(()=>{const rows=[],forms=new Set(),draws=new Set();
  for(const slot of [1,8,16])for(const value of [40,100,163,188])for(const event of EVENTS){
   state.slot=slot;const a=swimmer(value,'initial-'+value),live=state.rngSeed,stats=JSON.stringify(a.stats);
   state.rngSeed=profileHash(state.cpuCompetitionSeed+':'+state.season+':'+state.slot+':'+a.id+':'+event+':initial-pb-v2');
   const race=withMeetRaceContext('initial_pb',slot,state.season,()=>simulateRace(a,event,true,false));
   state.rngSeed=live;
   const actual=withMeetRaceContext('intercollege',42,state.season,()=>{const context=activeRaceMeetContext,pb=coherentCpuPB(a,event);if(context!==activeRaceMeetContext)throw Error('initial measurement leaked its meet context');return pb});
   const repeated=coherentCpuPB(a,event);forms.add(athleteMeetForm(a,'initial_pb',slot,state.season).level);draws.add(race.physics.raceCorrection);
   rows.push({actual,repeated,expected:race.total,rng:live===state.rngSeed,stats:stats===JSON.stringify(a.stats),context:activeRaceMeetContext===null});
  }return{rows,forms:forms.size,draws:draws.size};
 })()`);
 assert.equal(r.rows.length,180);assert.ok(r.forms>1&&r.draws>100);
 for(const row of r.rows){assert.equal(row.actual,row.expected);assert.equal(row.actual,row.repeated);assert.ok(row.rng&&row.stats&&row.context)}
});
