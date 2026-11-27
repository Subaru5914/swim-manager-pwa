const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const source=html.match(/<script>([\s\S]*?)<\/script>/)[1];
function game(){
  const context=vm.createContext({crypto:{getRandomValues:a=>{a[0]=12345;return a}}});
  vm.runInContext(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener')),context);
  vm.runInContext('state={rngSeed:12345,cpuCompetitionSeed:7654321,season:2026,slot:61,players:[],world:[],playerUniversity:"自大学"}',context);
  return code=>JSON.parse(vm.runInContext('JSON.stringify('+code+')',context));
}

test('relay prelim tags match displayed university data and fall back to the top eight for empty or stale finalists',()=>{
  const run=game(),result=run(`(()=>{
    const teams=Array.from({length:10},(_,i)=>({organization:'大学'+i,members:Array.from({length:4},(_,j)=>({id:'cpu-'+i+'-'+j,name:'選手'+i+'-'+j,category:'university',year:2})),race:{total:200+i,legs:[50,50,50,50]}}));
    const expected=teams.slice(0,8).map(team=>team.organization);
    const html=relayResultTable(teams,'4x100fr',teams.slice(0,8));
    const empty=relayResultTable(teams,'4x100fr',[]);
    const stale=relayResultTable(teams,'4x100fr',teams.slice(0,8).map(team=>({...team,organization:'別'+team.organization})));
    return{html,empty,stale,expected};
  })()`);
  const labels=html=>(html.match(/class="final-qualifier"/g)||[]).length;
  assert.equal(labels(result.html),8);assert.equal(labels(result.empty),8);assert.equal(labels(result.stale),8);
  for(const team of result.expected)assert.ok(result.html.includes(team));
});

test('actual race-form tags appear only beside own swimmers in race video cards',()=>{
  const run=game(),result=run(`(()=>{
    const make=(id,name,organization)=>({id,name,organization,category:'university',year:2,grade:2,stats:Object.fromEntries(STATS.map(k=>[k,100])),bestTimes:Object.fromEntries(EVENTS.map(e=>[e,expectedTime({stats:Object.fromEntries(STATS.map(k=>[k,100]))},e)]))});
    const own=Array.from({length:4},(_,i)=>make('own-'+i,'自チーム'+i,state.playerUniversity)),cpu=Array.from({length:4},(_,i)=>make('cpu-'+i,'他大学'+i,'他大学'));
    state.players=own;state.world=cpu;
    const ownRace=withMeetRaceContext('teijimayama_championship',61,2026,()=>simulateRace(own[0],'fr100',true,true));
    const cpuRace=withMeetRaceContext('teijimayama_championship',61,2026,()=>simulateRace(cpu[0],'fr100',true,true));
    const ownCard=raceEntrantCard({source:'PLAYER',athlete:own[0],race:ownRace,heatLane:1},0,'fr100');
    const cpuCard=raceEntrantCard({source:'CPU',athlete:cpu[0],race:cpuRace,heatLane:2},1,'fr100');
    const relayRace=withMeetRaceContext('teijimayama_championship',61,2026,()=>simulateRelay(own,'4x100fr',true));
    const relayCpuRace=withMeetRaceContext('teijimayama_championship',61,2026,()=>simulateRelay(cpu,'4x100fr',true));
    const relayOwnCard=raceEntrantCard({source:'PLAYER',athlete:{name:state.playerUniversity,organization:state.playerUniversity,category:'relay'},members:own,race:relayRace,heatLane:1},0,'4x100fr');
    const relayCpuCard=raceEntrantCard({source:'CPU',athlete:{name:'他大学',organization:'他大学',category:'relay'},members:cpu,race:relayCpuRace,heatLane:2},1,'4x100fr');
    const resultTable=relayResultTable([{organization:state.playerUniversity,members:own,race:relayRace}], '4x100fr', [{organization:state.playerUniversity,members:own,race:relayRace}]);
    const levels=html=>[...html.matchAll(/data-form-level="(-?[0-9]+)"/g)].map(m=>Number(m[1]));
    return{own:levels(ownCard),cpu:levels(cpuCard),relayOwn:levels(relayOwnCard),relayCpu:levels(relayCpuCard),relayOwnCard,ownLevel:ownRace.physics.meetFormLevel,relayLevels:relayRace.formLevels,resultTags:levels(resultTable)};
  })()`);
  assert.deepEqual(result.own,[result.ownLevel],JSON.stringify(result));assert.deepEqual(result.cpu,[]);
  assert.deepEqual(result.relayOwn,[]);assert.deepEqual(result.relayCpu,[]);assert.equal((result.relayOwnCard.match(/class="relay-member"/g)||[]).length,4);assert.doesNotMatch(result.relayOwnCard,/meet-form/);assert.deepEqual(result.resultTags,[]);
});

test('relay entry and race-video member lists always use two columns',()=>{
  assert.match(html,/\.relay-members\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(html,/\.modal-relay-editor \.relay-entry-team>\.row\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(html,/\.relay-entry-summary-names\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});
