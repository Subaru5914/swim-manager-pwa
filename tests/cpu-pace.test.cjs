const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(process.env.SWIM_HTML||path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(full=false){
  const context=vm.createContext({crypto:{getRandomValues:a=>{a[0]=12345;return a}}});
  vm.runInContext(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener')),context);
  vm.runInContext(`state={rngSeed:12345,cpuCompetitionSeed:7654321,season:2026,slot:1,players:[],world:[],recruits:[],playerUniversity:'自大学',
    universities:[{id:'U01',name:'他大学',region:'kansai',reputation:35}],recordRankings:{high:{fr200:[]}},recordBook:{},teamTop10:{},japanTeamHistory:[]}`,context);
  if(full)vm.runInContext('state=createState()',context);
  return code=>JSON.parse(vm.runInContext('JSON.stringify('+code+')',context));
}

test('slower championship calibration never weakens an earlier swim or another event',()=>{
  const run=game(),r=run(`(()=>{
    const a={id:'two-titles',category:'high',stats:Object.fromEntries(STATS.map(k=>[k,138])),bestTimes:{}};
    calibrateToTime(a,'fr400',233);
    for(const e of EVENTS)a.bestTimes[e]=round2(expectedTime(a,e));
    const stats=JSON.stringify(a.stats),pb=JSON.stringify(a.bestTimes),times=EVENTS.map(e=>expectedTime(a,e));
    const changed=calibrateToTime(a,'im400',expectedTime(a,'im400')+20);
    const preserved=stats===JSON.stringify(a.stats)&&pb===JSON.stringify(a.bestTimes)&&EVENTS.every((e,i)=>expectedTime(a,e)===times[i]);
    a.stats.fr_speed=185;const before={...a.stats};calibrateToTime(a,'fr200',expectedTime(a,'fr200')-1,165);
    return{changed,preserved,noLoss:STATS.every(k=>a.stats[k]>=before[k]),mental:a.stats.mental===before.mental};
  })()`);
  assert.ok(r.preserved&&r.noLoss&&r.mental);assert.equal(r.changed,false);
});

test('school and career transitions keep lifetime PB pace without repeatedly strengthening swimmers',()=>{
  const run=game(),rows=run(`[['middle','high'],['high','university'],['university','adult']].map(([from,to])=>{
    const a={id:from+'-entrant',name:'進学泳者',category:from,organization:'他大学',age:18,grade:3,specialty:'fr200',
      stats:Object.fromEntries(STATS.map(k=>[k,138])),bestTimes:{},accolades:[],raceHistory:[],cpuStatCeilings:{},
      cpuCompetitionCategory:from,cpuCompetitionProfileVersion:from==='university'?3:2,cpuRaceDistributionCategory:from};
    for(const e of EVENTS)a.bestTimes[e]=round2(expectedTime(a,e)*.995);
    const oldPB={...a.bestTimes};
    state.cpuRaceDistributionVersion=1;state.cpuRaceDistributions=Object.fromEntries(EVENTS.map(e=>[to+':'+e,[[1,1.3],[1000,1300]]]));
    a.category=to;a.grade=to==='adult'?null:1;a.age=to==='adult'?23:to==='university'?19:16;state.world=[a];
    maintainWorldPopulation();const first=JSON.stringify(a),seed=state.rngSeed;maintainWorldPopulation();
    return{from,to,pb:EVENTS.every(e=>a.bestTimes[e]<=oldPB[e]),
      clocks:EVENTS.every(e=>expectedTime(a,e)<=oldPB[e]-Math.min(...MEET_FORM_TIME_RANGES[distanceOf(e)].map(r=>r[0]))+RACE_EXECUTION_RANGE[distanceOf(e)]+.025),ceilings:STATS.every(k=>a.cpuStatCeilings[k]>=a.stats[k]),once:first===JSON.stringify(a)&&seed===state.rngSeed};
  })`);
  for(const r of rows)assert.ok(r.pb&&r.clocks&&r.ceilings&&r.once,JSON.stringify(r));
});

test('legacy active 1:50 qualifiers across own, CPU, alumni and representative profiles no longer swim 2:20, preserving PBs and records',()=>{
  const run=game(),r=run(`(()=>{
    const swimmer=(id,extra={})=>({id,name:id,category:'high',grade:3,age:18,organization:'他校',specialty:'fr200',
      stats:Object.fromEntries(STATS.map(k=>[k,k==='mental'?160:43])),bestTimes:{fr200:110},cpuStatCeilings:Object.fromEntries(STATS.map(k=>[k,165])),...extra});
    const a=swimmer('legacy-qualifier',{scouted:true}),own=swimmer('own',{year:1}),signed=swimmer('signed',{scouted:true}),alumni=swimmer('alumni',{alumni:true,category:'adult'}),retired=swimmer('retired',{retired:true}),adult=swimmer('adult',{category:'adult',age:25,grade:null});
    for(const k of STATS)signed.stats[k]=138;
    const consistent=swimmer('consistent');for(const k of STATS)consistent.stats[k]=138;consistent.bestTimes.fr200=expectedTime(consistent,'fr200')*.995;
    state.players=[own];state.world=[a,signed,alumni,retired,consistent,adult];state.recruits=[a.id,signed.id];
    const snapshot=swimmer('japan-cpu'),ownSnapshot=swimmer('japan-own');state.japanTeam={athletes:[{id:snapshot.id,ownAtSelection:false,snapshot},{id:ownSnapshot.id,ownAtSelection:true,snapshot:ownSnapshot}]};
    state.recordRankings.high.fr200=[{athleteId:a.id,time:110,gradeAtRecord:3}];state.recordBook.fr200={athleteId:a.id,time:110};
    state.teamTop10.fr200=[{athleteId:own.id,time:110}];state.japanTeamHistory=[{year:2025,results:{fr200:110}}];
    const protectedData=JSON.stringify([signed,retired,consistent]),records=JSON.stringify([state.recordRankings,state.recordBook,state.teamTop10,state.japanTeamHistory]);
    const pb=JSON.stringify(a.bestTimes),before=expectedTime(a,'fr200'),seed=state.rngSeed;
    migrateCpuRaceConsistency();const first=JSON.stringify(state);state=JSON.parse(first);migrateCpuRaceConsistency();
    const current=state.world.find(p=>p.id===a.id);
    const after=expectedTime(current,'fr200');rng=()=>.5;gauss=()=>0;
    const races=['joint_record','kansai_college','intercollege','teijimayama_championship','japan_open','japan_championship','world_championship'].map(meet=>withMeetRaceContext(meet,60,2026,()=>{
      const final=simulateMeetRace(current,'fr200',meet,true),prelim=simulateMeetRace(current,'fr200',meet,true,true);
      return{meet,final:final.total,prelim:prelim.total,delay:prelim.physics.preliminaryDelay,splits:round2(prelim.splits.reduce((sum,t)=>sum+t,0)),last:prelim.cumulative.at(-1),finish:prelim.trajectory.at(-1)};
    }));
    return{before,after,pb:pb===JSON.stringify(current.bestTimes),qualified:qualified(current,'japan_open','fr200'),
      protected:protectedData===JSON.stringify(['signed','retired','consistent'].map(id=>state.world.find(a=>a.id===id))),
      records:records===JSON.stringify([state.recordRankings,state.recordBook,state.teamTop10,state.japanTeamHistory]),
      snapshot:expectedTime(state.japanTeam.athletes[0].snapshot,'fr200')<111.2,
      allActive:[state.players[0],...state.world.filter(a=>['alumni','adult'].includes(a.id)),...state.japanTeam.athletes.map(m=>m.snapshot)].every(a=>a.bestTimes.fr200===110&&expectedTime(a,'fr200')<111.2&&a.stats.mental===160),
      once:first===JSON.stringify(state),rngUnchanged:state.rngSeed===seed,mental:current.stats.mental,ceilings:STATS.every(k=>current.cpuStatCeilings[k]>=current.stats[k]),races};
  })()`);
  assert.ok(r.before>139&&r.before<142,JSON.stringify(r));assert.ok(r.after>110&&r.after<111.2);
  assert.ok(r.pb&&r.qualified&&r.protected&&r.records&&r.snapshot&&r.allActive&&r.once&&r.rngUnchanged&&r.ceilings);assert.equal(r.mental,160);
  for(const row of r.races){
    assert.ok(row.final<112&&row.prelim<114,JSON.stringify(row));assert.ok(row.prelim>=row.final);assert.ok(row.delay===0||(row.delay>=.9&&row.delay<=2.2));
    assert.equal(row.last,row.prelim);assert.equal(row.splits,row.prelim);assert.equal(row.finish.distance,200);assert.ok(Math.abs(row.finish.t-row.prelim)<1e-8);
  }
});

test('all fifteen PBs stay reachable after repair in every active category, without changing mental, records or the race RNG',()=>{
  const run=game(),r=run(`(()=>{
    const swimmers=['own','middle','high','university','adult','international','alumni'].map((kind,i)=>{
      const a=attachMedleyStats({id:'all-pbs-'+i,name:kind,category:kind==='own'?'university':kind==='alumni'?'adult':kind,
        year:kind==='own'?2:null,alumni:kind==='alumni',stats:Object.fromEntries(STATS.map(k=>[k,138])),bestTimes:{},cpuStatCeilings:Object.fromEntries(STATS.map(k=>[k,165]))});
      for(const e of EVENTS)a.bestTimes[e]=round2(expectedTime(a,e));
      for(const k of STATS)a.stats[k]=k==='mental'?160:43;
      return a;
    });
    state.players=[swimmers[0]];state.world=swimmers.slice(1,5).concat(swimmers[6]);state.internationalWorld={athletes:[swimmers[5]]};
    state.cpuRaceConsistencyVersion=1;
    const pb=JSON.stringify(swimmers.map(a=>a.bestTimes)),seed=state.rngSeed;
    migrateCpuRaceConsistency();const first=JSON.stringify(state);migrateCpuRaceConsistency();
    return{pb:pb===JSON.stringify(swimmers.map(a=>a.bestTimes)),mental:swimmers.every(a=>a.stats.mental===160),
      rng:seed===state.rngSeed,stable:first===JSON.stringify(state),version:state.cpuRaceConsistencyVersion,
      rows:swimmers.flatMap(a=>EVENTS.map(e=>({id:a.id,event:e,base:expectedTime(a,e),pb:a.bestTimes[e],
        tolerance:-Math.min(...MEET_FORM_TIME_RANGES[distanceOf(e)].map(r=>r[0]))+RACE_EXECUTION_RANGE[distanceOf(e)]+.02})))};
  })()`);
  assert.ok(r.pb&&r.mental&&r.rng&&r.stable);assert.equal(r.version,2);assert.equal(r.rows.length,105);
  for(const row of r.rows)assert.ok(row.base<=row.pb+row.tolerance+.005,JSON.stringify(row));
});

test('a PB restored after load is repaired before individual and relay racing, with bounded real clocks and identical replay finishes',()=>{
  const run=game(),r=run(`(()=>{
    const a=attachMedleyStats({id:'late-own-pb',year:1,category:'university',stats:Object.fromEntries(STATS.map(k=>[k,43])),bestTimes:{}});
    const cpu=attachMedleyStats({...deepClone(a),id:'late-cpu-pb',year:null});
    state.players=[a];state.world=[cpu];state.cpuRaceConsistencyVersion=2;migrateCpuRaceConsistency();
    a.bestTimes.fr200=110;cpu.bestTimes.fr200=110;
    const raw=expectedTime(a,'fr200');state.rngSeed=4321;
    const race=withMeetRaceContext('japan_open',60,2026,()=>simulateRace(a,'fr200',true,true,false,true));
    const members=[a,cpu,a,cpu],relay=withMeetRaceContext('intercollege',60,2026,()=>simulateRelay(members,'4x200fr',true,true));
    const stats=JSON.stringify([a.stats,cpu.stats]);migrateCpuRaceConsistency();
    return{raw,base:expectedTime(a,'fr200'),pb:a.bestTimes.fr200,cpuPB:cpu.bestTimes.fr200,
      unchanged:stats===JSON.stringify([a.stats,cpu.stats]),race:{total:race.total,target:race.physics.targetTime,base:race.physics.abilityBase,delay:race.physics.preliminaryDelay,last:race.cumulative.at(-1),finish:race.trajectory.at(-1).t},
      relay:{total:relay.total,legs:relay.legs,last:relay.cumulativeLegs.at(-1),finish:relay.trajectory.at(-1).t}};
  })()`);
  assert.ok(r.raw>139&&r.base<111.2);assert.equal(r.pb,110);assert.equal(r.cpuPB,110);assert.ok(r.unchanged);
  assert.ok(r.race.total<119.4);assert.ok(r.race.base<111.2);assert.equal(r.race.total,r.race.last);assert.ok(Math.abs(r.race.finish-r.race.total)<1e-8);
  assert.ok(r.relay.legs.every(t=>t<117.2));assert.equal(r.relay.total,r.relay.last);assert.ok(Math.abs(r.relay.finish-r.relay.total)<1e-8);
});

test('repair leaves ordinary PB gaps and legitimate exceptional swims unchanged',()=>{
  const run=game(),r=run(`(()=>{
    const a={id:'ordinary-variance',category:'university',stats:Object.fromEntries(STATS.map(k=>[k,173])),bestTimes:{}};
    for(const e of EVENTS)a.bestTimes[e]=round2(expectedTime(a,e)*.99);
    state.world=[a];const stats=JSON.stringify(a.stats),pb=JSON.stringify(a.bestTimes);migrateCpuRaceConsistency();
    return{stats:stats===JSON.stringify(a.stats),pb:pb===JSON.stringify(a.bestTimes)};
  })()`);
  assert.ok(r.stats&&r.pb);
});

test('even repeated fastest legal swims never raise ability or make the next race faster in any of the fifteen events',()=>{
  const run=game(),r=run(`(()=>{
    const a=attachMedleyStats({id:'legal-race-pbs',year:2,category:'university',stats:Object.fromEntries(STATS.map(k=>[k,173])),bestTimes:{}});
    state.players=[a];athleteMeetForm=()=>MEET_FORMS[4];rng=()=>0;
    for(const e of EVENTS)a.bestTimes[e]=round2(expectedTime(a,e));
    const stats=JSON.stringify(a.stats),rows=[];
    for(const event of EVENTS){
      const base=expectedTime(a,event),times=[];
      for(let i=0;i<4;i++){
        const race=withMeetRaceContext('japan_open',60,2026,()=>simulateRace(a,event));
        updatePersonalBest(a,event,race.total);times.push(race.total);
        rows.push({event,base,actualBase:race.physics.abilityBase,time:race.total,stats:stats===JSON.stringify(a.stats)});
      }
    }
    return rows;
  })()`);
  assert.equal(r.length,60);
  for(const row of r){assert.ok(row.stats);assert.equal(row.actualBase,row.base)}
  for(let i=0;i<r.length;i+=4)assert.ok(r.slice(i,i+4).every(row=>row.time===r[i].time));
});

test('middle-school swimmers of all three grades race near their PBs in both joint meets across all fifteen events',()=>{
  const run=game(true),r=run(`(()=>{
    const rows=[];
    for(const slot of [76,84])for(const event of EVENTS){
      const result=withMeetRaceContext('joint_record',slot,2026,()=>runEvent('joint_record',event,[]));
      for(const stage of ['prelim','final'])for(const x of result[stage])if(x.athlete.category==='middle'){
        const d=distanceOf(event),range=MEET_FORM_TIME_RANGES[d][0][1]+RACE_EXECUTION_RANGE[d]+(stage==='prelim'?PRELIMINARY_TIME_DELAY[d][1]:0);
        const tolerance=-Math.min(...MEET_FORM_TIME_RANGES[d].map(r=>r[0]))+RACE_EXECUTION_RANGE[d]+.02;
        rows.push({slot,event,stage,grade:x.athlete.grade,pb:x.entryPB,time:x.race.total,base:x.race.physics.abilityBase,maxLag:range+tolerance,last:x.race.cumulative.at(-1)});
      }
    }
    return {rows,grades:[...new Set(rows.map(r=>r.grade))].sort(),events:[...new Set(rows.map(r=>r.event))],slots:[...new Set(rows.map(r=>r.slot))]};
  })()`);
  assert.deepEqual(r.grades,[1,2,3]);assert.equal(r.events.length,15);assert.deepEqual(r.slots,[76,84]);assert.ok(r.rows.length>100);
  for(const row of r.rows){assert.ok(row.base<=row.pb+row.maxLag+.03,JSON.stringify(row));assert.ok(row.time<=row.pb+row.maxLag+.03,JSON.stringify(row));assert.equal(row.time,row.last)}
});
