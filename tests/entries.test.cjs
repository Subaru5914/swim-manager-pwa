const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(full=false){
  const context=vm.createContext({crypto:{getRandomValues:a=>{a[0]=12345;return a;}}});
  vm.runInContext(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener')),context);
  const run=code=>vm.runInContext(code,context);
  run(full?'state=createState()':'state={playerUniversity:"自大学",recordRankings:{},teamTop10:{}}');
  return code=>JSON.parse(run(`JSON.stringify(${code})`));
}

test('competitive heats pack into eight lanes, preserve eligible entrants and seed every lane by PB',()=>{
  const run=game();
  const cases=run(`['kansai_college','intercollege','japan_open','japan_championship','joint_record','world_championship'].flatMap(meet=>['fr100','fr200','fr400'].flatMap(event=>[0,1,3,7,8,9,13,17,25,39,40,48,50,96].map(size=>{
    const field=Array.from({length:size},(_,i)=>({source:i<Math.min(3,size)?'PLAYER':'CPU',athlete:{id:'p'+i,bestTimes:{[event]:i<3?300+i:50+i}}}));
    const before=JSON.stringify(field),heats=seedRaceHeats(field,event,meet),flat=heats.flat();
    return{meet,event,size,max:preliminaryHeatCount(meet,event)*8,lanes:heats.map(h=>h.map(r=>r.heatLane)),count:flat.length,
      unique:new Set(flat.map(r=>r.athlete.id)).size,own:flat.filter(r=>r.source==='PLAYER').map(r=>r.athlete.id).sort(),unchanged:before===JSON.stringify(field)};
  })))`);
  for(const row of cases){
    const expected=Math.min(row.size,row.max);
    assert.equal(row.count,expected,JSON.stringify(row));assert.equal(row.unique,expected);assert.equal(row.unchanged,true);
    assert.deepEqual(row.own,Array.from({length:Math.min(3,row.size)},(_,i)=>'p'+i));
    for(const lanes of row.lanes)assert.deepEqual(lanes,[4,5,3,6,2,7,1,8].slice(0,lanes.length));
    if(expected%8===0)assert.ok(row.lanes.every(lanes=>lanes.length===8));
    if(expected>8)assert.ok(row.lanes.every(lanes=>lanes.length>=4));
    assert.equal(row.lanes.length,Math.ceil(expected/8));
  }
});

test('all registered swimmers survive insufficient fields and own time trials keep every selected swimmer',()=>{
  const run=game();
  const rows=run(`[9,17,25].map(size=>{
    const field=Array.from({length:size},(_,i)=>({source:'PLAYER',athlete:{id:'own'+i,bestTimes:{fr100:50+i}}}));
    return ['japan_open','team_trial'].map(meet=>{const heats=seedRaceHeats(field,'fr100',meet);return{meet,size,count:heats.flat().length,groups:heats.map(h=>h.length),unique:new Set(heats.flat().map(r=>r.athlete.id)).size};});
  }).flat()`);
  for(const row of rows){assert.equal(row.count,row.size);assert.equal(row.unique,row.size);assert.ok(row.groups.every(n=>n<=8));}
});

test('relay heats pack eight teams, keep all eligible teams within capacity and protect own and Japan entries',()=>{
  const run=game();
  const rows=run(`['kansai_college','intercollege','joint_record','world_championship'].flatMap(meet=>RELAYS.flatMap(kind=>[0,1,7,8,13,24,25,39,40,50].map(size=>{
    const required=meet==='world_championship'?'日本':state.playerUniversity;
    const teams=Array.from({length:size},(_,i)=>({organization:i===0?required:'team'+i,members:Array.from({length:4},(_,j)=>({id:i+'-'+j,bestTimes:Object.fromEntries(EVENTS.map(e=>[e,i===0?500:50+i]))}))}));
    const before=JSON.stringify(teams),heats=seedRelayHeats(teams,kind,meet),flat=heats.flat();
    return{meet,kind,size,max:preliminaryHeatCount(meet,kind)*8,count:flat.length,groups:heats.map(h=>h.length),
      lanes:heats.map(h=>h.map(t=>t.heatLane)),unique:new Set(flat.map(t=>t.organization)).size,retained:!size||flat.some(t=>t.organization===required),unchanged:before===JSON.stringify(teams)};
  })))`);
  for(const row of rows){
    const expected=Math.min(row.size,row.max);
    assert.equal(row.count,expected,JSON.stringify(row));assert.equal(row.unique,expected);assert.ok(row.retained&&row.unchanged);
    if(expected%8===0)assert.ok(row.groups.every(n=>n===8));
    if(expected>8)assert.ok(row.groups.every(n=>n>=4));
    assert.equal(row.groups.length,Math.ceil(expected/8));
    for(const lanes of row.lanes)assert.deepEqual(lanes,[4,5,3,6,2,7,1,8].slice(0,lanes.length));
  }
});

test('slow CPU Japanese representatives stay registered alongside own and foreign swimmers',()=>{
  const run=game();
  const result=run(`(()=>{
    const field=Array.from({length:90},(_,i)=>({source:'CPU',nationality:i<2?'日本':'アメリカ',athlete:{id:'p'+i,bestTimes:{fr100:i<2?90:45+i/100}}}));
    const heats=seedRaceHeats(field,'fr100','world_championship');
    return{count:heats.flat().length,groups:heats.map(h=>h.length),japanese:heats.flat().filter(r=>r.nationality==='日本').map(r=>r.athlete.id).sort()};
  })()`);
  assert.equal(result.count,32);assert.deepEqual(result.groups,[8,8,8,8]);assert.deepEqual(result.japanese,['p0','p1']);
});

test('each relay leg orders valid PBs first, preserves selection identities and leaves missing times last',()=>{
  const run=game();
  const rows=run(`(()=>{
    const roster=[
      {id:'a',name:'甲',year:4,bestTimes:{fr100:47,fr200:120,ba100:60,br100:70,fly100:55}},
      {id:'b',name:'乙',year:1,bestTimes:{fr100:50,fr200:100,ba100:55,br100:60,fly100:60}},
      {id:'c',name:'丙',year:2,bestTimes:{fr100:49,fr200:110,ba100:58,br100:65,fly100:50}},
      {id:'missing',name:'未記録',year:1,bestTimes:{}},
      {id:'zero',name:'無効',year:2,bestTimes:Object.fromEntries(EVENTS.map(e=>[e,0]))}];
    const before=JSON.stringify(roster);
    return{orders:Object.fromEntries(['fr100','fr200','ba100','br100','fly100'].map(e=>[e,sortedRelayRoster(roster,e).map(p=>p.id)])),unchanged:before===JSON.stringify(roster)};
  })()`);
  assert.deepEqual(rows.orders.fr100,['a','c','b','missing','zero']);
  assert.deepEqual(rows.orders.fr200,['b','c','a','missing','zero']);
  assert.deepEqual(rows.orders.ba100,['b','c','a','missing','zero']);
  assert.deepEqual(rows.orders.br100,['b','c','a','missing','zero']);
  assert.deepEqual(rows.orders.fly100,['c','a','b','missing','zero']);assert.equal(rows.unchanged,true);
});

test('all history filters group each meet and event as final then prelim without rewriting stored results',()=>{
  const run=game();
  const result=run(`(()=>{
    const p={id:'own',raceHistory:[]};
    for(const season of [2025,2026])for(const slot of [10,20])for(const meet of ['joint_record','intercollege'])for(const event of ['fr100','br100','4x100fr']){
      p.raceHistory.push({season,slot,meet,event,stage:'予選',time:60,rank:2});
      p.raceHistory.push({season,slot,meet,event,stage:event==='4x100fr'?'決勝':'A決勝',time:59,rank:1});
    }
    const before=JSON.stringify(p);
    return{modes:['recent','event','only_relays','only_fr100','only_4x100fr'].map(mode=>({mode,rows:sortedPlayerRaceHistory(p,mode)})),unchanged:before===JSON.stringify(p)};
  })()`);
  assert.equal(result.unchanged,true);
  for(const {mode,rows} of result.modes){
    const groups=new Map();
    for(const row of rows){
      const key=[row.season,row.slot,row.meet,row.event].join(':');
      if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row.stage);
      if(mode==='only_relays'||mode==='only_4x100fr')assert.equal(row.event,'4x100fr');
      if(mode==='only_fr100')assert.equal(row.event,'fr100');
    }
    for(const phases of groups.values())assert.deepEqual(phases,[phases[0]==='決勝'?'決勝':'A決勝','予選']);
    if(mode==='event')assert.equal(rows[0].event,'fr100');
    assert.equal(rows[0].season,2026);assert.equal(rows[0].slot,20);
  }
});

test('actual domestic and world races keep qualified rosters, college limits, representatives and eight-lane prelims',()=>{
  const run=game(true);
  const reports=run(`(()=>{
    const reports=[];
    for(const p of state.players.slice(0,4)){
      p.stats=Object.fromEntries(STATS.map(k=>[k,175]));
      p.bestTimes=Object.fromEntries(EVENTS.map(e=>[e,round2(expectedTime(p,e))]));
    }
    const ids=state.players.slice(0,4).map(p=>p.id),known=new Set([...state.players,...state.world].map(a=>a.id));
    for(const meet of ['team_trial','kansai_college','intercollege','japan_open','japan_championship','joint_record']){
      const entries={fr100:[ids[0]],br100:[ids[1]],im200:[ids[2]],ba100:[ids[3]]};
      const relays=Object.fromEntries(RELAYS.map(kind=>[kind,[...ids]]));
      const result=executeMeet(meet,entries,relays),counts={},organizations={},errors=[];
      for(const [event,field] of Object.entries(result.events)){
        if(meet!=='team_trial'&&meetIndividualEvents(meet).includes(event)&&(field.heats.length!==preliminaryHeatCount(meet,event)||!field.heats.every(h=>h.length===8)))errors.push('incomplete '+event);
        if(meet!=='team_trial'&&field.prelim.length>8&&field.heats.some(h=>h.length<4))errors.push('tiny '+event);
        if(field.heats.some(h=>h.length>8))errors.push('overfull '+event);
        if(new Set(field.prelim.map(r=>r.athlete.id)).size!==field.prelim.length)errors.push('duplicate '+event);
        for(const row of field.prelim){
          const a=row.athlete;counts[a.id]=(counts[a.id]||0)+1;const key=a.organization+'|'+event;organizations[key]=(organizations[key]||0)+1;
          if(!known.has(a.id)||!qualified(a,meet,event)||(row.source==='CPU'&&!allowedCpu(a,meet)))errors.push('invalid '+a.id);
          if(meet==='team_trial'?row.race.physics?.preliminaryDelay!==undefined:!(row.race.physics?.preliminaryDelay>0))errors.push('prelim delay '+event);
        }
        const wanted=entries[event]||[];
        if(wanted.some(id=>!field.prelim.some(r=>r.athlete.id===id)))errors.push('missing own '+event);
        if(field.final.length!==Math.min(8,field.prelim.length)&&meet!=='team_trial')errors.push('qualifiers '+event);
        for(const row of field.final)if(row.race.physics?.preliminaryDelay!==undefined||row.prelimTime!==field.prelim.find(p=>p.athlete.id===row.athlete.id)?.race.total)errors.push('final time '+event);
      }
      if(COLLEGE_ENTRY_LIMIT_MEETS.has(meet)&&(Object.values(counts).some(n=>n>3)||Object.values(organizations).some(n=>n>3)))errors.push('college limit');
      for(const [kind,finals,meta] of result.relays){
        if(meta.heats.length!==preliminaryHeatCount(meet,kind)||!meta.heats.every(h=>h.length===8))errors.push('incomplete relay '+kind);
        if(meta.prelim.length>8&&meta.heats.some(h=>h.length<4))errors.push('tiny relay '+kind);
        if(!meta.prelim.some(t=>t.organization===state.playerUniversity))errors.push('missing own relay');
        if(meta.prelim.some(team=>!(team.race.preliminaryDelay>0))||finals.some(team=>team.race.preliminaryDelay!==undefined||team.prelimTime!==meta.prelim.find(p=>p.organization===team.organization)?.race.total))errors.push('relay phase '+kind);
      }
      reports.push({meet,errors});
    }
    state.season=2027;state.slot=36;const cpu=state.world.find(a=>a.category==='university');
    const selected=[state.players[0],state.players[1],state.players[2],state.players[3],cpu];
    state.japanTeam={year:2027,individual:Object.fromEntries(EVENTS.map(e=>[e,e==='fr100'?[ids[0],cpu.id]:[ids[1]]])),relays:Object.fromEntries(RELAYS.map(k=>[k,[...ids]])),athletes:selected.map(a=>({id:a.id,snapshot:deepClone(a),ownAtSelection:state.players.includes(a)}))};
    const result=executeMeet('world_championship',{},{}),errors=[];
    for(const [event,field] of Object.entries(result.events)){
      if(field.heats.length!==preliminaryHeatCount('world_championship',event)||!field.heats.every(h=>h.length===8))errors.push('incomplete world '+event);
      for(const id of state.japanTeam.individual[event])if(!field.prelim.some(r=>r.athlete.id===id))errors.push('missing representative '+id);
      if(field.prelim.some(row=>!(row.race.physics?.preliminaryDelay>0))||field.final.some(row=>row.race.physics?.preliminaryDelay!==undefined||row.prelimTime!==field.prelim.find(p=>p.athlete.id===row.athlete.id)?.race.total))errors.push('world phase '+event);
    }
    for(const [kind,finals,meta] of result.relays){
      if(meta.heats.length!==preliminaryHeatCount('world_championship',kind)||!meta.heats.every(h=>h.length===8))errors.push('incomplete world relay '+kind);
      if(meta.prelim.length>8&&meta.heats.some(h=>h.length<4))errors.push('tiny world relay '+kind);
      if(!meta.prelim.some(t=>t.organization==='日本'))errors.push('missing Japan relay');
      if(meta.prelim.some(team=>!(team.race.preliminaryDelay>0))||finals.some(team=>team.race.preliminaryDelay!==undefined||team.prelimTime!==meta.prelim.find(p=>p.organization===team.organization)?.race.total))errors.push('world relay phase '+kind);
    }
    reports.push({meet:'world_championship',errors});return reports;
  })()`);
  for(const report of reports)assert.deepEqual(report.errors,[],JSON.stringify(report));
});
