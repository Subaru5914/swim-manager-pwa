const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),cp=require('node:child_process');
const {test}=require('node:test');
const repo=path.join(__dirname,'..'),html=fs.readFileSync(path.join(repo,'index.html'),'utf8');
function game(input=html,seed=12345){
 const source=input.match(/<script>([\s\S]*?)<\/script>/)[1];
 return vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+`
 function sample(id,value=150){return attachMedleyStats({id,name:id,category:'adult',age:24,organization:'検証クラブ',specialty:'fr100',retired:false,stats:Object.fromEntries(STATS.map(k=>[k,value])),bestTimes:{},potentialType:'normal',growthProfile:{1:1,2:1,3:1,4:1},accolades:[],raceHistory:[]})}
 function unreachablePBs(){const errors=[];for(const a of [...state.players,...state.world])for(const e of EVENTS){const pb=a.bestTimes?.[e],d=distanceOf(e),base=expectedTime(a,e),fastest=base+Math.min(...MEET_FORM_TIME_RANGES[d].map(r=>r[0]))-RACE_EXECUTION_RANGE[d];if(validRaceTime(pb)&&pb<fastest-.025)errors.push({id:a.id,e,pb,base})}return errors}
 return code=>JSON.parse(JSON.stringify(eval(code)))`,['globalThis'])({crypto:{getRandomValues:a=>{a[0]=seed;return a}}});
}
test('existing v2.25 swimmers keep every PB and record while excessive starts are reduced once and remain race-reachable',()=>{
 const old=game(cp.execFileSync('git',['show','d1da09e:index.html'],{cwd:repo,encoding:'utf8',maxBuffer:2000000}));
 const legacy=old('(state=createState(),migrateState(),deepClone(state))'),run=game();run('state='+JSON.stringify(legacy)+';trimGraduatingCohort();true');
 const before=run('deepClone(state)');run('migrateState();true');
 const result=run(`(()=>{const saved=JSON.stringify(state),seed=state.rngSeed;migrateState();return{state:deepClone(state),stable:saved===JSON.stringify(state)&&seed===state.rngSeed,bad:unreachablePBs()}})()`);
 assert.ok(result.stable);assert.deepEqual(result.bad,[]);
 for(const key of ['rngSeed','season','slot','points','reputation','playerUniversity','facilities','trainingFocus','trainingPlans','teamTop10','recordRankings','recordBook','recruits','japanTeamHistory'])assert.deepEqual(result.state[key],before[key],key);
 let reduced=0;for(const group of ['players','world']){
  assert.equal(result.state[group].length,before[group].length);
  result.state[group].forEach((a,i)=>{const b=before[group][i];assert.equal(a.id,b.id);assert.equal(a.startBalanceVersion,1);assert.ok(a.stats.start<=b.stats.start);reduced+=a.stats.start<b.stats.start;
   for(const key of ['bestTimes','imAptitude','name','specialty','organization','category','age','grade','year','accolades','raceHistory'])assert.deepEqual(a[key],b[key],a.id+' '+key);
   for(const key of Object.keys(b.stats).filter(k=>k!=='start'))assert.ok(a.stats[key]>=b.stats[key]-.0001,a.id+' '+key);
  });
 }
 assert.ok(reduced>2000);const cpu=result.state.world;assert.ok(cpu.filter(a=>a.stats.start>=151).length<cpu.length*.04);
 // Training after the upgrade must never trigger another downward correction.
 const retained=run(`(()=>{state.players[0].stats.start=180;const before=JSON.stringify(state.players[0].stats);migrateState();return before===JSON.stringify(state.players[0].stats)})()`);assert.ok(retained);
});
test('PB repair and profile solvers improve swimming abilities without repeatedly inflating a start',()=>{
 const run=game(),r=run(`(()=>{
  state={season:2026,rngSeed:5914,players:[],world:[],recruits:[]};const a=sample('repair',165);a.stats.start=180;
  for(const e of EVENTS)a.bestTimes[e]=coherentCpuPB(a,e);const pbs=JSON.stringify(a.bestTimes);balanceStartAbility(a);const start=a.stats.start;
  restoreAthletePaceFromPB(a);for(const e of EVENTS)calibrateToTime(a,e,expectedTime(a,e)*.998,200);
  fitCpuAbility(a,['fr100'],['fr_speed','fr_stamina','fr_turn','start'],175,200);calibrateWorldAthlete(a,'ba100',54);
  const stable=a.stats.start===start;balanceStartAbility(a);state.world=[a];return{stable,start,after:a.stats.start,pbs:pbs===JSON.stringify(a.bestTimes),bad:unreachablePBs()};
 })()`);assert.ok(r.stable&&r.pbs);assert.equal(r.after,r.start);assert.deepEqual(r.bad,[]);
});
test('start correction covers current representatives and foreign swimmers and keeps its marker through recruiting and graduation',()=>{
 const run=game(),r=run(`(()=>{
  state={season:2026,rngSeed:5914,playerUniversity:'自大学',players:[],world:[],trainingFocus:{}};
  const p=sample('own'),cpu=sample('cpu'),foreign=sample('foreign');p.year=4;p.organization=state.playerUniversity;cpu.category='high';cpu.grade=3;cpu.age=18;
  [p,cpu,foreign].forEach(a=>a.stats.start=175);state.players=[p];state.world=[cpu];state.internationalWorld={athletes:[foreign]};state.japanTeam={athletes:[{id:p.id,snapshot:deepClone(p)}]};migrateStartAbilities();
  const first=JSON.stringify([p,cpu,foreign,state.japanTeam]),goals=[p,cpu,foreign].map(a=>a.stats.start);migrateStartAbilities();
  const entrant=worldToPlayer(cpu),graduate=alumniAdultFromPlayer(p,'社会人チーム'),before=[entrant.stats.start,graduate.stats.start];state.players=[entrant];state.world=[graduate];migrateStartAbilities();
  return{stable:first===JSON.stringify([p,cpu,foreign,state.japanTeam]),goals,snapshot:state.japanTeam.athletes[0].snapshot.stats.start,converted:before[0]===entrant.stats.start&&before[1]===graduate.stats.start,markers:[entrant.startBalanceVersion,graduate.startBalanceVersion]};
 })()`);assert.ok(r.stable&&r.converted);assert.ok(r.goals.every(v=>v<175));assert.equal(r.snapshot,r.goals[0]);assert.deepEqual(r.markers,[1,1]);
});
for(const seed of [12345,54321])test(`new game/reset seed ${seed} limits high starts across every category and preserves reachable PBs and reloads`,t=>{
 const run=game(html,seed),r=run(`(()=>{
  state=createState();migrateState();const bad=unreachablePBs(),distribution=Object.fromEntries(['own','middle','high','university','adult'].map(c=>{const roster=c==='own'?state.players:state.world.filter(a=>a.category===c),values=roster.map(a=>a.stats.start).sort((a,b)=>a-b);return[c,{n:values.length,median:values[Math.floor(values.length/2)],max:values.at(-1),A:values.filter(v=>v>=151).length,S:values.filter(v=>v>=176).length}]}));
  const ids=state.players.map(a=>a.id),before=JSON.stringify(state),seed=state.rngSeed;migrateState();const stable=before===JSON.stringify(state)&&seed===state.rngSeed;
  newSeason();const classBefore=JSON.stringify(state.players.map(a=>[a.id,a.stats.start]));migrateState();
  return{bad,distribution,stable,afterApril:classBefore===JSON.stringify(state.players.map(a=>[a.id,a.stats.start])),firstYears:state.players.filter(a=>a.year===1).length,markers:[...state.players,...state.world].every(a=>a.startBalanceVersion===1)};
 })()`);assert.deepEqual(r.bad,[]);assert.ok(r.stable&&r.afterApril&&r.markers);assert.equal(r.firstYears,8);
 for(const d of Object.values(r.distribution)){assert.ok(d.A<d.n*.04);assert.equal(d.S,0)}t.diagnostic(JSON.stringify(r.distribution));
});
