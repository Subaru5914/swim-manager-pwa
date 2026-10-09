const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(){
  const alerts=[],context=vm.createContext({crypto:{getRandomValues:a=>{a[0]=12345;return a}},alert:text=>alerts.push(text)});
  vm.runInContext(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener')),context);
  const run=code=>vm.runInContext(code,context);run('state=createState()');
  return {run,alerts};
}

test('every active third-year high-school swimmer in any top-50 ranking appears, including secondary events and signed recruits',()=>{
  const {run}=game();
  const result=JSON.parse(run(`JSON.stringify((()=>{
    const template=state.world.find(a=>a.category==='high');
    state.world=Array.from({length:120},(_,i)=>({...deepClone(template),id:'coverage-'+i,grade:3,retired:false,scouted:false,discovered:false,specialty:'fr100',accolades:[],
      bestTimes:Object.fromEntries(EVENTS.map(e=>[e,JAPAN_RECORD[e]*(2+i*.02)]))}));
    state.world[0].grade=2;state.world[1].retired=true;
    const secondary=state.world[115];secondary.specialty='fr400';secondary.bestTimes.ba100=JAPAN_RECORD.ba100;
    state.world[4].scouted=true;state.recruits=[state.world[4].id];
    const board=refreshScoutBoard(),ids=new Set(board.map(a=>a.id));
    const expected=EVENTS.flatMap(e=>ranking(e,'high',50).concat(ranking(e,'all',50))).filter(a=>a.category==='high'&&a.grade===3);
    return {covered:expected.every(a=>ids.has(a.id)),secondary:ids.has(secondary.id),signed:ids.has(state.world[4].id),
      fiftieth:ids.has('coverage-50'),grades:board.every(a=>a.grade===3&&!a.retired),unique:ids.size===board.length,
      omitted:!ids.has('coverage-0')&&!ids.has('coverage-1'),secondaryRank:scoutHighSchoolRank(secondary,'fr400')};
  })())`));
  assert.ok(result.covered&&result.secondary&&result.signed&&result.fiftieth&&result.grades&&result.unique&&result.omitted,JSON.stringify(result));
  assert.ok(result.secondaryRank>50);
});

test('matching wishes add facility and region bonuses while unrelated facilities and missing wishes do not',()=>{
  const {run}=game();
  const result=JSON.parse(run(`JSON.stringify((()=>{
    state.reputation=35;
    const a=state.world.find(a=>a.category==='high'&&a.grade===3);
    a.specialty='fr100';a.accolades=[];a.bestTimes.fr100=JAPAN_RECORD.fr100;
    a.scoutPreferences={version:2,worldAmbition:false,preferredRegion:null};
    state.facilities=Object.fromEntries(STATS.map(k=>[k,0]));const ordinary=scoutProbability(a);
    state.facilities=Object.fromEntries(STATS.map(k=>[k,100]));const withoutWish=scoutProbability(a);
    a.scoutPreferences.worldAmbition=true;
    const levels=[0,50,100].map(level=>{state.facilities=Object.fromEntries(STATS.map(k=>[k,k.startsWith('fr_')?level:0]));return scoutProbability(a)});
    state.facilities.ba_speed=100;state.facilities.mental=100;const unrelated=scoutProbability(a);
    a.scoutPreferences.preferredRegion='kansai';const matched=scoutProbability(a);
    const oldName=state.playerUniversity;state.playerUniversity='大学を改名';const renamed=scoutProbability(a);state.playerUniversity=oldName;
    a.specialty='im200';state.facilities=Object.fromEntries(STATS.map(k=>[k,k.startsWith('fr_')?100:0]));
    const imPartial=scoutProbabilityDetails(a);state.facilities=Object.fromEntries(STATS.map(k=>[k,100]));const imFull=scoutProbabilityDetails(a);
    state.reputation=550;a.specialty='fr100';a.bestTimes.fr100=JAPAN_RECORD.fr100*3;const capped=scoutProbability(a);
    return {ordinary,withoutWish,levels,unrelated,matched,renamed,imPartial,imFull,capped};
  })())`));
  assert.equal(result.ordinary,result.withoutWish);assert.equal(result.levels[0],result.ordinary);
  assert.ok(Math.abs(result.levels[1]-result.levels[0]-.11)<1e-10);
  assert.ok(Math.abs(result.levels[2]-result.levels[0]-.22)<1e-10);
  assert.equal(result.unrelated,result.levels[2]);assert.equal(result.renamed,result.matched);
  assert.ok(Math.abs(result.matched-result.unrelated-.18)<1e-10);
  assert.equal(result.imPartial.facilityLevel,25);assert.equal(result.imFull.facilityLevel,100);
  assert.equal(result.imPartial.facilityBonus,.055);assert.equal(result.imFull.facilityBonus,.22);
  assert.equal(result.capped,.97);
});

test('equal specialty PBs have equal difficulty, faster PBs get harder and other categories do not affect high-school ranks',()=>{
  const {run}=game();
  const result=JSON.parse(run(`JSON.stringify((()=>{
    const a=state.world.find(a=>a.category==='high'&&a.grade===3),b=deepClone(a);
    a.specialty='fr100';a.accolades=[];a.scoutPreferences={version:2,worldAmbition:false,preferredRegion:null};
    a.bestTimes.fr100=JAPAN_RECORD.fr100*1.1;b.id='same-pb';b.bestTimes.fr100=a.bestTimes.fr100;b.specialty=a.specialty;b.accolades=[];b.scoutPreferences=deepClone(a.scoutPreferences);state.world.push(b);
    const first=scoutProbabilityDetails(a),same=scoutProbabilityDetails(b);
    state.world.push({...deepClone(a),id:'faster-adult',category:'adult',bestTimes:{fr100:1}});
    const otherCategory=scoutProbabilityDetails(a);
    a.bestTimes.fr50=.5;const otherEvent=scoutProbability(a);
    a.bestTimes.fr100=JAPAN_RECORD.fr100*.99;const faster=scoutProbability(a);
    state.world.push({...deepClone(a),id:'missing-pb',bestTimes:{fr100:null}});
    return {first,same,otherCategory,otherEvent,faster};
  })())`));
  assert.equal(result.first.rank,result.same.rank);assert.equal(result.first.probability,result.same.probability);
  assert.equal(result.first.rank,result.otherCategory.rank);assert.equal(result.first.probability,result.otherCategory.probability);
  assert.equal(result.otherEvent,result.first.probability);assert.ok(result.faster<result.first.probability);
});

test('optional hopes survive reload and old-save migration once without consuming RNG or changing earned stats and records',()=>{
  const {run}=game();
  const result=JSON.parse(run(`JSON.stringify((()=>{
    for(const a of state.world)delete a.scoutPreferences;
    state.version='pwa-v1.36';
    const own=JSON.stringify(state.players),records=JSON.stringify(state.recordRankings),stats=JSON.stringify(state.world.map(a=>[a.id,a.stats,a.bestTimes,a.accolades])),rngSeed=state.rngSeed;
    migrateState();const first=JSON.stringify(state),preferences=state.world.filter(a=>a.category==='high'&&a.grade===3).map(a=>a.scoutPreferences);
    state=JSON.parse(first);migrateState();refreshScoutBoard();
    return {own:JSON.stringify(state.players)===own,records:JSON.stringify(state.recordRankings)===records,
      stats:JSON.stringify(state.world.map(a=>[a.id,a.stats,a.bestTimes,a.accolades]))===stats,rng:state.rngSeed===rngSeed,
      stable:JSON.stringify(state)===first,none:preferences.some(p=>!p.worldAmbition&&!p.preferredRegion),
      world:state.world.filter(a=>a.category==='high'&&a.grade===3&&a.scoutPreferences.worldAmbition).every(a=>scoutHighSchoolRank(a,scoutSpecialty(a))<=8),regional:preferences.some(p=>p.preferredRegion==='kansai')};
  })())`));
  assert.ok(Object.values(result).every(Boolean),JSON.stringify(result));
});

test('actual scouting uses the displayed odds, charges attempts once, respects eight places and enrolls the signed class',()=>{
  const {run,alerts}=game();
  const result=JSON.parse(run(`JSON.stringify((()=>{
    let renders=0,saves=0;renderAll=()=>renders++;scheduleAutoSave=()=>saves++;
    const original=rng,candidates=refreshScoutBoard().filter(a=>!a.scouted).slice(0,9),oldIds=candidates.map(a=>a.id);
    state.points=20;const probability=scoutProbability(candidates[0]);
    rng=()=>probability+.00001;doScout(candidates[0].id);const failure=!candidates[0].scouted&&state.points===19;
    rng=()=>Math.max(0,probability-.00001);doScout(candidates[0].id);const success=candidates[0].scouted&&state.recruits.includes(candidates[0].id)&&state.points===18;
    doScout(candidates[0].id);const repeat=state.points===18;
    rng=()=>0;for(const a of candidates.slice(1))doScout(a.id);
    const cap=state.recruits.length===8&&scoutRecruitCount()===8&&!candidates[8].scouted&&state.points===11;
    rng=original;newSeason();
    const newcomers=state.players.filter(p=>p.year===1),board=refreshScoutBoard(),expected=EVENTS.flatMap(e=>ranking(e,'high',50)).filter(a=>a.grade===3);
    return {failure,success,repeat,cap,renders,saves,enrolled:oldIds.slice(0,8).every(id=>newcomers.some(p=>p.id===id)),
      classSize:newcomers.length,removed:board.every(a=>!oldIds.includes(a.id)),newRanking:expected.every(a=>board.some(b=>b.id===a.id))};
  })())`));
  assert.ok(result.failure&&result.success&&result.repeat&&result.cap&&result.enrolled&&result.removed&&result.newRanking,JSON.stringify(result));
  assert.equal(result.classSize,8);assert.equal(result.renders,9);assert.equal(result.saves,9);
  assert.ok(alerts.some(text=>text.includes('スカウトに失敗'))&&alerts.some(text=>text.includes('スカウトに成功'))&&alerts.some(text=>text.includes('8名')));
});

test('world wishes are rare and only assigned at specialty ranks 1 through 8; Kansai wishes occur about ten percent',()=>{
  const {run}=game();
  const result=JSON.parse(run(`JSON.stringify((()=>{
    const template=deepClone(state.world.find(a=>a.category==='high'&&a.grade===3));delete template.scoutPreferences;
    state.world=Array.from({length:20},(_,i)=>({...deepClone(template),id:'wish-rank-'+i,specialty:'fr100',bestTimes:{fr100:50+i*.1}}));
    const rankings=highSchoolScoutRankings(),rngSeed=state.rngSeed,n=2000;
    let fastWorld=0,eighthWorld=0,ninthWorld=0,missingWorld=0,kansai=0,stored=null;
    for(let i=0;i<n;i++){
      for(const [kind,time] of [['fast',49.9],['eighth',50.7],['ninth',50.8],['missing',null]]){
        const a={...deepClone(template),id:'wish-sample-'+kind+'-'+i,specialty:'fr100',bestTimes:{fr100:time}};
        const p=ensureScoutPreferences(a,rankings);
        if(kind==='fast'){fastWorld+=p.worldAmbition;kansai+=p.preferredRegion==='kansai';if(p.worldAmbition&&!stored)stored=a}
        if(kind==='eighth')eighthWorld+=p.worldAmbition;
        if(kind==='ninth')ninthWorld+=p.worldAmbition;
        if(kind==='missing')missingWorld+=p.worldAmbition;
      }
    }
    const saved=JSON.stringify(stored.scoutPreferences);stored.bestTimes.fr100=100;
    ensureScoutPreferences(stored,rankings);
    return {n,fastWorld,eighthWorld,ninthWorld,missingWorld,kansai,rng:rngSeed===state.rngSeed,stable:saved===JSON.stringify(stored.scoutPreferences)};
  })())`));
  assert.ok(result.fastWorld/result.n>.11&&result.fastWorld/result.n<.19,JSON.stringify(result));
  assert.ok(result.eighthWorld/result.n>.11&&result.eighthWorld/result.n<.19,JSON.stringify(result));
  assert.ok(result.kansai/result.n>.07&&result.kansai/result.n<.13,JSON.stringify(result));
  assert.equal(result.ninthWorld,0);assert.equal(result.missingWorld,0);assert.ok(result.rng&&result.stable);
});

test('v1 wishes are thinned once, nonleaders lose world wishes, and no-wish or signed candidates retain their status',()=>{
  const {run}=game();
  const result=JSON.parse(run(`JSON.stringify((()=>{
    const template=deepClone(state.world.find(a=>a.category==='high'&&a.grade===3));delete template.scoutPreferences;
    state.world=Array.from({length:20},(_,i)=>({...deepClone(template),id:'legacy-rank-'+i,specialty:'fr100',bestTimes:{fr100:50+i*.1}}));
    const rankings=highSchoolScoutRankings(),n=2000;
    let world=0,kansai=0,invalidWorld=0,added=0;
    for(let i=0;i<n;i++){
      for(const [kind,time] of [['leader',49.9],['outside',51],['none',49.9]]){
        const a={...deepClone(template),id:'legacy-wish-'+kind+'-'+i,specialty:'fr100',bestTimes:{fr100:time},
          scoutPreferences:{version:1,worldAmbition:kind!=='none',preferredRegion:kind==='none'?null:'kansai'}};
        const p=ensureScoutPreferences(a,rankings);
        if(kind==='leader'){world+=p.worldAmbition;kansai+=p.preferredRegion==='kansai'}
        if(kind==='outside')invalidWorld+=p.worldAmbition;
        if(kind==='none')added+=p.worldAmbition||p.preferredRegion!==null;
      }
    }
    for(const a of state.world)a.scoutPreferences={version:1,worldAmbition:true,preferredRegion:'kansai'};
    state.world[0].scouted=true;state.recruits=[state.world[0].id];const recruits=JSON.stringify(state.recruits),rngSeed=state.rngSeed;
    refreshScoutBoard();const first=JSON.stringify(state);state=JSON.parse(first);refreshScoutBoard();
    return {n,world,kansai,invalidWorld,added,stable:first===JSON.stringify(state),
      signed:state.world[0].scouted&&state.recruits.includes(state.world[0].id)&&JSON.stringify(state.recruits)===recruits,
      versions:state.world.every(a=>a.scoutPreferences.version===2),rng:rngSeed===state.rngSeed};
  })())`));
  assert.ok(result.world/result.n>.40&&result.world/result.n<.51,JSON.stringify(result));
  assert.ok(result.kansai/result.n>.28&&result.kansai/result.n<.39,JSON.stringify(result));
  assert.equal(result.invalidWorld,0);assert.equal(result.added,0);
  assert.ok(result.stable&&result.signed&&result.versions&&result.rng,JSON.stringify(result));
});
