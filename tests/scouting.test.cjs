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
    a.scoutPreferences={version:3,worldAmbition:false,preferredRegion:null,earlyCompetition:false,prestigeSchool:false};
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
  assert.ok(Math.abs(result.matched-result.unrelated-.10)<1e-10);
  assert.equal(result.imPartial.facilityLevel,25);assert.equal(result.imFull.facilityLevel,100);
  assert.equal(result.imPartial.facilityBonus,.055);assert.equal(result.imFull.facilityBonus,.22);
  assert.equal(result.capped,.97);
});

test('equal specialty PBs have equal difficulty, faster PBs get harder and other categories do not affect high-school ranks',()=>{
  const {run}=game();
  const result=JSON.parse(run(`JSON.stringify((()=>{
    const a=state.world.find(a=>a.category==='high'&&a.grade===3),b=deepClone(a);
    a.specialty='fr100';a.accolades=[];a.scoutPreferences={version:3,worldAmbition:false,preferredRegion:null,earlyCompetition:false,prestigeSchool:false};
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
      versions:state.world.every(a=>a.scoutPreferences.version===3),rng:rngSeed===state.rngSeed};
  })())`));
  assert.ok(result.world/result.n>.40&&result.world/result.n<.51,JSON.stringify(result));
  assert.ok(result.kansai/result.n>.28&&result.kansai/result.n<.39,JSON.stringify(result));
  assert.equal(result.invalidWorld,0);assert.equal(result.added,0);
  assert.ok(result.stable&&result.signed&&result.versions&&result.rng,JSON.stringify(result));
});

test('reputation starts helping at mid-tier and accelerates; prestige and early-entry wishes obey their conditions',()=>{
  const {run}=game();
  const result=JSON.parse(run(`JSON.stringify((()=>{
    const a=state.world.find(a=>a.category==='high'&&a.grade===3);
    a.specialty='fr100';a.bestTimes.fr100=50;a.accolades=[];
    a.scoutPreferences={version:3,worldAmbition:false,preferredRegion:null,earlyCompetition:false,prestigeSchool:false};
    const reps=[0,35,79,80,100,120,140,160,280,450,600].map(rep=>{state.reputation=rep;return scoutProbabilityDetails(a)});
    const labels=[279,280,450,600].map(reputationLabel);
    a.scoutPreferences.prestigeSchool=true;
    const prestige=[159,160,279,280,600].map(rep=>{state.reputation=rep;return scoutProbabilityDetails(a).prestigeBonus});
    a.scoutPreferences.prestigeSchool=false;a.scoutPreferences.earlyCompetition=true;
    const p=deepClone(state.players[0]);state.players=[49,49.5,50,48].map((time,i)=>({...deepClone(p),id:'peer-'+i,year:i===3?4:2,bestTimes:{fr100:time}}));
    state.recruits=[];for(const high of state.world)high.scouted=false;
    const tied=scoutProbabilityDetails(a);
    const signed={...deepClone(a),id:'signed-peer',bestTimes:{fr100:49.8}};state.world.push(signed);state.recruits=[signed.id];
    const fourth=scoutProbabilityDetails(a);signed.bestTimes.fr100=50;
    const third=scoutProbabilityDetails(a);a.bestTimes.fr100=null;
    const missing=scoutProbabilityDetails(a);
    return {reps:reps.map(d=>d.reputationBonus),labels,prestige,tied:{rank:tied.enrollmentRank,bonus:tied.earlyBonus},fourth:{rank:fourth.enrollmentRank,bonus:fourth.earlyBonus},third:{rank:third.enrollmentRank,bonus:third.earlyBonus},missing:{rank:missing.enrollmentRank,bonus:missing.earlyBonus}};
  })())`));
  assert.deepEqual(result.reps.slice(0,3),[0,0,0]);assert.ok(result.reps[3]>0&&result.reps[3]<=.02);
  const increments=result.reps.slice(4,8).map((v,i)=>v-result.reps[i+3]);
  assert.ok(increments.every((v,i)=>i===0||v>increments[i-1]),JSON.stringify(result));
  assert.deepEqual(result.labels,['強豪','名門','名門','名門']);
  assert.deepEqual(result.prestige,[0,.1,.1,.1,.1]);
  assert.deepEqual(result.tied,{rank:3,bonus:.1});assert.deepEqual(result.fourth,{rank:4,bonus:0});
  assert.deepEqual(result.third,{rank:3,bonus:.1});assert.deepEqual(result.missing,{rank:null,bonus:0});
});

test('new wishes each appear about ten percent and v2 wishes migrate once without changing signed recruits or RNG',()=>{
  const {run}=game();
  const result=JSON.parse(run(`JSON.stringify((()=>{
    const template=deepClone(state.world.find(a=>a.category==='high'&&a.grade===3)),rankings=highSchoolScoutRankings(),rngSeed=state.rngSeed;
    let early=0,prestige=0;const n=4000;
    for(let i=0;i<n;i++){
      const a={...deepClone(template),id:'v3-preference-'+i,scoutPreferences:{version:2,worldAmbition:true,preferredRegion:'kansai'}};
      const preference=ensureScoutPreferences(a,rankings);early+=preference.earlyCompetition;prestige+=preference.prestigeSchool;
      if(!preference.worldAmbition||preference.preferredRegion!=='kansai')throw new Error('old hope lost');
    }
    const a=state.world.find(a=>a.id===template.id);a.scouted=true;state.recruits=[a.id];a.scoutPreferences={version:2,worldAmbition:true,preferredRegion:'kansai'};
    const own=JSON.stringify(state.players),records=JSON.stringify(state.recordRankings),athletes=JSON.stringify(state.world.map(p=>[p.id,p.stats,p.bestTimes]));
    migrateState();const first=JSON.stringify(state);state=JSON.parse(first);migrateState();
    return {n,early,prestige,stable:first===JSON.stringify(state),rng:rngSeed===state.rngSeed,signed:state.recruits.includes(a.id)&&state.world.find(p=>p.id===a.id).scouted,
      own:own===JSON.stringify(state.players),records:records===JSON.stringify(state.recordRankings),athletes:athletes===JSON.stringify(state.world.map(p=>[p.id,p.stats,p.bestTimes]))};
  })())`));
  assert.ok(result.early/result.n>.08&&result.early/result.n<.12,JSON.stringify(result));
  assert.ok(result.prestige/result.n>.08&&result.prestige/result.n<.12,JSON.stringify(result));
  for(const key of ['stable','rng','signed','own','records','athletes'])assert.equal(result[key],true,key);
});

test('existing candidate identities supply exactly eight freshmen; every other senior advances and only middle-school first years are generated',()=>{
  const {run}=game();
  const result=JSON.parse(run(`JSON.stringify((()=>{
    const rows=[];
    for(let year=0;year<8;year++){
      const board=refreshScoutBoard(),before=new Map(board.map(a=>[a.id,{name:a.name,stats:deepClone(a.stats),pb:deepClone(a.bestTimes),specialty:a.specialty}]));
      const signed=board.slice(0,year%3===0?8:year%3===1?2:0).map(a=>a.id);state.recruits=signed;
      signed.forEach(id=>state.world.find(a=>a.id===id).scouted=true);
      const oldIds=new Set(state.players.concat(state.world).map(a=>a.id)),seniors=state.world.filter(a=>a.category==='high'&&a.grade===3).map(a=>a.id);
      newSeason();const freshmen=state.players.filter(p=>p.year===1),freshIds=new Set(freshmen.map(p=>p.id));
      rows.push({year,count:freshmen.length,unique:freshIds.size,signed:signed.every(id=>freshIds.has(id)),candidates:freshmen.every(p=>before.has(p.id)),
        preserved:freshmen.every(p=>{const a=before.get(p.id);return a.name===p.name&&a.specialty===p.specialty&&JSON.stringify(a.stats)===JSON.stringify(p.stats)&&JSON.stringify(a.pb)===JSON.stringify(p.bestTimes)}),
        moved:seniors.every(id=>freshIds.has(id)||state.world.some(a=>a.id===id&&a.category==='university'&&a.grade===1)),
        freshOnly:state.world.filter(a=>!oldIds.has(a.id)).every(a=>a.category==='middle'&&a.grade===1&&a.age===13),
        newCount:state.world.filter(a=>!oldIds.has(a.id)).length,expected:organizationNames().middle.length*3,
        removed:freshmen.every(p=>!state.world.some(a=>a.id===p.id)),welcome:state.pendingFreshmenWelcome.length,queue:state.recruits.length});
      const serial=state.serial,rngSeed=state.rngSeed;maintainWorldPopulation();migrateState();
      rows.at(-1).reloadNoNew=state.serial===serial&&state.rngSeed===rngSeed;
    }
    return rows;
  })())`));
  for(const row of result){
    assert.equal(row.count,8,JSON.stringify(row));assert.equal(row.unique,8);assert.equal(row.welcome,8);assert.equal(row.queue,0);
    assert.equal(row.newCount,row.expected);
    for(const key of ['signed','candidates','preserved','moved','freshOnly','removed','reloadNoNew'])assert.equal(row[key],true,JSON.stringify(row));
  }
});

test('CPU enrollment prefers strong and prestigious universities, observes available places and never loses a senior when all places fill',()=>{
  const {run}=game();
  const result=JSON.parse(run(`JSON.stringify((()=>{
    const a=deepClone(state.world.find(a=>a.category==='high'&&a.grade===3));
    state.universities=[35,80,160,280].map((rep,i)=>({id:'destination-'+i,name:'進路大学'+i,reputation:rep}));
    state.world=[];a.scoutPreferences={prestigeSchool:false};
    const counts=[0,0,0,0];for(let i=0;i<6000;i++)counts[+chooseCpuUniversityForRecruit(a).slice(-1)]++;
    state.world=Array.from({length:5},(_,i)=>({...deepClone(a),id:'full-'+i,category:'university',grade:1,organization:'進路大学3'}));
    const skipsFull=Array.from({length:200},()=>chooseCpuUniversityForRecruit(a)).every(name=>name!=='進路大学3');
    for(const u of state.universities.slice(0,3))for(let i=0;i<5;i++)state.world.push({...deepClone(a),id:u.id+'-'+i,category:'university',grade:1,organization:u.name});
    const overflow=chooseCpuUniversityForRecruit(a);
    return {counts,skipsFull,overflow};
  })())`));
  assert.ok(result.counts[3]>result.counts[2]&&result.counts[2]>result.counts[1]&&result.counts[1]>result.counts[0],JSON.stringify(result));
  assert.ok((result.counts[2]+result.counts[3])/6000>.75,JSON.stringify(result));
  assert.ok(result.skipsFull);assert.match(result.overflow,/進路大学[0-3]/);
});

test('unscouted freshmen favor specialty talent at strong and prestigious schools, with random selection and no stat changes',()=>{
  const {run}=game();
  const result=JSON.parse(run(`JSON.stringify((()=>{
    const template=deepClone(state.world.find(a=>a.category==='high'&&a.grade===3));
    const low={...deepClone(template),id:'ordinary-freshman',specialty:'fr100',stats:Object.fromEntries(STATS.map(k=>[k,80]))};
    const specialist={...deepClone(template),id:'specialist-freshman',specialty:'fr100',stats:Object.fromEntries(STATS.map(k=>[k,40]))};
    for(const k of ['fr_speed','fr_stamina','fr_turn','start'])specialist.stats[k]=160;
    const balanced={...deepClone(specialist),id:'balanced-freshman',stats:Object.fromEntries(STATS.map(k=>[k,160]))};
    const before=JSON.stringify([low,specialist,balanced]),rows=[],n=10000;
    for(const rep of [35,159,160,279,280,600]){
      state.reputation=rep;state.rngSeed=5914;let talented=0;
      for(let i=0;i<n;i++){
        const pool=[low,specialist],pick=pickGeneralFreshman(pool);
        talented+=pick.id===specialist.id;
        if(pool.length!==1||pool[0].id===pick.id)throw new Error('duplicate general admission');
      }
      rows.push({rep,rate:talented/n});
    }
    const emptySeed=state.rngSeed,empty=pickGeneralFreshman([])===null&&state.rngSeed===emptySeed;
    const oldRng=rng;state.reputation=280;rng=()=>0;const first=pickGeneralFreshman([low,specialist]);
    rng=()=>.999999999;const last=pickGeneralFreshman([low,specialist]);rng=oldRng;
    return {rows,empty,edges:first.id===low.id&&last.id===specialist.id,
      specialist:overallStatValue(specialist)<80&&Math.abs(recruitAbility(specialist)-160)<1e-9,
      sameTalent:universityTalentPreference(specialist,280)===universityTalentPreference(balanced,280),
      preserved:before===JSON.stringify([low,specialist,balanced])};
  })())`));
  assert.ok(result.empty&&result.edges&&result.specialist&&result.sameTalent&&result.preserved,JSON.stringify(result));
  for(const row of result.rows.slice(0,2))assert.ok(row.rate>.48&&row.rate<.52,JSON.stringify(row));
  for(const row of result.rows.slice(2,4))assert.ok(row.rate>.80&&row.rate<.86,JSON.stringify(row));
  for(const row of result.rows.slice(4))assert.ok(row.rate>.85&&row.rate<.90,JSON.stringify(row));
  assert.ok(result.rows[4].rate>result.rows[3].rate);
});

test('higher specialty ability increasingly favors elite CPU destinations without excluding ordinary universities',()=>{
  const {run}=game();
  const result=JSON.parse(run(`JSON.stringify((()=>{
    const template=deepClone(state.world.find(a=>a.category==='high'&&a.grade===3));
    state.universities=[35,80,160,280].map((rep,i)=>({id:'talent-destination-'+i,name:'能力進路大学'+i,reputation:rep}));state.world=[];
    const rows=[],n=10000;
    for(const level of [80,120,160]){
      const a={...deepClone(template),specialty:'fr100',stats:Object.fromEntries(STATS.map(k=>[k,level])),scoutPreferences:{prestigeSchool:false}};
      state.rngSeed=5914;const counts=[0,0,0,0];
      for(let i=0;i<n;i++)counts[+chooseCpuUniversityForRecruit(a).slice(-1)]++;
      rows.push({level,counts,elite:(counts[2]+counts[3])/n});
    }
    return rows;
  })())`));
  assert.ok(result[1].elite>result[0].elite&&result[2].elite>result[1].elite,JSON.stringify(result));
  assert.ok(result[2].elite-result[0].elite>.10,JSON.stringify(result));
  for(const row of result)assert.ok(row.counts.every(n=>n>0),JSON.stringify(row));
});

test('season rollover draws only the remaining own places and allocates CPU places in talent order',()=>{
  const {run}=game();
  const result=JSON.parse(run(`JSON.stringify((()=>{
    const original=deepClone(state),rows=[],realPick=pickGeneralFreshman,realChoose=chooseCpuUniversityForRecruit;
    for(const [rep,signedCount] of [[35,0],[160,2],[280,2],[280,8]]){
      state=deepClone(original);state.reputation=rep;
      const board=refreshScoutBoard(),signed=signedCount?board.slice(-signedCount).map(a=>a.id):[];
      state.recruits=signed;signed.forEach(id=>state.world.find(a=>a.id===id).scouted=true);
      const before=new Map(board.map(a=>[a.id,JSON.stringify([a.name,a.specialty,a.stats,a.bestTimes,a.accolades])])),draws=[],cpuOrder=[];
      pickGeneralFreshman=pool=>{draws.push({rep:state.reputation,size:pool.length});return realPick(pool)};
      chooseCpuUniversityForRecruit=a=>{cpuOrder.push(recruitAbility(a));return realChoose(a)};
      newSeason();const freshmen=state.players.filter(p=>p.year===1);
      rows.push({rep,signedCount,count:freshmen.length,draws,unique:new Set(freshmen.map(p=>p.id)).size,
        signed:signed.every(id=>freshmen.some(p=>p.id===id)),candidates:freshmen.every(p=>before.has(p.id)),
        preserved:freshmen.every(p=>before.get(p.id)===JSON.stringify([p.name,p.specialty,p.stats,p.bestTimes,p.accolades])),
        cpuOrdered:cpuOrder.every((ability,i)=>i===0||ability<=cpuOrder[i-1]+1e-9),
        noDuplicates:new Set(state.players.concat(state.world).map(a=>a.id)).size===state.players.length+state.world.length});
    }
    pickGeneralFreshman=realPick;chooseCpuUniversityForRecruit=realChoose;
    return rows;
  })())`));
  for(const row of result){
    assert.equal(row.count,8,JSON.stringify(row));assert.equal(row.unique,8);assert.equal(row.draws.length,8-row.signedCount);
    assert.ok(row.draws.every((draw,i)=>draw.rep===row.rep&&(i===0||draw.size===row.draws[i-1].size-1)),JSON.stringify(row));
    for(const key of ['signed','candidates','preserved','cpuOrdered','noDuplicates'])assert.equal(row[key],true,JSON.stringify(row));
  }
});
