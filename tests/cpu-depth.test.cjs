const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(seed=5914){
  const run=vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+'\nreturn code=>JSON.parse(JSON.stringify(eval(code)))',['globalThis'])({crypto:{getRandomValues:a=>{a[0]=seed;return a}}});
  run('(state=createState(),true)');return run;
}
test('CPU calibration uses the current race weights at all four distances',()=>{
  const run=game(),rows=run(`EVENTS.filter(e=>strokeForEvent(e)!=='im').map(event=>{
    const a=attachMedleyStats({id:'weights',stats:Object.fromEntries(STATS.map(k=>[k,120]))}),s=strokeForEvent(event);
    a.stats[s+'_speed']=180;a.stats[s+'_stamina']=65;a.stats[s+'_turn']=135;a.stats.start=88;
    const w=strokeAbilityWeights(distanceOf(event));return{event,actual:abilityValue(a,event)*200,fitted:w.speed*180+w.stamina*65+w.turn*135+w.start*88};
  })`);
  rows.forEach(row=>assert.ok(Math.abs(row.actual-row.fitted)<1e-9,JSON.stringify(row)));
});
test('college relay depth matches real finals through swimmer abilities and preserves identical CPU and player clocks',()=>{
  const run=game(),r=run(`(()=>{
    const rows=[];
    for(const [meet,region]of [['kansai_college','kansai'],['intercollege','national']])for(const kind of RELAYS){
      const teams=meetUniversities(meet).filter(n=>n!==state.playerUniversity).map(n=>{
        const members=bestRelayMembers(state.world.filter(a=>a.category==='university'&&a.organization===n),kind);
        return{members,time:expectedRelayTime(members,kind)};
      }).sort((a,b)=>a.time-b.time);
      const reference=CPU_COLLEGE_RELAY_REFERENCE[region][kind];
      rows.push({meet,kind,first:teams[0].time,eighth:teams[7].time,referenceFirst:reference[0],referenceEighth:reference[7]});
    }
    const p=state.world.find(a=>a.category==='university'),copy=attachMedleyStats(deepClone(p));
    state.rngSeed=5914;const cpu=raceTarget(p,'br100');state.rngSeed=5914;const own=raceTarget(copy,'br100');
    return{rows,same:cpu===own,count:state.universities.length,rosters:state.universities.map(u=>state.world.filter(a=>a.category==='university'&&a.organization===u.name).length)};
  })()`);
  assert.ok(r.same);assert.equal(r.count,39);assert.ok(r.rosters.every(n=>n===32));
  for(const row of r.rows){
    assert.ok(Math.abs(row.first/row.referenceFirst-1)<.025,JSON.stringify(row));
    assert.ok(Math.abs(row.eighth/row.referenceEighth-1)<.04,JSON.stringify(row));
  }
});
test('legacy NPC PB corrections also correct record sources once, while preserving own swimmers and signed recruits',()=>{
  const run=game(),r=run(`(()=>{
    const npc=state.world.find(a=>a.category==='university'),signed=state.world.find(a=>a.category==='high'&&a.grade===3);
    signed.scouted=true;state.recruits=[signed.id];
    const own=JSON.stringify(state.players),signedBefore=JSON.stringify(signed),ids=state.world.map(a=>a.id);
    npc.bestTimes.ba100=45;recordIndividualResult(npc,'ba100',45,'japan_championship','決勝');
    npc.bestTimes.fr400=600;
    for(const book of Object.values(state.recordRankings))book.fr400=(book.fr400||[]).filter(r=>r.athleteId!==npc.id);
    if(state.recordBook.fr400?.athleteId===npc.id)delete state.recordBook.fr400;
    delete npc.recordedPBs?.fr400;
    delete state.cpuDepthModelVersion;migrateState();
    const result={own:own===JSON.stringify(state.players),signed:signedBefore===JSON.stringify(signed),ids:ids.every(id=>state.world.some(a=>a.id===id)),
      pb:npc.bestTimes.ba100,base:expectedTime(npc,'ba100'),frPB:npc.bestTimes.fr400,frBase:expectedTime(npc,'fr400'),
      record:state.recordRankings.japan.ba100.filter(row=>row.athleteId===npc.id).every(row=>row.time>=npc.bestTimes.ba100-.005)};
    const first=JSON.stringify(state.world),maps=JSON.stringify(state.cpuUniversityDepthMaps),seed=state.rngSeed;
    state=JSON.parse(JSON.stringify(state));migrateState();
    return{...result,once:first===JSON.stringify(state.world),maps:maps===JSON.stringify(state.cpuUniversityDepthMaps),rng:seed===state.rngSeed};
  })()`);
  for(const key of ['own','signed','ids','record','once','maps','rng'])assert.equal(r[key],true,key);
  assert.ok(r.pb>53);assert.ok(Math.abs(r.pb-r.base)<1.5);assert.ok(Math.abs(r.frPB-r.frBase)<6);
});
test('every corrected NPC event has a reachable PB, independent stroke variation and bounded derived IM aptitude',()=>{
  const run=game(),r=run(`(()=>{
    const bad=[],bias=[],schools={};let badCount=0;
    const fail=row=>{badCount++;if(bad.length<20)bad.push(row)};
    for(const a of state.world.filter(adjustableCpu))for(const e of EVENTS){
      const d=distanceOf(e),base=expectedTime(a,e),pb=a.bestTimes[e],ranges=MEET_FORM_TIME_RANGES[d],radius=RACE_EXECUTION_RANGE[d];
      const low=base+Math.min(...ranges.map(r=>r[0]))-radius,high=base+Math.max(...ranges.map(r=>r[1]))+radius+PRELIMINARY_TIME_DELAY[d][1];
      // Current school rosters deliberately have no PB for unranked/non-main events.
      if(pb==null&&e!==a.specialty)continue;
      if(!validRaceTime(pb)||pb<low-.025||pb>high+.025)fail({id:a.id,e,pb,base});
    }
    for(const a of state.world){
      for(const c of ['speed','stamina']){const mean=MEDLEY_STROKES.reduce((sum,s)=>sum+a.stats[s+'_'+c],0)/4;bias.push(Math.abs(medleyStatValue(a,c)-mean))}
      if(['middle','high','adult'].includes(a.category))schools[a.category]=(schools[a.category]||0)+1;
    }
    return{bad,badCount,maxBias:Math.max(...bias),schools};
  })()`);
  assert.equal(r.badCount,0,JSON.stringify(r.bad));assert.ok(r.maxBias<=20.006);
  assert.deepEqual(r.schools,{middle:960,high:960,adult:288});
});
test('an incoming class cannot accumulate an unrealistically fast relay and never weakens returning or owned swimmers',()=>{
  const run=game(),r=run(`(()=>{
    const u=state.universities.find(u=>u.region!=='kansai'),old=state.world.map(a=>[a.id,JSON.stringify(a.stats)]),own=JSON.stringify(state.players),parents=new Map();
    for(let i=0;i<4;i++){
      const a=attachMedleyStats({id:'ADMISSION-'+i,name:'進学検証 '+i,category:'university',organization:u.name,grade:1,age:19,specialty:'fr200',stats:Object.fromEntries(STATS.map(k=>[k,40])),bestTimes:{},accolades:[]});
      for(const key of ['fr_speed','fr_stamina','fr_turn'])a.stats[key]=200;a.stats.start=110;a.stats.mental=110;
      for(const e of EVENTS)a.bestTimes[e]=coherentCpuPB(a,e);
      parents.set(a.id,Object.fromEntries(EVENTS.map(e=>[e,coherentCpuPB(a,e)])));parents.get(a.id).fr100=51;parents.get(a.id).fr200=114;
      state.world.push(a);
    }
    const roster=()=>state.world.filter(a=>a.category==='university'&&a.organization===u.name),before=expectedRelayTime(bestRelayMembers(roster(),'4x200fr'),'4x200fr'),seed=state.rngSeed;
    rebalanceCpuCollegeAdmissions(parents);
    return{before,after:expectedRelayTime(bestRelayMembers(roster(),'4x200fr'),'4x200fr'),own:own===JSON.stringify(state.players),
      returning:old.every(([id,stats])=>JSON.stringify(state.world.find(a=>a.id===id).stats)===stats),rng:seed===state.rngSeed};
  })()`);
  assert.ok(r.before<425);assert.ok(r.after>=428.9,JSON.stringify(r));assert.equal(r.own,true);assert.equal(r.returning,true);assert.equal(r.rng,true);
});
