const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),cp=require('node:child_process');
const {test}=require('node:test');
const repo=path.join(__dirname,'..'),current=fs.readFileSync(path.join(repo,'index.html'),'utf8');
const previous=cp.execFileSync('git',['show','8bf04bd:index.html'],{cwd:repo,encoding:'utf8',maxBuffer:2000000});
function game(input=current){
 const source=input.match(/<script>([\s\S]*?)<\/script>/)[1];
 return vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+`
  state={season:2026,slot:1,rngSeed:5914,players:[],world:[],playerUniversity:'自大学',universities:[{name:'検証大学',reputation:350}],facilities:Object.fromEntries(STATS.map(k=>[k,100])),trainingFocus:{}};
  function swimmer(value=100,year=1){return attachMedleyStats({id:'probe',name:'検証選手',year,specialty:'fr100',stats:Object.fromEntries(STATS.map(k=>[k,value])),imAptitude:{speed:0,stamina:0},bestTimes:{fr100:55},growthProfile:{1:1,2:1,3:1,4:1}})}
  return code=>JSON.parse(JSON.stringify(eval(code)));`,[])();
}

test('own diminishing returns are continuous and monotone through every rank, while the CPU curve remains exact',()=>{
 const run=game(),old=game(previous);
 const r=run(`(()=>{let previous=Infinity,errors=[];for(let i=0;i<=20000;i++){
  const value=i/100,m=playerStatGrowthMultiplier(value);if(m<0||m>1||m>previous+1e-12)errors.push(value);previous=m;
 }return{errors,edges:[-1,0,50,75,100,125,150,175,188,200,201].map(v=>[v,playerStatGrowthMultiplier(v)]),cpu:Array.from({length:20001},(_,i)=>statGrowthMultiplier(i/100))}})()`);
 assert.deepEqual(r.errors,[]);
 for(const [i,[value,expected]]of [[-1,1],[0,1],[50,1],[75,.65],[100,.42],[125,.291],[150,.102],[175,.035],[188,.003],[200,0],[201,0]].entries())assert.ok(Math.abs(r.edges[i][1]-expected)<1e-12,'ability '+value);
 assert.deepEqual(r.cpu,old('Array.from({length:20001},(_,i)=>statGrowthMultiplier(i/100))'));
});

test('the monthly C/B targets apply to every trainable ability without changing PBs or the focus',()=>{
 const r=game()(`(()=>{rng=()=>.99;return [125,150].flatMap(value=>STATS.map(stat=>{
  const p=swimmer(value);state.players=[p];state.trainingFocus.probe=[stat];const pb=JSON.stringify(p.bestTimes);
  for(let turn=0;turn<8;turn++)applyPlayerTraining(p,{expected:true});
  return{value,stat,gain:round2(p.stats[stat]-value),pb:pb===JSON.stringify(p.bestTimes),focus:state.trainingFocus.probe,unrelated:STATS.filter(k=>k!==stat).every(k=>p.stats[k]===value)};
 }))})()`);
 for(const row of r){assert.ok(Math.abs(row.gain-(row.value===125?8:3))<.1,JSON.stringify(row));assert.ok(row.pb&&row.unrelated);assert.deepEqual(row.focus,[row.stat])}
});

test('facility, hidden growth type, camp and double meet awards still scale the same expected practice',()=>{
 const r=game()(`(()=>{const rows=[];rng=()=>.99;
  for(const value of [60,100,125,150,175])for(const facility of [0,25,50,75,100])for(const type of Object.keys(PLAYER_GROWTH_TYPES))for(const year of [1,4])for(const [camp,multiplier]of [[1,1],[1.35,1],[1,2]]){
   const p=swimmer(value,year);p.growthProfile=PLAYER_GROWTH_TYPES[type].profile;state.players=[p];state.trainingFocus.probe=['mental'];state.facilities.mental=facility;
   applyPlayerTraining(p,{camp,multiplier,expected:true,precise:true});
   const expected=round2(value+1.93*1.22*1.01*playerStatGrowthMultiplier(value)*facilityGrowthMultiplier(facility)*p.growthProfile[year]*camp*multiplier);
   if(p.stats.mental!==expected)rows.push({value,facility,type,year,camp,multiplier,actual:p.stats.mental,expected});
  }return rows})()`);
 assert.deepEqual(r,[]);
});

test('secondary practice uses the reduced own curve and untrained IM abilities remain derived from the four strokes',()=>{
 const r=game()(`(()=>{rng=()=>.1;const p=swimmer();p.stats.fr_stamina=125;p.stats.fr_turn=150;state.players=[p];state.trainingFocus.probe=['fr_speed'];
  const before=[p.stats.im_speed,p.stats.im_stamina];applyPlayerTraining(p,{expected:true,precise:true});
  return{speed:p.stats.fr_speed,stamina:p.stats.fr_stamina,turn:p.stats.fr_turn,before,after:[p.stats.im_speed,p.stats.im_stamina],derived:[medleyStatValue(p,'speed'),medleyStatValue(p,'stamina')]};
 })()`);
 assert.equal(r.speed,101.6);assert.equal(r.stamina,125.12);assert.equal(r.turn,150);
 assert.deepEqual(r.after,r.derived);assert.ok(r.after.every((v,i)=>v>r.before[i]));
});

test('CPU practice, carry, decline and random draws stay identical to v2.33 across all categories and ranks',()=>{
 const exercise=`(()=>{
  state.world=['middle','high','university','adult'].flatMap(category=>[60,80,100,125,150,175].map((value,i)=>{
   const a=swimmer(value);delete a.year;Object.assign(a,{id:category+value,category,grade:i%3+1,age:category==='adult'?23+i:category==='middle'?13+i%3:category==='high'?16+i%3:19+i%3,organization:'検証大学',specialty:i%2?'im200':'fr100',growthProfile:[1,.72,.9,1.18,1.32],cpuStatCeilings:Object.fromEntries(STATS.map(k=>[k,200]))});
   a.bestTimes=Object.fromEntries(EVENTS.map(e=>[e,coherentCpuPB(a,e)]));return a;
  }));
  for(let turn=0;turn<96;turn++)for(const a of state.world)applyCpuTraining(a);
  return{world:state.world,seed:state.rngSeed};
 })()`;
 const old=game(previous)(exercise),actual=game()(exercise);assert.deepEqual(actual,old);
 assert.ok(actual.world.some(a=>a.category==='high'&&a.stats.fr_speed>125));
});
