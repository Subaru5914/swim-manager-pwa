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

test('winter invitations favor event ability and prestigious colleges while keeping four age groups and random outsiders',()=>{
  const run=game(),result=run(`(()=>{
    state.universities=[{name:'一般大学',reputation:80},{name:'強豪大学',reputation:200},{name:'名門大学',reputation:300}];
    const categories=['middle','high','university','adult'];
    const candidates=categories.flatMap(category=>Array.from({length:99},(_,i)=>({id:category+i,category,organization:state.universities[i%3].name,
      stats:Object.fromEntries(STATS.map(k=>[k,195-i])),bestTimes:{fr100:48+i*.1},index:i})));
    const before=JSON.stringify(candidates),counts=Object.fromEntries(categories.map(category=>[category,{top:0,bottom:0,total:0}])),college={},lineups=new Set();
    for(let seed=1;seed<=400;seed++){
      state.rngSeed=seed;const entries=selectJointCpuEntries(candidates,48,'fr100');
      if(entries.length!==48||new Set(entries.map(a=>a.id)).size!==48)throw Error('invalid capacity');
      for(const category of categories)if(entries.filter(a=>a.category===category).length!==12)throw Error('age group lost');
      for(const a of entries){const c=counts[a.category];c.total++;if(a.index<25)c.top++;if(a.index>=74)c.bottom++;if(a.category==='university')college[a.organization]=(college[a.organization]||0)+1}
      lineups.add(entries.map(a=>a.id).sort().join('|'));
    }
    return{counts,college,lineups:lineups.size,unchanged:before===JSON.stringify(candidates)};
  })()`);
  assert.ok(result.unchanged);assert.equal(result.lineups,400);
  for(const counts of Object.values(result.counts)){
    assert.ok(counts.top/counts.total>.4,JSON.stringify(counts));
    assert.ok(counts.bottom/counts.total>.02,JSON.stringify(counts));
  }
  assert.ok(result.college['名門大学']>result.college['強豪大学']&&result.college['強豪大学']>result.college['一般大学'],JSON.stringify(result.college));
});

test('winter invitation draws use each event, handle tied abilities fairly and retain capacity edge cases',()=>{
  const run=game(),result=run(`(()=>{
    const candidates=Array.from({length:80},(_,i)=>({id:'tie-'+i,category:'high',stats:Object.fromEntries(STATS.map(k=>[k,120])),bestTimes:{fr100:60}}));
    const before=JSON.stringify(candidates);let first=0,last=0;
    for(let seed=1;seed<=200;seed++){state.rngSeed=seed;for(const a of selectJointCpuEntries(candidates,16,'fr100')){if(+a.id.split('-')[1]<40)first++;else last++}}
    const many=selectJointCpuEntries(candidates,100,'fr100'),none=selectJointCpuEntries(candidates,0,'fr100'),empty=selectJointCpuEntries([],8,'fr100');
    const tiesUnchanged=before===JSON.stringify(candidates);
    candidates.forEach((a,i)=>{a.stats.fr_speed=a.stats.fr_stamina=a.stats.fr_turn=190-i;a.stats.ba_speed=a.stats.ba_stamina=a.stats.ba_turn=110+i});
    const average=event=>{let sum=0;for(let seed=1;seed<=100;seed++){state.rngSeed=seed;sum+=selectJointCpuEntries(candidates,16,event).reduce((n,a)=>n+ +a.id.split('-')[1],0)}return sum/1600};
    state.rngSeed=123;const one=selectJointCpuEntries(candidates,16,'fr100').map(a=>a.id);state.rngSeed=123;const again=selectJointCpuEntries(candidates,16,'fr100').map(a=>a.id);
    return{first,last,edges:many.length===80&&many!==candidates&&none.length===0&&empty.length===0,tiesUnchanged,fr:average('fr100'),ba:average('ba100'),one,again};
  })()`);
  assert.ok(result.edges&&result.tiesUnchanged);assert.ok(result.first/(result.first+result.last)>.45&&result.first/(result.first+result.last)<.55,JSON.stringify(result));
  assert.ok(result.fr<32&&result.ba>47,JSON.stringify(result));assert.deepEqual(result.one,result.again);
});

test('January and February record races preserve own entries and fill heats with eligible swimmers from every age',()=>{
  const run=game(),rows=run(`(()=>{
    simulateRace=(a,e)=>({total:a.bestTimes[e]+.5});simulateMeetRace=simulateRace;updateResultHistory=()=>({pb:false,newlyCleared:[]});
    const reports=[];
    for(const slot of [76,84])for(const event of ['fr50','fr100','fr200','fr400','ba50','im200']){
      state.slot=slot;
      state.world=['middle','high','university','adult'].flatMap(category=>Array.from({length:40},(_,i)=>({id:category+i,category,organization:'参加チーム',specialty:SPECIALTY_EVENTS.includes(event)?event:strokeForEvent(event)+'100',
        stats:Object.fromEntries(STATS.map(k=>[k,170-i])),imAptitude:{speed:0,stamina:0},bestTimes:{[event]:distanceOf(event)+i}})));
      state.world.push({...state.world[0],id:'retired',retired:true},{...state.world[0],id:'foreign',category:'foreign'});
      state.players=[{id:'own',name:'自選手',bestTimes:{[event]:distanceOf(event)+10}}];
      const result=runEvent('joint_record',event,['own']);
      reports.push({label:meetLabel('joint_record',slot),count:result.prelim.length,expected:preliminaryHeatCount('joint_record',event)*8,
        sizes:result.heats.map(h=>h.length),ids:result.prelim.map(row=>row.athlete.id),ages:[...new Set(result.prelim.filter(row=>row.source==='CPU').map(row=>row.athlete.category))]});
    }return reports;
  })()`);
  for(const row of rows){assert.equal(row.count,row.expected);assert.ok(row.sizes.every(n=>n===8));assert.equal(new Set(row.ids).size,row.count);assert.ok(row.ids.includes('own'));assert.ok(!row.ids.includes('retired')&&!row.ids.includes('foreign'));assert.deepEqual(row.ages.sort(),['adult','high','middle','university'])}
  assert.deepEqual([...new Set(rows.map(row=>row.label))],['Higashikata CUP','ダイナミオープン']);
});

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

test('college selections use full university ranks beyond fifty, without specialty or freestyle penalties overriding a better place',()=>{
 const run=game(),r=run(`(()=>{
  const events=['fr50','fr100','fr200','fr400','ba100','br100','fly100','im200','im400'],ahead=[68,60,55,57,54,64,67,65,66];
  const target={id:'target',category:'university',organization:'関西大学',specialty:'fr100',bestTimes:Object.fromEntries(events.map(e=>[e,standardFor('intercollege',e)*.95]))};
  state.players=[{id:'own',year:2,bestTimes:Object.fromEntries(events.map(e=>[e,target.bestTimes[e]*.8]))}];
  state.world=[target,...Array.from({length:70},(_,i)=>({id:'external-'+i,category:'university',organization:'大会外大学',bestTimes:Object.fromEntries(events.filter((e,j)=>i<ahead[j]).map(e=>[e,target.bestTimes[e]*(.8+i*.001)]))})),
   ...['middle','high','adult'].map(category=>({id:category,category,bestTimes:Object.fromEntries(events.map(e=>[e,1]))}))];
  const before=JSON.stringify(state),ranks=Object.fromEntries(events.map(e=>[e,categoryPersonalBestRankings('university').get(e).byId.get(target.id)]));
  const reports=['kansai_college','intercollege'].map(meet=>{const entries=buildCpuCollegeEntries(meet);return{meet,selected:events.filter(e=>entries[e].includes(target.id))}});
  return{ranks,reports,unchanged:before===JSON.stringify(state)};
 })()`);
 assert.ok(r.unchanged);assert.ok(Object.values(r.ranks).every(rank=>rank>50));assert.equal(r.ranks.ba100,56);assert.equal(r.ranks.fr200,57);assert.equal(r.ranks.fr400,59);
 for(const row of r.reports)assert.deepEqual(row.selected,['fr200','fr400','ba100']);
});
test('own university swimmers affect event priorities while other age groups and retired swimmers do not',()=>{
 const run=game(),r=run(`(()=>{
  const events=['fr100','fr200','fr400','ba100'],ahead=[3,2,1,1];
  const target={id:'target',category:'university',organization:'関西大学',specialty:'fr100',bestTimes:Object.fromEntries(events.map(e=>[e,standardFor('intercollege',e)*.95]))};
  state.world=[target,...Array.from({length:3},(_,i)=>({id:'external-'+i,category:'university',organization:'大会外大学',bestTimes:Object.fromEntries(events.filter((e,j)=>i<ahead[j]).map(e=>[e,target.bestTimes[e]*.9]))})),
   ...['middle','high','adult'].map(category=>({id:category,category,bestTimes:{fr200:1}})),{id:'retired',category:'university',retired:true,bestTimes:{fr200:1}}];
  const selected=()=>{const entries=buildCpuCollegeEntries('intercollege');return events.filter(e=>entries[e].includes(target.id))};
  const without=selected();state.players=Array.from({length:3},(_,i)=>({id:'own'+i,year:i+1,bestTimes:{fr200:100+i}}));
  return{without,withOwn:selected(),rank:categoryPersonalBestRankings('university').get('fr200').byId.get(target.id)};
 })()`);
 assert.deepEqual(r.without,['fr200','fr400','ba100']);assert.deepEqual(r.withOwn,['fr100','fr400','ba100']);assert.equal(r.rank,6);
});
test('promoted fourth-place swimmers can replace a lower-priority event and cause further PB-ordered promotions',()=>{
 const run=game(),r=run(`(()=>{
  const events=['fr50','fr100','fr200','fr400','ba100','br100','fly100'];
  const team=Array.from({length:9},(_,i)=>({id:'p'+i,category:'university',organization:'関西大学',specialty:'fr100',bestTimes:Object.fromEntries(events.map(e=>[e,standardFor('intercollege',e)*(.85+i*.005)]))}));
  const ahead={fr50:30,fr100:20,fr200:10,fr400:5};
  state.world=team.concat(Array.from({length:30},(_,i)=>({id:'external-'+i,category:'university',organization:'大会外大学',bestTimes:Object.fromEntries(Object.keys(ahead).filter(e=>i<ahead[e]).map(e=>[e,team[0].bestTimes[e]*(.8+i*.001)]))})));
  const before=JSON.stringify(state),entries=buildCpuCollegeEntries('intercollege'),byId=Object.fromEntries(team.map(a=>[a.id,events.filter(e=>entries[e].includes(a.id))]));
  return{entries,byId,unchanged:before===JSON.stringify(state)};
 })()`);
 assert.ok(r.unchanged);for(const id of ['p0','p1','p2'])assert.deepEqual(r.byId[id],['ba100','br100','fly100']);
 for(const id of ['p3','p4','p5'])assert.deepEqual(r.byId[id],['fr100','fr200','fr400']);
 assert.deepEqual(r.entries.fr50,['p6','p7','p8']);for(const events of Object.values(r.byId))assert.ok(events.length<=3);
});
test('ranked college ties are deterministic, limited fields remain short and standards or missing PBs cannot be bypassed',()=>{
 const run=game(),r=run(`(()=>{
  const events=['fr50','fr100','fr200','fr400'],reports=[];
  for(const meet of ['kansai_college','intercollege']){
   const a={id:'target',category:'university',organization:'関西大学',specialty:'fr400',bestTimes:Object.fromEntries(events.map(e=>[e,standardFor('intercollege',e)*.95]))};
   state.world=[a];const before=JSON.stringify(state),entries=buildCpuCollegeEntries(meet),selected=events.filter(e=>entries[e].includes(a.id)),stable=before===JSON.stringify(state);
   a.bestTimes={fr100:standardFor(meet,'fr100'),im200:standardFor(meet,'im200')+.01,ba50:1};const limited=buildCpuCollegeEntries(meet);
   reports.push({meet,selected,stable,limited:EVENTS.filter(e=>limited[e].includes(a.id))});
  }
  return reports;
 })()`);
 for(const row of r){assert.deepEqual(row.selected,['fr50','fr100','fr400']);assert.ok(row.stable);assert.deepEqual(row.limited,['fr100'])}
});

test('November medley priority retains the university top-fifteen rule and includes own students',()=>{
  const run=game(),result=run(`(()=>{
    const events=['fr50','fr100','fr200','fr400','im200','im400'],reports=[];
    const fixture=(rank200,rank400)=>{
      const target={id:'target',category:'university',organization:'関西大学',specialty:'fr100',bestTimes:{fr50:23,fr100:50,fr200:110,fr400:220,im200:120,im400:255}};
      state.players=[{id:'own-ranker',year:1,bestTimes:{im200:115,im400:245}}];
      state.world=[target,...Array.from({length:14},(_,i)=>({id:'ranker-'+i,category:'university',organization:'大会外大学',bestTimes:{...(i<rank200-2?{im200:111+i*.1}:{}),...(i<rank400-2?{im400:240+i*.1}:{})}})),
        ...['middle','high','adult'].map(category=>({id:category,category,bestTimes:{im200:117,im400:247}})),
        {id:'retired',category:'university',retired:true,bestTimes:{im200:116,im400:246}}];
      return target;
    };
    rng=()=>.5;
    for(const meet of ['teijimayama_championship'])for(const rank200 of [15,16])for(const rank400 of [15,16]){
      fixture(rank200,rank400);const before=JSON.stringify([state.players,state.world]);
      const actualRanks=['im200','im400'].map(event=>ranking(event,'university',50).findIndex(a=>a.id==='target')+1);
      const globalRanks=['im200','im400'].map(event=>ranking(event,'all',50).findIndex(a=>a.id==='target')+1);
      const entries=buildCpuCollegeEntries(meet),selected=events.filter(event=>entries[event].includes('target'));
      reports.push({meet,rank200,rank400,actualRanks,globalRanks,selected,unchanged:before===JSON.stringify([state.players,state.world])});
    }
    return{reports};
  })()`);
  for(const row of result.reports){
    assert.deepEqual(row.actualRanks,[row.rank200,row.rank400]);assert.ok(row.globalRanks.every(rank=>rank>15));assert.ok(row.unchanged);
    const expected=['fr100',...(row.rank200===15?['im200']:[]),...(row.rank400===15?['im400']:[])];
    for(const event of ['fr200','fr400','fr50'])if(expected.length<3)expected.push(event);
    assert.deepEqual([...row.selected].sort(),expected.sort(),JSON.stringify(row));
  }
});

test('November ranked medleys retain weighted random selection',()=>{
  const run=game(),rows=run(`(()=>{
    const events=['fr50','fr100','fr200','im200','im400'],rows=[];
    for(const rank of [15,16]){
      const target={id:'target',category:'university',organization:'関西大学',specialty:'fr100',bestTimes:{fr50:23,fr100:50,fr200:110,im200:120,im400:255}};
      state.world=[target,...Array.from({length:rank-1},(_,i)=>({id:'ranker-'+i,category:'university',organization:'大会外大学',bestTimes:{im200:111+i*.1,im400:240+i*.1}}))];
      const before=JSON.stringify(state.world),counts={im200:0,im400:0},lineups=new Set();let valid=true;
      for(let seed=1;seed<=400;seed++){
        state.rngSeed=seed;const entries=buildCpuCollegeEntries('teijimayama_championship'),selected=EVENTS.filter(event=>entries[event].includes(target.id));
        if(selected.length!==3||Object.values(entries).some(ids=>ids.length>3))valid=false;
        for(const event of ['im200','im400'])if(selected.includes(event))counts[event]++;
        lineups.add(selected.join('|'));
      }
      rows.push({rank,counts,valid,lineups:lineups.size,unchanged:before===JSON.stringify(state.world)});
    }return rows;
  })()`);
  for(const row of rows){assert.ok(row.valid&&row.unchanged);assert.ok(row.lineups>5)}
  for(const event of ['im200','im400']){assert.ok(rows[0].counts[event]>rows[1].counts[event]*1.5,JSON.stringify(rows));assert.ok(rows[0].counts[event]<400)}
});

test('November event draws retain the reduced freestyle sprint priority',()=>{
  const run=game(),rows=run(`(()=>{
    const events=['fr50','fr100','fr200','fr400','ba100'],rows=[];
    for(const meet of ['teijimayama_championship'])for(const specialty of ['fr100','ba100','fr50']){
      const target={id:'target',category:'university',organization:'関西大学',specialty,bestTimes:Object.fromEntries(events.map(event=>[event,standardFor('intercollege',event)*.95]))};
      state.world=[target];const before=JSON.stringify(state.world),counts=Object.fromEntries(events.map(event=>[event,0])),lineups=new Set();let valid=true;
      for(let seed=1;seed<=800;seed++){
        state.rngSeed=profileHash('fr50-invitations:'+seed);const entries=buildCpuCollegeEntries(meet),selected=EVENTS.filter(event=>entries[event].includes(target.id));
        if(selected.length!==3||Object.values(entries).some(ids=>ids.length>3))valid=false;
        for(const event of selected)if(event in counts)counts[event]++;
        lineups.add(selected.join('|'));
      }
      const unchanged=before===JSON.stringify(state.world);
      // A meet without standards permits PB-less entries too. Test short lists
      // in the two restricted college meets, where missing PBs exclude events.
      let few=null,noDraw=null;
      if(meet!=='teijimayama_championship'){
        target.bestTimes=Object.fromEntries(['fr50','fr100','fr200'].map(event=>[event,target.bestTimes[event]]));
        const seed=state.rngSeed,entries=buildCpuCollegeEntries(meet);few=EVENTS.filter(event=>entries[event].includes(target.id));noDraw=seed===state.rngSeed;
      }
      rows.push({meet,specialty,counts,valid,lineups:lineups.size,unchanged,few,noDraw});
    }return rows;
  })()`);
  for(const row of rows){
    const comparison=row.specialty==='fr100'?'fr200':'fr100';
    assert.ok(row.counts.fr50<row.counts[comparison],JSON.stringify(row));
    assert.ok(row.counts.fr50>0&&row.counts.fr50<800,JSON.stringify(row));assert.ok(row.valid&&row.unchanged,JSON.stringify(row));assert.ok(row.lineups>3);
    if(row.few){assert.deepEqual(row.few,['fr50','fr100','fr200']);assert.ok(row.noDraw)}
  }
});

test('college conflicts retain rank-preferred events and fill every available slot by team PB order',()=>{
  const run=game();
  const reports=run(`(()=>{
    const events=['fr50','fr100','fr200','ba100','br100','fly100','im200','im400'];
    // Eight events need 24 places; ten swimmers retain the original fixture's
    // six spare athlete-event places for PB-ordered replacements.
    state.world=Array.from({length:10},(_,i)=>({id:'p'+i,category:'university',organization:'関西大学',specialty:'fr100',
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
  assert.equal(new Set(reports.map(report=>report.allocation.join(','))).size,1,'rank-based selection is independent of the random seed');
});

test('national meets retain selected qualifiers from all CPU ages and strokes, adding heats beyond the old cap',()=>{
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

test('national entries choose the five best overall PB ranks beyond 50 for every age, regardless of specialty, stroke or ability',()=>{
  const run=game(),rows=run(`(()=>{
    const rows=[];
    for(const meet of ['japan_open','japan_championship'])for(const category of ['middle','high','university','adult']){
      const a={id:'selection',category,specialty:'fr100',stats:Object.fromEntries(STATS.map(k=>[k,80])),bestTimes:Object.fromEntries(EVENTS.map(e=>[e,standardFor(meet,e)*.98]))};
      a.stats.fr_speed=200;a.stats.fr_stamina=200;
      state.world=[a,...EVENTS.flatMap((e,i)=>Array.from({length:100-3*i},(_,n)=>({id:e+n,category:['middle','high','university','adult'][n%4],bestTimes:{[e]:a.bestTimes[e]-.01-n*.001}})))];
      state.players=[];
      const before=JSON.stringify(state),selected=cpuEntryEvents(a,meet),fields=categoryPersonalBestRankings('all');
      rows.push({meet,category,selected,ranks:selected.map(e=>fields.get(e).byId.get(a.id)),unchanged:before===JSON.stringify(state)});
    }return rows;
  })()`);
  for(const row of rows){
    assert.deepEqual(row.selected,['im400','im200','fly200','fly100','fly50'],JSON.stringify(row));
    assert.deepEqual(row.ranks,[59,62,65,68,71]);assert.ok(row.unchanged);
  }
});

test('overall ranks include own swimmers and every age, exclude retired swimmers, and break tied places by specialty then event order',()=>{
  const run=game(),r=run(`(()=>{
    const meet='japan_open',events=['fr50','fr100','fr200','fr400','ba50','ba100'];
    const a={id:'target',category:'high',specialty:'fr100',bestTimes:Object.fromEntries(events.map(e=>[e,standardFor(meet,e)*.97]))};
    state.world=[a,{id:'retired',category:'adult',retired:true,bestTimes:{fr100:a.bestTimes.fr100-1}}];state.players=[];
    const initial=cpuEntryEvents(a,meet);
    state.players=[{id:'own',year:1,bestTimes:{fr100:a.bestTimes.fr100-1}}];
    const withOwn=cpuEntryEvents(a,meet);
    state.world.push(...['middle','high','university','adult'].map((category,i)=>({id:'peer'+i,category,bestTimes:{fr100:a.bestTimes.fr100-1}})));
    const fields=categoryPersonalBestRankings('all'),firstRanks=events.map(e=>fields.get(e).byId.get(a.id));
    // Equal PBs share a place; the target follows all five tied faster swimmers.
    const tiedRanks=fields.get('fr100').rows.filter(p=>p.id!=='target').map(p=>fields.get('fr100').byId.get(p.id));
    const before=JSON.stringify(state),plan=buildCpuNationalEntries(meet),repeat=buildCpuNationalEntries(meet);
    return{initial,withOwn,firstRanks,tiedRanks,selected:events.filter(e=>plan[e].includes(a.id)),unchanged:before===JSON.stringify(state),stable:JSON.stringify(plan)===JSON.stringify(repeat)};
  })()`);
  assert.deepEqual(r.initial,['fr100','fr50','fr200','fr400','ba50']);
  assert.deepEqual(r.withOwn,['fr50','fr200','fr400','ba50','ba100']);
  assert.deepEqual(r.firstRanks,[1,6,1,1,1,1]);assert.deepEqual(r.tiedRanks,[1,1,1,1,1]);
  assert.deepEqual(r.selected,['fr50','fr200','fr400','ba50','ba100']);assert.ok(r.unchanged&&r.stable);
});

test('national selections respect each meet standard, missing or invalid PBs, and allow fewer than five entries or an unqualified specialty',()=>{
  const run=game(),r=run(`(()=>{
    const a={id:'qualifying',category:'adult',specialty:'fr100',stats:Object.fromEntries(STATS.map(k=>[k,140])),bestTimes:{fr100:50.1,fr50:22.7,fr200:Infinity,fr400:0,ba100:NaN,br100:999}};
    state.world=[a];const open=cpuEntryEvents(a,'japan_open'),championship=cpuEntryEvents(a,'japan_championship');
    a.bestTimes={};const none=cpuEntryEvents(a,'japan_open');a.bestTimes.fr100=standardFor('japan_open','fr100');const exact=cpuEntryEvents(a,'japan_open');
    return{open,championship,none,exact};
  })()`);
  assert.deepEqual(r.open,['fr100','fr50']);assert.deepEqual(r.championship,['fr50']);assert.deepEqual(r.none,[]);assert.deepEqual(r.exact,['fr100']);
});

test('national plans include every eligible age and adult alumnus once, exclude outsiders, and preserve all swimmer data and the next draw',()=>{
  const run=game(),r=run(`(()=>{
    const meet='japan_open',stats=Object.fromEntries(STATS.map(k=>[k,140])),bestTimes=Object.fromEntries(EVENTS.map(e=>[e,standardFor(meet,e)*.99]));
    state.world=['middle','high','university','adult'].map(category=>({id:category,category,specialty:'im200',stats,bestTimes}));
    state.world.push({id:'alumni',category:'adult',alumni:true,specialty:'ba100',stats,bestTimes},
      {id:'retired',category:'adult',retired:true,specialty:'fr100',stats,bestTimes},{id:'foreign',category:'foreign',specialty:'fr100',stats,bestTimes},
      {id:'no-pb',category:'high',specialty:'fr100',stats,bestTimes:{}});
    state.players=[{id:'own',year:1,specialty:'fr100',stats,bestTimes}];
    const before=JSON.stringify(state),entries=buildCpuNationalEntries(meet),repeat=buildCpuNationalEntries(meet),counts={};
    for(const ids of Object.values(entries))for(const id of ids)counts[id]=(counts[id]||0)+1;
    return{counts,unchanged:before===JSON.stringify(state),stable:JSON.stringify(entries)===JSON.stringify(repeat),otherMeet:buildCpuNationalEntries('intercollege')};
  })()`);
  assert.deepEqual(r.counts,{middle:5,high:5,university:5,adult:5,alumni:5});assert.ok(r.unchanged&&r.stable);assert.ok(Object.values(r.otherMeet).every(ids=>!ids.length));
});

test('actual national execution freezes five CPU events before new PBs qualify for another event while preserving manual own entries',()=>{
  const run=game(),reports=run(`(()=>{
    const reports=[];
    simulateRace=(a,e)=>({total:a.bestTimes[e]+.1});simulateMeetRace=simulateRace;
    runRelays=()=>[];teamScoring=()=>({});refreshRecordBook=()=>{};refreshScoutBoard=()=>{};prepareMeetCompletion=()=>{};selectJapanTeam=()=>null;
    for(const meet of ['japan_open','japan_championship']){
      const stats=Object.fromEntries(STATS.map(k=>[k,100])),bestTimes=Object.fromEntries(EVENTS.map(e=>[e,standardFor(meet,e)*.99]));
      const cpu={id:'cpu',category:'adult',specialty:'fr100',organization:'CPU',stats:{...stats,ba_speed:180,fly_speed:200},bestTimes:Object.fromEntries(['fr50','fr100','fr200','fr400','ba50'].map(e=>[e,bestTimes[e]]))};
      const own={id:'own',year:1,organization:state.playerUniversity,specialty:'fr100',stats,bestTimes};
      state.world=[cpu,{id:'faster-backstroker',category:'high',organization:'高校',specialty:'ba100',stats,bestTimes:{ba50:cpu.bestTimes.ba50-.1}}];state.players=[own];state.points=0;state.pointLog=[];state.meetHistory=[];
      updateResultHistory=(a,e,t,m,stage,rank)=>{if(a===cpu&&e==='ba50')a.bestTimes.fly50=standardFor(meet,'fly50')*.97;return{rank,pb:false,newlyCleared:[]}};
      const plan=buildCpuNationalEntries(meet),result=executeMeetWithForm(meet,Object.fromEntries(EVENTS.map(e=>[e,['own']])),{});
      const cpuEvents=EVENTS.filter(e=>result.events[e].prelim.some(row=>row.athlete.id==='cpu'));
      const ownEvents=EVENTS.filter(e=>result.events[e].prelim.some(row=>row.athlete.id==='own'));
      reports.push({meet,cpuEvents,ownEvents,qualifiedLater:qualified(cpu,meet,'fly50'),nowWouldChoose:cpuEntryEvents(cpu,meet),plan:EVENTS.filter(e=>plan[e].includes('cpu')),
        correctFinals:EVENTS.every(e=>result.events[e].final.every(row=>result.events[e].prelim.some(pre=>pre.athlete.id===row.athlete.id)))});
    }return reports;
  })()`);
  for(const r of reports){assert.deepEqual(r.cpuEvents,['fr50','fr100','fr200','fr400','ba50']);assert.deepEqual(r.cpuEvents,r.plan);assert.equal(r.ownEvents.length,15);assert.ok(r.qualifiedLater&&r.correctFinals);assert.ok(r.nowWouldChoose.includes('fly50')&&!r.nowWouldChoose.includes('ba50'))}
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
