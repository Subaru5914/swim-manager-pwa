const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(){return vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+`
 state={rngSeed:5914,playerUniversity:'自大学',recordRankings:{},teamTop10:{}};
 const p={id:'own',stats:{fr:100},bestTimes:{fr100:50,ba50:30},raceHistory:[]};
 const row=(id,event,time,season=2026,slot=43,stage='A決勝',extra={})=>({id,event,time,season,slot,stage,meet:'intercollege',...extra});
 return code=>JSON.parse(JSON.stringify(eval(code)))`,[])()}

test('event buttons use actual saved appearances and relay recovery rather than PBs, without changing data or RNG',()=>{
 const r=game()(`(()=>{
  p.raceHistory=[row('individual','fr100',51),row('relay','4x200fr',440,2026,43,'決勝',{lapTime:110})];
  state.teamTop10={'4x100medley':[{season:2025,slot:20,meet:'kansai_college',stage:'決勝',time:240,members:[{id:p.id}]}]};
  const before=JSON.stringify([p,state]),events=playerRaceHistoryEvents(p);
  const empty=playerRaceHistoryEvents({id:'absent',bestTimes:{fr100:50},raceHistory:[]});
  return{events,empty,unchanged:before===JSON.stringify([p,state])};
 })()`);
 assert.deepEqual(r.events,['fr100','4x200fr','4x100medley']);assert.deepEqual(r.empty,[]);assert.ok(r.unchanged);
});

test('fastest compares individual hundredths, breaks ties by latest date, and leaves invalid clocks last',()=>{
 const r=game()(`(()=>{
  p.raceHistory=[row('old','fr100',51,2025),row('new','fr100',51,2026,40),row('latest','fr100',52,2026,45),row('fast','fr100',50.004),row('missing','fr100',null),row('zero','fr100',0),row('infinite','fr100',Infinity),row('other','br100',49)];
  const before=JSON.stringify([p,state]);
  return{fast:sortedPlayerRaceHistory(p,'fastest','fr100').map(h=>h.id),recent:sortedPlayerRaceHistory(p,'recent','fr100').map(h=>h.id),unchanged:before===JSON.stringify([p,state])};
 })()`);
 assert.deepEqual(r.fast,['fast','new','old','latest','missing','zero','infinite']);
 assert.equal(r.recent[0],'latest');assert.equal(r.recent.at(-1),'old');assert.ok(r.unchanged);
});

test('relay fastest uses the actual personal lap, with missing laps last even if the team total is faster',()=>{
 const r=game()(`(()=>{
  p.raceHistory=[row('fast-team','4x100fr',190,2026,43,'決勝',{lapTime:54}),row('fast-person','4x100fr',220,2025,20,'決勝',{lapTime:50}),row('missing','4x100fr',180,2027,20,'決勝'),row('invalid','4x100fr',170,2026,20,'決勝',{lapTime:-1}),row('other','4x200fr',420,2026,20,'決勝',{lapTime:105})];
  const before=JSON.stringify([p,state]);
  return{fast:sortedPlayerRaceHistory(p,'fastest','4x100fr').map(h=>h.id),recent:sortedPlayerRaceHistory(p,'recent','4x100fr').map(h=>h.id),unchanged:before===JSON.stringify([p,state])};
 })()`);
 assert.deepEqual(r.fast,['fast-person','fast-team','missing','invalid']);
 assert.deepEqual(r.recent,['missing','fast-team','invalid','fast-person']);assert.ok(r.unchanged);
});

test('all event buttons follow the established event order and repeated filters keep final-before-prelim ties stable',()=>{
 const r=game()(`(()=>{
  const events=[...EVENTS,...RELAYS];
  p.raceHistory=events.slice().reverse().flatMap(event=>[row(event+'pre',event,60,2026,43,'予選',{lapTime:60}),row(event+'final',event,60,2026,43,'決勝',{lapTime:60})]);
  const before=JSON.stringify([p,state]),actual=playerRaceHistoryEvents(p);
  const pairs=events.flatMap(event=>['recent','fastest'].map(mode=>sortedPlayerRaceHistory(p,mode,event).map(h=>h.stage)));
  return{events,actual,pairs,unchanged:before===JSON.stringify([p,state])};
 })()`);
 assert.deepEqual(r.actual,r.events);assert.equal(r.actual.length,18);
 for(const pair of r.pairs)assert.deepEqual(pair,['決勝','予選']);assert.ok(r.unchanged);
});

test('duplicate saved relay books produce one appearance with no invented personal lap',()=>{
 const r=game()(`(()=>{
  const saved={season:2025,slot:20,meet:'kansai_college',event:'4x100fr',stage:'決勝',organization:state.playerUniversity,time:219,members:[{id:p.id}]};
  state.teamTop10={'4x100fr':[saved]};state.recordRankings={university:{'4x100fr':[saved]},japan:{'4x100fr':[saved]}};
  p.raceHistory=[row('actual','4x100fr',230,2026,43,'決勝',{lapTime:55})];
  const before=JSON.stringify([p,state]),rows=sortedPlayerRaceHistory(p,'fastest','4x100fr');
  return{events:playerRaceHistoryEvents(p),rows,unchanged:before===JSON.stringify([p,state])};
 })()`);
 assert.deepEqual(r.events,['4x100fr']);assert.equal(r.rows.length,2);assert.equal(r.rows[0].lapTime,55);assert.equal(r.rows[1].lapTime,null);assert.equal(r.rows[1].time,219);assert.ok(r.unchanged);
});
