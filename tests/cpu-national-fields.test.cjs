const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const load=vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+
  '\nreturn code=>JSON.parse(JSON.stringify(eval(code)))',['globalThis']);
function game(seed=5914){const run=load({crypto:{getRandomValues:a=>{a[0]=seed;return a}}});run('(state=createState(),migrateState(),true)');return run}

test('national references use actual Zen-chu races and domestic Japan Open / Japanese Championship results',()=>{
  const run=game(),r=run(`({middle:cpuNonCollegeReference('middle','fr100')[0],high:cpuNonCollegeReference('high','fr100')[0],adult:cpuNonCollegeReference('adult','fr50')[0],events:Object.keys(CPU_NON_COLLEGE_REFERENCE.middle).length})`);
  assert.deepEqual(r,{middle:52.27,high:49.47,adult:22.12,events:12});
});
test('fresh school and national fields have realistic leading distributions and a bounded slower tail in every event',()=>{
  for(const seed of [5914,54321,12345]){
    const run=game(seed),rows=run(`['middle','high','adult'].flatMap(category=>EVENTS.map(event=>{
      const roster=state.world.filter(a=>a.category===category&&!a.alumni),times=roster.map(a=>expectedTime(a,event)).sort((a,b)=>a-b),reference=cpuNonCollegeReference(category,event),d=distanceOf(event),bins={},width={50:.25,100:.5,200:1,400:2}[d];
      for(const t of times.slice(0,50))bins[Math.floor(t/width)]=(bins[Math.floor(t/width)]||0)+1;
      return{category,event,d,first:times[0],last:times.at(-1),top50:times[49],referenceFirst:reference[0],referenceLast:reference.at(-1),density:Math.max(...Object.values(bins))};
    }))`);
    for(const row of rows){
      assert.ok(row.first>=row.referenceFirst*.988&&row.first<=row.referenceFirst*1.035,JSON.stringify({seed,...row}));
      assert.ok(row.last<=row.referenceLast*1.15,JSON.stringify({seed,...row}));
      assert.ok(row.top50-row.first>=({50:.65,100:1.5,200:3.5,400:8}[row.d]),JSON.stringify({seed,...row}));
      if(row.d===200)assert.ok(row.density<=20,JSON.stringify({seed,...row}));
    }
  }
});
test('legacy non-college repairs change swimmer abilities and PBs together, update top tens, and preserve owned / signed athletes and progress',()=>{
  const run=game(),r=run(`(()=>{
    const signed=state.world.find(a=>a.category==='high'&&a.grade===3);signed.scouted=true;state.recruits=[signed.id];
    const protectedData=JSON.stringify([state.players,signed,state.teamTop10]),ids=state.world.map(a=>a.id),universities=JSON.stringify(state.world.filter(a=>a.category==='university'));
    const before=new Map(state.world.map(a=>[a.id,JSON.stringify(a.stats)])),mental=new Map(state.world.map(a=>[a.id,a.stats.mental]));
    state.season=2028;state.slot=77;state.points=99;state.reputation=150;
    delete state.cpuNonCollegeModelVersion;delete state.cpuNonCollegeDistributions;migrateCpuNonCollegeDistributions();
    const bad=[];for(const a of state.world.filter(adjustableCpu))for(const e of EVENTS){
      const d=distanceOf(e),ranges=MEET_FORM_TIME_RANGES[d],radius=RACE_EXECUTION_RANGE[d],base=expectedTime(a,e),pb=a.bestTimes[e];
      if(pb<base+Math.min(...ranges.map(r=>r[0]))-radius-.025||pb>base+Math.max(...ranges.map(r=>r[1]))+radius+PRELIMINARY_TIME_DELAY[d][1]+.025)bad.push({id:a.id,e,pb,base});
    }
    const byId=new Map([...state.world,...state.players].map(a=>[a.id,a])),records=[];
    for(const book of Object.values(state.recordRankings))for(const [event,rows]of Object.entries(book))for(const row of rows){
      const a=byId.get(row.athleteId);if(a&&EVENTS.includes(event)&&row.time<a.bestTimes[event]-.005)records.push({id:a.id,event,record:row.time,pb:a.bestTimes[event]});
    }
    const snapshot=JSON.stringify(state),seed=state.rngSeed;migrateCpuNonCollegeDistributions();
    return{protected:protectedData===JSON.stringify([state.players,signed,state.teamTop10]),universities:universities===JSON.stringify(state.world.filter(a=>a.category==='university')),
      ids:ids.every(id=>byId.has(id)),mental:state.world.every(a=>a.stats.mental===mental.get(a.id)),changed:state.world.filter(a=>JSON.stringify(a.stats)!==before.get(a.id)).length,
      once:snapshot===JSON.stringify(state)&&seed===state.rngSeed,progress:[state.season,state.slot,state.points,state.reputation],bad,records};
  })()`);
  assert.ok(r.protected&&r.universities&&r.ids&&r.mental&&r.once);assert.ok(r.changed>2000);
  assert.deepEqual(r.progress,[2028,77,99,150]);assert.deepEqual(r.bad,[]);assert.deepEqual(r.records,[]);
});
test('recruit admission retains fixed IM aptitude, all PB pace and specialty with the same actual player and CPU clock',()=>{
  const run=game(),r=run(`(()=>{
    const a=state.world.find(a=>a.category==='high'&&strokeForEvent(a.specialty)==='im'),p=worldToPlayer(a);
    const rows=EVENTS.map(event=>{state.rngSeed=5914;const cpu=raceTarget(a,event);state.rngSeed=5914;const own=raceTarget(p,event);return{event,cpu,own,pb:p.bestTimes[event],source:a.bestTimes[event]}});
    return{aptitude:JSON.stringify(a.imAptitude)===JSON.stringify(p.imAptitude),specialty:a.specialty===p.specialty,rows};
  })()`);
  assert.ok(r.aptitude&&r.specialty);for(const row of r.rows){assert.equal(row.cpu,row.own,JSON.stringify(row));assert.equal(row.pb,row.source)}
});
test('partial CPU relay corrections update known laps and totals while protecting player and unavailable lineups',()=>{
  const run=game(),r=run(`(()=>{
    const roster=state.world.filter(a=>a.category==='university').slice(0,4),own=state.players[0];
    const record=members=>({kind:'relay',event:'4x100medley',organization:'検証大学',time:220,legs:[60,65,50,45],members:members.map(a=>({id:a.id,name:a.name}))});
    state.recordRankings.japan['4x100medley']=[record(roster),record([own,...roster.slice(1)]),record([{id:'unavailable'},...roster.slice(1)])];
    const protectedRows=JSON.stringify(state.recordRankings.japan['4x100medley'].slice(1));
    correctCpuRecordReferences(new Map([[roster[0].id,{deltas:{ba100:1.25}}]]));
    return{row:state.recordRankings.japan['4x100medley'][0],protected:protectedRows===JSON.stringify(state.recordRankings.japan['4x100medley'].slice(1))};
  })()`);
  assert.ok(r.protected);assert.equal(r.row.time,221.25);assert.deepEqual(r.row.legs,[61.25,65,50,45]);
});
test('eight seasons of daily practice keep PBs reachable across school and adult transitions without repeat calibration',()=>{
  const run=game(),rows=run(`(()=>{
    const rows=[];for(let year=0;year<=8;year++){
      const bad=[];for(const a of [...state.players,...state.world].filter(a=>!a.retired))for(const event of EVENTS){
        const pb=a.bestTimes[event];if(!validRaceTime(pb))continue;
        const d=distanceOf(event),base=expectedTime(a,event),ranges=MEET_FORM_TIME_RANGES[d],r=RACE_EXECUTION_RANGE[d];
        if(pb<base+Math.min(...ranges.map(r=>r[0]))-r-.025)bad.push({id:a.id,category:a.category,event,pb,base});
      }
      const profiles=JSON.stringify([state.players,state.world]),seed=state.rngSeed;maintainWorldPopulation();
      const relays=['kansai_college','intercollege'].flatMap(meet=>RELAYS.map(kind=>{
        const times=meetUniversities(meet).filter(n=>n!==state.playerUniversity).map(n=>expectedRelayTime(bestRelayMembers(state.world.filter(a=>a.category==='university'&&a.organization===n&&!a.retired),kind),kind));
        return{meet,kind,first:Math.min(...times),reference:CPU_COLLEGE_RELAY_REFERENCE[meet==='kansai_college'?'kansai':'national'][kind][0]};
      }));
      rows.push({season:state.season,bad,stable:profiles===JSON.stringify([state.players,state.world])&&seed===state.rngSeed,
        relays,universityCount:state.world.filter(a=>a.category==='university').length,schoolS:state.world.filter(a=>['middle','high'].includes(a.category)&&STATS.some(k=>k!=='mental'&&a.stats[k]>=188)).length});
      if(year<8){for(let slot=1;slot<=96;slot++){state.slot=slot;trainCommand()}newSeason()}
    }return rows;
  })()`);
  for(const row of rows){
    assert.deepEqual(row.bad,[],JSON.stringify(row));assert.ok(row.stable,JSON.stringify(row));assert.equal(row.schoolS,0);assert.ok(row.universityCount>=1240&&row.universityCount<=1400);
    for(const relay of row.relays)assert.ok(relay.first>=relay.reference*.985&&relay.first<=relay.reference*1.035,JSON.stringify({season:row.season,...relay}));
  }
});
