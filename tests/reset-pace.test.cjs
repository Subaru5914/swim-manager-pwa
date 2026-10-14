const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
// Function scope avoids VM global-proxy overhead during the exhaustive clock
// draws. The game functions themselves are unmodified, with only the seed fixed.
const load=vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+
  '\nreturn code=>JSON.parse(JSON.stringify(eval(code)))',['globalThis']);

for(const seed of [12345,54321,5914,24680])test(`reset seed ${seed}: every fresh PB and race draw agrees with ability, and replay clocks agree with splits`,t=>{
  const run=load({crypto:{getRandomValues:a=>{a[0]=seed;return a}}});
  run('(state=createState(),migrateState(),true)');
  const result=run(`(()=>{
    const categories={own:state.players,...Object.fromEntries(['middle','high','university','adult'].map(c=>[c,state.world.filter(a=>a.category===c)]))};
    const before=JSON.stringify([state.players,state.world]),bad=[],races=[],relays=[],recordChecks=[];
    let pairs=0,pbs=0,draws=0;
    const fail=row=>{if(bad.length<20)bad.push(row)};
    for(const [category,roster]of Object.entries(categories))for(const a of roster)for(const e of EVENTS){
      pairs++;
      const base=expectedTime(a,e),d=distanceOf(e),ranges=MEET_FORM_TIME_RANGES[d],radius=RACE_EXECUTION_RANGE[d],pb=a.bestTimes[e];
      const low=base+Math.min(...ranges.map(r=>r[0]))-radius,high=base+Math.max(...ranges.map(r=>r[1]))+radius+PRELIMINARY_TIME_DELAY[d][1];
      if(!Number.isFinite(base)||base<=0)fail({category,id:a.id,event:e,base});
      if(validRaceTime(pb)){
        pbs++;
        if(pb<low-.025||pb>high+.025)fail({category,id:a.id,event:e,pb,base,low,high});
        const normal=ranges[2];
        if(category!=='own'&&(pb<base+normal[0]-radius-.025||pb>base+normal[1]+radius+.025))fail({category,id:a.id,event:e,pb,base,reason:'fresh PB outside normal form'});
      }else if(category!=='own')fail({category,id:a.id,event:e,pb,reason:'missing CPU PB'});
      // Exercise production draws for every swimmer/event, with fresh independent
      // prelim/final draws and eight competition dates covering different forms.
      for(let date=0;date<8;date++)withMeetRaceContext('japan_open',date*10+1,2026,()=>{
        for(const preliminary of [true,false]){
          const q=raceTimeCorrections(a,e),form=athleteMeetForm(a,'japan_open',date*10+1,2026),range=ranges[form.level+2];
          const delay=preliminary?samplePreliminaryDelay(a,e):0,time=q.base+q.formCorrection+q.raceCorrection+delay;draws++;
          if(q.base!==base||q.formCorrection<range[0]||q.formCorrection>range[1]||Math.abs(q.raceCorrection)>radius||
             (delay!==0&&(delay<PRELIMINARY_TIME_DELAY[d][0]||delay>PRELIMINARY_TIME_DELAY[d][1]))||time<low-.005||time>high+.005)
            fail({category,id:a.id,event:e,preliminary,pb,base,time,q,delay});
        }
      });
    }
    const profilesBefore=JSON.stringify([state.players,state.world]),seedBefore=state.rngSeed;
    state=JSON.parse(JSON.stringify(state));migrateState();
    const reloadStable=profilesBefore===JSON.stringify([state.players,state.world])&&seedBefore===state.rngSeed;
    // Independently exercise the full recorded swimming engine, including IM
    // quarter transitions, weak stamina and the fastest/median/slowest profiles.
    for(const category of Object.keys(categories))for(const event of EVENTS){
      const roster=(category==='own'?state.players:state.world.filter(a=>a.category===category)).slice().sort((a,b)=>expectedTime(a,event)-expectedTime(b,event));
      for(const index of [0,Math.floor(roster.length/2),roster.length-1])for(const preliminary of [true,false]){
        const a=roster[index],base=expectedTime(a,event),pb=a.bestTimes[event];
        const race=withMeetRaceContext('japan_open',60,2026,()=>simulateRace(a,event,true,true,false,preliminary));
        const q=race.physics,expected=round2(base+q.formCorrection+q.raceCorrection+(q.preliminaryDelay||0));
        races.push({category,event,index,preliminary,pb,base,actualBase:q.abilityBase,total:race.total,expected,
          splits:round2(race.splits.reduce((sum,x)=>sum+x,0)),last:race.cumulative.at(-1),finish:race.trajectory.at(-1).t,distance:race.trajectory.at(-1).distance});
      }
    }
    const byId=new Map([...state.players,...state.world].map(a=>[a.id,a]));
    for(const category of ['high','university','japan'])for(const event of EVENTS){
      const roster=category==='japan'?[...state.players,...state.world]:categories[category];
      const expected=roster.filter(a=>validRaceTime(a.bestTimes[event])).sort((a,b)=>a.bestTimes[event]-b.bestTimes[event]).slice(0,10);
      const rows=state.recordRankings[category][event]||[];
      const cutoff=expected.at(-1)?.bestTimes[event],ids=new Set(rows.map(row=>row.athleteId));
      recordChecks.push({category,event,expected:expected.map(a=>a.bestTimes[event]),actual:rows.map(row=>row.time),
        identities:rows.every(row=>{const a=byId.get(row.athleteId);return a&&a.name===row.name&&a.organization===row.organization&&a.bestTimes[event]===row.time}),
        // Equal PBs at tenth place may keep either tied swimmer's history.
        fastest:expected.filter(a=>a.bestTimes[event]<cutoff).every(a=>ids.has(a.id)),unique:ids.size===rows.length});
    }
    for(const meet of ['kansai_college','intercollege'])for(const kind of RELAYS){
      const teams=meetUniversities(meet).filter(n=>n!==state.playerUniversity).map(n=>bestRelayMembers(state.world.filter(a=>a.category==='university'&&a.organization===n),kind))
        .sort((a,b)=>expectedRelayTime(a,kind)-expectedRelayTime(b,kind));
      for(const index of [0,7]){
        const members=teams[index];state.rngSeed=12345;
        const prelim=withMeetRaceContext(meet,60,2026,()=>simulateRelay(members,kind,true,true));state.rngSeed=12345;
        const final=withMeetRaceContext(meet,60,2026,()=>simulateRelay(members,kind,true,false));
        relays.push({meet,kind,index,total:prelim.total,final:final.total,legs:round2(prelim.legs.reduce((sum,x)=>sum+x,0)),
          last:prelim.cumulativeLegs.at(-1),finish:prelim.trajectory.at(-1).t});
      }
    }
    return{seed:state.cpuCompetitionSeed,counts:Object.fromEntries(Object.entries(categories).map(([c,r])=>[c,r.length])),pairs,pbs,draws,bad,
      drawProfilesStable:before===profilesBefore,reloadStable,raceProfilesStable:profilesBefore===JSON.stringify([state.players,state.world]),recordChecks,races,relays};
  })()`);
  assert.deepEqual(result.bad,[]);
  assert.ok(result.drawProfilesStable&&result.reloadStable&&result.raceProfilesStable);
  assert.equal(result.counts.own,32);
  assert.equal(result.pbs,(result.pairs-result.counts.own*15));
  assert.equal(result.draws,result.pairs*16);
  assert.equal(result.races.length,450);
  assert.equal(result.recordChecks.length,45);
  for(const row of result.recordChecks){assert.deepEqual(row.actual,row.expected,JSON.stringify(row));assert.ok(row.identities&&row.fastest&&row.unique,JSON.stringify(row))}
  for(const row of result.races){
    assert.equal(row.actualBase,row.base,JSON.stringify(row));
    for(const key of ['expected','splits','last'])assert.equal(row[key],row.total,JSON.stringify(row));
    assert.ok(Math.abs(row.finish-row.total)<1e-7,JSON.stringify(row));
    assert.equal(row.distance,Number(row.event.match(/\d+/)[0]),JSON.stringify(row));
  }
  for(const row of result.relays){
    assert.equal(row.total,row.final,JSON.stringify(row));
    assert.equal(row.total,row.legs,JSON.stringify(row));assert.equal(row.total,row.last,JSON.stringify(row));
    assert.ok(Math.abs(row.finish-row.total)<1e-7,JSON.stringify(row));
  }
  const summary={seed,counts:result.counts,athleteEventPairs:result.pairs,PBs:result.pbs,draws:result.draws,individualTopTens:result.recordChecks.length,recordedRaces:result.races.length,recordedRelays:result.relays.length,unreachablePBs:result.bad.length};
  t.diagnostic(JSON.stringify(summary));
  if(process.env.SWIM_RESET_REPORT_DIR){fs.mkdirSync(process.env.SWIM_RESET_REPORT_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.SWIM_RESET_REPORT_DIR,`reset-${seed}.json`),JSON.stringify({...summary,races:result.races,relays:result.relays},null,2));}
});
