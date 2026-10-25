const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),cp=require('node:child_process');
const {test}=require('node:test');
const repo=path.join(__dirname,'..'),current=fs.readFileSync(path.join(repo,'index.html'),'utf8');
function game(input=current,seed=5914){
 const source=input.match(/<script>([\s\S]*?)<\/script>/)[1];
 return vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+`
 function candidate(id,category,pbs,specialty='fr100'){
  return attachMedleyStats({id,name:id,category,grade:category==='adult'?null:3,age:category==='adult'?24:18,organization:'検証所属',retired:false,specialty,
   stats:Object.fromEntries(STATS.map(k=>[k,140])),imAptitude:{speed:0,stamina:0},bestTimes:{...pbs},accolades:[],raceHistory:[],condition:65,fatigue:0});
 }
 function specialtyErrors(){
  const all=activeAthletes(),errors=[],fields=new Map();
  for(const category of ['middle','high','university','adult']){
   const peers=all.filter(p=>!p.retired&&(state.players.includes(p)?category==='university':p.category===category));
   fields.set(category,new Map(SPECIALTY_EVENTS.map(e=>[e,peers.map(p=>p.bestTimes?.[e]).filter(validRaceTime).sort((a,b)=>a-b)])));
  }
  for(const a of state.world.filter(a=>!a.retired&&['middle','high','university','adult'].includes(a.category))){
   const ranks=SPECIALTY_EVENTS.filter(e=>validRaceTime(a.bestTimes?.[e])).map(e=>{
    const clocks=fields.get(a.category).get(e);let lo=0,hi=clocks.length;
    while(lo<hi){const mid=(lo+hi)>>1;if(clocks[mid]<a.bestTimes[e])lo=mid+1;else hi=mid}
    return{event:e,rank:lo+1};
   });
   const actual=ranks.find(r=>r.event===a.specialty),best=Math.min(...ranks.map(r=>r.rank));
   if(!actual||actual.rank!==best||a.cpuSpecialtySeason!==state.season)errors.push({id:a.id,category:a.category,specialty:a.specialty,actual,best});
  }
  return errors;
 }
 return code=>JSON.parse(JSON.stringify(eval(code)))`,['globalThis'])({crypto:{getRandomValues:a=>{a[0]=seed;return a}}});
}
function minimal(){const run=game();run(`state={season:2026,slot:1,rngSeed:5914,cpuCompetitionSeed:5914,playerUniversity:'自大学',players:[],world:[],recruits:[],recordRankings:{},recordBook:{},teamTop10:{},retiredArchive:[],facilities:{}};true`);return run;}

test('all four domestic CPU categories use their own complete PB ranking, including owned university students and alumni',()=>{
 const run=minimal(),r=run(`(()=>{
  for(const c of ['middle','high','university','adult']){
   state.world.push(candidate(c+'-target',c,{fr100:54,ba100:59,ba50:20}));
   state.world.push(candidate(c+'-peer',c,{fr100:53,ba100:60}));
  }
  const own=candidate('own','university',{fr100:52,ba100:58},'fr100');own.year=2;state.players=[own];
  const alumnus=candidate('alumnus','adult',{fr100:52,ba100:61});alumnus.alumni=true;alumnus.almaMater=state.playerUniversity;state.world.push(alumnus);
  const retired=candidate('retired','middle',{fr100:1,ba100:1});retired.retired=true;state.world.push(retired);
  const physical=JSON.stringify(activeAthletes().map(a=>[a.id,a.stats,a.imAptitude,a.bestTimes,a.raceHistory])),seed=state.rngSeed;
  const changed=updateCpuRankedSpecialties(),saved=JSON.stringify(state),again=updateCpuRankedSpecialties();
  return{changed,again,errors:specialtyErrors(),stable:saved===JSON.stringify(state),seed:seed===state.rngSeed,preserved:physical===JSON.stringify(activeAthletes().map(a=>[a.id,a.stats,a.imAptitude,a.bestTimes,a.raceHistory])),own:own.specialty,targets:state.world.filter(a=>a.id.endsWith('-target')).map(a=>[a.category,a.specialty]),retired:retired.specialty};
 })()`);
 assert.deepEqual(r.errors,[]);assert.equal(r.own,'fr100');assert.equal(r.retired,'fr100');assert.ok(r.changed>0&&r.again===0&&r.stable&&r.seed&&r.preserved);
 assert.ok(r.targets.every(([,e])=>e==='ba100'));
});

test('tied places keep the current specialty, use equal ranks for equal clocks and ignore unmeasured or excluded events',()=>{
 const run=minimal(),r=run(`(()=>{
  const a=candidate('a','adult',{fr100:50,ba100:55,br100:0,fly100:NaN,ba50:1,br50:1,fly50:1},'ba100');
  const b=candidate('b','adult',{fr100:50,ba100:55},'fr100');state.world=[a,b];updateCpuRankedSpecialties();
  const fields=categoryPersonalBestRankings('adult');return{specialties:[a.specialty,b.specialty],ranks:[fields.get('fr100').byId.get(a.id),fields.get('fr100').byId.get(b.id)],keys:Object.keys(a.bestTimes),errors:specialtyErrors()};
 })()`);
 assert.deepEqual(r.specialties,['ba100','fr100']);assert.deepEqual(r.ranks,[1,1]);assert.deepEqual(r.errors,[]);assert.ok(!r.keys.includes('im200'));
});

test('rank selection uses places below the visible top fifty and does not depend on roster order',()=>{
 const run=minimal(),r=run(`(()=>{
  state.world=Array.from({length:65},(_,i)=>candidate('a'+i,'adult',{fr100:50+i*.1,ba100:55+i*.1}));
  const a=state.world.at(-1);a.bestTimes.ba100=state.world[54].bestTimes.ba100+.01;
  const copy=deepClone(state);updateCpuRankedSpecialties();const one=Object.fromEntries(state.world.map(a=>[a.id,a.specialty]));
  state=copy;state.world.reverse();updateCpuRankedSpecialties();return{one,two:Object.fromEntries(state.world.map(a=>[a.id,a.specialty])),rank:categoryPersonalBestRankings('adult').get('ba100').byId.get(a.id),errors:specialtyErrors()};
 })()`);
 assert.equal(r.one.a64,'ba100');assert.equal(r.rank,56);assert.deepEqual(r.one,r.two);assert.deepEqual(r.errors,[]);
});

test('new PBs and scout views keep specialties during the year, and the next season updates all school grades together',()=>{
 const run=minimal(),r=run(`(()=>{
  const a=candidate('target','high',{fr100:54,ba100:59});a.grade=3;
  const b=candidate('peer','high',{fr100:53,ba100:60});b.grade=1;state.world=[a,b];updateCpuRankedSpecialties();
  const first=a.specialty;a.bestTimes.fr100=52;b.bestTimes.ba100=58;refreshScoutBoard();updateCpuRankedSpecialties();const during=a.specialty,read=scoutSpecialty(a,highSchoolScoutRankings());
  state.season++;updateCpuRankedSpecialties();return{first,during,read,next:a.specialty,errors:specialtyErrors(),seasons:state.world.map(a=>a.cpuSpecialtySeason)};
 })()`);
 assert.equal(r.first,'ba100');assert.equal(r.during,'ba100');assert.equal(r.read,'ba100');assert.equal(r.next,'fr100');assert.deepEqual(r.errors,[]);assert.deepEqual(r.seasons,[2027,2027]);
});

test('high-school pruning settles against the remaining PBs and retains every specialty even beyond fifty',()=>{
 const run=minimal(),r=run(`(()=>{
  state.world=Array.from({length:85},(_,i)=>candidate('a'+i,'high',{fr100:50+i*.1,ba100:55+(84-i)*.1}));
  state.world.forEach((a,i)=>{a.grade=1+i%3});updateCpuRankedSpecialties();refreshScoutBoard();
  const first=JSON.stringify(state);refreshScoutBoard();return{errors:specialtyErrors(),stable:first===JSON.stringify(state),missing:state.world.filter(a=>!validRaceTime(a.bestTimes[a.specialty])).length,unranked:EVENTS.some(e=>highSchoolScoutRankings().get(e).rows.slice(50).some(a=>a.specialty!==e))};
 })()`);
 assert.deepEqual(r.errors,[]);assert.ok(r.stable&&!r.unranked);assert.equal(r.missing,0);
});

test('v2.23 saves migrate specialties once, preserving balanced abilities, retained PBs, histories, own settings and RNG',()=>{
 const previous=game(cp.execFileSync('git',['show','34c1871:index.html'],{cwd:repo,encoding:'utf8',maxBuffer:2000000}));
 const legacy=previous('(state=createState(),migrateState(),deepClone(state))'),run=game();run('state='+JSON.stringify(legacy)+';migrateStartAbilities();trimGraduatingCohort();true');
 const before=run('deepClone(state)');run('migrateState();true');
 const result=run(`(()=>{const saved=JSON.stringify(state),seed=state.rngSeed;migrateState();return{state:deepClone(state),stable:saved===JSON.stringify(state)&&seed===state.rngSeed,errors:specialtyErrors()}})()`);
 assert.deepEqual(result.errors,[]);assert.ok(result.stable);assert.equal(result.state.version,'pwa-v2.57');
 for(const key of ['season','slot','rngSeed','points','facilities','players','trainingFocus','trainingPlans','teamTop10','recordRankings','pendingCollegeAdmissions','pendingSeasonRetirements'])assert.deepEqual(result.state[key],before[key],key);
 for(let i=0;i<before.world.length;i++){
  const a=result.state.world[i],b=before.world[i];assert.equal(a.id,b.id);
  for(const key of ['stats','imAptitude','raceHistory','accolades','organization','category','grade','age'])assert.deepEqual(a[key],b[key],a.id+' '+key);
  for(const [event,time]of Object.entries(a.bestTimes))assert.equal(time,b.bestTimes[event],a.id+' '+event+' PB');
  if(a.category!=='high')assert.deepEqual(a.bestTimes,b.bestTimes,a.id+' all PBs');
 }
});

test('fresh reset rosters and a real April rollover select their final category ranks without changing race calculations or earned abilities',()=>{
 const run=game(),result=run(`(()=>{
  state=createState();migrateState();const created=specialtyErrors();
  const physical=new Map(activeAthletes().map(a=>[a.id,JSON.stringify([a.stats,a.imAptitude||{},EVENTS.map(e=>expectedTime(a,e))])])),ownSpecialties=new Map(state.players.map(a=>[a.id,a.specialty]));
  newSeason();const errors=specialtyErrors(),changedAbilities=[];
  for(const a of activeAthletes())if(physical.has(a.id)&&physical.get(a.id)!==JSON.stringify([a.stats,a.imAptitude||{},EVENTS.map(e=>expectedTime(a,e))]))changedAbilities.push(a.id);
  const ownChanged=state.players.filter(a=>ownSpecialties.has(a.id)&&ownSpecialties.get(a.id)!==a.specialty).map(a=>a.id),first=JSON.stringify(state);migrateState();
  const stable=first===JSON.stringify(state),recruits=state.players.filter(a=>a.year===1).length,profiles=state.world.every(a=>a.cpuDevelopment.specialty===a.specialty);
  state=createState();migrateState();return{created,errors,reset:specialtyErrors(),changedAbilities,ownChanged,stable,recruits,profiles};
 })()`);
 assert.deepEqual(result.created,[]);assert.deepEqual(result.errors,[]);assert.deepEqual(result.reset,[]);assert.deepEqual(result.changedAbilities,[]);assert.deepEqual(result.ownChanged,[]);assert.ok(result.stable&&result.profiles);assert.equal(result.recruits,8);
});
