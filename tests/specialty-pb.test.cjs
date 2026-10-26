const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),cp=require('node:child_process');
const {test}=require('node:test');
const repo=path.join(__dirname,'..'),current=fs.readFileSync(path.join(repo,'index.html'),'utf8');
function game(input=current,seed=5914){
  const source=input.match(/<script>([\s\S]*?)<\/script>/)[1];
  return vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+`
    function athlete(id,category='high',grade=3){return attachMedleyStats({id,name:id,category,grade,age:18,organization:'検証所属',retired:false,specialty:'fr100',stats:Object.fromEntries(STATS.map(k=>[k,140])),imAptitude:{speed:0,stamina:0},bestTimes:{},accolades:[],raceHistory:[],scoutPreferences:{version:3,worldAmbition:false,preferredRegion:null,earlyCompetition:false,prestigeSchool:false}})}
    return code=>JSON.parse(JSON.stringify(eval(code)))`,['globalThis'])({crypto:{getRandomValues:a=>{a[0]=seed;return a}}});
}
function minimal(){const run=game();run(`state={season:2026,slot:43,rngSeed:5914,playerUniversity:'自大学',players:[],world:[],recruits:[],recordRankings:{},recordBook:{},teamTop10:{},retiredArchive:[],facilities:{}};true`);return run}
test('all active categories, alumni and Japanese snapshots acquire only missing specialty PBs with no stat or RNG changes',()=>{
  const run=minimal(),r=run(`(()=>{
    const own=athlete('own','university',2);delete own.category;own.year=2;own.organization=state.playerUniversity;state.players=[own];
    state.world=['middle','high','university','adult'].map(c=>athlete(c,c));state.world.push({...athlete('alumni','adult'),alumni:true,almaMater:state.playerUniversity});
    const foreign=athlete('INT1','international'),snapshot=athlete('snapshot','university');state.internationalWorld={athletes:[foreign]};state.japanTeam={selectedSeason:2026,athletes:[{id:snapshot.id,snapshot}]};
    const all=[own,...state.world,foreign,snapshot];all.forEach((a,i)=>{a.specialty=['fr50','fr100','fr200','fr400','ba100','br100','fly100','im200'][i];a.bestTimes.ba50=coherentCpuPB(a,'ba50')});
    const existing=state.world[2];existing.bestTimes[existing.specialty]=coherentCpuPB(existing,existing.specialty)-.1;
    const before=JSON.stringify(all.map(a=>[a.stats,a.imAptitude,a.bestTimes.ba50,a.bestTimes[a.specialty]??null])),seed=state.rngSeed;
    const count=ensureSpecialtyPBs(),first=JSON.stringify(state),again=ensureSpecialtyPBs();
    return{count,again,all:all.map(a=>({id:a.id,keys:Object.keys(a.bestTimes),pb:a.bestTimes[a.specialty],expected:coherentCpuPB(a,a.specialty)})),original:JSON.parse(before),current:all.map(a=>[a.stats,a.imAptitude,a.bestTimes.ba50]),unchanged:first===JSON.stringify(state),rng:seed===state.rngSeed,ownRecord:state.teamTop10[own.specialty][0].time,ownPB:own.bestTimes[own.specialty],medals:playerMainResults(own)};
  })()`);
  assert.equal(r.count,7);assert.equal(r.again,0);assert.ok(r.unchanged&&r.rng);assert.equal(r.ownRecord,r.ownPB);assert.deepEqual(r.medals,[]);
  for(let i=0;i<r.all.length;i++){assert.equal(r.all[i].keys.length,2);assert.deepEqual(r.current[i],r.original[i].slice(0,3));assert.equal(r.all[i].pb,r.original[i][3]??r.all[i].expected)}
});
test('unranked specialty clocks survive annual school pruning while other unranked clocks are removed',()=>{
  const run=minimal(),r=run(`(()=>{
    state.world=Array.from({length:80},(_,i)=>athlete('candidate-'+i));
    const slow=state.world.at(-1);for(const k of STATS)slow.stats[k]=80;
    for(const a of state.world)for(const e of EVENTS)a.bestTimes[e]=coherentCpuPB(a,e);
    const last=state.world.at(-1),pb=last.bestTimes.fr100;last.scouted=true;state.recruits=[last.id];
    refreshScoutBoard();measureUnrankedHighSchoolPBs();refreshScoutBoard();
    const fields=highSchoolScoutRankings(),first=JSON.stringify(state),seed=state.rngSeed;refreshScoutBoard();
    return{pb,last:deepClone(last),fields:EVENTS.map(e=>({event:e,total:fields.get(e).rows.length,visible:ranking(e,'high',50).length,extraSpecialties:fields.get(e).rows.slice(50).every(a=>a.specialty===e)})),signed:state.scoutBoard.includes(last.id),stable:first===JSON.stringify(state)&&seed===state.rngSeed};
  })()`);
  assert.equal(r.last.bestTimes.fr100,r.pb);assert.ok(r.last.bestTimes.fr100>0&&r.signed&&r.stable);for(const field of r.fields){assert.equal(field.visible,50);assert.ok(field.extraSpecialties)}
});
test('an annual ranking update chooses an improved school event before pruning and keeps its actual PB even outside fifty',()=>{
  const run=minimal(),r=run(`(()=>{
    state.world=Array.from({length:70},(_,i)=>athlete('candidate-'+i));
    for(const [i,a]of state.world.entries()){a.bestTimes.fr100=50+i*.1;a.bestTimes.ba100=55+i*.1}
    const a=state.world[69];a.bestTimes.ba100=state.world[54].bestTimes.ba100+.01;
    const pb=a.bestTimes.ba100;updateCpuRankedSpecialties();refreshScoutBoard();const first=JSON.stringify(state);refreshScoutBoard();
    return{specialty:a.specialty,pb:a.bestTimes.ba100,previous:a.bestTimes.fr100??null,expected:pb,rank:scoutHighSchoolRank(a,a.specialty),stable:first===JSON.stringify(state)};
  })()`);
  assert.equal(r.specialty,'ba100');assert.equal(r.pb,r.expected);assert.equal(r.previous,null);assert.equal(r.rank,51);assert.ok(r.stable);
});
test('specialty changes add a reachable PB to own-team rankings and preserve an already recorded specialty',()=>{
  const run=minimal(),r=run(`(()=>{
    const p=athlete('own','university',2);p.year=2;p.organization=state.playerUniversity;state.players=[p];ensureSpecialtyPBs([p]);const first=p.bestTimes.fr100;
    p.specialty='im400';const seed=state.rngSeed,stats=JSON.stringify(p.stats);ensureSpecialtyPBs([p]);const im=p.bestTimes.im400;
    p.specialty='fr100';ensureSpecialtyPBs([p]);return{first,fr:p.bestTimes.fr100,im,expected:coherentCpuPB(p,'im400'),team:state.teamTop10.im400[0].time,student:state.recordRankings.university.im400[0].time,ranked:ranking('im400','player',50)[0].bestTimes.im400,protected:seed===state.rngSeed&&stats===JSON.stringify(p.stats)};
  })()`);
  assert.equal(r.fr,r.first);for(const key of ['im','team','student','ranked'])assert.equal(r[key],r.expected);assert.ok(r.protected);
});
test('v2.02 data automatically fills specialties, preserving measured clocks, balanced abilities, progress and random sequence on reload',()=>{
  const oldHtml=cp.execFileSync('git',['show','244c8aaf:index.html'],{cwd:repo,encoding:'utf8',maxBuffer:2000000}),old=game(oldHtml);
  const legacy=old(`(state=createState(),migrateState(),deepClone(state))`),run=game();run(`state=${JSON.stringify(legacy)};migrateStartAbilities();trimGraduatingCohort();true`);
  const before=run('deepClone(state)');run('migrateState();true');
  const r=run(`(()=>{
    const first=JSON.stringify(state),seed=state.rngSeed,all=[...state.players,...state.world.filter(a=>!a.retired)],fields=highSchoolScoutRankings();migrateState();
    return{state:deepClone(state),stable:first===JSON.stringify(state)&&seed===state.rngSeed,missing:all.filter(a=>!validRaceTime(a.bestTimes[a.specialty])).map(a=>a.id),extra:EVENTS.some(e=>fields.get(e).rows.slice(50).some(a=>a.specialty!==e))};
  })()`);
  assert.equal(before.version,'pwa-v2.02');assert.equal(r.state.version,'pwa-v2.79');assert.deepEqual(r.missing,[]);assert.ok(r.stable&&!r.extra);
  for(const k of ['rngSeed','season','slot','points','reputation','playerUniversity','facilities','trainingFocus','recruits'])assert.deepEqual(r.state[k],before[k]);
  for(const group of ['players','world'])for(let i=0;i<before[group].length;i++){
    const a=r.state[group][i],b=before[group][i];assert.equal(a.id,b.id);for(const k of ['stats','imAptitude','accolades','raceHistory','potentialType'])assert.deepEqual(a[k],b[k],a.id+' '+k);
    for(const [e,t]of Object.entries(b.bestTimes))if(e===b.specialty||a.category!=='high')assert.equal(a.bestTimes[e],t,a.id+' '+e);
    for(const [e,t]of Object.entries(a.bestTimes))if(!Object.hasOwn(b.bestTimes,e)){assert.equal(e,b.specialty);assert.ok(Number.isFinite(t)&&t>0)}
  }
});
test('fresh generation, reset and international generation keep specialty PBs reachable and visible without inventing other own-team PBs',()=>{
  const run=game(),r=run(`(()=>{
    state=createState();migrateState();const ownCounts=state.players.map(p=>Object.keys(p.bestTimes).length),foreign=ensureInternationalWorld(2027).athletes;
    const all=[...state.players,...state.world,...foreign],missing=all.filter(a=>!validRaceTime(a.bestTimes[a.specialty])).map(a=>a.id),invalid=[];
    for(const a of all){const e=a.specialty,d=distanceOf(e),pb=a.bestTimes[e],base=expectedTime(a,e),normal=MEET_FORM_TIME_RANGES[d][2],r=RACE_EXECUTION_RANGE[d];if(pb<base+normal[0]-r-.025||pb>base+normal[1]+r+.025)invalid.push(a.id)}
    const f=foreign[0],seed=state.rngSeed,expected=coherentCpuPB(f,f.specialty);delete f.bestTimes[f.specialty];ensureInternationalWorld(2027);const foreignRng=state.rngSeed===seed;
    state=createState();migrateState();return{ownCounts,missing,invalid,foreign:foreign.length,restored:f.bestTimes[f.specialty],expected,foreignRng,reset:state.players.every(p=>Object.keys(p.bestTimes).length===1&&validRaceTime(p.bestTimes[p.specialty]))&&state.world.every(a=>validRaceTime(a.bestTimes[a.specialty]))};
  })()`);
  assert.deepEqual(r.ownCounts,Array(32).fill(1));assert.deepEqual(r.missing,[]);assert.deepEqual(r.invalid,[]);assert.ok(r.foreign>0&&r.reset&&r.foreignRng);assert.equal(r.restored,r.expected);
});

test('balanced new profiles use the unchanged v2.02 race formula and own specialty PBs reach the records',()=>{
  const oldHtml=cp.execFileSync('git',['show','244c8aaf:index.html'],{cwd:repo,encoding:'utf8',maxBuffer:2000000});
  const snapshot=`(()=>{state=createState();migrateState();return{seed:state.rngSeed,profiles:[...state.players,...state.world].map(a=>[a.id,a.stats,a.imAptitude,EVENTS.map(e=>expectedTime(a,e))]),own:state.players.map(p=>({id:p.id,event:p.specialty,time:p.bestTimes[p.specialty],record:(state.teamTop10[p.specialty]||[]).find(r=>r.athleteId===p.id)?.time??null}))}})()`;
  const after=game()(snapshot),legacy=game(oldHtml),before=legacy(`(${JSON.stringify(after.profiles)}).map(([id,stats,imAptitude])=>{const a=attachMedleyStats({id,stats,imAptitude});return[id,EVENTS.map(e=>expectedTime(a,e))]})`);
  for(let i=0;i<before.length;i++)assert.deepEqual(after.profiles[i][3],before[i][1],before[i][0]);
  assert.ok(after.own.every(p=>p.time>0));
  // Each event retains its fastest ten rather than promising all thirty-two
  // swimmers appear in a top ten. Every retained own row has the same PB.
  for(const p of after.own)if(p.record!=null)assert.equal(p.record,p.time);
});
