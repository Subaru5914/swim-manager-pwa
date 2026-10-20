const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test'),SaveHistory=require('../save-history.js');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(){return vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+`
 state={season:2028,slot:43,rngSeed:12345,playerUniversity:'自大学',players:[],world:[],universities:[],retiredArchive:[],japanTeamHistory:[],meetHistory:[],recordRankings:{},recordBook:{},teamTop10:{},teamPodiumHistory:[]};
 function swimmer(id='rival'){const a=attachMedleyStats({id,name:'他大学泳者',organization:'他大学',category:'university',grade:3,age:21,specialty:'fr100',stats:Object.fromEntries(STATS.map(k=>[k,150])),imAptitude:{speed:0,stamina:0},bestTimes:{},raceHistory:[],accolades:[]});state.world.push(a);return a}
 return code=>JSON.parse(JSON.stringify(eval(code)))`,['SaveHistory'])(SaveHistory)}

test('actual CPU final podiums in the four requested meets are compactly stored, show race-time grade and exclude relays and other meets',()=>{
 const r=game()(`(()=>{const a=swimmer(),stats=JSON.stringify(a.stats),seed=state.rngSeed;
  for(const [i,meet]of RIVAL_PODIUM_MEETS.entries())updateResultHistory(a,EVENTS[i],50+i,meet,'A決勝',i%3+1);
  for(const [meet,stage,event,rank]of [['intercollege','予選','fly100',1],['intercollege','B決勝','br100',1],['teijimayama_championship','A決勝','fr400',1],['world_championship','A決勝','im200',1],['team_trial','記録会','fr100',1],['japan_open','A決勝','4x100fr',1]])recordAthleteMainResult(a,{season:2028,slot:43,meet,stage,event,rank,time:200});
  const rows=rivalMainResults(a),html=rivalMainResultsHtml(a);a.grade++;state.season++;return{rows,html,after:rivalMainResults(a),details:a.raceHistory,stats:stats===JSON.stringify(a.stats),rng:seed===state.rngSeed,stored:a.accolades};
 })()`);
 assert.equal(r.rows.length,4);assert.equal(r.stored.length,4);assert.deepEqual(r.details,[]);assert.ok(r.stats&&r.rng);assert.deepEqual(r.after,r.rows);assert.ok(r.rows.every(row=>row.gradeAtRecord===3&&row.schoolCategory==='university'));
 for(const meet of ['kansai_college','intercollege','japan_open','japan_championship'])assert.ok(r.rows.some(row=>row.meet===meet));assert.match(r.html,/主な実績/);assert.match(r.html,/優勝/);assert.doesNotMatch(r.html,/4x100fr|世界大会|帝嶋山/);
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
