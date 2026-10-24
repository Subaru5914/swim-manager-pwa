const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(){return vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+`
 state={season:2026,slot:43,rngSeed:5914,playerUniversity:'自大学',players:[],world:[],universities:[{id:'cpu',name:'他大学'}],kansaiIds:['cpu'],interIds:['cpu'],teamTop10:{},recordRankings:{},recordBook:{},teamPodiumHistory:[],meetHistory:[],teamScoreHistory:[],pointLog:[],points:0};
 function swimmer(id,event,pb,pre,fin,own=true){return {id,name:id,category:'university',year:2,grade:2,organization:own?state.playerUniversity:'他大学',specialty:event,stats:Object.fromEntries(STATS.map(k=>[k,138])),bestTimes:pb==null?{}:{[event]:pb},raceHistory:[],accolades:[],pre,fin}}
 simulateRace=(a,e,champ,record,takeover,preliminary)=>({total:preliminary?a.pre:a.fin});
 simulateMeetRace=(a,e,m,r,preliminary)=>simulateRace(a,e,true,r,false,preliminary);
 return code=>JSON.parse(JSON.stringify(eval(code)))`,[])()}

test('all domestic and world overall results compare prelims to entry PB and finals to the PB before the final',()=>{
 const run=game(),r=run(`['kansai_college','intercollege','teijimayama_championship','joint_record','japan_open','japan_championship','world_championship'].map(meet=>{
  const event='fr200',own=swimmer('own',event,110,109,108),unchanged=swimmer('unchanged',event,105,111,110),cpu=swimmer('cpu',event,109.5,112,111,false);
  state.players=[own,unchanged];state.world=[cpu];
  const result=meet==='world_championship'?raceEventField(meet,event,[{source:'PLAYER',athlete:own,entryPB:110},{source:'PLAYER',athlete:unchanged,entryPB:105},{source:'CPU',athlete:cpu,entryPB:109.5}]):runEvent(meet,event,['own','unchanged'],{fr200:['cpu']});
  const first=stage=>result[stage].find(r=>r.athlete.id==='own'),other=stage=>result[stage].find(r=>r.athlete.id==='unchanged');
  return {meet,pb:own.bestTimes.fr200,pre:first('prelim').entryPB,fin:first('final').entryPB,
   preliminary:resultEntryPBCell(first('prelim'),event),final:resultEntryPBCell(first('final'),event),
   unchanged:['prelim','final'].map(stage=>other(stage).entryPB),cpu:resultEntryPBCell(result.prelim.find(r=>r.source==='CPU'),event),
   header:resultRankingTable(result.final,event).includes('<th>レース前PB</th>'),
   frozen:JSON.stringify(result)===JSON.stringify((resultRankingTable(result.prelim,event,result.final),result))};
 })`);
 for(const row of r){
  assert.equal(row.pre,110,row.meet);assert.equal(row.fin,109,row.meet);assert.equal(row.pb,108,row.meet);
  assert.match(row.preliminary,/>1:50\.00</,row.meet);assert.match(row.final,/>1:49\.00</,row.meet);
  assert.deepEqual(row.unchanged,[105,105]);assert.match(row.cpu,/>—</);assert.ok(row.header&&row.frozen);
 }
});

test('an unmeasured entry stays unmeasured in prelim comparison after first PB, JSON round trips and later improvements',()=>{
 const run=game(),r=run(`(()=>{
  const p=swimmer('first-clock','fr200',null,109,108);state.players=[p];state.world=[];
  const result=runEvent('joint_record','fr200',[p.id]),saved=JSON.parse(JSON.stringify(result));
  saved.prelim[0].athlete.bestTimes.fr200=90;saved.final[0].athlete.bestTimes.fr200=90;
  return{entry:saved.prelim[0].entryPB,finalEntry:saved.final[0].entryPB,pre:resultEntryPBCell(saved.prelim[0],'fr200'),fin:resultEntryPBCell(saved.final[0],'fr200')};
 })()`);
 assert.equal(r.entry,null);assert.equal(r.finalEntry,109);assert.match(r.pre,/>-</);assert.match(r.fin,/>1:49\.00</);
});

test('saved rows without entry PB recover previous PB, preserve an unmeasured entry and render short times',()=>{
 const run=game(),r=run(`(()=>{
  const p=swimmer('saved','fr100',48,47,46),row={source:'PLAYER',athlete:p,race:{total:47},achievement:{previousPB:50}};
  const before=JSON.stringify(row),normal=resultEntryPBCell(row,'fr100');row.achievement.previousPB=null;
  const unmeasured=resultEntryPBCell(row,'fr100'),unknown=resultEntryPBCell({source:'PLAYER',athlete:p,race:{total:47}},'fr100');
  row.entryPB=49;row.swimOffRound=1;row.achievement.previousPB=48.5;
  return{normal,unmeasured,unknown,swimOff:resultEntryPBCell(row,'fr100'),before};
 })()`);
 assert.match(r.normal,/>50\.00</);assert.match(r.unmeasured,/>-</);assert.match(r.unknown,/>-</);assert.match(r.swimOff,/>48\.50</);
});
