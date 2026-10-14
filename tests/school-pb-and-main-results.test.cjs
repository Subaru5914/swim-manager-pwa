const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),cp=require('node:child_process');
const {test}=require('node:test'),SaveHistory=require('../save-history.js');
const repo=path.join(__dirname,'..'),html=fs.readFileSync(path.join(repo,'index.html'),'utf8');
function game(input=html,seed=5914){
  const source=input.match(/<script>([\s\S]*?)<\/script>/)[1];
  return vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+`
    function schoolAthlete(i,category='high',level=150){return attachMedleyStats({id:'school-'+i,name:'年次計測'+i,category,age:18,grade:3,retired:false,specialty:'fr100',stats:Object.fromEntries(STATS.map(k=>[k,level])),imAptitude:{speed:0,stamina:0},bestTimes:{},accolades:[],scoutPreferences:{version:3,worldAmbition:false,preferredRegion:null,earlyCompetition:false,prestigeSchool:false}})}
    function ownAthlete(i){const p=schoolAthlete(i,'university',163);p.id='own-'+i;p.year=2;p.organization=state.playerUniversity;p.raceHistory=[];p.growthProfile=[1,1,1,1];p.bestTimes.fr100=49;return p}
    return code=>JSON.parse(JSON.stringify(eval(code)))`,['globalThis','SaveHistory'])({crypto:{getRandomValues:a=>{a[0]=seed;return a}}},SaveHistory);
}
function minimal(){const run=game();run(`state={season:2026,slot:43,rngSeed:5914,points:50,reputation:80,playerUniversity:'自大学',players:[],world:[],recruits:[],recordRankings:{},recordBook:{},teamTop10:{},retiredArchive:[],japanTeamHistory:[],facilities:{},schoolPBModelVersion:1,highSchoolPBMeasurementSeason:2025};true`);return run}
test('annual PB checks compare all unmeasured swimmers together, retain fifty and leave abilities and RNG unchanged',()=>{
  const results=[];
  for(const reversed of [false,true]){
    const run=minimal(),r=run(`(()=>{
      state.world=Array.from({length:65},(_,i)=>schoolAthlete(i,'high',i<50?150:i<52?170:80));
      for(const a of state.world.slice(0,50))for(const e of EVENTS)a.bestTimes[e]=round2(expectedTime(a,e)+(Number(a.id.slice(7)))*.01);
      const before=JSON.stringify(state.world.map(a=>[a.id,a.stats])),seed=state.rngSeed;
      ${reversed?'state.world.reverse();':''}
      const result=updateSchoolPersonalBests(),rows=EVENTS.map(e=>ranking(e,'high',50)),ids=rows.map(rows=>rows.map(a=>a.id).sort());
      const protectedStats=JSON.stringify(state.world.slice().sort((a,b)=>+a.id.slice(7)-+b.id.slice(7)).map(a=>[a.id,a.stats]))===before;
      const clock=state.world.filter(a=>a.id==='school-50'||a.id==='school-51').every(a=>EVENTS.every(e=>a.bestTimes[e]===coherentCpuPB(a,e)));
      return{result,ids,counts:rows.map(rows=>rows.length),protectedStats,rng:seed===state.rngSeed,clock,lowMissing:state.world.filter(a=>+a.id.slice(7)>=52).every(a=>!Object.keys(a.bestTimes).length)};
    })()`);
    assert.ok(r.result.highRegistered>0&&r.protectedStats&&r.rng&&r.clock&&r.lowMissing);assert.deepEqual(r.counts,Array(15).fill(50));results.push(r.ids);
  }
  assert.deepEqual(results[0],results[1]);
});
test('checks run once per academic year and a newly strong non-specialty stroke can acquire PBs in the next year',()=>{
  const run=minimal(),r=run(`(()=>{
    state.world=Array.from({length:51},(_,i)=>schoolAthlete(i,'high',i<50?150:80));
    for(const a of state.world.slice(0,50))for(const e of EVENTS)a.bestTimes[e]=coherentCpuPB(a,e);
    const a=state.world[50];updateSchoolPersonalBests();const missing=!validRaceTime(a.bestTimes.ba100);
    a.stats.ba_speed=170;a.stats.ba_stamina=170;a.stats.ba_turn=170;
    const sameYear=updateSchoolPersonalBests(),stillMissing=!validRaceTime(a.bestTimes.ba100);
    state.season++;const newYear=updateSchoolPersonalBests(),pb=a.bestTimes.ba100,first=JSON.stringify(state);state=JSON.parse(first);updateSchoolPersonalBests();
    return{missing,sameYear,stillMissing,newYear,pb,expected:coherentCpuPB(state.world.find(p=>p.id===a.id),'ba100'),rank:scoutHighSchoolRank(state.world.find(p=>p.id===a.id),'ba100'),season:state.highSchoolPBMeasurementSeason,stable:first===JSON.stringify(state)};
  })()`);
  assert.ok(r.missing&&r.stillMissing&&r.stable);assert.equal(r.sameYear.highRegistered,0);assert.ok(r.newYear.highRegistered>=3);assert.equal(r.pb,r.expected);assert.ok(r.rank<=50);assert.equal(r.season,2027);
});
test('a tied unmeasured candidate at the fiftieth place does not displace an existing PB',()=>{
  const run=minimal(),r=run(`(()=>{
    state.world=Array.from({length:51},(_,i)=>schoolAthlete(i));const a=state.world[50];
    for(const e of EVENTS){const time=coherentCpuPB(a,e);state.world.slice(0,50).forEach((p,i)=>p.bestTimes[e]=round2(time-(49-i)*.01))}
    const result=updateSchoolPersonalBests();return{result,missing:!Object.keys(a.bestTimes).length,lastKnown:EVENTS.every(e=>validRaceTime(state.world[49].bestTimes[e]))};
  })()`);
  assert.equal(r.result.highRegistered,0);assert.ok(r.missing&&r.lastKnown);
});
test('current middle-school PB rules keep strong secondary strokes and earned weak-stroke races, without touching other age groups',()=>{
  const run=minimal(),r=run(`(()=>{
    const a=schoolAthlete(0,'middle',60);a.specialty='fr100';for(const s of ['fr','ba'])for(const k of ['speed','stamina','turn'])a.stats[s+'_'+k]=s==='fr'?150:145;
    for(const e of EVENTS)a.bestTimes[e]=coherentCpuPB(a,e);a.recordedPBs={br100:a.bestTimes.br100};
    const adult=schoolAthlete(1,'adult',160);adult.bestTimes.fly100=coherentCpuPB(adult,'fly100');state.world=[a,adult];delete state.schoolPBModelVersion;
    const before=JSON.stringify([a.stats,adult]),seed=state.rngSeed;updateSchoolPersonalBests();
    return{keys:Object.keys(a.bestTimes),protected:before===JSON.stringify([a.stats,adult]),rng:state.rngSeed===seed,recorded:a.recordedPBs.br100===a.bestTimes.br100};
  })()`);
  for(const e of ['fr50','fr100','fr200','fr400','ba50','ba100','ba200','br100'])assert.ok(r.keys.includes(e));for(const e of ['br50','br200','fly50','fly100','fly200','im200','im400'])assert.ok(!r.keys.includes(e));assert.ok(r.protected&&r.rng&&r.recorded);
});
test('current v2.01 generation migrates school PBs and medals once, preserving own players, adult/college PBs, stats, progress and the next draw',()=>{
  const oldHtml=cp.execFileSync('git',['show','HEAD:index.html'],{cwd:repo,encoding:'utf8',maxBuffer:2000000}),old=game(oldHtml);
  const before=old(`(()=>{
    state=createState();migrateState();
    const a=state.world.find(a=>a.category==='high'&&a.grade===3&&!Object.keys(a.bestTimes).length&&!a.accolades.length);a.stats.ba_speed=170;a.stats.ba_stamina=170;a.stats.ba_turn=170;attachMedleyStats(a);
    state.players[0].raceHistory=[{season:2026,slot:43,meet:'intercollege',event:'fr100',stage:'A決勝',rank:1,time:52}];
    migrateState();
    return{state:deepClone(state),promoted:a.id};
  })()`),run=game();run(`state=${JSON.stringify(before.state)};migrateState();true`);
  const result=run(`(()=>{
    const a=state.world.find(a=>a.id===${JSON.stringify(before.promoted)}),fields=highSchoolScoutRankings(),first=JSON.stringify(state),seed=state.rngSeed;
    migrateState();return{state:deepClone(state),rank:fields.get('ba100').byId.get(a.id),pb:a.bestTimes.ba100,clock:coherentCpuPB(a,'ba100'),stable:first===JSON.stringify(state)&&seed===state.rngSeed,main:playerMainResults(state.players[0])};
  })()`);
  assert.ok(result.rank<=50&&result.stable);assert.equal(result.pb,result.clock);assert.equal(result.state.rngSeed,before.state.rngSeed);
  for(const key of ['season','slot','points','reputation','playerUniversity','trainingFocus','facilities'])assert.deepEqual(result.state[key],before.state[key]);
  const byId=new Map(before.state.world.map(a=>[a.id,a]));for(const a of result.state.world){const b=byId.get(a.id);assert.deepEqual(a.stats,b.stats,a.id);if(!['middle','high'].includes(a.category))assert.deepEqual(a.bestTimes,b.bestTimes,a.id)}
  for(let i=0;i<result.state.players.length;i++)for(const key of ['stats','bestTimes','raceHistory','specialty'])assert.deepEqual(result.state.players[i][key],before.state.players[i][key]);
  assert.equal(result.main[0].rank,1);assert.equal(result.main[0].event,'fr100');
});
test('main results record actual final podiums, exclude self trials/prelims/B finals and update a corrected placement',()=>{
  const run=minimal(),r=run(`(()=>{
    const p=ownAthlete(0);state.players=[p];
    for(const [meet,stage,rank,event]of [['team_trial','決勝',1,'fr100'],['intercollege','予選',1,'fr100'],['japan_open','B決勝',1,'ba100'],['intercollege','A決勝',1,'fr100'],['japan_open','A決勝',2,'ba100'],['japan_championship','A決勝',3,'fly100'],['kansai_college','A決勝',4,'br100']])updateResultHistory(p,event,60,meet,stage,rank);
    const first=playerMainResults(p),seed=state.rngSeed;recordAthleteMainResult(p,{season:2026,slot:43,meet:'intercollege',event:'fr100',stage:'決勝',rank:2,time:59});
    const corrected=playerMainResults(p).find(h=>h.meet==='intercollege');recordAthleteMainResult(p,{season:2026,slot:43,meet:'intercollege',event:'fr100',stage:'決勝',rank:4,time:61});
    p.raceHistory=p.raceHistory.filter(h=>h.meet!=='intercollege');const removed=!playerMainResults(p).some(h=>h.meet==='intercollege');
    return{first,corrected,removed,rng:seed===state.rngSeed,stored:p.accolades.length};
  })()`);
  assert.equal(r.first.length,3);assert.deepEqual(r.first.map(h=>h.rank).sort(),[1,2,3]);assert.equal(r.corrected.rank,2);assert.equal(r.corrected.time,59);assert.ok(r.removed&&r.rng);assert.equal(r.stored,2);
});
test('relay podiums belong to the four final swimmers and keep total and personal lap times',()=>{
  const run=minimal(),r=run(`(()=>{
    state.players=Array.from({length:5},(_,i)=>ownAthlete(i));const members=state.players.slice(0,4);
    const team={organization:state.playerUniversity,members,rank:2,prelimRank:1,race:{total:200,legs:[49,50,50,51]}};
    recordRelayResult('4x100fr',team,'intercollege','予選');recordRelayResult('4x100fr',team,'intercollege','決勝');recordRelayResult('4x100fr',team,'intercollege','決勝');
    return state.players.map(p=>({main:playerMainResults(p),stored:p.accolades.length}));
  })()`);
  for(let i=0;i<4;i++){assert.equal(r[i].main.length,1);assert.equal(r[i].main[0].rank,2);assert.equal(r[i].main[0].time,200);assert.equal(r[i].main[0].lapTime,[49,50,50,51][i]);assert.equal(r[i].stored,1)}assert.equal(r[4].main.length,0);assert.equal(r[4].stored,0);
});
test('world podiums update both the selected snapshot and the live own athlete, and legacy world/relay results can be recovered',()=>{
  const run=minimal(),r=run(`(()=>{
    const p=ownAthlete(0);state.players=[p];const snapshot=attachMedleyStats(deepClone(p));state.japanTeam={year:2027,athletes:[{id:p.id,ownAtSelection:true,snapshot}]};
    recordAthleteMainResult(snapshot,{season:2027,slot:36,meet:'world_championship',event:'fr100',stage:'A決勝',rank:1,time:48});
    const shared=JSON.stringify(p.accolades)===JSON.stringify(snapshot.accolades);
    p.raceHistory=[];p.accolades=[];snapshot.accolades=[];
    state.japanTeamHistory=[{year:2027,worldSeason:2027,worldSlot:36,results:{individual:{fr100:[{athleteId:p.id,final:{rank:1,time:48}}]},relays:{'4x100fr':{final:{rank:3,time:195,members:[{id:p.id}],legs:[48.5]}}}}}];
    initializeMainResults();const first=JSON.stringify(state);initializeMainResults();return{shared,results:playerMainResults(p),stable:first===JSON.stringify(state)};
  })()`);
  assert.ok(r.shared&&r.stable);assert.equal(r.results.length,2);assert.ok(r.results.some(h=>h.event==='fr100'&&h.rank===1));assert.ok(r.results.some(h=>h.event==='4x100fr'&&h.rank===3&&h.lapTime===48.5));
});
test('saved podiums survive old detailed-history cleanup and transfer to adult alumni without affecting abilities or PBs',()=>{
  const run=minimal(),r=run(`(()=>{
    const p=ownAthlete(0);state.players=[p];state.season=2026;updateResultHistory(p,'fr100',60,'intercollege','A決勝',1);
    state.season=2035;state.recordRankings={};state.recordBook={};state.teamTop10={};
    const before=JSON.stringify([p.stats,p.bestTimes,p.accolades]),plan=SaveHistory.plan(state,{triggerBytes:1,targetBytes:1});plan.apply(state);
    const adult=alumniAdultFromPlayer(p,'社会人');return{removed:plan.removed,history:p.raceHistory.length,main:playerMainResults(p),adult:adult.accolades,protected:before===JSON.stringify([p.stats,p.bestTimes,p.accolades])};
  })()`);
  assert.equal(r.removed,1);assert.equal(r.history,0);assert.equal(r.main.length,1);assert.equal(r.main[0].rank,1);assert.deepEqual(r.adult,r.main);assert.ok(r.protected);
});
test('four real April rollovers recheck all high-school distances, leave no faster unmeasured candidate and remain stable on reload',()=>{
  const run=game(),r=run(`(()=>{
    state=createState();migrateState();const errors=[],years=[];
    for(let year=0;year<4;year++){
      for(let turn=0;turn<8;turn++)trainCommand();newSeason();
      const fields=highSchoolScoutRankings();
      for(const event of EVENTS){
        const rows=fields.get(event).rows,cutoff=rows.at(-1)?.bestTimes[event];if(rows.length!==50)errors.push(state.season+' count '+event);
        for(const a of state.world.filter(a=>a.category==='high'&&!a.retired))if(!validRaceTime(a.bestTimes[event])&&coherentCpuPB(a,event)<cutoff-.005)errors.push(state.season+' missing '+a.id+' '+event);
      }
      const first=JSON.stringify(state),seed=state.rngSeed;state=JSON.parse(first);migrateState();
      if(first!==JSON.stringify(state)||seed!==state.rngSeed)errors.push(state.season+' reload');
      years.push({season:state.season,measured:state.highSchoolPBMeasurementSeason});
    }
    return{errors,years};
  })()`);
  assert.deepEqual(r.errors,[]);assert.equal(r.years.length,4);for(const year of r.years)assert.equal(year.season,year.measured);
});
