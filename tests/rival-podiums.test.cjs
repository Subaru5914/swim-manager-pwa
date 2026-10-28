const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test'),SaveHistory=require('../save-history.js');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(){return vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+`
 state={season:2028,slot:43,rngSeed:12345,playerUniversity:'自大学',players:[],world:[],universities:[],retiredArchive:[],japanTeamHistory:[],meetHistory:[],recordRankings:{},recordBook:{},teamTop10:{},teamPodiumHistory:[]};
 function swimmer(id='rival'){const a=attachMedleyStats({id,name:'他大学泳者',organization:'他大学',category:'university',grade:3,age:21,specialty:'fr100',stats:Object.fromEntries(STATS.map(k=>[k,150])),imAptitude:{speed:0,stamina:0},bestTimes:{},raceHistory:[],accolades:[]});state.world.push(a);return a}
 return code=>JSON.parse(JSON.stringify(eval(code)))`,['SaveHistory'])(SaveHistory)}

test('actual CPU final podiums including Spring Kansai are compactly stored, show race-time grade and exclude relays and other meets',()=>{
 const r=game()(`(()=>{const a=swimmer(),stats=JSON.stringify(a.stats),seed=state.rngSeed;
  for(const [i,meet]of RIVAL_PODIUM_MEETS.entries())updateResultHistory(a,EVENTS[i],50+i,meet,'A決勝',i%3+1);
  for(const [meet,stage,event,rank]of [['intercollege','予選','fly100',1],['intercollege','B決勝','br100',1],['teijimayama_championship','A決勝','fr400',1],['world_championship','A決勝','im200',1],['team_trial','記録会','fr100',1],['japan_open','A決勝','4x100fr',1]])recordAthleteMainResult(a,{season:2028,slot:43,meet,stage,event,rank,time:200});
  const rows=rivalMainResults(a),html=rivalMainResultsHtml(a);a.grade++;state.season++;return{rows,html,after:rivalMainResults(a),details:a.raceHistory,stats:stats===JSON.stringify(a.stats),rng:seed===state.rngSeed,stored:a.accolades};
 })()`);
 assert.equal(r.rows.length,5);assert.equal(r.stored.length,5);assert.deepEqual(r.details,[]);assert.ok(r.stats&&r.rng);assert.deepEqual(r.after,r.rows);assert.ok(r.rows.every(row=>row.gradeAtRecord===3&&row.schoolCategory==='university'));
 for(const meet of ['spring_kansai','kansai_college','intercollege','japan_open','japan_championship'])assert.ok(r.rows.some(row=>row.meet===meet));assert.match(r.html,/主な実績/);assert.match(r.html,/春季関西選手権/);assert.match(r.html,/優勝/);assert.doesNotMatch(r.html,/4x100fr|世界大会|帝嶋山/);
});

test('Spring Kansai individual A-final podiums appear for both teams; prelims, B-finals and corrected fourth places stay excluded',()=>{
 const r=game()(`(()=>{state.slot=16;const own=swimmer('own'),cpu=swimmer();own.organization=state.playerUniversity;own.year=2;delete own.grade;state.players=[own];state.world=state.world.filter(a=>a!==own);
  for(const a of [own,cpu]){
   updateResultHistory(a,'fr50',25.55,'spring_kansai','A決勝',2);
   updateResultHistory(a,'ba50',28.88,'spring_kansai','予選',1);
   updateResultHistory(a,'br50',31.11,'spring_kansai','B決勝',1);
  }
  const ownRows=playerMainResults(own),cpuRows=rivalMainResults(cpu),ownHtml=detailMainResultsHtml(own,true),cpuHtml=rivalMainResultsHtml(cpu);
  updateResultHistory(cpu,'fr50',25.66,'spring_kansai','A決勝',4);
  return{ownRows,cpuRows,ownHtml,cpuHtml,corrected:rivalMainResults(cpu)};
 })()`);
 assert.equal(r.ownRows.length,1);assert.equal(r.cpuRows.length,1);
 for(const rows of [r.ownRows,r.cpuRows])assert.deepEqual(rows.map(h=>[h.meet,h.event,h.rank,h.time,h.schoolCategory]),[['spring_kansai','fr50',2,25.55,'university']]);
 assert.equal(r.ownRows[0].gradeAtRecord,2);assert.equal(r.cpuRows[0].gradeAtRecord,3);
 for(const html of [r.ownHtml,r.cpuHtml]){assert.match(html,/春季関西選手権/);assert.match(html,/2位/);assert.doesNotMatch(html,/data-(?:main|rival-podium)-event="(?:ba50|br50)"/)}
 assert.deepEqual(r.corrected,[]);
});

test('saved Spring Kansai podium summaries restore missing rival awards once without changing existing medals, PBs, abilities or RNG',()=>{
 const run=game(),r=run(`(()=>{const a=swimmer();state.slot=17;a.bestTimes.fr50=25.55;
  recordAthleteMainResult(a,{season:2027,slot:43,meet:'intercollege',event:'fr100',stage:'A決勝',rank:3,time:54});
  const existing=JSON.stringify(a.accolades),protectedData=JSON.stringify([a.stats,a.bestTimes,state.rngSeed]);
  state.meetHistory=[{season:2028,slot:16,meet:'spring_kansai',podiums:{
   fr50:[{athleteId:a.id,name:a.name,organization:a.organization,rank:2,time:25.55,schoolCategory:'university',gradeAtRecord:3}],
   ba50:[{athleteId:'unknown-id',name:a.name,organization:a.organization,rank:1,time:28}],
   br50:[{athleteId:a.id,name:a.name,organization:a.organization,rank:4,time:30}],
   fly50:[{athleteId:a.id,name:a.name,organization:a.organization,rank:1,time:27,stage:'予選'}]
  }}];
  restoreRivalMainResults();const saved=JSON.stringify(state);restoreRivalMainResults();
  return{saved,stable:saved===JSON.stringify(state),rows:rivalMainResults(a),existing:existing===JSON.stringify(a.accolades.filter(h=>h.meet!=='spring_kansai')),protected:protectedData===JSON.stringify([a.stats,a.bestTimes,state.rngSeed])};
 })()`);
 assert.ok(r.stable&&r.existing&&r.protected);assert.equal(r.rows.length,2);assert.deepEqual(r.rows.find(h=>h.meet==='spring_kansai'),{kind:'podium',season:2028,slot:16,meet:'spring_kansai',event:'fr50',stage:'決勝',rank:2,time:25.55,schoolCategory:'university',gradeAtRecord:3});
 const restored=game()(`(()=>{state=${r.saved};const before=JSON.stringify(state);restoreRivalMainResults();return{stable:before===JSON.stringify(state),rows:rivalMainResults(state.world[0])}})()`);
 assert.ok(restored.stable);assert.deepEqual(restored.rows,r.rows);
});

test('a corrected fourth place removes the former podium and tied podiums retain each swimmer identity in meet summaries',()=>{
 const r=game()(`(()=>{const a=swimmer(),b=swimmer('other');b.name='同着泳者';
  updateResultHistory(a,'fr100',51,'intercollege','A決勝',3);const first=rivalMainResults(a).length;
  updateResultHistory(a,'fr100',52,'intercollege','A決勝',4);
  const rows=assignRaceRanks([{athlete:a,race:{total:50}},{athlete:b,race:{total:50}}]),podiums=racePodiums(rows);
  return{first,removed:rivalMainResults(a).length,podiums};
 })()`);
 assert.equal(r.first,1);assert.equal(r.removed,0);assert.deepEqual(r.podiums.map(p=>p.rank),[1,1]);assert.deepEqual(r.podiums.map(p=>p.athleteId),['rival','other']);assert.ok(r.podiums.every(p=>p.gradeAtRecord===3));
});

test('legacy summaries restore only identifiable individual podiums, reject old namesakes and unknown IDs, and do not mutate PBs or RNG',()=>{
 const r=game()(`(()=>{const a=swimmer(),b=swimmer('new-freshman');b.grade=1;b.name='新入生';a.bestTimes.fr100=51;const before=JSON.stringify([a.stats,a.bestTimes,b.stats,b.bestTimes]),seed=state.rngSeed;
  const meet=(season,meet,event,row)=>({season,slot:43,meet,podiums:{[event]:[row]}});
  state.meetHistory=[meet(2027,'intercollege','fr100',{name:a.name,organization:a.organization,time:52,rank:2}),
   meet(2028,'japan_open','ba100',{athleteId:a.id,name:'旧氏名',organization:'旧大学',time:57,rank:3,schoolCategory:'university',gradeAtRecord:3}),
   meet(2023,'intercollege','fr200',{name:a.name,organization:a.organization,time:120,rank:1}),
   meet(2027,'intercollege','fr200',{name:b.name,organization:b.organization,time:120,rank:1}),
   meet(2028,'japan_championship','br100',{athleteId:'wrong-id',name:a.name,organization:a.organization,time:64,rank:1}),
   meet(2028,'intercollege','4x100fr',{athleteId:a.id,name:a.name,organization:a.organization,time:205,rank:1})];
  restoreRivalMainResults();const first=JSON.stringify(state);restoreRivalMainResults();return{rows:rivalMainResults(a),fresh:rivalMainResults(b),stable:first===JSON.stringify(state),protected:before===JSON.stringify([a.stats,a.bestTimes,b.stats,b.bestTimes])&&seed===state.rngSeed};
 })()`);
 assert.equal(r.rows.length,2);assert.deepEqual(r.fresh,[]);assert.ok(r.stable&&r.protected);assert.equal(r.rows.find(h=>h.event==='fr100').gradeAtRecord,2);assert.equal(r.rows.find(h=>h.event==='ba100').gradeAtRecord,3);
});

test('capacity cleanup retains compact CPU podiums after old detailed histories and unrelated summaries are removed; viewing is read only',()=>{
 const r=game()(`(()=>{const a=swimmer();state.season=2038;state.slot=43;a.grade=3;
  recordAthleteMainResult(a,{season:2030,slot:43,meet:'intercollege',event:'fr100',stage:'A決勝',rank:1,time:51,schoolCategory:'university',gradeAtRecord:2});
  a.raceHistory=Array.from({length:12},()=>({season:2030,slot:43,meet:'intercollege',event:'fr200',stage:'予選',time:120}));
  state.meetHistory=[{season:2030,slot:43,meet:'intercollege',podiums:{},padding:'x'.repeat(10000)}];
  const protectedData=JSON.stringify([a.stats,a.bestTimes,a.accolades]),plan=SaveHistory.plan(state,{triggerBytes:1,targetBytes:1});plan.apply(state);
  const before=JSON.stringify(state),html=rivalMainResultsHtml(a);return{removed:plan.removed,history:a.raceHistory.length,rows:rivalMainResults(a),protected:protectedData===JSON.stringify([a.stats,a.bestTimes,a.accolades]),readonly:before===JSON.stringify(state),html};
 })()`);
 assert.ok(r.removed>0&&r.protected&&r.readonly);assert.equal(r.history,0);assert.equal(r.rows.length,1);assert.match(r.html,/51.00/);
});
