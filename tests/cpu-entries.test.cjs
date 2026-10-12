const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(){
  const context=vm.createContext({crypto:{getRandomValues:a=>{a[0]=12345;return a;}}});
  vm.runInContext(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener')),context);
  const run=code=>vm.runInContext(code,context);
  run(`state={playerUniversity:'自大学',season:2026,slot:1,rngSeed:12345,universities:[{id:'k',name:'関西大学'},{id:'n',name:'関東大学'}],kansaiIds:['k'],interIds:['k','n'],players:[],world:[]};`);
  return code=>JSON.parse(run(`JSON.stringify(${code})`));
}

test('college entries choose each university\'s fastest qualified PBs, regardless of specialty or filler flag',()=>{
  const run=game();
  const result=run(`(()=>{
    const events=['ba100','br100'];
    for(const org of ['関西大学','関東大学'])for(let i=0;i<5;i++)state.world.push({id:org+i,organization:org,category:'university',specialty:'fr100',cpuFieldRoster:i===0,
      bestTimes:Object.fromEntries(events.map(e=>[e,standardFor('intercollege',e)*(.8+i*.03)]))});
    for(const [id,category,organization,retired] of [['high','high','関西大学',false],['retired','university','関西大学',true],['unregistered','university','対象外',false]])
      state.world.push({id,category,organization,retired,specialty:'ba100',bestTimes:{ba100:40,br100:45}});
    state.world.push({id:'slow',category:'university',organization:'関西大学',specialty:'ba100',bestTimes:{ba100:999,br100:999}});
    const before=JSON.stringify(state.world),kansai=buildCpuCollegeEntries('kansai_college'),inter=buildCpuCollegeEntries('intercollege');
    return {kansai,inter,unchanged:before===JSON.stringify(state.world)};
  })()`);
  assert.equal(result.unchanged,true);
  for(const event of ['ba100','br100']){
    assert.deepEqual(result.kansai[event],['関西大学0','関西大学1','関西大学2']);
    assert.deepEqual(result.inter[event],['関西大学0','関西大学1','関西大学2','関東大学0','関東大学1','関東大学2']);
  }
  assert.deepEqual(result.inter.ba50,[]);
});

test('college conflicts retain random three events and replace withdrawn entries by qualified PB order',()=>{
  const run=game();
  const reports=run(`(()=>{
    const events=['fr50','fr100','fr200','ba100','br100','fly100'];
    state.world=Array.from({length:8},(_,i)=>({id:'p'+i,category:'university',organization:'関西大学',specialty:'fr100',
      bestTimes:Object.fromEntries(events.map(e=>[e,standardFor('intercollege',e)*(.75+i*.02)]))}));
    const results=[];
    for(let seed=1;seed<=30;seed++){
      state.rngSeed=seed;const entries=buildCpuCollegeEntries('intercollege'),counts={},errors=[];
      for(const e of events){
        if(entries[e].length!==3||new Set(entries[e]).size!==3)errors.push('slots '+e);
        const times=entries[e].map(id=>state.world.find(a=>a.id===id).bestTimes[e]);
        if(times.some((time,i)=>i&&time<times[i-1]))errors.push('PB order '+e);
        for(const id of entries[e])counts[id]=(counts[id]||0)+1;
      }
      if(Object.values(counts).some(n=>n>3))errors.push('athlete limit');
      for(const id of ['p0','p1','p2'])if(counts[id]!==3)errors.push('retained '+id);
      // Every slower replacement is preceded by a faster entrant in the same
      // event, or by a swimmer whose three-event allocation is already full.
      for(const e of events)for(const id of entries[e])for(const a of state.world){
        const selected=state.world.find(p=>p.id===id);
        if(a.bestTimes[e]<selected.bestTimes[e]&&!entries[e].includes(a.id)&&(counts[a.id]||0)<3)errors.push('skipped faster '+e);
      }
      results.push({errors,allocation:events.filter(e=>entries[e].includes('p0'))});
    }
    return results;
  })()`);
  for(const report of reports)assert.deepEqual(report.errors,[],JSON.stringify(report));
  assert.ok(new Set(reports.map(report=>report.allocation.join(','))).size>3,'conflict allocation varies across seeds');
});

test('national meets retain all standard-clearing CPU ages and all strokes, adding heats beyond the old cap',()=>{
  const run=game();
  const result=run(`(()=>{
    const reports=[];
    simulateRace=(a,e)=>({total:a.bestTimes[e]+.5});
    simulateMeetRace=(a,e)=>({total:a.bestTimes[e]+.5});
    updateResultHistory=()=>({pb:false,newlyCleared:[]});
    for(const meet of ['japan_open','japan_championship']){
      const event='br100',std=standardFor(meet,event);
      state.world=Array.from({length:72},(_,i)=>({id:'p'+i,category:['middle','high','university','adult'][i%4],organization:'参加チーム',specialty:'fr100',bestTimes:{br100:std-1-i/100}}));
      state.world.push({id:'slow',category:'university',specialty:'br100',bestTimes:{br100:std+.01}},
        {id:'retired',category:'adult',retired:true,specialty:'br100',bestTimes:{br100:std-5}},
        {id:'foreign',category:'foreign',specialty:'br100',bestTimes:{br100:std-5}});
      state.players=[{id:'own',category:'university',organization:'自大学',bestTimes:{br100:std-1}}];
      const race=runEvent(meet,event,['own']);
      reports.push({meet,count:race.prelim.length,unique:new Set(race.prelim.map(r=>r.athlete.id)).size,ids:race.prelim.map(r=>r.athlete.id),
        groups:race.heats.map(h=>h.length),ages:[...new Set(race.prelim.filter(r=>r.source==='CPU').map(r=>r.athlete.category))],final:race.final.length});
    }
    return reports;
  })()`);
  for(const report of result){
    assert.equal(report.count,73);assert.equal(report.unique,73);assert.equal(report.final,8);
    assert.ok(report.ids.includes('own'));assert.ok(report.ids.includes('p71'));
    assert.ok(!report.ids.some(id=>['slow','retired','foreign'].includes(id)));
    assert.deepEqual(report.ages.sort(),['adult','high','middle','university']);
    assert.equal(report.groups.length,10);assert.ok(report.groups.every(size=>size>=4&&size<=8));
  }
});

test('college races preserve every university selection beyond nominal heat capacity',()=>{
  const run=game();
  const result=run(`(()=>{
    const meet='intercollege',event='fr100',std=standardFor(meet,event);
    simulateRace=(a,e)=>({total:a.bestTimes[e]+.5});
    simulateMeetRace=(a,e)=>({total:a.bestTimes[e]+.5});
    updateResultHistory=()=>({pb:false,newlyCleared:[]});
    state.universities=Array.from({length:20},(_,i)=>({id:'u'+i,name:'大学'+i}));
    state.interIds=state.universities.map(u=>u.id);
    state.world=state.universities.flatMap((u,i)=>Array.from({length:4},(_,n)=>({id:u.id+'p'+n,category:'university',organization:u.name,specialty:'br100',bestTimes:{fr100:std-2+(i*4+n)/100}})));
    const entries=buildCpuCollegeEntries(meet),race=runEvent(meet,event,[],entries);
    const automatic=runEvent(meet,event,[]);
    return {selected:entries[event].sort(),raced:race.prelim.map(r=>r.athlete.id).sort(),automatic:automatic.prelim.map(r=>r.athlete.id).sort(),groups:race.heats.map(h=>h.length)};
  })()`);
  assert.equal(result.selected.length,60);assert.deepEqual(result.raced,result.selected);assert.deepEqual(result.automatic,result.selected);
  assert.equal(result.groups.length,8);assert.ok(result.groups.every(size=>size>=4&&size<=8));
});

test('national playback includes own swimmers in first and last heats beyond the former six-heat limit',()=>{
  const run=game();
  const result=run(`(()=>{
    const meet='japan_open',event='br100',std=standardFor(meet,event);
    simulateRace=(a,e)=>({total:a.bestTimes[e]+.5,trajectory:[{phase:'finish',t:a.bestTimes[e]+.5}]});
    simulateMeetRace=simulateRace;updateResultHistory=()=>({pb:false,newlyCleared:[]});
    state.world=Array.from({length:72},(_,i)=>({id:'p'+i,category:'adult',organization:'参加チーム',specialty:'fr100',bestTimes:{br100:std-1-i/100}}));
    state.players=[{id:'fast',category:'university',organization:'自大学',bestTimes:{br100:std-5}},
      {id:'slow',category:'university',organization:'自大学',bestTimes:{br100:std-.01}}];
    const selections={br100:['fast','slow']},field=runEvent(meet,event,selections.br100);
    const result={meet,events:Object.fromEntries(EVENTS.map(e=>[e,e===event?field:{prelim:[],heats:[],final:[]}])),relays:[]};
    const queue=buildMeetRaceQueue(result,selections);
    return {heats:field.heats.length,prelim:queue.filter(q=>q.stage==='heat').map(q=>({heatNo:q.heatNo,heatCount:q.heatCount,own:q.rows.filter(r=>r.source==='PLAYER').map(r=>r.athlete.id)})),
      finals:queue.filter(q=>q.stage==='final').map(q=>q.rows.filter(r=>r.source==='PLAYER').map(r=>r.athlete.id))};
  })()`);
  assert.equal(result.heats,10);
  assert.deepEqual(result.prelim,[{heatNo:1,heatCount:10,own:['slow']},{heatNo:10,heatCount:10,own:['fast']}]);
  assert.deepEqual(result.finals,[['fast']]);
});
