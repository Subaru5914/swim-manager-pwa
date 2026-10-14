const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(){
  const ctx=vm.createContext({crypto:{getRandomValues:a=>{a[0]=12345;return a}}});
  vm.runInContext(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener')),ctx);
  vm.runInContext(`state={rngSeed:12345,cpuCompetitionSeed:7654321,season:2026,slot:1,points:20,players:[],world:[],meetHistory:[],playerUniversity:'自大学'};
    function swimmer(id,value=138){return{id,name:id,year:2,stats:Object.fromEntries(STATS.map(k=>[k,k==='mental'?100:value])),bestTimes:{},specialty:'fr100'}}`,ctx);
  return code=>JSON.parse(vm.runInContext('JSON.stringify('+code+')',ctx));
}
test('normal strokes transfer exactly six percentage points at 100m and four at 200m while balanced benchmarks and IM weights stay fixed',()=>{
  const run=game(),r=run(`(()=>{
    const rows=['fr','ba','br','fly'].flatMap(stroke=>[50,100,200].filter(d=>EVENTS.includes(stroke+d)).map(d=>{
      const p=swimmer(null,0);p.stats[stroke+'_speed']=200;const speed=abilityValue(p,stroke+d);
      p.stats[stroke+'_speed']=0;p.stats[stroke+'_stamina']=200;return{stroke,d,speed,stamina:abilityValue(p,stroke+d)};
    }));
    const p=swimmer(null,138),balanced=EVENTS.map(e=>({e,ability:abilityValue(p,e)*200,time:expectedTime(p,e),expected:abilityBenchmarkTime(e,138)}));
    const im=[200,400].map(d=>{const p=swimmer(null,120);for(const s of MEDLEY_STROKES)p.stats[s+'_speed']=140;const before=abilityValue(p,'im'+d);for(const s of MEDLEY_STROKES)p.stats[s+'_speed']++;return{d,weight:(abilityValue(p,'im'+d)-before)*200}});
    return{rows,balanced,im};
  })()`);
  const expected={50:[.7533512064343164,.05361930294906165],100:[.609172932330827,.210375939849624],200:[.4151386321626617,.4185027726432532]};
  for(const row of r.rows){assert.ok(Math.abs(row.speed-expected[row.d][0])<1e-12);assert.ok(Math.abs(row.stamina-expected[row.d][1])<1e-12)}
  for(const row of r.balanced){assert.ok(Math.abs(row.ability-138)<1e-10);assert.ok(Math.abs(row.time-row.expected)<1e-10)}
  assert.ok(Math.abs(r.im[0].weight-.588)<1e-10);assert.ok(Math.abs(r.im[1].weight-.343)<1e-10);
});
test('independent form and execution draws retain each combined distance range and possible negative corrections without Gaussian',()=>{
  const run=game(),r=run(`(()=>{
    const candidates=Array.from({length:500},(_,i)=>swimmer('range-'+i));gauss=()=>{throw new Error('extra Gaussian')};
    return MEET_FORMS.flatMap(form=>{
      const p=candidates.find(p=>athleteMeetForm(p,'intercollege',41,2026).level===form.level);state.players=[p];
      return withMeetRaceContext('intercollege',41,2026,()=>['fr50','fr100','fr200','fr400','im200','im400'].map(e=>{
        const d=distanceOf(e),base=expectedTime(p,e);p.bestTimes[e]=base;
        let draws=0;const clocks=[.2,.9].map(selector=>[0,.25,.5,.75,.999999].map(q=>{let turn=0;rng=()=>{draws++;return turn++%2===0?selector:q};return raceTarget(p,e)-base}));
        rng=()=>{state.rngSeed=(Math.imul(state.rngSeed,1664525)+1013904223)>>>0;return state.rngSeed/4294967296};
        state.rngSeed=12345;let updates=0;for(let i=0;i<5000;i++)if(round2(raceTarget(p,e))<round2(base))updates++;
        rng=()=>0;const fastest=round2(raceTarget(p,e));
        return{level:form.level,e,d,base,clocks,draws,updates,fastest};
      }));
    });
  })()`);
  const ranges={50:[[-.02,1.2],[-.05,.8],[-.1,.5],[-.15,.3],[-.25,.1]],100:[[-.04,2.4],[-.1,1.6],[-.2,1],[-.3,.6],[-.6,.2]],200:[[-.1,5],[-.25,3.5],[-.5,2],[-.8,1.2],[-1.2,.5]],400:[[-.2,10],[-.5,7],[-1,4],[-1.5,2.5],[-2.5,1]]};
  for(const row of r){
    const [min,max]=ranges[row.d][row.level+2],radius={50:.5,100:.8,200:1,400:2}[row.d];assert.equal(row.draws,40);assert.ok(row.fastest<Math.round(row.base*100)/100,JSON.stringify(row));assert.ok(row.updates>0&&row.updates<4900);
    [0,Math.sqrt(.125),.5,1-Math.sqrt(.125),1-Math.sqrt(.000001/2)].forEach((q,i)=>assert.ok(Math.abs(row.clocks[0][i]-(min-radius+(max-min+2*radius)*q))<1e-9,JSON.stringify(row)));
    [0,.25,.5,.75,.999999].forEach((q,i)=>assert.ok(Math.abs(row.clocks[1][i]-(min-radius+(max-min+2*radius)*q))<1e-9,JSON.stringify(row)));
  }
});
test('PBs and their changes cannot alter any individual or relay-leg base clock',()=>{
  const run=game(),r=run(`(()=>{
    const p=swimmer('reference');state.players=[p];rng=()=>.5;
    return withMeetRaceContext('joint_record',82,2026,()=>EVENTS.map(e=>{
      const base=expectedTime(p,e),times=[null,base-10,base,base+30].map(pb=>{p.bestTimes[e]=pb;return raceTarget(p,e)});
      return{e,base,times};
    }));
  })()`);
  for(const row of r)assert.ok(row.times.every(t=>t===row.times[0]));
});
test('the mixture keeps the mean and bounds, places seventy percent in the central half and reduces extreme races',()=>{
  const run=game(),r=run(`(()=>{
    const count=60000,measure=draw=>{
      state.rngSeed=987654321;let sum=0,squares=0,central=0,extreme=0,min=Infinity,max=-Infinity;
      for(let i=0;i<count;i++){const x=draw();sum+=x;squares+=x*x;central+=x>=.25&&x<=.75;extreme+=x<.1||x>.9;min=Math.min(min,x);max=Math.max(max,x)}
      const mean=sum/count;return{mean,variance:squares/count-mean*mean,central:central/count,extreme:extreme/count,min,max};
    };
    const mixed=measure(()=>sampleRaceCorrection(0,1)),uniform=measure(()=>rand(0,1));
    state.rngSeed=321;const saved=JSON.stringify(state),first=Array.from({length:20},()=>sampleRaceCorrection(-1,4));state=JSON.parse(saved);
    return{mixed,uniform,reproducible:JSON.stringify(first)===JSON.stringify(Array.from({length:20},()=>sampleRaceCorrection(-1,4)))};
  })()`);
  assert.ok(Math.abs(r.mixed.mean-.5)<.005);assert.ok(Math.abs(r.mixed.central-.70)<.01);assert.ok(Math.abs(r.mixed.extreme-.072)<.005);
  assert.ok(r.mixed.variance/r.uniform.variance>.57&&r.mixed.variance/r.uniform.variance<.63);
  assert.ok(r.mixed.min>=0&&r.mixed.min<.002&&r.mixed.max<=1&&r.mixed.max>.998);assert.ok(r.reproducible);
});
test('real preliminary and final simulation uses the same ability base after a preliminary PB improvement',()=>{
  const run=game(),r=run(`(()=>{
    const p=Array.from({length:200},(_,i)=>swimmer('real-'+i)).find(p=>athleteMeetForm(p,'joint_record',82,2026).level===0);
    p.bestTimes.fr100=expectedTime(p,'fr100');state.players=[p];const before=p.bestTimes.fr100;
    rng=()=>0;gauss=()=>0;updateResultHistory=(a,e,t)=>{if(t<a.bestTimes[e])a.bestTimes[e]=t;return{pb:t<a.bestTimes[e]}};
    const result=withMeetRaceContext('joint_record',82,2026,()=>runEvent('joint_record','fr100',[p.id]));
    return{before,prelim:result.prelim[0].race.total,final:result.final[0].race.total,finalFinish:result.final[0].race.trajectory.at(-1).t};
  })()`);
  assert.equal(r.prelim,Math.round((r.before-1)*100)/100);assert.equal(r.final,Math.round((r.before-1)*100)/100);assert.equal(r.finalFinish,r.final);
});
test('repeated PB updates never move the ability base while training improves it',()=>{
  const run=game(),r=run(`(()=>{
    const p=swimmer('ceiling');state.players=[p];rng=()=>0;
    const base=expectedTime(p,'fr100');p.bestTimes.fr100=base;
    const outcomes=[];for(let i=0;i<100;i++){const t=raceTarget(p,'fr100');p.bestTimes.fr100=Math.min(p.bestTimes.fr100,t);outcomes.push(t)}
    const stopped=p.bestTimes.fr100;for(const k of STATS)if(k!=='mental')p.stats[k]=175;
    const improved=raceTarget(p,'fr100'),ability=expectedTime(p,'fr100'),pb=p.bestTimes.fr100;
    return{base,stopped,outcomes,improved,ability,pb,unchanged:p.bestTimes.fr100===pb};
  })()`);
  assert.ok(r.outcomes.every(t=>Math.abs(t-(r.base-1))<1e-10));assert.ok(Math.abs(r.stopped-(r.base-1))<1e-10);assert.ok(Math.abs(r.improved-(r.ability-1))<1e-10);assert.ok(r.improved<r.stopped);assert.ok(r.unchanged);
});
test('execution varies independently around zero at the requested width while the full form range and mean stay fixed',()=>{
  const run=game(),r=run(`(()=>{
    const p=swimmer('execution');state.players=[p];
    return EVENTS.map(e=>{
      const d=distanceOf(e),radius=RACE_EXECUTION_RANGE[d],[min,max]=MEET_FORM_TIME_RANGES[d][2];
      const samples=[0,.5,.999999].map(q=>{let i=0;rng=()=>[.9,.5,.9,q][i++];return raceTimeCorrections(p,e)});
      const originalRng=rng;rng=()=>{state.rngSeed=(Math.imul(state.rngSeed,1664525)+1013904223)>>>0;return state.rngSeed/4294967296};state.rngSeed=987654321;
      let sum=0,raceSum=0,lo=Infinity,hi=-Infinity,central=0;const count=20000,width=max-min+2*radius;
      for(let i=0;i<count;i++){const c=raceTimeCorrections(p,e),x=c.formCorrection+c.raceCorrection;sum+=x;raceSum+=c.raceCorrection;lo=Math.min(lo,x);hi=Math.max(hi,x);central+=x>=min-radius+width*.25&&x<=min-radius+width*.75}
      rng=originalRng;return{e,radius,min,max,samples,mean:sum/count,raceMean:raceSum/count,lo,hi,central:central/count};
    });
  })()`);
  for(const row of r){
    assert.ok(row.samples.every(c=>Math.abs(c.formCorrection-(row.min+row.max)/2)<1e-10));
    assert.ok(Math.abs(row.samples[0].raceCorrection+row.radius)<1e-10);assert.equal(row.samples[1].raceCorrection,0);assert.ok(row.samples[2].raceCorrection>row.radius*.99);
    assert.ok(Math.abs(row.mean-(row.min+row.max)/2)<(row.max-row.min)*.01);assert.ok(Math.abs(row.raceMean)<row.radius*.01);
    assert.ok(row.lo>=row.min-row.radius&&row.hi<=row.max+row.radius);assert.ok(row.central>.80&&row.central<.91,JSON.stringify(row));
  }
});
