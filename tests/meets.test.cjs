const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const end = source.indexOf('document.getElementById("nav").addEventListener');
function game(seed = 12345) {
  const context = vm.createContext({ crypto: { getRandomValues: a => { a[0] = seed; return a; } } });
  vm.runInContext(source.slice(0, end), context);
  const run = code => vm.runInContext(code, context);
  run('state=createState()');
  return run;
}
const json = (run, code) => JSON.parse(run(`JSON.stringify(${code})`));

test('domestic heats use 6/5/4 groups, world heats use 4/3/2, each with at most eight lanes', () => {
  const run = game();
  const rows = json(run, `['joint_record','kansai_college','intercollege','japan_open','japan_championship','world_championship'].flatMap(meet=>EVENTS.map(e=>{
    let target=preliminaryHeatCount(meet,e),field=Array.from({length:target*8},(_,i)=>({athlete:{id:i,bestTimes:{[e]:100+i}}}));
    let heats=seedRaceHeats(field,e,meet);
    return {meet,e,target,count:heats.length,lanes:heats.map(h=>h.length),unique:new Set(heats.flat().map(x=>x.athlete.id)).size};
  }))`);
  for (const row of rows) {
    const distance = Number(row.e.match(/\d+/)[0]);
    const expected = row.meet === 'world_championship'
      ? (distance <= 100 ? 4 : distance <= 200 ? 3 : 2)
      : (distance <= 100 ? 6 : distance <= 200 ? 5 : 4);
    assert.equal(row.target, expected);
    assert.equal(row.count, expected);
    assert.equal(row.unique, expected * 8);
    assert.ok(row.lanes.every(n => n === 8));
  }
  assert.equal(run(`seedRaceHeats(Array.from({length:17},(_,i)=>({athlete:{id:i,bestTimes:{fr100:100}}})),'fr100','team_trial').length`), 3);
});

test('CPU college entries follow specialties and three-per-event / three-per-athlete limits', () => {
  const run = game();
  const entries = json(run, `['kansai_college','intercollege'].map(meet=>{
    let entries=buildCpuCollegeEntries(meet),counts={},organizations={};
    for(let e of EVENTS)for(let id of entries[e]){
      let a=state.world.find(x=>x.id===id);
      if(!cpuEntryEvents(a).includes(e)||!qualified(a,meet,e))throw Error('invalid CPU entry');
      counts[id]=(counts[id]||0)+1;
      let k=a.organization+'|'+e;organizations[k]=(organizations[k]||0)+1;
    }
    return {athletes:Object.values(counts),events:Object.values(organizations)};
  })`);
  for (const row of entries) {
    assert.ok(row.athletes.length > 0);
    assert.ok(row.athletes.every(n => n <= 3));
    assert.ok(row.events.every(n => n <= 3));
  }
});

test('the eight fastest swimmers across all prelim heats qualify for the final', () => {
  const run = game();
  const result = json(run, `(()=>{
    let r=runEvent('joint_record','fr100',[state.players[0].id]);
    return {groups:r.heats.length,prelim:r.prelim.slice(0,8).map(x=>x.athlete.id).sort(),final:r.final.map(x=>x.athlete.id).sort(),times:r.prelim.map(x=>x.race.total)};
  })()`);
  assert.equal(result.groups, 6);
  assert.deepEqual(result.final, result.prelim);
  assert.deepEqual(result.times, [...result.times].sort((a, b) => a - b));
});

test('college final points are 12/10/8/6/4/3/2/1 and relay points double', () => {
  const run = game();
  const rows = json(run, `['kansai_college','intercollege'].map(meet=>{
    let orgs=Array.from({length:8},(_,i)=>'team'+i),results=Object.fromEntries(EVENTS.map(e=>[e,{final:[]}])) ;
    results.fr100.final=orgs.map(organization=>({athlete:{organization}}));
    let individual=teamScoring(meet,results,[]);
    let relay=teamScoring(meet,Object.fromEntries(EVENTS.map(e=>[e,{final:[]} ])),[['4x100fr',orgs.map(organization=>({organization}))]]);
    return {individual:orgs.map(o=>individual[o]),relay:orgs.map(o=>relay[o])};
  })`);
  for (const row of rows) {
    assert.deepEqual(row.individual, [12, 10, 8, 6, 4, 3, 2, 1]);
    assert.deepEqual(row.relay, [24, 20, 16, 12, 8, 6, 4, 2]);
  }
});

test('empty and multiple legacy training selections become exactly one valid item', () => {
  const run=game();
  const result=json(run,`(()=>{
    return [[],['mental','start'],['mental','fr_speed','fr_stamina'],STATS,['bogus']].map(focus=>{
      let p=state.players[0];p.specialty='fr100';state.trainingFocus[p.id]=focus;
      return ensureTrainingFocus(p);
    });
  })()`);
  assert.deepEqual(result,[['fr_speed'],['mental'],['fr_speed'],['fr_speed'],['fr_speed']]);
});

test('world editions start in 2027 and March belongs to the next calendar year', () => {
  const run = game();
  assert.equal(run(`meetAt({month:8,week:2,half:'後半'},2026)`), null);
  assert.equal(run(`meetAt({month:8,week:2,half:'後半'},2027)`), 'world_championship');
  assert.equal(run(`meetAt({month:8,week:2,half:'後半'},2028)`), null);
  assert.equal(run(`meetAt({month:8,week:2,half:'後半'},2029)`), 'world_championship');
  assert.equal(run(`calendarYear(2026,94)`), 2027);
  assert.equal(run(`calendarYear(2027,36)`), 2027);
});

// Artificial thresholds isolate the selection rule; they do not stand in for official standards.
const selectionFixture = `
  PANPAC_2026_DISPATCH.times=Object.fromEntries(EVENTS.map(e=>[e,100]));
  const fixtureSwimmers=[state.players.find(p=>p.year===4),...state.players.slice(0,3),...state.world.slice(0,4)];
  const fixtureResults=Object.fromEntries(EVENTS.map((e,index)=>[e,{final:fixtureSwimmers.map((a,i)=>({athlete:a,race:{total:98+i},source:state.players.includes(a)?'PLAYER':'CPU'}))}]));
  for(let [e,index] of [['ba100',4],['br100',5],['fly100',6]]){
    fixtureResults[e].final=fixtureSwimmers.map((a,i)=>({athlete:a,race:{total:a===fixtureSwimmers[index]?97:99+i}})).sort((a,b)=>a.race.total-b.race.total);
  }
  state.activeCompetitionSeason=2026;state.activeCompetitionSlot=94;
`;

test('Japan selects up to two standard-clearing finalists, top four freestyle finalists, and medley winners', () => {
  const run = game();
  run(selectionFixture);
  const result = json(run, `(()=>{
    let team=selectJapanTeam(fixtureResults,2027);
    let answer={individual:team.individual.fr100,free:team.relays['4x100fr'],free200:team.relays['4x200fr'],medley:team.relays['4x100medley'],expected:fixtureSwimmers.map(a=>a.id)};
    fixtureResults.fr50.final.forEach((x,i)=>x.race.total=101+i);
    answer.none=selectJapanTeam(fixtureResults,2027).individual.fr50;
    fixtureResults.ba100.final[0].athlete=fixtureSwimmers[0];
    answer.duplicate=selectJapanTeam(fixtureResults,2027).relays['4x100medley'];
    return answer;
  })()`);
  assert.deepEqual(result.individual, result.expected.slice(0, 2));
  assert.deepEqual(result.free, result.expected.slice(0, 4));
  assert.deepEqual(result.free200, result.expected.slice(0, 4));
  assert.deepEqual(result.medley, [result.expected[4], result.expected[5], result.expected[6], result.expected[0]]);
  assert.deepEqual(result.none, []);
  assert.deepEqual(result.duplicate, []);
  assert.equal(run(`selectJapanTeam(fixtureResults,2028)`), null);
});

test('Japan team survives April, missing graduated swimmers, and save migration', () => {
  const run = game();
  run(selectionFixture);
  const result = json(run, `(()=>{
    let team=selectJapanTeam(fixtureResults,2027),id=team.individual.fr100[0],selected=JSON.stringify(team);
    state.activeCompetitionSeason=null;state.activeCompetitionSlot=null;newSeason();
    state.players=state.players.filter(p=>p.id!==id);state.world=state.world.filter(p=>p.id!==id);
    state=JSON.parse(JSON.stringify(state));migrateState();
    return {season:state.season,selection:JSON.stringify(state.japanTeam),selected,id,found:japanTeamAthlete(id)?.id,own:ownJapanAthlete(id),entry:worldAutoEntries(2027).individual.fr100,wrong:worldAutoEntries(2029).individual.fr100};
  })()`);
  assert.equal(result.season, 2027);
  assert.equal(result.selection, result.selected);
  assert.equal(result.found, result.id);
  assert.equal(result.own, true);
  assert.ok(result.entry.includes(result.id));
  assert.deepEqual(result.wrong, []);
});

test('foreign swimmers are random, edition-stable, event specialists and stronger than the domestic field', () => {
  const run = game();
  const result = json(run, `(()=>{
    let international=ensureInternationalWorld(2027),same=international===ensureInternationalWorld(2027);
    let means=EVENTS.map(e=>{
      let foreign=international.athletes.filter(a=>a.individualEligible&&a.specialty===e).map(a=>expectedTime(a,e)).sort((a,b)=>a-b).slice(0,8);
      let domestic=state.world.filter(a=>allowedCpu(a,'japan_championship')&&cpuEntryEvents(a).includes(e)).map(a=>expectedTime(a,e)).sort((a,b)=>a-b).slice(0,8);
      return {e,foreign:foreign.reduce((a,b)=>a+b)/foreign.length,domestic:domestic.reduce((a,b)=>a+b)/domestic.length};
    });
    let relays=RELAYS.map(k=>WORLD_COUNTRIES.map(c=>expectedRelayTime(international.relayTeams[c][k].map(id=>international.athletes.find(a=>a.id===id)),k)).sort((a,b)=>a-b)[0]/WORLD_REFERENCE.relays[k]);
    let oldIds=international.athletes.map(a=>a.id).join(','),next=ensureInternationalWorld(2029);
    return {same,count:international.athletes.length,countries:new Set(international.athletes.map(a=>a.organization)).size,valid:international.athletes.every(a=>STATS.every(k=>a.stats[k]>=0&&a.stats[k]<=200)),changed:oldIds!==next.athletes.map(a=>a.id).join(','),means,relays};
  })()`);
  assert.equal(result.same, true);
  assert.equal(result.count, 864);
  assert.equal(result.countries, 24);
  assert.equal(result.valid, true);
  assert.equal(result.changed, true);
  for (const row of result.means) assert.ok(row.foreign < row.domestic, JSON.stringify(row));
  for (const ratio of result.relays) assert.ok(ratio >= .985 && ratio < 1.04, ratio);
});

test('a complete world meet keeps automatic Japan entries and animates only owned individuals and national relays', () => {
  const run = game();
  run(selectionFixture);
  const result = json(run, `(()=>{
    let team=selectJapanTeam(fixtureResults,2027);state.season=2027;state.slot=36;state.activeCompetitionSeason=2027;state.activeCompetitionSlot=36;
    let automatic=worldAutoEntries(2027),own=worldOwnEntries(2027);
    let meet=executeMeet('world_championship',Object.fromEntries(EVENTS.map(e=>[e,[]])),{});
    let queue=buildMeetRaceQueue(meet,own.individual);
    let groups=EVENTS.map(e=>({e,count:meet.events[e].heats.length,expected:preliminaryHeatCount('world_championship',e),japan:meet.events[e].prelim.filter(x=>x.nationality==='日本').map(x=>x.athlete.id),automatic:automatic.individual[e],top:meet.events[e].prelim.slice(0,8).map(x=>x.athlete.id).sort(),final:meet.events[e].final.map(x=>x.athlete.id).sort()}));
    let onlyOwn=queue.every(q=>q.rows.some(x=>x.source==='PLAYER'));
    let mixedRelay=queue.some(q=>q.event==='4x100medley'&&q.rows.some(x=>x.athlete.organization==='日本'&&x.source==='PLAYER'));
    state.japanTeam.athletes.forEach(a=>a.ownAtSelection=false);state.players=[];
    let cpuOnly=worldOwnEntries(2027),empty=buildMeetRaceQueue({...meet,relayEntries:cpuOnly.relays},cpuOnly.individual);
    let cpuProgram=buildMeetProgram({...meet,relayEntries:cpuOnly.relays},cpuOnly.individual);
    return {groups,onlyOwn,mixedRelay,empty:empty.length,cpuProgram:cpuProgram.length,history:state.meetHistory.at(-1).meet,points:state.points};
  })()`);
  for (const row of result.groups) {
    assert.equal(row.count, row.expected);
    assert.deepEqual([...row.japan].sort(), [...row.automatic].sort());
    assert.deepEqual(row.top, row.final);
  }
  assert.equal(result.onlyOwn, true);
  assert.equal(result.mixedRelay, true);
  assert.equal(result.empty, 0);
  assert.equal(result.cpuProgram, 30);
  assert.equal(result.history, 'world_championship');
  assert.equal(result.points, 0);
});

test('four-day meets finish every daily prelim before finals and place all three relays on the requested days', () => {
  const run=game();
  const rows=json(run,`(()=>{
    const athlete=state.players[0],members=state.players.slice(0,4),race={total:60,trajectory:[{t:0,distance:0}],legs:[15,15,15,15]};
    const individual={source:'PLAYER',athlete,heatLane:4,race};
    const team={organization:state.playerUniversity,members,heatLane:4,race};
    const selections=Object.fromEntries(EVENTS.map(e=>[e,[athlete.id]]));
    return ['kansai_college','intercollege','japan_open','japan_championship','world_championship','joint_record','team_trial'].map(meet=>{
      const result={meet,events:Object.fromEntries(EVENTS.map(e=>[e,{prelim:[individual],final:meet==='team_trial'?[]:[individual],heats:[[individual]]}])),
        relays:RELAY_MEETS.has(meet)?RELAYS.map(e=>[e,[team],{prelim:[team],heats:[[team]]}]):[],
        relayEntries:RELAY_MEETS.has(meet)?Object.fromEntries(RELAYS.map(e=>[e,members.map(p=>p.id)])):{} };
      const program=buildMeetProgram(result,selections),queue=buildMeetRaceQueue(result,selections);
      return {meet,program:program.map(({day,event,phase,showOverview})=>({day,event,phase,showOverview})),
        races:queue.map(({day,event,phase,eventEnd})=>({day,event,phase,eventEnd})),days:meetEventDays(meet)};
    });
  })()`);
  const fourDays=[['im400','ba200','fr100'],['fr200','fly200','br100','4x100fr'],['ba100','im200','fr400','4x100medley'],['fr50','fly100','br200','4x200fr']];
  const singles=['fr50','fr100','fr200','fr400','ba100','ba200','br100','br200','fly100','fly200','im200','im400'];
  for(const row of rows){
    const four=!['joint_record','team_trial'].includes(row.meet),relays=['kansai_college','intercollege','world_championship','joint_record'].includes(row.meet);
    const days=four?fourDays.map(events=>events.filter(e=>relays||!e.startsWith('4x'))):[[...singles,...(relays?['4x100fr','4x200fr','4x100medley']:[])]];
    const phases=row.meet==='team_trial'?['team_trial']:['prelim','final'];
    const expected=days.flatMap((events,i)=>phases.flatMap(phase=>events.map(event=>({day:i+1,event,phase}))));
    assert.deepEqual(row.days,days,row.meet);
    assert.deepEqual(row.program.map(({day,event,phase})=>({day,event,phase})),expected,row.meet);
    assert.ok(row.program.every(p=>p.showOverview===four),row.meet);
    assert.deepEqual(row.races.map(({day,event,phase})=>({day,event,phase})),expected,row.meet);
    assert.ok(row.races.every(r=>r.eventEnd),row.meet);
  }
});

test('race result PB badges are shown only for owned swimmers while standard badges remain independent', () => {
  const run=game();
  const rows=json(run,`['PLAYER','CPU'].map(source=>({source,html:achievementBadges({source,achievement:{pb:true,newlyCleared:['日本選手権']}},'fr100')}))`);
  assert.match(rows[0].html,/自己PB/);
  assert.doesNotMatch(rows[1].html,/自己PB/);
  assert.ok(rows.every(row=>row.html.includes('初突破')));
});

test('dispatch data matches all twelve user-provided 2026 Pan Pacific standards', () => {
  const run = game();
  assert.equal(run('dispatchStandardsReady()'), true);
  assert.equal(run('PANPAC_2026_DISPATCH.year'), 2026);
  assert.equal(run('PANPAC_2026_DISPATCH.sourceType'), 'user_provided');
  assert.deepEqual(json(run, 'EVENTS.map(dispatchStandard)'), [21.64,47.64,105.60,224.33,52.57,115.64,59.27,129.32,50.88,114.62,117.23,251.52]);
  assert.match(run('PANPAC_2026_DISPATCH.source'), /^https:\/\//);
});

test('prelim lanes follow PB and final lanes follow prelim times in 4,5,3,6,2,7,1,8 order', () => {
  const run=game();
  const result=json(run,`(()=>{
    let field=Array.from({length:8},(_,i)=>({athlete:{id:String(i),bestTimes:{fr100:60-i},stats:Object.fromEntries(STATS.map(k=>[k,130]))}}));
    let heat=seedRaceHeats(field,'fr100','team_trial')[0];
    let p=state.players[0];p.stats=Object.fromEntries(STATS.map(k=>[k,173]));p.bestTimes.fr100=48;
    let race=runEvent('joint_record','fr100',[p.id]);
    let finals=race.prelim.slice(0,8).map(pre=>race.final.find(x=>x.athlete.id===pre.athlete.id).heatLane);
    const members=Array.from({length:4},(_,i)=>({...p,id:'m'+i}));
    let teams=Array.from({length:8},(_,i)=>({organization:'Team '+i,members:members.map(p=>({...p,bestTimes:{fr100:50+i}}))}));
    let relay=seedRelayHeats(teams,'4x100fr','joint_record').flat();
    return {heat:heat.map(x=>({id:x.athlete.id,lane:x.heatLane})),finals,relay:relay.map(t=>({score:relaySeedScore(t,'4x100fr'),lane:t.heatLane,heat:t.heatNo}))};
  })()`);
  assert.deepEqual(result.heat.map(x=>x.id),['7','6','5','4','3','2','1','0']);
  assert.deepEqual(result.heat.map(x=>x.lane),[4,5,3,6,2,7,1,8]);
  assert.deepEqual(result.finals,[4,5,3,6,2,7,1,8]);
  for(const heat of new Set(result.relay.map(t=>t.heat))){
    const lanes=result.relay.filter(t=>t.heat===heat).sort((a,b)=>a.score-b.score).map(t=>t.lane);
    assert.deepEqual(lanes,[4,5,3,6,2,7,1,8].slice(0,lanes.length));
  }
});

test('reputation additions decrease modestly in the three national meets and the displayed rules agree', () => {
  const run=game();
  const result=json(run,`(()=>{
    let entry=Object.fromEntries(EVENTS.map(e=>[e,e==='fr100'?['a','b','c','d','e','f']:[]]));
    return {deltas:['intercollege','japan_open','japan_championship'].map(m=>playerReputationDelta(m,entry)),empty:['intercollege','japan_open','japan_championship'].map(m=>playerReputationDelta(m,Object.fromEntries(EVENTS.map(e=>[e,[]])))),text:reputationRuleHtml()};
  })()`);
  assert.deepEqual(result.deltas,[84.8,99.6,158.4]);
  assert.deepEqual(result.empty,[-1.5,-.75,-1]);
  assert.match(result.text,/1人 \+10/);assert.match(result.text,/1人 \+15/);assert.match(result.text,/1人 \+24/);
});

test('international names contain no numeric IDs, remain unique, and old names are cleaned once', () => {
  const run=game();
  const result=json(run,`(()=>{
    let world=ensureInternationalWorld(2027);
    let names=world.athletes.map(a=>a.name),id=world.athletes[0].id;
    world.athletes[0].name='Alex Miller 001';world.athletes[1].name='Alex Miller 002';
    state.meetHistory=[{meet:'world_championship',podiums:{fr100:[{name:'Alex Miller 001',organization:'アメリカ',time:47.12},{name:'代表 123',organization:'日本',time:47.2}]}}];
    state=JSON.parse(JSON.stringify(state));migrateState();
    let first=JSON.stringify(state.internationalWorld.athletes.map(a=>({id:a.id,name:a.name,stats:a.stats,pb:a.bestTimes})));
    migrateState();
    return {count:names.length,unique:new Set(names).size,numeric:names.some(n=>/\\d/.test(n)),oldId:state.internationalWorld.athletes[0].id,name:state.internationalWorld.athletes[0].name,podium:state.meetHistory[0].podiums.fr100,once:first===JSON.stringify(state.internationalWorld.athletes.map(a=>({id:a.id,name:a.name,stats:a.stats,pb:a.bestTimes})))};
  })()`);
  assert.equal(result.count,864);assert.equal(result.unique,864);assert.equal(result.numeric,false);
  assert.equal(result.name,'Alex Miller');assert.equal(result.once,true);assert.match(result.oldId,/^INT/);
  assert.deepEqual(result.podium,[{name:'Alex Miller',organization:'アメリカ',time:47.12},{name:'代表 123',organization:'日本',time:47.2}]);
});
