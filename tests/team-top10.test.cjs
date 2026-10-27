const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(){return vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+`
 state={season:2028,slot:43,rngSeed:5914,playerUniversity:'自大学',players:[],world:[],retiredArchive:[],universities:[],teamTop10:{},recordRankings:{},recordBook:{},teamPodiumHistory:[],alumniCareer:[],japanTeamHistory:[]};
 const swimmer=(id,extra={})=>({id,name:'同名泳者',year:3,age:21,organization:state.playerUniversity,bestTimes:{fr100:48},raceHistory:[],accolades:[],...extra});
 const history=(event,time,extra={})=>({season:2027,slot:43,meet:'intercollege',event,time,stage:'予選',schoolCategory:'university',gradeAtRecord:2,organization:state.playerUniversity,...extra});
 return code=>JSON.parse(JSON.stringify(eval(code)))`,['globalThis'])({})}

test('team top ten keeps the lifetime PB ahead of slower college swims while official books retain the college swim and first relay leg',()=>{
 const r=game()(`(()=>{const a=swimmer('own');state.players=[a];
  const result=updateResultHistory(a,'fr100',50,'intercollege','予選',10);
  updateResultHistory(a,'fr100',49,'intercollege','決勝',8);
  updateResultHistory(a,'fr100',51,'japan_open','予選',15);
  const members=[a,...Array.from({length:3},(_,i)=>swimmer('leg-'+i))];state.players=members;
  recordRelayResult('4x100fr',{organization:state.playerUniversity,members,rank:4,race:{total:203,legs:[48.5,51.5,51,52]}},'intercollege','決勝');
  return{pb:a.bestTimes.fr100,result,rows:state.teamTop10.fr100,college:state.recordRankings.university.fr100,relay:state.teamTop10['4x100fr'],other:members.slice(1).map(p=>p.bestTimes.fr100)}})()`);
 assert.equal(r.pb,48);assert.equal(r.result.pb,false);assert.equal(r.rows.length,1);assert.equal(r.rows[0].time,48);assert.equal(r.rows[0].stage,'PB');assert.equal(r.college[0].time,48.5);assert.match(r.college[0].stage,/第1泳者/);
 assert.deepEqual(r.relay[0].legs,[48.5,51.5,51,52]);assert.deepEqual(r.other,[48,48,48]);
});

test('team top ten restores every individual event from current and graduate histories outside the national top ten, by ID and once',()=>{
 const r=game()(`(()=>{const a=swimmer('own'),b=swimmer('graduate',{category:'adult',year:undefined,age:24,alumni:true,almaMater:state.playerUniversity,graduationSeason:2026,organization:'実業団'});
  const c=swimmer('retired',{year:undefined,age:24,almaMater:state.playerUniversity,organization:'実業団',season:2028,reason:'社会人引退'});
  for(const event of EVENTS){a.bestTimes[event]=60;for(const p of [b,c])p.bestTimes[event]??=57;a.raceHistory.push(history(event,60));b.raceHistory.push(history(event,59,{season:2025,gradeAtRecord:3}));c.raceHistory.push(history(event,58,{season:2025,gradeAtRecord:3}));
   state.recordRankings.university??={};state.recordRankings.university[event]=Array.from({length:10},(_,i)=>({kind:'individual',event,athleteId:'other-'+i,name:'他大学',time:40+i,organization:'他大学',season:2027,meet:'intercollege',stage:'決勝',schoolCategory:'university',gradeAtRecord:2}));}
  state.players=[a];state.world=[b];state.retiredArchive=[c];const athletes=JSON.stringify([a,b,c]),seed=state.rngSeed;refreshRecordRankings();const first=JSON.stringify(state);refreshRecordRankings();
  return{events:EVENTS,book:state.teamTop10,once:first===JSON.stringify(state),same:athletes===JSON.stringify([a,b,c]),rng:seed===state.rngSeed}})()`);
 assert.ok(r.once,'idempotent refresh');assert.ok(r.same,'athletes unchanged');assert.ok(r.rng,'RNG unchanged');for(const event of r.events){assert.deepEqual(r.book[event].map(h=>[h.athleteId,h.time]),[['retired',58],['graduate',59],['own',60]]);assert.equal(r.book[event][0].season,2025)}
});

test('team top ten keeps its faster archives, restores saved own records, and keeps team PB snapshots separate from school, adult and other-university race records',()=>{
 const r=game()(`(()=>{const a=swimmer('own',{bestTimes:{fr100:36}});state.players=[a];
  a.raceHistory=[history('fr100',50),history('fr100',39,{schoolCategory:'high',gradeAtRecord:3,season:2025,organization:'高校'}),history('fr100',38,{schoolCategory:'adult',gradeAtRecord:null,organization:'実業団'}),history('fr100',37,{organization:'別大学'})];
  state.teamTop10.fr100=[{kind:'individual',event:'fr100',athleteId:'past',name:'消去済み卒業生',time:47,season:2020,meet:'intercollege',stage:'決勝'}];
  state.recordRankings.university={ba100:[{kind:'individual',event:'ba100',athleteId:'book',name:'保存済み選手',time:55,season:2024,organization:state.playerUniversity,meet:'intercollege',stage:'決勝',schoolCategory:'university',gradeAtRecord:4}]};
  refreshRecordRankings();return{fr:state.teamTop10.fr100,ba:state.teamTop10.ba100,pb:a.bestTimes.fr100,college:state.recordRankings.university.fr100}})()`);
 assert.deepEqual(r.fr.map(h=>[h.athleteId,h.time]),[['own',36],['past',47]]);assert.ok(r.fr[0].teamPBOnly);assert.equal(r.pb,36);assert.equal(r.ba[0].time,55);assert.equal(r.ba[0].season,2024);assert.ok(r.college.every(h=>h.time!==36));
});

test('team top ten retains ten distinct swimmers by ID, picks their fastest swim, and replaces equal PB placeholders with dated races',()=>{
 const r=game()(`(()=>{state.players=Array.from({length:14},(_,i)=>swimmer('own-'+i,{bestTimes:{fr100:50+i*.1},raceHistory:[history('fr100',50+i*.1),history('fr100',51+i*.1)]}));
  state.teamTop10.fr100=[{kind:'individual',event:'fr100',athleteId:'own-0',name:'同名泳者',time:50,season:2026,slot:null,meet:'initial_pb',stage:'PB'}];
  refreshRecordRankings();return state.teamTop10.fr100})()`);
 assert.equal(r.length,10);assert.deepEqual(r.map(h=>h.athleteId),Array.from({length:10},(_,i)=>'own-'+i));assert.equal(r[0].season,2027);assert.equal(r[0].meet,'intercollege');assert.equal(r[0].stage,'予選');
});

test('team top ten restores all three relays with the saved lineup and splits and never imports a Japan representative relay',()=>{
 const r=game()(`(()=>{const members=Array.from({length:4},(_,i)=>({id:'leg-'+i,name:'泳者'+i,schoolCategory:'university',gradeAtRecord:i+1}));
  state.recordRankings.university=Object.fromEntries(RELAYS.map(event=>[event,[{kind:'relay',event,members,legs:[50,51,52,53],time:206,organization:state.playerUniversity,season:2026,slot:43,meet:'intercollege',stage:'予選'}]]));
  state.recordRankings.japan={'4x100fr':[{kind:'relay',event:'4x100fr',members,time:190,legs:[46,47,48,49],organization:'日本',season:2027,slot:36,meet:'world_championship',stage:'決勝'}]};
  refreshRecordRankings();const first=JSON.stringify(state.teamTop10);refreshRecordRankings();return{book:state.teamTop10,once:first===JSON.stringify(state.teamTop10)}})()`);
 assert.ok(r.once);assert.equal(Object.keys(r.book).length,3);for(const rows of Object.values(r.book)){assert.equal(rows[0].time,206);assert.deepEqual(rows[0].members.map(m=>m.id),['leg-0','leg-1','leg-2','leg-3']);assert.deepEqual(rows[0].legs,[50,51,52,53])}
});

test('team top ten recovers an unranked relay from four saved member histories and leaves incomplete lineups unfilled',()=>{
 const r=game()(`(()=>{state.players=Array.from({length:4},(_,i)=>swimmer('leg-'+i,{bestTimes:{fr100:48,ba100:49,fr200:100}}));
  for(const [i,a]of state.players.entries()){a.raceHistory=[history('4x100medley',220,{kind:'relay',legIndex:i,lapTime:50+i}),...(i<3?[history('4x200fr',450,{kind:'relay',legIndex:i,lapTime:110+i})]:[])];}
  const before=JSON.stringify(state.players);refreshRecordRankings();return{book:state.teamTop10,same:before===JSON.stringify(state.players)}})()`);
 assert.ok(r.same);assert.deepEqual(r.book['4x100medley'][0].members.map(m=>m.id),['leg-0','leg-1','leg-2','leg-3']);assert.deepEqual(r.book['4x100medley'][0].legs,[50,51,52,53]);assert.equal(r.book['4x200fr'],undefined);
 assert.equal(r.book.ba100[0].athleteId,'leg-0');assert.equal(r.book.ba100[0].time,49);assert.equal(r.book.br100,undefined);assert.equal(r.book.fly100,undefined);
});

test('an enrolling swimmer immediately contributes all valid PBs, slower races keep them, and an actual faster swim replaces the entry snapshot',()=>{
 const r=game()(`(()=>{const a=swimmer('freshman',{year:1,bestTimes:{fr100:49,ba100:55}});state.players=[a];a.raceHistory=[history('fr100',49,{season:2027,schoolCategory:'high',gradeAtRecord:3,organization:'出身高校'})];
  registerTeamPersonalBests([a],{meet:'enrollment_pb',grade:1});refreshRecordRankings();const entry=deepClone(state.teamTop10),collegeBefore=deepClone(state.recordRankings.university||{});
  const slower=updateResultHistory(a,'fr100',50,'intercollege','予選',12),kept=deepClone(state.teamTop10.fr100[0]);
  const faster=updateResultHistory(a,'fr100',48.5,'intercollege','決勝',8);return{entry,collegeBefore,slower,kept,faster,record:state.teamTop10.fr100[0],high:state.recordRankings.high.fr100[0]}})()`);
 assert.equal(r.entry.fr100[0].time,49);assert.equal(r.entry.ba100[0].time,55);assert.equal(r.entry.fr100[0].meet,'enrollment_pb');assert.ok(r.entry.fr100[0].teamPBOnly);assert.equal(r.collegeBefore.fr100,undefined);
 assert.equal(r.slower.pb,false);assert.equal(r.kept.time,49);assert.equal(r.faster.pb,true);assert.equal(r.record.time,48.5);assert.equal(r.record.meet,'intercollege');assert.equal(r.record.teamPBOnly,undefined);assert.equal(r.high.time,49);
});

test('relay lead-off PB flags freeze the comparison for each round, survive saved results, and exclude equal, slower and flying legs',()=>{
 const r=game()(`(()=>{const cases=[];for(const kind of RELAYS){const event=relayLegEvent(kind,0),members=Array.from({length:4},(_,i)=>swimmer(kind+'-'+i,{bestTimes:{[event]:60}}));state.players=members;
   const team=time=>({organization:state.playerUniversity,members,rank:3,race:{total:time+153,legs:[time,50,51,52]}}),pre=team(59),final=team(58),equal=team(58),slow=team(59);
   recordRelayResult(kind,pre,'intercollege','予選');recordRelayResult(kind,final,'intercollege','決勝');recordRelayResult(kind,pre,'intercollege','予選');
   recordRelayResult(kind,equal,'japan_open','予選');recordRelayResult(kind,slow,'japan_open','決勝');
   const result=unpackMeetResult(JSON.parse(JSON.stringify(packMeetResult({meet:'intercollege',events:{},relays:[[kind,[final],{prelim:[pre]}]]}))));
   cases.push({kind,event,pre:pre.leadOffAchievement,final:final.leadOffAchievement,equal:equal.leadOffAchievement.pb,slow:slow.leadOffAchievement.pb,restored:result.relays[0][1][0].leadOffAchievement,
    markup:relayResultTable([final],kind),other:members.slice(1).map(a=>a.bestTimes[event]),top:state.teamTop10[event].find(h=>h.athleteId===members[0].id).time});
  }return cases})()`);
 for(const c of r){assert.equal(c.pre.previousPB,60);assert.equal(c.pre.time,59);assert.ok(c.pre.pb);assert.equal(c.final.previousPB,59);assert.equal(c.final.time,58);assert.ok(c.final.pb);assert.deepEqual(c.restored,c.final);assert.equal(c.equal,false);assert.equal(c.slow,false);assert.deepEqual(c.other,[60,60,60]);assert.equal(c.top,58);assert.equal((c.markup.match(/data-relay-pb="true"/g)||[]).length,1);assert.match(c.markup,/自己PB!/)}
});
