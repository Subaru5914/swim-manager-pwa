const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(){
  const context=vm.createContext({crypto:{getRandomValues:a=>{a[0]=5914;return a}}});
  vm.runInContext(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener')),context);
  const run=code=>vm.runInContext(code,context);
  run('state=createState();state.world=[];state.players=[];state.teamTop10={};state.recordRankings={};state.retiredArchive=[]');
  return code=>JSON.parse(run('JSON.stringify('+code+')'));
}

test('refresh merges school records into national records and keeps ten distinct fastest swimmers without losing snapshots',()=>{
  const run=game();
  const r=run(`(()=>{
    const entries=Array.from({length:14},(_,i)=>({kind:'individual',event:'fr100',athleteId:'high-'+i,name:'高校選手'+i,organization:'記録高校',
      time:50+i,season:2025,slot:20,meet:'全国高校総体',stage:'決勝',schoolCategory:'high',gradeAtRecord:3}));
    state.recordRankings={high:{fr100:[...entries.reverse(),{...entries[0],time:100},{...entries[1],time:-1}]},
      university:{fr100:[{...entries[0],athleteId:'student',time:48,organization:'記録大学',schoolCategory:'university',gradeAtRecord:2}]},
      japan:{fr100:[{...entries[0],athleteId:'adult',time:47,organization:'記録実業団',schoolCategory:'adult',gradeAtRecord:null}]}};
    const seed=state.rngSeed;refreshRecordRankings();const first=JSON.stringify(state.recordRankings);refreshRecordRankings();
    return {books:state.recordRankings,stable:first===JSON.stringify(state.recordRankings),rng:seed===state.rngSeed};
  })()`);
  assert.equal(r.books.high.fr100.length,10);assert.equal(new Set(r.books.high.fr100.map(x=>x.athleteId)).size,10);
  assert.deepEqual(r.books.high.fr100.map(x=>x.time),[50,51,52,53,54,55,56,57,58,59]);
  assert.deepEqual(r.books.japan.fr100.map(x=>x.time),[47,48,50,51,52,53,54,55,56,57]);
  assert.equal(r.books.japan.fr100[2].gradeAtRecord,3);assert.equal(r.books.japan.fr100[1].gradeAtRecord,2);
  assert.ok(r.stable&&r.rng);
});

test('refresh recovers missing own races and high-school titles with their actual school year and organization',()=>{
  const run=game();
  const r=run(`(()=>{
    state.season=2028;
    const own={id:'own-history',name:'戦績選手',year:3,age:21,organization:state.playerUniversity,bestTimes:{fr100:40},stats:{},
      raceHistory:[{season:2027,slot:42,event:'fr100',time:49,meet:'intercollege',stage:'予選',schoolCategory:'university',gradeAtRecord:2,organization:state.playerUniversity}],
      accolades:[{competition:'全国高校総体',season:2025,event:'fr100',time:51,organization:'元の高校',schoolCategory:'high',gradeAtRecord:3}]};
    const alumni={id:'old-history',name:'卒業選手',category:'adult',age:24,organization:'現在の実業団',alumni:true,almaMater:state.playerUniversity,graduationSeason:2026,
      raceHistory:[{season:2025,slot:42,event:'fr100',time:48,meet:'intercollege',stage:'決勝'},
        {season:2028,slot:96,event:'fr100',time:47,meet:'japan_championship',stage:'決勝',schoolCategory:'adult',gradeAtRecord:null,organization:'記録時の実業団'}],accolades:[]};
    state.players=[own];state.world=[alumni];
    const athletes=JSON.stringify([own,alumni]);refreshRecordRankings();
    return {books:state.recordRankings,athletes:athletes===JSON.stringify([own,alumni])};
  })()`);
  assert.equal(r.books.high.fr100[0].organization,'元の高校');assert.equal(r.books.high.fr100[0].gradeAtRecord,3);
  assert.deepEqual(r.books.university.fr100.map(x=>[x.time,x.gradeAtRecord]),[[48,3],[49,2]]);
  assert.equal(r.books.university.fr100[0].organization,r.books.university.fr100[1].organization);
  assert.deepEqual(r.books.japan.fr100.map(x=>x.time),[47,49]);assert.equal(r.books.japan.fr100[0].organization,'記録時の実業団');
  assert.ok(r.athletes);
});

test('undated current PBs are never relabeled as student records after admission or graduation',()=>{
  const run=game();
  const r=run(`(()=>{
    const a={id:'promoted-high',name:'進学選手',category:'university',grade:1,age:19,organization:'進学大学',bestTimes:{fr100:40},raceHistory:[],accolades:[]};
    state.world=[a];state.recordRankings={high:{fr100:[{kind:'individual',event:'fr100',athleteId:a.id,name:a.name,organization:'元の高校',time:50,season:2025,meet:'全国高校総体',stage:'決勝',schoolCategory:'high',gradeAtRecord:3}]}};
    refreshRecordRankings();a.category='adult';a.grade=null;a.age=23;state.season+=4;refreshRecordRankings();
    return state.recordRankings;
  })()`);
  assert.deepEqual(r.university||{},{});assert.equal(r.japan.fr100[0].time,50);
  assert.equal(r.japan.fr100[0].organization,'元の高校');assert.equal(r.japan.fr100[0].gradeAtRecord,3);
});

test('relay recovery keeps the fastest lineup per university and does not move the Japan national relay into student records',()=>{
  const run=game();
  const r=run(`(()=>{
    const members=Array.from({length:4},(_,i)=>({id:'leg-'+i,name:'泳者'+i,schoolCategory:'university',gradeAtRecord:i+1}));
    state.teamTop10={'4x100fr':[{kind:'relay',event:'4x100fr',time:199,members,memberKey:'legs',season:2026,meet:'intercollege',stage:'決勝'}]};
    state.recordRankings={university:{'4x100fr':[{...deepClone(state.teamTop10['4x100fr'][0]),organization:state.playerUniversity,time:200}]},
      japan:{'4x100fr':[{kind:'relay',event:'4x100fr',organization:'日本',time:190,members:deepClone(members),season:2027,meet:'world_championship',stage:'決勝'}]}};
    refreshRecordRankings();const first=JSON.stringify(state.recordRankings);refreshRecordRankings();
    return {books:state.recordRankings,stable:first===JSON.stringify(state.recordRankings)};
  })()`);
  assert.deepEqual(r.books.university['4x100fr'].map(x=>x.time),[199]);
  assert.deepEqual(r.books.japan['4x100fr'].map(x=>x.time),[190,199]);
  assert.deepEqual(r.books.university['4x100fr'][0].members.map(x=>x.gradeAtRecord),[1,2,3,4]);assert.ok(r.stable);
});

test('an equal actual race replaces an undated PB placeholder while slower races leave the record intact',()=>{
  const run=game();
  const r=run(`(()=>{
    const a={id:'equal-race',name:'同記録選手',category:'university',grade:2,age:20,organization:'記録大学'};
    recordIndividualResult(a,'fr100',49,'PB集計','PB');
    recordIndividualResult(a,'fr100',49,'intercollege','決勝');
    recordIndividualResult(a,'fr100',50,'japan_championship','決勝');
    refreshRecordRankings();return state.recordRankings;
  })()`);
  for(const category of ['university','japan']){
    assert.equal(r[category].fr100[0].time,49);assert.equal(r[category].fr100[0].meet,'intercollege');assert.equal(r[category].fr100[0].gradeAtRecord,2);
  }
});

test('malformed relay data is rejected before refresh can replace the saved book',()=>{
  const run=game();
  const r=run(`(()=>{
    state.recordRankings={japan:{fr100:[{kind:'relay',event:'fr100',time:45}]}};
    const before=JSON.stringify(state.recordRankings);let rejected=false;
    try{refreshRecordRankings()}catch(error){rejected=true}
    return {rejected,unchanged:before===JSON.stringify(state.recordRankings)};
  })()`);
  assert.ok(r.rejected&&r.unchanged);
});

test('renaming a university also renames source history so refreshed records cannot restore its old name',()=>{
  const run=game();
  const r=run(`(()=>{
    const own={id:'rename-history',name:'改名記録選手',year:2,age:20,organization:state.playerUniversity,raceHistory:[
      {season:state.season,slot:42,event:'fr100',time:49,meet:'intercollege',stage:'決勝',schoolCategory:'university',gradeAtRecord:2,organization:state.playerUniversity}],accolades:[]};
    state.players=[own];refreshRecordRankings();renamePlayerUniversity('新大学名');
    state.recordRankings={};refreshRecordRankings();
    return {book:state.recordRankings,history:own.raceHistory[0]};
  })()`);
  assert.equal(r.history.organization,'新大学名');
  for(const category of ['university','japan'])assert.equal(r.book[category].fr100[0].organization,'新大学名');
});

test('a graduated representative snapshot recovers a world record only in the national category',()=>{
  const run=game();
  const r=run(`(()=>{
    state.season=2027;
    const snapshot={id:'selected-graduate',name:'卒業代表',year:4,age:22,organization:state.playerUniversity,
      raceHistory:[{season:2027,slot:37,event:'fr100',time:47,meet:'world_championship',stage:'決勝'}],accolades:[]};
    state.japanTeam={selectedSeason:2026,athletes:[{id:snapshot.id,snapshot,ownAtSelection:true}]};
    refreshRecordRankings();return state.recordRankings;
  })()`);
  assert.equal(r.japan.fr100[0].time,47);assert.equal(r.japan.fr100[0].schoolCategory,'graduate');
  assert.equal(r.japan.fr100[0].gradeAtRecord,null);assert.deepEqual(r.university||{},{});
});
