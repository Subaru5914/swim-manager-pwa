const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const source=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const initialization=source.indexOf('document.getElementById("nav").addEventListener');
function game(seed=12345){
  const c=vm.createContext({crypto:{getRandomValues:a=>{a[0]=seed;return a}}});
  vm.runInContext(source.slice(0,initialization),c);
  vm.runInContext('state=createState()',c);
  return code=>JSON.parse(vm.runInContext('JSON.stringify('+code+')',c));
}

test('national CPU top fifties span realistic fields at every distance and use their displayed abilities for races',()=>{
  for(const seed of [12345,54321,5914]){
    const run=game(seed),rows=run(`['university','adult'].flatMap(category=>EVENTS.map(event=>{
      const a=state.world.filter(a=>a.category===category),times=a.map(a=>a.bestTimes[event]).sort((a,b)=>a-b),d=distanceOf(event),bins={},width={50:.25,100:.5,200:1,400:2}[d];
      for(const t of times.slice(0,50))bins[Math.floor(t/width)]=(bins[Math.floor(t/width)]||0)+1;
      const sample=a.filter(p=>!(p.accolades||[]).some(t=>t.event===event)).slice(0,12);
      const clocks=sample.map(p=>{const own=attachMedleyStats(deepClone(p)),saved=JSON.stringify(p);
        state.rngSeed=5914;const cpu=raceTarget(p,event);state.rngSeed=5914;const player=raceTarget(own,event);
        return {same:cpu===player,unchanged:saved===JSON.stringify(p),ratio:p.bestTimes[event]/expectedTime(p,event)};
      });
      return {category,event,d,first:times[0],span:times[49]-times[0],maxBin:Math.max(...Object.values(bins)),clocks};
    }))`);
    for(const row of rows){
      assert.ok(row.span>=({50:.7,100:1.8,200:4,400:9}[row.d])-1e-9,JSON.stringify({seed,...row}));
      if(row.d===200)assert.ok(row.maxBin<=20,JSON.stringify({seed,...row}));
      assert.ok(row.clocks.every(c=>c.same&&c.unchanged&&c.ratio>=.97&&c.ratio<=1.026),JSON.stringify(row));
    }
  }
});

test('old CPU saves retain earned records, own abilities, alumni and recruited swimmers, with stable repeated reloads',()=>{
  const run=game(),r=run(`(()=>{
    const own=JSON.stringify(state.players),signed=state.world.find(a=>a.category==='high'&&a.grade===3);
    signed.scouted=true;state.recruits=[signed.id];
    const alumni=attachMedleyStats({...deepClone(state.players[0]),id:'distribution-alumnus',category:'adult',age:25,alumni:true});state.world.push(alumni);
    const cpu=state.world.find(a=>a.category==='university'),earned=expectedTime(cpu,'fr100')*.985;
    recordIndividualResult(cpu,'fr100',earned,'japan_championship','決勝');
    const historical=state.recordRankings.japan.fr100.map(r=>({id:r.athleteId,time:r.time}));
    delete state.cpuRaceDistributionVersion;delete state.cpuRaceDistributions;
    for(const a of state.world)delete a.cpuRaceDistributionCategory;
    // The recruited/alumni fixtures already carried the marker; emulate an old save consistently.
    const signedOld=JSON.stringify(signed),alumniOld=JSON.stringify(alumni);
    migrateState();const saved=JSON.stringify(state.world),maps=JSON.stringify(state.cpuRaceDistributions),pb=cpu.bestTimes.fr100;
    state=JSON.parse(JSON.stringify(state));migrateState();migrateState();
    const byId=new Map([...state.players,...state.world].map(a=>[a.id,a]));
    return {own:JSON.stringify(state.players)===own,signed:JSON.stringify(byId.get(signed.id))===signedOld,
      alumni:JSON.stringify(byId.get(alumni.id))===alumniOld,once:JSON.stringify(state.world)===saved,maps:JSON.stringify(state.cpuRaceDistributions)===maps,
      earned:pb<=round2(earned)&&byId.get(cpu.id).bestTimes.fr100<=round2(earned),
      historical:historical.every(r=>!byId.has(r.id)||byId.get(r.id).bestTimes.fr100<=r.time),
      titles:state.world.every(a=>a.accolades.every(t=>a.bestTimes[t.event]<=t.time))};
  })()`);
  for(const [key,value] of Object.entries(r))assert.equal(value,true,key);
});

test('category transitions preserve race PBs and apply the distribution once, while year changes never reapply it',()=>{
  const run=game(),r=run(`(()=>{
    const a=state.world.find(a=>a.category==='high'&&a.grade===3&&!a.scouted),time=expectedTime(a,'fr200')*.99;
    recordIndividualResult(a,'fr200',time,'Higashikata CUP','決勝');const own=JSON.stringify(state.players);
    const previousPBs=deepClone(a.bestTimes);
    a.category='university';a.grade=1;a.age=19;a.organization=state.universities[0].name;maintainWorldPopulation();
    const first=JSON.stringify(a),pb=a.bestTimes.fr200;maintainWorldPopulation();
    for(let i=0;i<20;i++){state.season++;maintainWorldPopulation()}
    return {once:JSON.stringify(a)===first,category:a.cpuRaceDistributionCategory,pb:pb<=round2(time)&&EVENTS.every(e=>a.bestTimes[e]<=previousPBs[e]),own:JSON.stringify(state.players)===own};
  })()`);
  assert.ok(r.once&&r.pb&&r.own,JSON.stringify(r));assert.equal(r.category,'university');
});
