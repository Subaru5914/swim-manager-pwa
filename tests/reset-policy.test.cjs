const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
// All checks use the current game's formulas and reference distributions.
const load=vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+
  '\nreturn code=>JSON.parse(JSON.stringify(eval(code)))',['globalThis']);

for(const seed of [12345,54321,5914,24680])test(`reset policy seed ${seed}: developing roster, real-reference CPU goals and retained earned progress`,t=>{
  const run=load({crypto:{getRandomValues:a=>{a[0]=seed;return a}}});
  const r=run(`(()=>{
    state=createState();migrateState();
    const ordinary=state.players.filter(p=>!p.prodigy),bad=[];
    for(const p of ordinary){
      // Initial own players must not inherit CPU-only ceilings or training rules.
      if(p.cpuDevelopment||p.cpuStatCeilings||p.cpuCompetitionProfileVersion)bad.push(p.id+' CPU metadata');
      if(p.entryAbilityAverage!==round2(overallStatValue(p)))bad.push(p.id+' entry ability');
    }
    for(const a of state.world){
      if(a.cpuDevelopment?.version!==1||a.cpuDevelopment.category!==a.category)bad.push(a.id+' development');
      for(const [i,e]of EVENTS.entries()){
        const floor=a.cpuDevelopment.floors[i],base=expectedTime(a,e),reference=cpuDevelopmentReference(a,e);
        if(!validRaceTime(floor)||floor>base+.015||!reference?.every(validRaceTime))bad.push(a.id+' '+e+' reference');
        if(a.category!=='adult'&&floor<Math.min(base,reference[0]*.995)-.015)bad.push(a.id+' '+e+' upper limit');
      }
    }
    const score=roster=>EVENTS.reduce((s,e)=>s+roster.map(a=>abilityValue(a,e)).sort((a,b)=>b-a).slice(0,3).reduce((x,y)=>x+y,0),0);
    const rosters=state.universities.map(u=>state.world.filter(a=>a.category==='university'&&a.organization===u.name));
    const depthRank=1+rosters.filter(r=>score(r)>score(state.players)).length;
    const relayRanks=RELAYS.map(kind=>{const own=expectedRelayTime(bestRelayMembers(state.players,kind,false),kind);return 1+rosters.filter(r=>expectedRelayTime(bestRelayMembers(r,kind,false),kind)<own).length});
    const summary={reputation:state.reputation,label:reputationLabel(state.reputation),count:state.players.length,
      classes:[1,2,3,4].map(y=>state.players.filter(p=>p.year===y).length),
      ordinary:ordinary.length,ordinaryMean:ordinary.reduce((s,p)=>s+overallStatValue(p),0)/ordinary.length,
      depthRank,relayRanks,prodigies:state.players.filter(p=>p.prodigy).length};
    // A reload may never apply the new starting-roster limit to earned players.
    state.reputation=310;state.players[0].stats.fr_speed=175;state.players[0].stats.fr_stamina=170;
    const snapshot=JSON.stringify([state.players,state.world]),seed=state.rngSeed;
    state=JSON.parse(JSON.stringify(state));migrateState();
    return{...summary,bad,reloadStable:snapshot===JSON.stringify([state.players,state.world])&&seed===state.rngSeed,reputationAfterLoad:state.reputation};
  })()`);
  assert.deepEqual(r.bad,[]);
  assert.equal(r.reputation,35);assert.equal(r.label,'発展途上');assert.equal(r.count,32);assert.deepEqual(r.classes,[8,8,8,8]);
  for(const rank of [r.depthRank,...r.relayRanks])assert.ok(rank>=30&&rank<=40,JSON.stringify(r));
  assert.ok(r.reloadStable);assert.equal(r.reputationAfterLoad,310);
  t.diagnostic(JSON.stringify({seed,ordinary:r.ordinary,ordinaryMean:r.ordinaryMean,depthRank:r.depthRank,relayRanks:r.relayRanks,prodigies:r.prodigies}));
});
