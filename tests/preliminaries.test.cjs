const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(){
  const context=vm.createContext({});vm.runInContext(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener')),context);
  vm.runInContext(`state={rngSeed:12345,season:2026,players:[],world:[],playerUniversity:"自大学"};
    function forcePreliminaryRng(gates=[0]){let i=0;const seq=gates.flatMap(gate=>[.5,.5,.5,.5,gate,...(gate===0?[.5,.5]:[])]);rng=()=>seq[i++%seq.length]}`,context);
  return code=>JSON.parse(vm.runInContext('JSON.stringify('+code+')',context));
}
const ranges={50:[.08,.22],100:[.18,.45],200:[.9,2.2],400:[2,4.5]};

test('all individual prelims can apply a distance-dependent delay while retaining exact splits and recorded finish',()=>{
  const run=game(),rows=run(`(()=>{
    rng=()=>.5;gauss=()=>0;
    const p={id:'individual',stats:Object.fromEntries(STATS.map(k=>[k,138])),bestTimes:{}};
    const before=JSON.stringify(p);
    return EVENTS.map(event=>{
      rng=()=>.5;const final=simulateRace(p,event,true,true);
      forcePreliminaryRng();const prelim=simulateRace(p,event,true,true,false,true);
      forcePreliminaryRng();const cpu=simulateMeetRace(p,event,'intercollege',false,true);
      return{event,distance:distanceOf(event),base:final.physics.targetTime,delay:prelim.physics.preliminaryDelay,finalDelay:final.physics.preliminaryDelay??null,
        total:prelim.total,cpu:cpu.total,last:prelim.cumulative.at(-1),sum:round2(prelim.splits.reduce((a,b)=>a+b,0)),finish:prelim.trajectory.at(-1),unchanged:before===JSON.stringify(p)};
    });
  })()`);
  assert.equal(rows.length,15);
  for(const row of rows){
    const [min,max]=ranges[row.distance],delay=(min+max)/2;
    assert.ok(Math.abs(row.delay-delay)<1e-10);assert.equal(row.finalDelay,null);
    assert.equal(row.total,Math.round((row.base+delay)*100)/100);assert.equal(row.total,row.cpu);
    assert.equal(row.last,row.total);assert.equal(row.sum,row.total);assert.equal(row.finish.distance,row.distance);assert.ok(Math.abs(row.finish.t-row.total)<1e-8);assert.ok(row.unchanged);
  }
});

test('all own and CPU relay prelims omit the delay and keep laps, totals and playback on the same clock',()=>{
  const run=game(),rows=run(`(()=>{
    rng=()=>.5;gauss=()=>0;
    const members=Array.from({length:4},(_,i)=>({id:'relay-'+i,name:'泳者'+i,stats:Object.fromEntries(STATS.map(k=>[k,138])),bestTimes:{}})),before=JSON.stringify(members);
    samplePreliminaryDelay=()=>{throw new Error('Relay must not draw a preliminary correction')};
    return RELAYS.map(event=>{
      rng=()=>.5;const final=simulateRelay(members,event,true);
      const prelim=simulateRelay(members,event,true,true),cpu=simulateCpuRelay(members,event,'intercollege',true);
      return{event,legDistance:event==='4x200fr'?200:100,base:final.total,total:prelim.total,cpu:cpu.total,legs:prelim.legs,last:prelim.cumulativeLegs.at(-1),
        delay:prelim.preliminaryDelay,finalDelay:final.preliminaryDelay??null,finish:prelim.trajectory.at(-1),distance:prelim.distance,unchanged:before===JSON.stringify(members)};
    });
  })()`);
  for(const row of rows){
    assert.equal(row.delay,undefined);assert.equal(row.finalDelay,null);
    assert.equal(row.total,row.base);assert.equal(row.cpu,row.total);
    assert.equal(Math.round(row.legs.reduce((a,b)=>a+b,0)*100)/100,row.total);assert.equal(row.last,row.total);
    assert.equal(row.finish.distance,row.distance);assert.ok(Math.abs(row.finish.t-row.total)<1e-8);assert.ok(row.unchanged);
  }
});

test('owned swimmers, owned Japan snapshots, CPU and alumni share probabilistic prelim delays with identical official clocks',()=>{
  const run=game(),r=run(`(()=>{
    const make=id=>({id,name:id,stats:Object.fromEntries(STATS.map(k=>[k,138])),bestTimes:{}}),own=make('own'),graduate=make('graduate'),cpu=make('cpu'),alumni=make('graduate');
    state.players=[own];state.world=[cpu,alumni];
    state.japanTeam={year:2027,athletes:[{id:graduate.id,ownAtSelection:true,snapshot:graduate},{id:cpu.id,ownAtSelection:false,snapshot:cpu}]};
    const originalRng=rng;
    return EVENTS.map(event=>{
      const races=[own,graduate].map(p=>{
        rng=()=>.5;const final=simulateRace(p,event,true,true);
        forcePreliminaryRng();const prelim=simulateRace(p,event,true,true,false,true);
        forcePreliminaryRng([.99]);const no=simulateRace(p,event,true,true,false,true);
        return{id:p.id,event,prelim:prelim.total,final:final.total,zero:no.total,zeroDelay:no.physics.preliminaryDelay,delay:prelim.physics.preliminaryDelay,probability:prelim.physics.preliminaryProbability,
          form:prelim.physics.formCorrection,finalForm:final.physics.formCorrection,execution:prelim.physics.raceCorrection,finalExecution:final.physics.raceCorrection,last:prelim.cumulative.at(-1),finish:prelim.trajectory.at(-1).t};
      });
      rng=originalRng;const seed=state.rngSeed;samplePreliminaryDelay(own,event);const consumed=seed!==state.rngSeed;
      forcePreliminaryRng();const cpuRace=simulateRace(cpu,event,true,true,false,true);
      return{races,consumed,cpuDelay:cpuRace.physics.preliminaryDelay,cpuProbability:cpuRace.physics.preliminaryProbability,
        alumni:withMeetRaceContext('japan_open',67,2027,()=>athletePreliminaryProbability(alumni,event)),
        graduateWorld:withMeetRaceContext('world_championship',36,2027,()=>athletePreliminaryProbability({...alumni},event))};
    });
  })()`);
  for(const row of r){
    assert.ok(row.consumed&&row.cpuDelay>0&&row.cpuProbability>0&&row.alumni>0&&row.graduateWorld>0);
    for(const race of row.races){assert.ok(race.delay>0&&race.probability>0&&race.probability<1);assert.equal(race.prelim,Math.round((race.final+race.delay)*100)/100);assert.equal(race.zeroDelay,0);assert.equal(race.zero,race.final);assert.equal(race.form,race.finalForm);assert.equal(race.execution,race.finalExecution);assert.equal(race.last,race.prelim);assert.ok(Math.abs(race.finish-race.prelim)<1e-8)}
  }
});

test('preliminary tendencies differ by swimmer, rise with distance and survive JSON and mental changes without consuming RNG',()=>{
  const run=game(),r=run(`(()=>{
    const swimmers=Array.from({length:200},(_,i)=>({id:'tendency-'+i,stats:{mental:i},bestTimes:{}}));state.world=swimmers;
    const before=JSON.stringify(state),rates=swimmers.map(p=>[50,100,200,400].map(d=>athletePreliminaryProbability(p,'fr'+d)));
    const untouched=JSON.stringify(state)===before;state=JSON.parse(before);state.rngSeed=98765;
    for(const p of state.world)p.stats.mental=200-p.stats.mental;
    return{rates,reloaded:state.world.map(p=>[50,100,200,400].map(d=>athletePreliminaryProbability(p,'fr'+d))),untouched};
  })()`);
  assert.ok(r.untouched);assert.deepEqual(r.rates,r.reloaded);assert.ok(new Set(r.rates.map(a=>a[0])).size>190);
  for(const row of r.rates){[[.10,.40],[.20,.50],[.45,.75],[.60,.90]].forEach(([lo,hi],i)=>assert.ok(row[i]>lo&&row[i]<hi));for(let i=1;i<row.length;i++)assert.ok(row[i]>row[i-1])}
});

test('preliminary delay sampling retains both zero and positive outcomes at each personal probability and preserves the saved RNG stream',()=>{
  const run=game(),r=run(`(()=>{
    const p={id:'sampling',stats:{mental:138}};
    const rows=[50,100,200,400].map(d=>{
      state.rngSeed=12345;const e='fr'+d,probability=athletePreliminaryProbability(p,e);let applied=0,min=Infinity,max=0,sum=0;
      const count=30000;for(let i=0;i<count;i++){const delay=samplePreliminaryDelay(p,e);if(delay>0){applied++;min=Math.min(min,delay);max=Math.max(max,delay)}sum+=delay}
      return{d,probability,applied:applied/count,min,max,mean:sum/count};
    });
    const saved=JSON.stringify(state),first=Array.from({length:100},()=>samplePreliminaryDelay(p,'fr200'));state=JSON.parse(saved);
    return{rows,reproducible:JSON.stringify(first)===JSON.stringify(Array.from({length:100},()=>samplePreliminaryDelay(p,'fr200')))};
  })()`);
  assert.ok(r.reproducible);
  for(const row of r.rows){const [lo,hi]=ranges[row.d];assert.ok(Math.abs(row.applied-row.probability)<.015);assert.ok(row.min>=lo&&row.max<=hi);assert.ok(Math.abs(row.mean-row.probability*(lo+hi)/2)<(lo+hi)*.01)}
});

test('real individual preliminaries may have no delay while no relay swimmer draws one in either phase',()=>{
  const run=game(),r=run(`(()=>{
    const members=Array.from({length:4},(_,i)=>({id:'mixed-'+i,stats:Object.fromEntries(STATS.map(k=>[k,138])),bestTimes:{}})),before=JSON.stringify(members);
    rng=()=>.99;const individuals=EVENTS.map(event=>{const final=simulateRace(members[0],event,true,true),prelim=simulateRace(members[0],event,true,true,false,true);return{event,final:final.total,prelim:prelim.total,delay:prelim.physics.preliminaryDelay,probability:prelim.physics.preliminaryProbability,finish:prelim.trajectory.at(-1).t}});
    samplePreliminaryDelay=()=>{throw new Error('Unexpected relay preliminary draw')};
    const relays=RELAYS.map(kind=>{
      state.rngSeed=7654321;const final=simulateRelay(members,kind,true);
      state.rngSeed=7654321;const prelim=simulateRelay(members,kind,true,true);
      return{kind,final:final.total,prelim:prelim.total,delay:prelim.preliminaryDelay??null,legs:prelim.legs,finalLegs:final.legs,last:prelim.cumulativeLegs.at(-1),finish:prelim.trajectory.at(-1).t,finalDelay:final.preliminaryDelay??null};
    });
    return{individuals,relays,unchanged:before===JSON.stringify(members)};
  })()`);
  assert.ok(r.unchanged);
  for(const row of r.individuals){assert.equal(row.delay,0);assert.equal(row.prelim,row.final);assert.equal(row.finish,row.prelim);assert.ok(row.probability>0&&row.probability<1)}
  for(const row of r.relays){assert.equal(row.finalDelay,null);assert.equal(row.delay,null);assert.equal(row.prelim,row.final);assert.deepEqual(row.legs,row.finalLegs);assert.equal(row.last,row.prelim);assert.ok(Math.abs(row.finish-row.prelim)<1e-8)}
});

test('mental alone does not change random timing variance at the same form, including upper A, and no separate poor-race penalty remains',()=>{
  const run=game(),groups=run(`[138,173].map(value=>[0,100,150,200].map(mental=>{
    const p={stats:Object.fromEntries(STATS.map(k=>[k,k==='mental'?mental:value])),bestTimes:{}},base=expectedTime(p,'fr100');p.bestTimes.fr100=base+30;
    state.rngSeed=7654321;const normal=[];let poor=0;
    for(let i=0;i<10000;i++){const time=raceTarget(p,'fr100');if(time>p.bestTimes.fr100)poor++;else normal.push(time)}
    const mean=normal.reduce((a,b)=>a+b,0)/normal.length,sd=Math.sqrt(normal.reduce((sum,t)=>sum+(t-mean)**2,0)/normal.length);
    return{value,mental,rate:poor/10000,sd};
  }))`);
  for(const rows of groups){
    rows.forEach(row=>assert.equal(row.rate,0,JSON.stringify(row)));
    for(let i=1;i<rows.length;i++){assert.equal(rows[i].rate,rows[0].rate);assert.equal(rows[i].sd,rows[0].sd)}
  }
});

test('final cards recover actual prelim times from old individual and relay results without using PB or new lineup times',()=>{
  const run=game(),r=run(`(()=>{
    const original=Array.from({length:4},(_,i)=>({id:'original-'+i,name:'旧泳者'+i,year:2})),replacement=Array.from({length:4},(_,i)=>({id:'new-'+i,name:'決勝泳者'+i,year:3}));
    state.players=[...original,...replacement];
    const athlete=replacement[0],race={total:49,trajectory:[{t:49,distance:100,phase:'finish'}]},individual={source:'PLAYER',athlete,entryPB:48,heatLane:4,race};
    const prelim={...individual,race:{total:51.23}},individualBlock={event:'fr100',phase:'final',stage:'final',ownIds:[athlete.id],rows:[individual],eventResult:{prelim:[prelim],final:[individual]}};
    const relay={organization:state.playerUniversity,members:replacement,heatLane:4,race:{total:210,trajectory:[{t:210,distance:400,phase:'finish'}]}};
    const relayBlock={event:'4x100medley',phase:'final',stage:'relay_final',ownIds:replacement.map(a=>a.id),rows:[relay],relayPrelim:[{organization:state.playerUniversity,members:original,race:{total:215.67}}]};
    const before=JSON.stringify([individualBlock,relayBlock]);
    const own=buildMeetBlockRaceQueue(individualBlock,0)[0].rows[0],team=buildMeetBlockRaceQueue(relayBlock,1)[0].rows[0];
    return{individual:own.prelimTime,relay:team.prelimTime,card:raceEntrantCard(own,0,'fr100'),relayCard:raceEntrantCard(team,0,'4x100medley'),
      newNames:team.members.map(a=>a.name),unchanged:before===JSON.stringify([individualBlock,relayBlock])};
  })()`);
  assert.equal(r.individual,51.23);assert.equal(r.relay,215.67);assert.match(r.card,/予選 <b>51\.23<\/b>/);assert.match(r.relayCard,/予選 <b>3:35\.67<\/b>/);
  assert.ok(r.newNames.every(name=>name.startsWith('決勝泳者')));assert.ok(r.unchanged);
});

test('restored probabilities and sampled delays exactly match v1.98 for all events, player IDs and fallback names',()=>{
  const cp=require('node:child_process'),repo=path.join(__dirname,'..');
  const previous=cp.execFileSync('git',['show','2bebee0:index.html'],{cwd:repo,encoding:'utf8',maxBuffer:2000000}).match(/<script>([\s\S]*?)<\/script>/)[1];
  const load=code=>vm.compileFunction(code.slice(0,code.indexOf('document.getElementById("nav").addEventListener'))+'\nreturn code=>JSON.parse(JSON.stringify(eval(code)))',[])();
  const old=load(previous),current=load(source),scenario=`(()=>{
    state={season:2026,rngSeed:12345,players:[],world:[]};
    const actors=[...Array.from({length:300},(_,i)=>({id:'W-'+i,stats:{mental:i%201}})),{name:'名前のみ 泳者'},{id:0},{id:''},{}];
    const rates=actors.map(a=>EVENTS.map(e=>athletePreliminaryProbability(a,e)));
    const seed=state.rngSeed,draws=actors.slice(0,8).map(a=>EVENTS.map(e=>Array.from({length:30},()=>samplePreliminaryDelay(a,e))));
    return{rates,seed,draws,nextSeed:state.rngSeed};
  })()`;
  assert.deepEqual(current(scenario),old(scenario));
});
