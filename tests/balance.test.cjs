const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// Exercise the same functions shipped in the standalone HTML, without a DOM.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const initialization = source.indexOf('document.getElementById("nav").addEventListener');
assert.ok(initialization > 0);

function game(seed = 12345) {
  const context = vm.createContext({
    crypto: { getRandomValues: array => { array[0] = seed; return array; } },
  });
  vm.runInContext(source.slice(0, initialization), context);
  const run = code => vm.runInContext(code, context);
  run('state=createState()');
  return run;
}

test('existing CPU cohorts advance through twelve full seasons without replacements or ability inflation',()=>{
  const run=game();
  const samples=JSON.parse(run(`JSON.stringify((()=>{
    const samples=[],admissions=[],snapshot=()=>{
      const cpu=state.world.filter(a=>a.category==='university'),values=cpu.map(overallStatValue).sort((a,b)=>a-b);
      const sizes=state.universities.flatMap(u=>[1,2,3,4].map(grade=>cpu.filter(a=>a.organization===u.name&&a.grade===grade).length));
      return {season:state.season,count:cpu.length,expected:admissions.length?admissions.slice(-4).reduce((s,n)=>s+n,0):state.universities.length*20,sizes,
        mean:values.reduce((a,b)=>a+b)/values.length,p90:values[Math.floor(values.length*.9)],
        reputationBound:state.universities.every(u=>Math.abs(u.reputation-u.baseReputation)<=25.01)};
    };
    samples.push(snapshot());
    for(let year=1;year<=12;year++){
      for(let turn=0;turn<96;turn++){state.slot=turn+1;trainCommand()}
      for(const meet of ['kansai_college','intercollege']){
        const entries=buildCpuCollegeEntries(meet),byId=new Map(state.world.map(a=>[a.id,a]));
        completeMeet({meet,season:state.season,events:Object.fromEntries(EVENTS.map(e=>[e,{prelim:entries[e].map(id=>({source:'CPU',athlete:byId.get(id)}))}])),relays:[]});
      }
      admissions.push(state.world.filter(a=>a.category==='high'&&a.grade===3&&!a.retired).length-8);
      newSeason();
      if(year%4===0)samples.push(snapshot());
    }
    return samples;
  })())`));
  for(const sample of samples){
    assert.equal(sample.count,sample.expected,JSON.stringify(sample));
    assert.ok(sample.sizes.every(n=>n>=0&&n<=5));assert.equal(sample.reputationBound,true);
    assert.ok(Math.abs(sample.mean-samples[0].mean)<4,JSON.stringify(sample));
    assert.ok(Math.abs(sample.p90-samples[0].p90)<5,JSON.stringify(sample));
  }
});

test('CPU individuals vary within one team and the new legacy spread preserves players, alumni and title records once',()=>{
  const run=game();
  const result=JSON.parse(run(`JSON.stringify((()=>{
    let used=new Set(),sample=Array.from({length:80},()=>makeAthlete('university','同じ大学',used,20,2,82));
    let values=sample.map(overallStatValue),mean=values.reduce((a,b)=>a+b)/values.length;
    let own=JSON.stringify(state.players),alumni={...deepClone(state.players[0]),id:'preserved-alumni',category:'adult',age:26,alumni:true};
    state.world.push(alumni);let savedAlumni=JSON.stringify(alumni);
    for(let a of state.world.filter(a=>a.category==='university')){
      delete a.cpuCompetitionProfileVersion;delete a.cpuCompetitionCategory;
      a.stats=Object.fromEntries(STATS.map(k=>[k,120]));a.bestTimes=Object.fromEntries(EVENTS.map(e=>[e,expectedTime(a,e)]));
    }
    state.cpuDiversityVersion=1;migrateState();
    let first=JSON.stringify(state.world),cpu=state.world.filter(a=>a.category==='university').map(overallStatValue);
    let cpuMean=cpu.reduce((a,b)=>a+b)/cpu.length;
    let titlesValid=state.world.every(a=>(a.accolades||[]).every(t=>!EVENTS.includes(t.event)||!Number.isFinite(t.time)||a.bestTimes[t.event]<=t.time));
    migrateState();
    return {sampleSD:Math.sqrt(values.reduce((s,v)=>s+(v-mean)**2,0)/values.length),
      legacySD:Math.sqrt(cpu.reduce((s,v)=>s+(v-cpuMean)**2,0)/cpu.length),
      ownPreserved:JSON.stringify(state.players)===own,alumniPreserved:JSON.stringify(state.world.find(a=>a.id===alumni.id))===savedAlumni,
      once:first===JSON.stringify(state.world),titlesValid};
  })())`));
  assert.ok(result.sampleSD>8,JSON.stringify(result));assert.ok(result.legacySD>4,JSON.stringify(result));
  assert.ok(result.ownPreserved&&result.alumniPreserved&&result.once&&result.titlesValid,JSON.stringify(result));
});

test('new CPU swimmers spread across every event even within one university and grade',()=>{
  for(const seed of [12345,54321,5914]){
    const run=game(seed);
    const result=JSON.parse(run(`JSON.stringify((()=>{
      const used=new Set(),athletes=Array.from({length:200},()=>makeAthlete('university','同学年の大学',used,20,2,82));
      const deviation=values=>{let mean=values.reduce((s,v)=>s+v,0)/values.length;return Math.sqrt(values.reduce((s,v)=>s+(v-mean)**2,0)/values.length)};
      return{abilities:deviation(athletes.map(overallStatValue)),events:EVENTS.map(e=>({e,relativeSD:deviation(athletes.map(a=>expectedTime(a,e)))/INTERCOLLEGE_A_FINAL_REFERENCE[e]}))};
    })())`));
    assert.ok(result.abilities>13,JSON.stringify({seed,...result}));
    for(const row of result.events)assert.ok(row.relativeSD>.014,JSON.stringify({seed,...row}));
  }
});

test('v2 CPU saves gain event differences once while player, alumni, awards and historical records remain intact',()=>{
  const run=game();
  const result=JSON.parse(run(`JSON.stringify((()=>{
    const own=JSON.stringify(state.players),records=JSON.stringify(state.recordRankings),titles=JSON.stringify(state.world.flatMap(a=>a.accolades));
    const alumni={...deepClone(state.players[0]),id:'v3-preserved-alumni',category:'adult',age:26,alumni:true};state.world.push(alumni);const savedAlumni=JSON.stringify(alumni);
    const cpu=state.world.filter(a=>a.category==='university');
    for(const a of cpu){
      delete a.cpuCompetitionProfileVersion;delete a.cpuCompetitionCategory;
      delete a.cpuIndividualProfileVersion;
      a.stats=Object.fromEntries(STATS.map(k=>[k,120]));a.cpuStatCeilings=Object.fromEntries(STATS.map(k=>[k,170]));
      a.bestTimes=Object.fromEntries(EVENTS.map(e=>[e,round2(expectedTime(a,e,true))]));
    }
    delete cpu[0].specialty;
    state.cpuDiversityVersion=2;migrateState();
    const first=JSON.stringify(state.world),profiles=cpu.every(a=>a.cpuIndividualProfileVersion===1);
    const eventSpreads=EVENTS.map(e=>{const times=cpu.map(a=>expectedTime(a,e)),mean=times.reduce((s,v)=>s+v,0)/times.length;return{e,relativeSD:Math.sqrt(times.reduce((s,v)=>s+(v-mean)**2,0)/times.length)/mean}});
    const titlesValid=state.world.every(a=>(a.accolades||[]).every(t=>!EVENTS.includes(t.event)||!Number.isFinite(t.time)||a.bestTimes[t.event]<=t.time));
    migrateState();return{version:state.cpuDiversityVersion,profiles,eventSpreads,titlesValid,once:JSON.stringify(state.world)===first,
      own:JSON.stringify(state.players)===own,alumni:JSON.stringify(state.world.find(a=>a.id===alumni.id))===savedAlumni,
      records:JSON.stringify(state.recordRankings)===records,titles:JSON.stringify(state.world.filter(a=>!a.alumni).flatMap(a=>a.accolades))===titles};
  })())`));
  assert.equal(result.version,5);assert.ok(result.profiles&&result.once&&result.own&&result.alumni&&result.records&&result.titles&&result.titlesValid,JSON.stringify(result));
  for(const row of result.eventSpreads)assert.ok(row.relativeSD>.012,JSON.stringify(row));
});

test('late-A ability differences affect every event while sprint and distance CPU specialties stay distinct',()=>{
  const run=game();
  const result=JSON.parse(run(`JSON.stringify((()=>{
    const time=(e,value)=>expectedTime({stats:Object.fromEntries(STATS.map(k=>[k,value]))},e);
    const rows=EVENTS.map(e=>({e,portion:(time(e,167)-time(e,175))/(time(e,163)-time(e,175))}));
    const athlete={id:'cpu-distance-profile',stats:Object.fromEntries(STATS.map(k=>[k,113])),cpuStatCeilings:Object.fromEntries(STATS.map(k=>[k,170]))};
    const short={...deepClone(athlete),specialty:'fr50'},long={...deepClone(athlete),specialty:'fr400'};
    diversifyCpuIndividual(short);diversifyCpuIndividual(long);
    return{rows,sprint:[expectedTime(short,'fr50'),expectedTime(long,'fr50')],distance:[expectedTime(short,'fr400'),expectedTime(long,'fr400')]};
  })())`));
  for(const row of result.rows)assert.ok(row.portion>.6,JSON.stringify(row));
  assert.ok(result.sprint[0]<result.sprint[1]);assert.ok(result.distance[0]>result.distance[1]);
});

test('initial teammates have visibly different overall abilities within the same grade',()=>{
  let spreads=[],deviations=[];
  for(const seed of [12345,20261008,816,5914,314159,987654]){
    const run=game(seed);
    const classes=JSON.parse(run(`JSON.stringify([1,2,3,4].map(year=>state.players.filter(p=>p.year===year&&!p.prodigy).map(overallStatValue)))`));
    for(const means of classes){
      assert.ok(means.length>=5);
      const average=means.reduce((a,b)=>a+b)/means.length;
      spreads.push(Math.max(...means)-Math.min(...means));
      deviations.push(Math.sqrt(means.reduce((sum,v)=>sum+(v-average)**2,0)/means.length));
    }
  }
  assert.ok(deviations.reduce((a,b)=>a+b)/deviations.length>=7);
  assert.ok(spreads.filter(spread=>spread>=20).length>=spreads.length*.7);
});

test('all 15 events use C/B/A/S benchmarks and improve continuously with ability', () => {
  const run = game();
  const rows = JSON.parse(run(`JSON.stringify(EVENTS.map(event => {
    const time = value => expectedTime({stats:Object.fromEntries(STATS.map(k=>[k,value]))},event);
    return {event,C:time(113),Cref:KANSAI_COLLEGE_WIN_TARGET[event]*1.02,
      B:time(138),Bref:INTERCOLLEGE_A_FINAL_REFERENCE[event],A:time(163),
      S:time(188),record:JAPAN_RECORD[event],times:Array.from({length:201},(_,v)=>time(v))};
  }))`));
  assert.equal(rows.length, 15);
  for (const row of rows) {
    assert.ok(Math.abs(row.C - row.Cref) < 1e-8, row.event);
    assert.ok(Math.abs(row.B - row.Bref) < 1e-8, row.event);
    assert.ok(row.C > row.B && row.B > row.A && row.A > row.S, row.event);
    assert.ok(Math.abs(row.S - row.record) < 1e-8, row.event);
    for (let i = 1; i < row.times.length; i++) {
      assert.ok(row.times[i] < row.times[i - 1], `${row.event}: ${i}`);
    }
  }
});

test('distance still changes the speed/stamina balance', () => {
  const run = game();
  const result = JSON.parse(run(`JSON.stringify((()=>{
    let p={stats:Object.fromEntries(STATS.map(k=>[k,113]))},base50=expectedTime(p,'fr50'),base400=expectedTime(p,'fr400');
    p.stats.fr_speed+=10;
    let speed50=base50-expectedTime(p,'fr50'),speed400=base400-expectedTime(p,'fr400');
    p.stats.fr_speed-=10;p.stats.fr_stamina+=10;
    return {short:speed50/(base50-expectedTime(p,'fr50')),long:speed400/(base400-expectedTime(p,'fr400'))};
  })())`));
  assert.ok(result.short > result.long);
});

test('balanced A speed and stamina reach medley championship pace while weak strokes still cost time',()=>{
  const run=game();
  const rows=JSON.parse(run(`JSON.stringify((()=>{
    const p={stats:Object.fromEntries(STATS.map(k=>[k,80]))};
    const swimming=['fr','ba','br','fly'].flatMap(s=>['speed','stamina'].map(k=>s+'_'+k));
    swimming.forEach(k=>p.stats[k]=163);
    return ['im200','im400'].map(e=>{
      const base=expectedTime(p,e),champion=Math.max(JAPAN_RECORD[e]*1.01,INTERCOLLEGE_A_FINAL_REFERENCE[e]*.985);
      const gains=swimming.map(k=>{const raised=deepClone(p);raised.stats[k]+=10;return base-expectedTime(raised,e)});
      const weak=deepClone(p);weak.stats.br_speed=80;weak.stats.br_stamina=80;
      const technique=deepClone(p);technique.stats.start=200;['fr','ba','br','fly'].forEach(s=>technique.stats[s+'_turn']=200);
      const zero=deepClone(p);swimming.forEach(k=>zero.stats[k]=0);
      const oldAbility=(()=>{const [sp,st,tr,d]=eventProfile(p,e,true),sw={200:.28,400:.40}[d],vw=.72-sw*.35;return (vw*sp+sw*st+.11*tr+.07*p.stats.start)/(vw*200+sw*200+.11*200+.07*200)})();
      return {e,base,champion,gains,weak:expectedTime(weak,e),technique:expectedTime(technique,e),zero:expectedTime(zero,e),legacyAbility:abilityValue(p,e,true),oldAbility,
        nonMedley:EVENTS.filter(x=>!x.startsWith('im')).map(x=>({x,current:abilityValue(p,x),legacy:abilityValue(p,x,true)}))};
    });
  })())`));
  for(const row of rows){
    assert.ok(row.base<=row.champion*1.002,JSON.stringify(row));
    assert.ok(row.gains.every(g=>g>0),JSON.stringify(row));
    assert.ok(row.weak>row.base*1.01,JSON.stringify(row));
    assert.ok(row.technique<row.base&&row.base-row.technique<row.champion*.003,JSON.stringify(row));
    assert.ok(Number.isFinite(row.zero)&&row.zero>row.weak,JSON.stringify(row));
    assert.ok(Math.abs(row.legacyAbility-row.oldAbility)<1e-12,row.e);
    for(const event of row.nonMedley)assert.equal(event.current,event.legacy,event.x);
  }
});

test('balanced A medley swimmers can win against the strongest college entrants and share the CPU race clock',()=>{
  const run=game();
  const rows=JSON.parse(run(`JSON.stringify((()=>{
    const p={id:'medley-A-player',stats:Object.fromEntries(STATS.map(k=>[k,80])),bestTimes:{}};
    for(const s of ['fr','ba','br','fly'])for(const k of ['speed','stamina'])p.stats[s+'_'+k]=163;
    const cpu={...deepClone(p),id:'medley-A-cpu',category:'university'};
    state.players.push(p);
    const entries=buildCpuCollegeEntries('intercollege'),byId=new Map(state.world.map(a=>[a.id,a]));
    return ['im200','im400'].map(e=>{
      p.bestTimes[e]=expectedTime(p,e);
      const field=entries[e].map(id=>byId.get(id)).sort((a,b)=>expectedTime(a,e)-expectedTime(b,e)).slice(0,7);
      let wins=0,own=[],sameClock=true;
      for(let trial=0;trial<12;trial++){
        state.rngSeed=1234+trial;const race=simulateMeetRace(p,e,'intercollege',false);own.push(race.total);
        state.rngSeed=1234+trial;const match=simulateMeetRace(cpu,e,'intercollege',false);
        sameClock&&=race.total===match.total&&race.physics.targetTime===match.physics.targetTime;
        const rivals=field.map(a=>simulateMeetRace(a,e,'intercollege',false).total);
        if(race.total<Math.min(...rivals))wins++;
      }
      return {e,wins,sameClock,field:field.length,own,pb:p.bestTimes[e]};
    });
  })())`));
  for(const row of rows){
    assert.equal(row.field,7);assert.equal(row.sameClock,true,row.e);
    assert.ok(row.wins>=2,JSON.stringify(row));
    assert.ok(row.own.some(time=>time>row.pb+.8),JSON.stringify(row));
    assert.ok(new Set(row.own).size>=8,JSON.stringify(row));
  }
});

test('prodigy stats are random and capped at low A, including already strong arrivals', () => {
  const run = game();
  const result = JSON.parse(run(`JSON.stringify((()=>{
    const samples=[];
    for(let i=0;i<1000;i++){
      const p={stats:Object.fromEntries(STATS.map(k=>[k,i%2?195:75])),specialty:'fr100',potentialType:'early'};
      applyProdigyBoost(p,1);
      samples.push({stats:STATS.map(k=>p.stats[k]),type:p.potentialType,prodigy:p.prodigy});
    }
    return samples;
  })())`));
  const maxima = new Set();
  for (const sample of result) {
    assert.equal(sample.prodigy, true);
    assert.ok(['normal', 'late'].includes(sample.type));
    for (const value of sample.stats) assert.ok(value >= 0 && value <= 158);
    maxima.add(Math.max(...sample.stats));
  }
  assert.ok(maxima.size > 100);
});

test('max facilities yield about 30 per eight focused turns and B/A/S progressively slow down', () => {
  const run = game();
  const rows = JSON.parse(run(`JSON.stringify([80,113,138,163,188].map(value=>{
    let gains=[];
    for(let sample=0;sample<500;sample++){
      let p={id:'test',name:'test',year:1,stats:Object.fromEntries(STATS.map(k=>[k,value])),growthProfile:{1:1}};
      state={players:[p],world:[],slot:1,rngSeed:sample+1234,facilities:Object.fromEntries(STATS.map(k=>[k,100])),trainingFocus:{test:['fr_speed']}};
      for(let turn=0;turn<8;turn++){state.slot=turn+1;trainCommand()}
      gains.push(p.stats.fr_speed-value);
    }
    return {value,mean:gains.reduce((a,b)=>a+b,0)/gains.length};
  }))`));
  assert.ok(rows[0].mean >= 28 && rows[0].mean <= 32, JSON.stringify(rows));
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].mean < rows[i - 1].mean);
  assert.ok(rows[2].mean < 15);
  assert.ok(rows[3].mean < 6);
  assert.ok(rows[4].mean < 1);
  console.log('8-turn growth:', rows.map(row => `${row.value}: +${row.mean.toFixed(2)}`).join(', '));
});

test('secondary growth sometimes occurs and sometimes leaves all untrained stats unchanged', () => {
  const run = game();
  const counts = JSON.parse(run(`JSON.stringify((()=>{
    let none=0,secondary=0;
    for(let sample=0;sample<1000;sample++){
      let p={id:'test',name:'test',year:1,stats:Object.fromEntries(STATS.map(k=>[k,80])),growthProfile:{1:1}};
      state={players:[p],world:[],slot:1,rngSeed:sample+9001,facilities:{fr_speed:100},trainingFocus:{test:['fr_speed']}};
      trainCommand();
      if(p.stats.fr_stamina>80||p.stats.fr_turn>80)secondary++;else none++;
      for(let k of STATS.filter(k=>!k.startsWith('fr_')))if(p.stats[k]!==80)throw new Error('Unrelated stat grew');
    }
    return {none,secondary};
  })())`));
  assert.ok(counts.none > 600 && counts.none < 800, JSON.stringify(counts));
  assert.ok(counts.secondary > 200 && counts.secondary < 400, JSON.stringify(counts));
});

test('all growth respects the 200 cap; empty legacy focus becomes one specialty item', () => {
  const run = game();
  const result = JSON.parse(run(`JSON.stringify((()=>{
    let p={id:'test',name:'test',year:1,stats:Object.fromEntries(STATS.map(k=>[k,80])),growthProfile:{1:1}};
    state={players:[p],world:[],slot:1,rngSeed:1234,facilities:{},trainingFocus:{}};
    trainCommand();let focus=state.trainingFocus.test,primary=p.stats.fr_speed>80,unrelated=STATS.filter(k=>!k.startsWith('fr_')).every(k=>p.stats[k]===80);
    p.stats=Object.fromEntries(STATS.map(k=>[k,200]));state.trainingFocus.test=['fr_speed'];
    trainCommand();return {focus,primary,unrelated,cap:STATS.every(k=>p.stats[k]===200)};
  })())`));
  assert.deepEqual(result.focus, ['fr_speed']);
  assert.equal(result.primary, true);
  assert.equal(result.unrelated, true);
  assert.equal(result.cap, true);
});

test('school ranking and reputation drive scouting while untitled swimmers receive a small bonus', () => {
  const run = game();
  const rows = JSON.parse(run(`JSON.stringify((()=>{
    const field=state.world.filter(a=>a.category==='high').sort((a,b)=>a.bestTimes.fr100-b.bestTimes.fr100);
    return [0,10,35,160,310,600].flatMap(rep=>[0,9,49,99,199].map(index=>{
      state.reputation=rep;
      const a={...deepClone(field[index]),id:'ranked-test-'+index,category:'high',grade:3,specialty:'fr100',accolades:[],scoutPreferences:{version:3,worldAmbition:false,preferredRegion:null,earlyCompetition:false,prestigeSchool:false}};
      const ordinary=scoutProbability(a),rank=scoutProbabilityDetails(a).rank;
      a.accolades=[{competition:'全国高校総体',event:'fr100',rank:1,season:2026}];
      return {rep,rank,ordinary,titled:scoutProbability(a)};
    }));
  })())`));
  for (const row of rows) {
    assert.ok(row.ordinary >= .01 && row.ordinary <= .97);
    assert.ok(row.titled >= .01 && row.titled <= .97);
    assert.ok(row.ordinary > row.titled&&row.ordinary-row.titled<=.04000001,JSON.stringify(row));
    if(row.rep===0&&row.rank>=80)assert.ok(row.ordinary>.55);
  }
  for(let i=5;i<rows.length;i++)assert.ok(rows[i].ordinary>=rows[i-5].ordinary);
  for(let i=0;i<rows.length;i+=5)for(let j=1;j<5;j++){
    const before=rows[i+j-1].ordinary,after=rows[i+j].ordinary;
    assert.ok(before===.97?after===.97:after>before,JSON.stringify(rows.slice(i,i+5)));
  }
});

test('S is rare in generated CPU and player rosters', () => {
  for (const seed of [12345, 54321, 987654, 8675309]) {
    const run = game(seed);
    const result = JSON.parse(run(`JSON.stringify({world:state.world.length,
      s:state.world.filter(a=>STATS.some(k=>statRank(a.stats[k])==='S')).length,
      players:state.players.filter(a=>STATS.some(k=>statRank(a.stats[k])==='S')).length})`));
    assert.equal(result.world, 1560);
    assert.ok(result.s / result.world < .03, JSON.stringify(result));
    assert.equal(result.players, 0);
  }
});

test('player and CPU individual and relay races use the same abilities and time rules', () => {
  const run = game();
  const result = JSON.parse(run(`JSON.stringify((()=>{
    const results=[];
    for(const value of [113,138,163,188])for(const e of EVENTS){
      let player={id:'p',name:'p',stats:Object.fromEntries(STATS.map(k=>[k,value]))};
      let cpu={...player,id:'cpu',category:'university',organization:state.universities[0].name};
      state.players=[player];state.rngSeed=7654321;
      let pRace=simulateRace(player,e,true,false);state.rngSeed=7654321;
      let cRace=simulateMeetRace(cpu,e,'kansai_college',false);
      results.push({event:e,p:pRace.total,c:cRace.total,pTarget:pRace.physics.targetTime,cTarget:cRace.physics.targetTime});
    }
    let members=Array.from({length:4},(_,i)=>({id:'p'+i,stats:Object.fromEntries(STATS.map(k=>[k,138+i]))}));
    state.players=members;
    for(const kind of RELAYS){
      state.rngSeed=45678;let p=simulateRelay(members,kind,false);
      state.rngSeed=45678;let c=simulateCpuRelay(members.map(p=>({...p})),kind,'intercollege');
      results.push({event:kind,p:p.total,c:c.total,pTarget:p.legs.join(','),cTarget:c.legs.join(',')});
    }
    return results;
  })())`));
  assert.equal(result.length, 63);
  for (const row of result) {
    assert.equal(row.cTarget, row.pTarget, row.event);
    assert.equal(row.c, row.p, row.event);
  }
});

test('actual race scores and playback stay on the ability-based clock instead of beating the benchmarks', () => {
  const run = game();
  const rows = JSON.parse(run(`JSON.stringify((()=>{
    const rows=[];
    for(const value of [113,138,163,188])for(const event of EVENTS){
      const p={stats:Object.fromEntries(STATS.map(k=>[k,value]))};
      state.rngSeed=43210;const race=simulateRace(p,event,true,false);
      rows.push({event,value,total:race.total,target:round2(race.physics.targetTime),
        expected:expectedTime(p,event),sum:round2(race.splits.reduce((a,b)=>a+b,0)),last:race.cumulative.at(-1)});
    }
    const p={stats:Object.fromEntries(STATS.map(k=>[k,138]))};
    for(const event of ['fr100','im400']){
      state.rngSeed=43210;const race=simulateRace(p,event,true,true);
      if(Math.abs(race.trajectory.at(-1).t-race.total)>.02)throw new Error('Playback and score disagree');
      if(race.trajectory.at(-1).distance!==distanceOf(event))throw new Error('Playback did not finish');
      for(let i=1;i<race.trajectory.length;i++)if(race.trajectory[i].t<race.trajectory[i-1].t)throw new Error('Playback clock reversed');
      state.rngSeed=43210;const takeover=simulateRace(p,event,true,false,true);
      if(!(takeover.total<race.total))throw new Error('Relay takeover advantage was lost');
    }
    return rows;
  })())`));
  for (const row of rows) {
    assert.equal(row.total, row.target, JSON.stringify(row));
    assert.equal(row.sum, row.total, JSON.stringify(row));
    assert.equal(row.last, row.total, JSON.stringify(row));
    const distance=Number(row.event.match(/\d+/)[0]);
    assert.ok(row.total>=row.expected*.98&&row.total<=row.expected+({50:.7,100:1.4,200:3.1,400:5.1}[distance]),JSON.stringify(row));
  }
});

test('legacy save migration preserves player progress and history and runs the CPU rebalance once', () => {
  const run = game();
  const result = JSON.parse(run(`JSON.stringify((()=>{
    delete state.balanceModelVersion;state.version='pwa-v1.25';
    state.players[0].stats.fr_speed=182;state.players[0].bestTimes.fr100=48.01;
    state.meetHistory=[{season:2025,meet:'intercollege',pointsAfter:50}];
    const id=state.world.find(a=>a.category==='university').id;
    state.world.find(a=>a.id===id).stats.fr_speed=190;
    state.world.push({...deepClone(state.players[0]),id:'alumni-test',category:'adult',age:25,alumni:true});
    migrateState();let first=JSON.stringify(state.world.map(a=>({id:a.id,stats:a.stats,pb:a.bestTimes})));
    let cpu=state.world.find(a=>a.id===id).stats.fr_speed;
    migrateState();let second=JSON.stringify(state.world.map(a=>({id:a.id,stats:a.stats,pb:a.bestTimes})));
    return {version:state.version,speed:state.players[0].stats.fr_speed,pb:state.players[0].bestTimes.fr100,
      history:state.meetHistory,alumni:state.world.find(a=>a.id==='alumni-test').stats.fr_speed,cpu,once:first===second};
  })())`));
  assert.equal(result.version, 'pwa-v1.58');
  assert.equal(result.speed, 182);
  assert.equal(result.pb, 48.01);
  assert.equal(result.alumni, 182);
  assert.equal(result.cpu, 147.5);
  assert.deepEqual(result.history, [{ season: 2025, meet: 'intercollege', pointsAfter: 50 }]);
  assert.equal(result.once, true);
});

test('new seasons preserve eight real candidates including prodigy abilities and all earned PBs', () => {
  const run = game();
  const result = JSON.parse(run(`JSON.stringify((()=>{
    state.reputation=600;
    const a=state.world.find(a=>a.category==='high'&&a.grade===3);
    a.prodigy=true;state.recruits=[a.id];
    a.stats=Object.fromEntries(STATS.map((k,i)=>[k,152+i*.1]));
    const stats=JSON.stringify(a.stats),pb=JSON.stringify(a.bestTimes);
    newSeason();
    const freshmen=state.players.filter(p=>p.year===1),prodigy=freshmen.find(p=>p.id===a.id);
    return {count:freshmen.length,total:state.players.length,welcome:state.pendingFreshmenWelcome.length,
      max:Math.max(...STATS.map(k=>prodigy.stats[k])),prodigy:prodigy.prodigy,pbs:Object.keys(prodigy.bestTimes).length,
      stats:stats===JSON.stringify(prodigy.stats),pb:pb===JSON.stringify(prodigy.bestTimes)};
  })())`));
  assert.equal(result.count, 8);
  assert.equal(result.total, 32);
  assert.equal(result.welcome, 8);
  assert.equal(result.prodigy, true);
  assert.ok(result.max <= 158);
  assert.equal(result.pbs,15);assert.ok(result.stats&&result.pb);
});

test('facility upgrades progressively improve eight-turn gains while level 100 stays near +30', () => {
  const run=game();
  const rows=JSON.parse(run(`JSON.stringify([0,25,50,75,100].map(level=>{
    let sum=0;
    for(let sample=0;sample<300;sample++){
      let p={id:'test',name:'test',specialty:'fr100',year:1,stats:Object.fromEntries(STATS.map(k=>[k,80])),growthProfile:{1:1}};
      state={players:[p],world:[],slot:1,rngSeed:sample+4321,facilities:{fr_speed:level},trainingFocus:{test:['fr_speed']}};
      for(let turn=0;turn<8;turn++){state.slot=turn+1;trainCommand()}
      sum+=p.stats.fr_speed-80;
    }
    return {level,gain:sum/300};
  }))`));
  assert.ok(rows[0].gain<10);
  assert.ok(rows[4].gain>=28&&rows[4].gain<=32);
  for(let i=1;i<rows.length;i++)assert.ok(rows[i].gain>rows[i-1].gain+3,JSON.stringify(rows));
  console.log('Facility growth:',rows.map(r=>`Lv.${r.level}: +${r.gain.toFixed(2)}`).join(', '));
});

test('upper A can break each dispatch standard on a good day in actual player and CPU races', () => {
  const run=game();
  const rows=JSON.parse(run(`JSON.stringify([165,173].flatMap(value=>EVENTS.map(e=>{
    let p={id:'upper-a',stats:Object.fromEntries(STATS.map(k=>[k,value]))},passes=0,bestSeed=0,worstSeed=0,min=Infinity,max=0;
    for(let i=0;i<5000;i++){
      let seed=state.rngSeed,t=raceTarget(p,e);
      if(t<=dispatchStandard(e))passes++;
      if(t<min){min=t;bestSeed=seed}if(t>max){max=t;worstSeed=seed}
    }
    state.players=[p];state.rngSeed=bestSeed;let player=simulateRace(p,e,true,true).total;
    state.rngSeed=bestSeed;let cpu=simulateMeetRace(p,e,'japan_championship',false).total;
    state.rngSeed=worstSeed;let slow=simulateRace(p,e,true,true).total;
    return {e,value,chance:passes/5000,player,cpu,slow,standard:dispatchStandard(e)};
  })))`));
  for(const row of rows){
    assert.ok(row.chance>.003&&row.chance<.98,JSON.stringify(row));
    assert.ok(row.player<row.standard&&row.cpu<row.standard&&row.slow>row.standard,JSON.stringify(row));
    assert.ok(Math.abs(row.player-row.cpu)<.001,JSON.stringify(row));
  }
});

test('generated swimmers have distinct stroke strengths without changing existing earned stats', () => {
  const run=game();
  const result=JSON.parse(run(`JSON.stringify((()=>{
    let players=state.players.filter(p=>!p.prodigy),cpu=state.world.filter(a=>a.category==='university');
    const spread=a=>{let values=['fr','ba','br','fly'].map(s=>['speed','stamina','turn'].reduce((sum,k)=>sum+a.stats[s+'_'+k],0)/3);return Math.max(...values)-Math.min(...values)};
    let p=state.players[0];p.stats.fr_speed=183.25;let before=JSON.stringify(p.stats);migrateState();
    return {playerMean:players.reduce((s,a)=>s+spread(a),0)/players.length,cpuMean:cpu.reduce((s,a)=>s+spread(a),0)/cpu.length,preserved:before===JSON.stringify(p.stats)};
  })())`));
  assert.ok(result.playerMean>20&&result.cpuMean>20,JSON.stringify(result));
  assert.equal(result.preserved,true);
});

test('scouting uses specialty PB rank rather than ability snapshots and title absence adds four points', () => {
  const run=game();
  const rows=JSON.parse(run(`JSON.stringify([10,160,310].map(rep=>{
    state.reputation=rep;
    const field=state.world.filter(a=>a.category==='high').sort((a,b)=>a.bestTimes.fr100-b.bestTimes.fr100);
    const make=(time,ability,titleRank=null)=>({id:'pb-scout-'+ability+'-'+titleRank,category:'high',grade:3,
      stats:Object.fromEntries(STATS.map(k=>[k,ability])),specialty:'fr100',bestTimes:{fr100:time},
      scoutPreferences:{version:3,worldAmbition:false,preferredRegion:null,earlyCompetition:false,prestigeSchool:false},
      accolades:titleRank?[{competition:'全国高校総体',event:'fr100',rank:titleRank,season:2026}]:[]});
    const fast=field[0].bestTimes.fr100,slow=field[79].bestTimes.fr100;
    return {slow:scoutProbability(make(slow,80)),fast:scoutProbability(make(fast,80)),strongStatsSamePB:scoutProbability(make(fast,173)),
      champion:scoutProbability(make(fast,173,1)),finalist:scoutProbability(make(fast,173,8))};
  }))`));
  for(const row of rows){
    assert.ok(row.slow>row.fast+.2,JSON.stringify(row));
    assert.equal(row.fast,row.strongStatsSamePB);assert.equal(row.champion,row.finalist);
    assert.ok(Math.abs(row.fast-row.champion-.04)<1e-10);
  }
  assert.ok(rows[2].fast>rows[0].fast&&rows[2].champion>rows[0].champion);
});

test('standard badges are first-ever per swimmer, event and meet, surviving history pruning and saves', () => {
  const run=game();
  const result=JSON.parse(run(`JSON.stringify((()=>{
    let p=state.players[0];p.bestTimes.fr100=80;p.standardAchievementVersion=1;p.standardAchievements={};
    let first=updateResultHistory(p,'fr100',51,'team_trial','記録会',1);
    let second=updateResultHistory(p,'fr100',50.5,'joint_record','予選',1);
    let third=updateResultHistory(p,'fr100',49.9,'joint_record','A決勝',1);
    let repeated=updateResultHistory(p,'fr100',49.8,'japan_championship','予選',1);
    p.raceHistory=[];state=JSON.parse(JSON.stringify(state));migrateState();p=state.players[0];
    let reload=updateResultHistory(p,'fr100',49.7,'intercollege','A決勝',1);
    let legacy=state.players[1];legacy.bestTimes.fr100=49.8;delete legacy.standardAchievements;delete legacy.standardAchievementVersion;
    let oldSave=updateResultHistory(legacy,'fr100',49.75,'japan_championship','予選',1);
    return {first:first.newlyCleared,second:second.newlyCleared,third:third.newlyCleared,repeated:repeated.newlyCleared,reload:reload.newlyCleared,oldSave:oldSave.newlyCleared,repeatHtml:achievementBadges({source:'PLAYER',achievement:repeated},'fr100')};
  })())`));
  assert.deepEqual(result.first,['関西カレッジ']);
  assert.deepEqual(result.second,['インカレ']);
  assert.deepEqual(result.third,['ジャパンオープン','日本選手権']);
  assert.deepEqual(result.repeated,[]);assert.deepEqual(result.reload,[]);assert.deepEqual(result.oldSave,[]);
  assert.match(result.repeatHtml,/自己PB/);assert.doesNotMatch(result.repeatHtml,/突破/);
});

test('higher mental abilities progressively reduce actual poor races, including a mental value of zero',()=>{
  const run=game();
  const rows=JSON.parse(run(`JSON.stringify([0,50,100,150,200].map(mental=>{
    let p={stats:Object.fromEntries(STATS.map(k=>[k,k==='mental'?mental:173])),bestTimes:{}};
    p.bestTimes.fr100=expectedTime(p,'fr100')+8;
    state.rngSeed=7654321;
    let poor=0;
    for(let i=0;i<8000;i++)if(raceTarget(p,'fr100')>p.bestTimes.fr100)poor++;
    return {mental,rate:poor/8000};
  }))`));
  assert.ok(rows[0].rate>.18);
  assert.ok(rows.at(-1).rate>.10&&rows.at(-1).rate<.14);
  for(let i=1;i<rows.length;i++)assert.ok(rows[i].rate<rows[i-1].rate,JSON.stringify(rows));
});

test('poor races miss PB by distance-scaled margins even when abilities improve', () => {
  const run=game();
  const rows=JSON.parse(run(`JSON.stringify(EVENTS.map(e=>{
    let p={stats:Object.fromEntries(STATS.map(k=>[k,173])),bestTimes:{[e]:expectedTime({stats:Object.fromEntries(STATS.map(k=>[k,165]))},e)}};
    let pb=p.bestTimes[e],poor=[];
    for(let i=0;i<2000;i++){let t=raceTarget(p,e);if(t>pb)poor.push(t-pb)}
    // Non-PBs also include ordinary race variance, not only poor-condition races.
    const oldPB=pb+30,oldBest={...p,bestTimes:{[e]:oldPB}},badCondition=[];
    for(let i=0;i<2000;i++){let t=raceTarget(oldBest,e);if(t>oldPB)badCondition.push(t-oldPB)}
    return {e,distance:distanceOf(e),count:poor.length,max:Math.max(...poor),min:Math.min(...poor),
      badCount:badCondition.length,badMin:Math.min(...badCondition),badMax:Math.max(...badCondition)};
  }))`));
  for(const row of rows){
    const expected={50:.5,100:1,200:2.8,400:4.7}[row.distance];
    assert.ok(row.count>150&&row.count<1100,JSON.stringify(row));
    assert.ok(row.max>expected,JSON.stringify(row));
    const [min,max]={50:[.3,.65],100:[.65,1.25],200:[1,3],400:[1,5]}[row.distance];
    assert.ok(row.badCount>150&&row.badCount<450,JSON.stringify(row));
    assert.ok(row.badMin>=min-1e-8&&row.badMax<=max+1e-8,JSON.stringify(row));
  }
});

test('CPU universities and swimmers have wider differences and legacy diversity migrates only once', () => {
  const run=game();
  const result=JSON.parse(run(`JSON.stringify((()=>{
    let teams=state.universities.map(u=>({rep:u.reputation,mean:state.world.filter(a=>a.category==='university'&&a.organization===u.name).reduce((s,a)=>s+overallStatValue(a),0)/20}));
    let p=state.players[0],own=JSON.stringify(p),alumni={...deepClone(p),id:'alumni-profile',category:'adult',age:26,alumni:true};state.world.push(alumni);
    const oldAlumni=JSON.stringify(alumni);delete state.cpuDiversityVersion;state.cpuUniversityRepModelVersion=2;
    state.universities.forEach(u=>{u.baseReputation=clamp(35+(u.strength-65)*8.5,20,320);u.reputation=u.baseReputation+10});
    migrateState();let first=JSON.stringify(state.world),reps=JSON.stringify(state.universities);migrateState();
    return {repRange:Math.max(...teams.map(u=>u.rep))-Math.min(...teams.map(u=>u.rep)),abilityRange:Math.max(...teams.map(u=>u.mean))-Math.min(...teams.map(u=>u.mean)),preserved:own===JSON.stringify(state.players[0]),alumniPreserved:JSON.stringify(state.world.find(a=>a.id===alumni.id))===oldAlumni,once:first===JSON.stringify(state.world)&&reps===JSON.stringify(state.universities),version:state.cpuDiversityVersion};
  })())`));
  assert.ok(result.repRange>280,JSON.stringify(result));assert.ok(result.abilityRange>28,JSON.stringify(result));
  assert.equal(result.preserved,true);assert.equal(result.alumniPreserved,true);assert.equal(result.once,true);assert.equal(result.version,5);
});

test('school swimmers have lower overall levels and category leaders vary between close races and standouts',()=>{
  const samples=[];
  for(const seed of [12345,54321,5914,8675309]){
    const run=game(seed);
    samples.push(JSON.parse(run(`JSON.stringify(['middle','high','university','adult'].map(category=>{
      const athletes=state.world.filter(a=>a.category===category),values=athletes.map(overallStatValue).sort((a,b)=>a-b);
      return {category,mean:values.reduce((a,b)=>a+b)/values.length,p90:values[Math.floor(values.length*.9)],
        events:EVENTS.map(e=>{const times=athletes.map(a=>a.bestTimes[e]).sort((a,b)=>a-b),mean=times.reduce((a,b)=>a+b)/times.length;return{e,close:(times[2]-times[0])/times[0],gap:(times[1]-times[0])/times[0],relativeSD:Math.sqrt(times.reduce((s,t)=>s+(t-mean)**2,0)/times.length)/mean,mean}})};
    }))`)));
  }
  for(const rows of samples){
    assert.ok(rows[0].mean<78&&rows[0].p90<110,JSON.stringify(rows[0]));
    assert.ok(rows[1].mean<96&&rows[1].p90<130,JSON.stringify(rows[1]));
    for(let i=0;i<12;i++){
      assert.ok(rows[0].events[i].mean>rows[1].events[i].mean,JSON.stringify(rows));
      assert.ok(rows[1].events[i].mean>rows[2].events[i].mean,JSON.stringify(rows));
    }
  }
  for(let i=0;i<4;i++){
    const fields=samples.flatMap(rows=>rows[i].events);
    const close=fields.filter(e=>e.close<.004).length,standouts=fields.filter(e=>e.gap>.008).length;
    assert.ok(close>=2&&standouts>=3,JSON.stringify({category:samples[0][i].category,close,standouts}));
    // A crowded top 20 is allowed; the complete category must still have a broad field.
    assert.ok(fields.reduce((sum,e)=>sum+e.relativeSD,0)/fields.length>.02,samples[0][i].category);
  }
});

test('generated high-school finals vary level, front-group size and gaps while keeping ordered titles',()=>{
  const run=game();
  const result=JSON.parse(run(`JSON.stringify((()=>{
    const editions=Array.from({length:100},()=>interhighFinalTargets('fr100'));
    const titles=SPECIALTY_EVENTS.map(e=>state.world.flatMap(a=>a.accolades.filter(t=>t.event===e&&t.competitionId==='interhigh_'+state.season).map(t=>({rank:t.rank,time:t.time,pb:a.bestTimes[e]}))).sort((a,b)=>a.rank-b.rank));
    return {editions,titles,reference:INTERHIGH.events.fr100.times[0]};
  })())`));
  const frontSizes=new Set(result.editions.map(times=>times.filter(t=>t-times[0]<result.reference*.005).length));
  assert.ok(frontSizes.size>=4,JSON.stringify([...frontSizes]));
  assert.ok(result.editions.some(times=>times[1]-times[0]>result.reference*.015));
  assert.ok(result.editions.some(times=>times[3]-times[0]<result.reference*.004));
  assert.ok(new Set(result.editions.map(times=>times[0])).size>30);
  for(const times of result.editions)for(let i=1;i<times.length;i++)assert.ok(times[i]>times[i-1]);
  for(const titles of result.titles){
    assert.equal(titles.length,8);
    for(let i=0;i<titles.length;i++){
      assert.equal(titles[i].rank,i+1);assert.ok(titles[i].pb<=titles[i].time);
      if(i)assert.ok(titles[i].time>titles[i-1].time);
    }
  }
});

test('continuous CPU fields generate weak cohorts, numerous strong contenders and a lone standout without year inflation',()=>{
  const run=game();
  const result=JSON.parse(run(`JSON.stringify((()=>{
    const savedSeed=state.cpuCompetitionSeed,fields={},samples=[];
    for(let seed=1;seed<=4000&&Object.keys(fields).length<3;seed++){
      state.cpuCompetitionSeed=seed;
      const f=cpuCompetitionField('university','fr100');
      if(f.level < -8 && !fields.weak)fields.weak={seed,...f};
      if(f.level > 8 && f.contenderRate>.09 && !fields.crowded)fields.crowded={seed,...f};
      if(Math.abs(f.level)<3&&f.contenderRate<.015&&f.eliteRate>.0032&&f.eliteRate<.0036&&f.upperShift>0&&!fields.standout)fields.standout={seed,...f};
    }
    for(const [kind,f] of Object.entries(fields)){
      state.cpuCompetitionSeed=f.seed;
      const athletes=Array.from({length:500},(_,i)=>{
        const a={id:'field-comparison-'+i,category:'university',organization:'分布比較大学',grade:2,specialty:'fr100',stats:Object.fromEntries(STATS.map(k=>[k,113]))};
        applyCpuCompetitionProfile(a);return a;
      });
      const values=athletes.map(a=>abilityValue(a,'fr100')*200).sort((a,b)=>b-a);
      samples.push({kind,mean:values.reduce((a,b)=>a+b)/values.length,leaders:values.filter(v=>v>=163).length,gap:values[0]-values[1],values:values.slice(0,10)});
    }
    state.cpuCompetitionSeed=savedSeed;
    const original=JSON.stringify(cpuCompetitionField('university','fr100'));
    state=JSON.parse(JSON.stringify(state));migrateState();
    const reload=original===JSON.stringify(cpuCompetitionField('university','fr100'));
    const centuries=Array.from({length:120},(_,i)=>cpuCompetitionField('university','fr100',2026+i));
    return {samples,reload,centuries};
  })())`));
  assert.equal(result.samples.length,3);assert.equal(result.reload,true);
  const byKind=Object.fromEntries(result.samples.map(row=>[row.kind,row]));
  assert.ok(byKind.crowded.mean-byKind.weak.mean>15,JSON.stringify(result.samples));
  assert.ok(byKind.crowded.leaders>=15,JSON.stringify(result.samples));
  assert.ok(byKind.standout.leaders>=1&&byKind.standout.leaders<=3&&byKind.standout.gap>3,JSON.stringify(result.samples));
  for(const f of result.centuries){
    assert.ok(Math.abs(f.level)<=14&&f.spread>=.45&&f.spread<=1.6);
    assert.ok(f.contenderRate>=.005&&f.contenderRate<=.15&&f.eliteRate>=.0003&&f.eliteRate<=.0233);
  }
  assert.ok(result.centuries.slice(0,20).some(f=>f.level>5)&&result.centuries.slice(-20).some(f=>f.level< -5));
});

test('v4 CPU saves receive new distributions once without changing own players, alumni, records or titles',()=>{
  const run=game();
  const result=JSON.parse(run(`JSON.stringify((()=>{
    const own=JSON.stringify(state.players),records=JSON.stringify(state.recordRankings),titles=JSON.stringify(state.world.flatMap(a=>a.accolades));
    const alumni={...deepClone(state.players[0]),id:'v4-preserved-alumni',category:'adult',age:26,alumni:true};state.world.push(alumni);const savedAlumni=JSON.stringify(alumni);
    for(const a of state.world.filter(a=>!a.alumni))a.cpuCompetitionProfileVersion=1;
    state.cpuDiversityVersion=4;delete state.cpuCompetitionSeed;migrateState();
    const first=JSON.stringify(state),profiles=state.world.filter(a=>!a.alumni).every(a=>a.cpuCompetitionProfileVersion===2);
    migrateState();return {profiles,once:JSON.stringify(state)===first,own:JSON.stringify(state.players)===own,
      alumni:JSON.stringify(state.world.find(a=>a.id===alumni.id))===savedAlumni,records:JSON.stringify(state.recordRankings)===records,
      titles:JSON.stringify(state.world.filter(a=>!a.alumni).flatMap(a=>a.accolades))===titles,
      titlePBs:state.world.every(a=>a.accolades.every(t=>a.bestTimes[t.event]<=t.time))};
  })())`));
  assert.ok(Object.values(result).every(Boolean),JSON.stringify(result));
});

test('v3 CPU saves gain competition profiles once and preserve own players, alumni, historical records and title PBs',()=>{
  const run=game();
  const result=JSON.parse(run(`JSON.stringify((()=>{
    const own=JSON.stringify(state.players),records=JSON.stringify(state.recordRankings),titles=JSON.stringify(state.world.flatMap(a=>a.accolades));
    const alumni={...deepClone(state.players[0]),id:'field-preserved-alumni',category:'adult',age:26,alumni:true};state.world.push(alumni);const savedAlumni=JSON.stringify(alumni);
    for(const a of state.world.filter(a=>!a.alumni)){
      delete a.cpuCompetitionProfileVersion;delete a.cpuCompetitionCategory;
      a.stats=Object.fromEntries(STATS.map(k=>[k,120]));a.bestTimes=Object.fromEntries(EVENTS.map(e=>[e,expectedTime(a,e)*1.01]));
      for(const t of a.accolades)a.bestTimes[t.event]=Math.min(a.bestTimes[t.event],t.time);
    }
    state.cpuDiversityVersion=3;migrateState();
    const first=JSON.stringify(state.world),schoolMeans=['middle','high'].map(c=>{const rows=state.world.filter(a=>a.category===c);return rows.reduce((s,a)=>s+overallStatValue(a),0)/rows.length});
    const profiles=state.world.filter(a=>!a.alumni).every(a=>a.cpuCompetitionProfileVersion===2&&a.cpuCompetitionCategory===a.category);
    const titlePBs=state.world.every(a=>a.accolades.every(t=>a.bestTimes[t.event]<=t.time));
    migrateState();return {profiles,titlePBs,schoolMeans,once:JSON.stringify(state.world)===first,
      own:JSON.stringify(state.players)===own,alumni:JSON.stringify(state.world.find(a=>a.id===alumni.id))===savedAlumni,
      records:JSON.stringify(state.recordRankings)===records,titles:JSON.stringify(state.world.filter(a=>!a.alumni).flatMap(a=>a.accolades))===titles};
  })())`));
  assert.ok(result.profiles&&result.titlePBs&&result.once&&result.own&&result.alumni&&result.records&&result.titles,JSON.stringify(result));
  assert.ok(result.schoolMeans[0]<80&&result.schoolMeans[1]<95,JSON.stringify(result));
});

test('CPU profiles adapt once on school and university enrollment without losing lifetime PBs or changing own players',()=>{
  const run=game();
  const result=JSON.parse(run(`JSON.stringify((()=>{
    const own=JSON.stringify(state.players),a=state.world.find(a=>a.category==='middle');
    a.category='high';a.grade=1;a.organization=organizationNames().high[0];
    const before=deepClone(a.bestTimes);maintainWorldPopulation();const high=JSON.stringify(a);
    maintainWorldPopulation();const highOnce=high===JSON.stringify(a);
    a.category='university';a.grade=1;a.organization=state.universities.find(u=>u.id==='U08').name;
    maintainWorldPopulation();const college=JSON.stringify(a),category=a.cpuCompetitionCategory;
    a.grade=2;maintainWorldPopulation();const gradeOnly={...a,grade:1};
    return {highOnce,category,collegeOnce:college===JSON.stringify(gradeOnly),pb:EVENTS.every(e=>a.bestTimes[e]<=before[e]),own:JSON.stringify(state.players)===own};
  })())`));
  assert.ok(result.highOnce&&result.collegeOnce&&result.pb&&result.own,JSON.stringify(result));
  assert.equal(result.category,'university');
});
