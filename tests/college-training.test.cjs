const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(){
 return vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+`
 state={season:2026,slot:1,rngSeed:5914,cpuCompetitionSeed:5914,players:[],world:[],universities:[],kansaiIds:[],interIds:[],playerUniversity:'自大学',facilities:{},trainingFocus:{},recruits:[],recordRankings:{},recordBook:{},teamTop10:{},retiredArchive:[],japanTeamHistory:[]};
 function swimmer(id,organization='検証大学',value=125){return attachMedleyStats({id,name:id,organization,category:'university',grade:1,age:19,retired:false,specialty:'fr400',stats:Object.fromEntries(STATS.map(k=>[k,value])),imAptitude:{speed:0,stamina:0},bestTimes:{},accolades:[],raceHistory:[],growthProfile:{1:1,2:1,3:1,4:1},cpuStatCeilings:Object.fromEntries(STATS.map(k=>[k,200]))})}
 function school(id,region='national'){const u={id,name:id,region,reputation:150};state.universities.push(u);state.interIds.push(id);if(region==='kansai')state.kansaiIds.push(id);return u}
 function rankFixture(){
  school('検証大学','kansai');const a=swimmer('target'),peers=[swimmer('peer1'),swimmer('peer2')],own=swimmer('own','自大学'),retired=swimmer('retired');own.year=1;delete own.category;retired.retired=true;
  for(const event of EVENTS){const base=expectedTime(a,event);a.bestTimes[event]=round2(base+(['ba100','ba200','fly200'].includes(event)?0:.3));peers.forEach((p,i)=>p.bestTimes[event]=round2(base+.1*(i+1)));own.bestTimes[event]=round2(base+(event==='fr100'?.05:.4));retired.bestTimes[event]=round2(base-.1)}
  state.players=[own];state.world=[a,...peers,retired];return a;
 }
 return code=>JSON.parse(JSON.stringify(eval(code)))`,[])();
}

test('college practice keeps the specialty and best three student ranks, including own-team competition and tied places, without changing records or RNG',()=>{
 const r=game()(`(()=>{
  const a=rankFixture(),before=JSON.stringify(state),plan=cpuCollegeTrainingPlan(),rank=categoryPersonalBestRankings('university').get('fr100').byId.get(a.id);
  const result={events:[...plan.get(a.id)],rank,pure:before===JSON.stringify(state),ids:[...plan.keys()]};
  a.bestTimes={ba100:a.bestTimes.ba100};result.sparse=[...cpuCollegeTrainingPlan().get(a.id)];return result;
 })()`);
 assert.deepEqual(r.events,['fr400','ba100','ba200','fly200']);assert.equal(r.rank,4);
 assert.ok(r.pure);assert.deepEqual(r.ids,['target','peer1','peer2']);assert.deepEqual(r.sparse,['fr400','ba100']);
});

test('relay practice covers each actual final role and planned preliminary reserve with unique medley swimmers and no duplicated event',()=>{
 const r=game()(`(()=>{
  for(let u=0;u<10;u++){
   const org=school('U'+u,u<2?'kansai':'national').name;
   for(let i=0;i<8;i++){
    const a=swimmer(org+'-'+i,org,u===0?145-i*.2:100-i*.2);a.specialty='br200';
    for(const e of EVENTS)a.bestTimes[e]=coherentCpuPB(a,e);state.world.push(a);
   }
  }
  const before=JSON.stringify(state),plan=cpuCollegeTrainingPlan(),pure=before===JSON.stringify(state),rosters=new Map(state.universities.map(u=>[u.name,state.world.filter(a=>a.organization===u.name)]));
  let reserves=0,roles=0,additional=0;const errors=[];
  for(const meet of ['kansai_college','intercollege'])for(const kind of RELAYS){
   const entries=meetUniversities(meet).map(organization=>({organization,members:bestRelayMembers(rosters.get(organization)||[],kind)})).filter(t=>t.members.length===4);
   for(const team of cpuRelayPreliminaryEntries(entries,kind,rosters)){
    reserves+=team.reservedIds.length;
    for(const members of [team.members,team.finalMembers]){
     if(new Set(members.map(a=>a.id)).size!==4)errors.push('duplicate swimmer');
     members.forEach((a,i)=>{const e=relayLegEvent(kind,i);roles++;if(!plan.get(a.id)?.has(e))errors.push(a.id+':'+e);if(e!==a.specialty)additional++});
    }
   }
  }
  return{pure,reserves,roles,additional,errors};
 })()`);
 assert.ok(r.pure&&r.reserves>0&&r.roles>0&&r.additional>0);assert.deepEqual(r.errors,[]);
});

test('multiple events redistribute the same physical-practice budget instead of stacking gains, while earned PBs, mental and start remain intact',()=>{
 const rows=game()(`(()=>{
  school('検証大学');return [['ba100'],['ba100','fly200'],['ba100','fly200','im200','im400','fr100']].map(events=>{
   const a=swimmer('allocation');a.specialty='fr100';for(const k of ['speed','stamina','turn'])a.stats['fr_'+k]=145;
   ensureCpuDevelopment(a);a.cpuDevelopment.floors=EVENTS.map(()=>1);a.bestTimes.fr100=coherentCpuPB(a,'fr100');
   const pb=JSON.stringify(a.bestTimes),errors=[];let promoted=false;
   const physical=STATS.filter(k=>MEDLEY_STROKES.includes(k.split('_')[0]));
   const total=p=>physical.reduce((sum,k)=>sum+p.stats[k]+p.cpuDevelopment.carry[STATS.indexOf(k)],0);
   for(let turn=0;turn<96;turn++){
    const reference=attachMedleyStats(deepClone(a)),before=total(a),seed=5914+turn;state.rngSeed=seed;applyCpuTraining(reference);const nextSeed=state.rngSeed;
    state.rngSeed=seed;applyCpuTraining(a,new Set(events));
    if(total(a)-before>total(reference)-before+.00002)errors.push('extra training budget '+turn);
    if(a.stats.mental!==reference.stats.mental||a.stats.start!==reference.stats.start||state.rngSeed!==nextSeed)errors.push('unrelated change '+turn);
    if(a.stats.ba_speed>reference.stats.ba_speed)promoted=true;
    if(STATS.some((k,i)=>a.stats[k]>a.cpuDevelopment.goals[i]+.005))errors.push('goal exceeded '+turn);
   }
   return{events,promoted,errors,pb:pb===JSON.stringify(a.bestTimes)};
  });
 })()`);
 for(const r of rows){assert.ok(r.promoted&&r.pb,JSON.stringify(r));assert.deepEqual(r.errors,[],r.events.join(','))}
});

test('real training commands build one fresh shared plan per turn and react to changed PB ranks without retargeting growth ceilings',()=>{
 const r=game()(`(()=>{
  const a=rankFixture(),pb=JSON.stringify(a.bestTimes);state.players=[];state.world=state.world.filter(a=>!a.retired);
  const initialPlan=cpuCollegeTrainingPlan();state.world.forEach(ensureCpuDevelopment);
  const goals=JSON.stringify(state.world.map(a=>[a.id,a.cpuDevelopment.goals,a.cpuDevelopment.floors])),originalPlan=cpuCollegeTrainingPlan,originalTrain=applyCpuTraining;
  let builds=0,plans=[];cpuCollegeTrainingPlan=()=>{builds++;return originalPlan()};
  applyCpuTraining=(p,events)=>{if(p===a)plans.push([...events]);originalTrain(p,events)};
  trainCommand();const unchangedPB=pb===JSON.stringify(a.bestTimes);
  for(const e of ['ba100','ba200','fly200'])a.bestTimes[e]=round2(expectedTime(a,e)+1);
  for(const e of ['br100','br200','im200'])a.bestTimes[e]=round2(expectedTime(a,e)-.1);
  state.slot=2;trainCommand();cpuCollegeTrainingPlan=originalPlan;applyCpuTraining=originalTrain;
  return{builds,plans,unchangedPB,goals:goals===JSON.stringify(state.world.map(a=>[a.id,a.cpuDevelopment.goals,a.cpuDevelopment.floors]))};
 })()`);
 assert.equal(r.builds,2);assert.ok(r.unchangedPB&&r.goals);assert.deepEqual(r.plans[0],['fr400','ba100','ba200','fly200']);assert.deepEqual(r.plans[1],['fr400','br100','br200','im200']);
});

test('a season of actual college training respects saved ability and measured-record ceilings and survives save restoration without a jump',()=>{
 const r=game()(`(()=>{
  state=createState();migrateState();const orgs=new Set(state.universities.filter(u=>u.region==='kansai').slice(0,1).concat(state.universities.filter(u=>u.region!=='kansai').slice(0,1)).map(u=>u.name));
  state.world=state.world.filter(a=>a.category==='university'&&orgs.has(a.organization));state.players=[];
  const before=new Map(state.world.map(a=>[a.id,{stats:deepClone(a.stats),goals:deepClone(a.cpuDevelopment.goals),floors:deepClone(a.cpuDevelopment.floors)}])),errors=[];
  for(let turn=0;turn<96;turn++){state.slot=turn+1;trainCommand()}
  for(const a of state.world){const b=before.get(a.id);
   STATS.forEach((k,i)=>{if(a.stats[k]<b.stats[k]||a.stats[k]>Math.max(b.stats[k],b.goals[i])+.005)errors.push(a.id+':'+k)});
   EVENTS.forEach((e,i)=>{if(expectedTime(a,e)<b.floors[i]-.006)errors.push(a.id+':'+e)});
  }
  const saved=JSON.stringify(state.world.map(a=>[a.id,a.stats,a.bestTimes,a.cpuDevelopment])),seed=state.rngSeed;
  state=JSON.parse(JSON.stringify(state));migrateState();
  return{count:before.size,errors,stable:saved===JSON.stringify(state.world.filter(a=>before.has(a.id)).map(a=>[a.id,a.stats,a.bestTimes,a.cpuDevelopment]))&&seed===state.rngSeed};
 })()`);
 assert.equal(r.count,64);assert.deepEqual(r.errors,[]);assert.ok(r.stable);
});
