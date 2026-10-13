const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(process.env.SWIM_HTML||path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(){
  const context=vm.createContext({});
  vm.runInContext(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener')),context);
  vm.runInContext(`state={rngSeed:12345,cpuCompetitionSeed:7654321,season:2026,slot:1,players:[],world:[],recruits:[],playerUniversity:'自大学',
    universities:[{id:'U01',name:'他大学',region:'kansai',reputation:35}],recordRankings:{high:{fr200:[]}},recordBook:{},teamTop10:{},japanTeamHistory:[]}`,context);
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
      clocks:EVENTS.every(e=>expectedTime(a,e)<=oldPB[e]+Math.max(oldPB[e]*.02,{50:.5,100:1,200:2.5,400:5}[distanceOf(e)])+.01),ceilings:STATS.every(k=>a.cpuStatCeilings[k]>=a.stats[k]),once:first===JSON.stringify(a)&&seed===state.rngSeed};
  })`);
  for(const r of rows)assert.ok(r.pb&&r.clocks&&r.ceilings&&r.once,JSON.stringify(r));
});

test('a legacy high-school 1:50 qualifier no longer swims 2:20, with one repair and unchanged records and protected athletes',()=>{
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
    const protectedData=JSON.stringify([own,signed,alumni,retired,consistent,adult,ownSnapshot]),records=JSON.stringify([state.recordRankings,state.recordBook,state.teamTop10,state.japanTeamHistory]);
    const pb=JSON.stringify(a.bestTimes),before=expectedTime(a,'fr200'),seed=state.rngSeed;
    migrateCpuRaceConsistency();const first=JSON.stringify(state);state=JSON.parse(first);migrateCpuRaceConsistency();
    const current=state.world.find(p=>p.id===a.id);
    const after=expectedTime(current,'fr200');rng=()=>.5;gauss=()=>0;
    const races=['joint_record','kansai_college','intercollege','teijimayama_championship','japan_open','japan_championship','world_championship'].map(meet=>withMeetRaceContext(meet,60,2026,()=>{
      const final=simulateMeetRace(current,'fr200',meet,true),prelim=simulateMeetRace(current,'fr200',meet,true,true);
      return{meet,final:final.total,prelim:prelim.total,delay:prelim.physics.preliminaryDelay,splits:round2(prelim.splits.reduce((sum,t)=>sum+t,0)),last:prelim.cumulative.at(-1),finish:prelim.trajectory.at(-1)};
    }));
    return{before,after,pb:pb===JSON.stringify(current.bestTimes),qualified:qualified(current,'japan_open','fr200'),
      protected:protectedData===JSON.stringify([state.players[0],...state.world.slice(1),state.japanTeam.athletes[1].snapshot]),
      records:records===JSON.stringify([state.recordRankings,state.recordBook,state.teamTop10,state.japanTeamHistory]),
      snapshot:expectedTime(state.japanTeam.athletes[0].snapshot,'fr200')<111.2,
      once:first===JSON.stringify(state),rngUnchanged:state.rngSeed===seed,mental:current.stats.mental,ceilings:STATS.every(k=>current.cpuStatCeilings[k]>=current.stats[k]),races};
  })()`);
  assert.ok(r.before>139&&r.before<142,JSON.stringify(r));assert.ok(r.after>110&&r.after<111.2);
  assert.ok(r.pb&&r.qualified&&r.protected&&r.records&&r.snapshot&&r.once&&r.rngUnchanged&&r.ceilings);assert.equal(r.mental,160);
  for(const row of r.races){
    assert.ok(row.final<112&&row.prelim<114,JSON.stringify(row));assert.ok(row.prelim>=row.final);assert.ok(row.delay===0||(row.delay>=.9&&row.delay<=2.2));
    assert.equal(row.last,row.prelim);assert.equal(row.splits,row.prelim);assert.equal(row.finish.distance,200);assert.ok(Math.abs(row.finish.t-row.prelim)<1e-8);
  }
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
