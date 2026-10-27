const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(){return vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+`
 state={season:2026,slot:38,rngSeed:5914,cpuCompetitionSeed:5914,players:[],world:[],retiredArchive:[],universities:[],recruits:[],scoutBoard:[],facilities:{},trainingFocus:{},recordRankings:{},recordBook:{},teamTop10:{},teamPodiumHistory:[],meetHistory:[],japanTeamHistory:[],playerUniversity:'自大学',points:123};
 refreshScoutBoard=()=>[];
 function swimmer(i,specialty='fr100',value=150){return attachMedleyStats({id:'IH-'+i,name:'高校選手'+i,category:'high',age:18,grade:3,organization:'検証高校',specialty,retired:false,stats:Object.fromEntries(STATS.map(k=>[k,value])),imAptitude:{speed:0,stamina:0},bestTimes:{},accolades:[],raceHistory:[]})}
 return code=>JSON.parse(JSON.stringify(eval(code)))`,['globalThis'])({crypto:{getRandomValues:a=>{a[0]=5914;return a}}})}

test('Interhigh entries use the specialty and the strongest secondary event, never weak strokes or unsupported 50m events',()=>{
 const r=game()(`(()=>{const a=swimmer(0,'fr100',70);for(const s of ['fr','ba'])for(const k of ['speed','stamina','turn'])a.stats[s+'_'+k]=s==='fr'?150:165;
  const before=JSON.stringify(a),seed=state.rngSeed,events=interhighEntryEvents(a),secondary=SPECIALTY_EVENTS.filter(e=>e!==a.specialty).sort((x,y)=>abilityValue(a,y)-abilityValue(a,x)||SPECIALTY_EVENTS.indexOf(x)-SPECIALTY_EVENTS.indexOf(y))[0];
  return{events,secondary,unchanged:before===JSON.stringify(a)&&seed===state.rngSeed}})()`);
 assert.equal(r.events[0],'fr100');assert.equal(r.events[1],r.secondary);assert.ok(r.events[1].startsWith('ba'));assert.equal(r.events.length,2);assert.ok(r.unchanged);
});

test('Interhigh finals call the race formula, award places by actual clocks including ties, and register reachable PBs without boosting abilities',()=>{
 const r=game()(`(()=>{state.world=Array.from({length:12},(_,i)=>swimmer(i,'fr100',160-i*.1));state.world.push({...swimmer(99),category:'adult',age:23,grade:null});
  const protectedData=JSON.stringify(state.world.map(a=>[a.id,a.stats,a.specialty])),seed=state.rngSeed,original=raceTarget,calls=[];
  raceTarget=(a,e)=>{calls.push([a.id,e,activeRaceMeetContext.meet,activeRaceMeetContext.season]);rng();return 50+Math.floor(Number(a.id.slice(3))/2)*.1};
  const rows=assignInterhigh();raceTarget=original;
  const first=JSON.stringify(state),again=assignInterhigh();
  return{rows:rows.filter(r=>r.event==='fr100'),calls,unchanged:protectedData===JSON.stringify(state.world.map(a=>[a.id,a.stats,a.specialty]))&&state.rngSeed===seed,once:first===JSON.stringify(state)&&again.length===0,pb:state.world.slice(0,8).every(a=>a.bestTimes.fr100<=a.accolades.find(h=>h.event==='fr100').time),maxEntries:Math.max(...state.world.map(a=>a.accolades.length))}})()`);
 assert.deepEqual(r.rows.map(x=>x.rank),[1,1,3,3,5,5,7,7]);assert.equal(r.rows.length,8);assert.ok(r.calls.every(([id,,meet,season])=>id!=='IH-99'&&meet==='全国高校総体'&&season===2026));assert.ok(r.unchanged&&r.once&&r.pb);assert.ok(r.maxEntries<=2);
});

test('historical reconstruction scales only a temporary school profile, freezes school grades, and leaves live stats and names intact',()=>{
 const r=game()(`(()=>{state.season=2027;state.slot=1;const a=swimmer(0,'fr100',190);delete a.grade;a.year=1;a.age=19;a.category='university';a.organization=state.playerUniversity;state.players=[a];
  const before=JSON.stringify([a.name,a.stats]),seed=state.rngSeed,profile=interhighSchoolProfile(a,true);const rows=assignInterhigh({season:2026,historical:true});
  return{rows,cap:Math.max(...PHYSICAL_STATS.map(k=>profile.stats[k])),unchanged:before===JSON.stringify([a.name,a.stats])&&seed===state.rngSeed,grades:a.accolades.map(h=>[h.schoolCategory,h.gradeAtRecord,h.season]),reachable:a.accolades.every(h=>h.entryBaseTime>=round2(expectedTime(a,h.event))&&a.bestTimes[h.event]<=h.time)}})()`);
 assert.ok(r.rows.length>0&&r.unchanged&&r.reachable);assert.equal(r.cap,165);assert.ok(r.grades.every(([school,grade,season])=>school==='high'&&grade===3&&season===2026));
});

test('existing generated Interhigh medals are rebuilt for current athletes without changing played meets, names, abilities, points or RNG',()=>{
 const r=game()(`(()=>{state.slot=1;state.world=Array.from({length:36},(_,i)=>swimmer(i,i%2?'ba100':'fr100',160+i*.1));
  for(const a of state.world){for(const s of ['br','fly'])for(const k of ['speed','stamina','turn'])a.stats[s+'_'+k]=65;
   a.accolades=[{competitionId:'interhigh_2026',competition:'全国高校総体',stage:'A_final',season:2026,event:'fly200',rank:1,time:112,organization:'旧高校'}];a.bestTimes.fr100=48;
   a.raceHistory=[{meet:'intercollege',season:2024,event:'br100',stage:'A決勝',rank:2,time:65}];
  }
  const owned=state.world.shift();owned.year=1;owned.age=19;delete owned.grade;owned.category='university';owned.organization=state.playerUniversity;state.players=[owned];
  upsertMainResult(owned,owned.accolades[0]);
  const before=JSON.stringify([...state.players,...state.world].map(a=>[a.id,a.name,a.stats,a.raceHistory.filter(h=>h.meet!=='全国高校総体'),a.bestTimes.fr100])),seed=state.rngSeed;
  const count=repairGeneratedInterhighResults(),after=JSON.stringify(state),rows=[...state.players,...state.world].flatMap(a=>a.accolades.filter(h=>h.interhighResultVersion===1).map(h=>({event:h.event,season:h.season,time:h.time,rank:h.rank,allowed:interhighEntryEvents(a).includes(h.event)})));
  repairGeneratedInterhighResults();return{count,rows,once:after===JSON.stringify(state),same:before===JSON.stringify([...state.players,...state.world].map(a=>[a.id,a.name,a.stats,a.raceHistory.filter(h=>h.meet!=='全国高校総体'),a.bestTimes.fr100])),seed:seed===state.rngSeed,points:state.points,legacy:[...state.players,...state.world].some(a=>a.accolades.some(h=>h.competitionId==='interhigh_2026')),wrongMain:playerMainResults(owned).some(h=>h.meet==='全国高校総体'&&h.event==='fly200')}})()`);
 assert.ok(r.count>0&&r.once&&r.same&&r.seed);assert.equal(r.points,123);assert.equal(r.legacy,false);assert.equal(r.wrongMain,false);assert.ok(r.rows.every(h=>h.allowed&&h.season===2025));
 for(const event of new Set(r.rows.map(h=>h.event))){const rows=r.rows.filter(h=>h.event===event).sort((a,b)=>a.time-b.time);for(let i=1;i<rows.length;i++)assert.ok(rows[i].rank>=rows[i-1].rank)}
});

test('a verified Interhigh race is preserved even when an old generated title conflicts with it',()=>{
 const r=game()(`(()=>{state.slot=40;const a=swimmer(0);state.world=[a];a.accolades=[{competitionId:'interhigh_2026',competition:'全国高校総体',stage:'A_final',season:2026,event:'fr100',rank:1,time:49}];
  a.raceHistory=[{meet:'全国高校総体',season:2026,event:'fr100',stage:'決勝',rank:2,time:51,schoolCategory:'high',gradeAtRecord:3}];const history=JSON.stringify(a.raceHistory);
  repairGeneratedInterhighResults();return{same:history===JSON.stringify(a.raceHistory.filter(h=>h.interhighResultVersion!==1)),main:playerMainResults(a).find(h=>h.event==='fr100')}})()`);
 assert.ok(r.same);assert.equal(r.main.rank,2);assert.equal(r.main.time,51);
});

test('the August school meet runs once through the real training command, without an instant ability or point bonus',()=>{
 const r=game()(`(()=>{state.world=Array.from({length:10},(_,i)=>swimmer(i));state.cpuDevelopmentVersion=1;
  applyPlayerTraining=()=>({changes:[]});applyCpuTraining=()=>{};cpuCollegeTrainingPlan=()=>new Map();measureCpuTrainingPBs=()=>{};
  const before=JSON.stringify(state.world.map(a=>a.stats)),seed=state.rngSeed;state.slot=37;trainCommand();const early=state.world.every(a=>!a.accolades.length);
  state.slot=38;trainCommand();const count=state.world.reduce((n,a)=>n+a.accolades.length,0),saved=JSON.stringify(state.world);trainCommand();
  return{early,count,once:saved===JSON.stringify(state.world),same:before===JSON.stringify(state.world.map(a=>a.stats)),rng:seed===state.rngSeed,points:state.points,dates:state.world.flatMap(a=>a.accolades.map(h=>[h.season,h.slot,h.gradeAtRecord]))}})()`);
 assert.ok(r.early&&r.count>0&&r.once&&r.same&&r.rng);assert.equal(r.points,123);assert.ok(r.dates.every(([season,slot,grade])=>season===2026&&slot===38&&grade===3));
});

test('historical medley aptitude cannot lift the reconstructed school profile above its school ceiling',()=>{
 const r=game()(`(()=>{const a=swimmer(0,'im200',200);a.imAptitude={speed:20,stamina:20};const before=JSON.stringify(a),profile=interhighSchoolProfile(a,true);
  return{same:before===JSON.stringify(a),max:Math.max(...TRAINING_DISPLAY_STATS.filter(k=>k!=='mental').map(k=>displayStatValue(profile,k))),mental:profile.stats.mental}})()`);
 assert.ok(r.same&&r.max<=165);assert.equal(r.mental,200);
});

test('later CPU profile corrections cannot rewrite Interhigh clocks and invalidate their finishing order',()=>{
 const r=game()(`(()=>{state.world=Array.from({length:10},(_,i)=>swimmer(i));assignInterhigh();
  const before=JSON.stringify(state.world.map(a=>a.accolades)),books=JSON.stringify(state.recordRankings);
  correctCpuRecordReferences(new Map(state.world.map((a,i)=>[a.id,{deltas:{fr100:i*2,fr50:-i}}])));
  return{awards:before===JSON.stringify(state.world.map(a=>a.accolades)),books:books===JSON.stringify(state.recordRankings)}})()`);
 assert.ok(r.awards&&r.books);
});

test('missing historical opponents cannot turn a weak saved swimmer into an Interhigh champion',()=>{
 const r=game()(`(()=>{state.slot=1;const a=swimmer(0,'fr100',80);state.world=[a];a.accolades=[{competitionId:'interhigh_2026',competition:'全国高校総体',stage:'A_final',season:2026,event:'fr100',rank:1,time:50}];
  const stats=JSON.stringify(a.stats);repairGeneratedInterhighResults();return{main:playerMainResults(a),awards:a.accolades,stats:stats===JSON.stringify(a.stats)}})()`);
 assert.ok(r.stats);assert.deepEqual(r.main,[]);assert.deepEqual(r.awards,[]);
});
