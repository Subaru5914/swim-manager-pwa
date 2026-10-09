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
    const snapshot=a=>[a.id,a.name,a.year,a.age,a.organization,a.stats,a.raceHistory,a.accolades];
    const athletes=JSON.stringify([own,alumni].map(snapshot));refreshRecordRankings();
    return {books:state.recordRankings,athletes:athletes===JSON.stringify([own,alumni].map(snapshot)),ownPB:own.bestTimes.fr100,alumniPB:alumni.bestTimes.fr100};
  })()`);
  assert.equal(r.books.high.fr100[0].organization,'元の高校');assert.equal(r.books.high.fr100[0].gradeAtRecord,3);
  assert.deepEqual(r.books.university.fr100.map(x=>[x.time,x.gradeAtRecord]),[[48,3],[49,2]]);
  assert.equal(r.books.university.fr100[0].organization,r.books.university.fr100[1].organization);
  assert.deepEqual(r.books.japan.fr100.map(x=>x.time),[47,49]);assert.equal(r.books.japan.fr100[0].organization,'記録時の実業団');
  assert.ok(r.athletes);assert.equal(r.ownPB,40);assert.equal(r.alumniPB,47);
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

test('CPU PB refresh retains earlier faster times and still accepts improvements in each event',()=>{
  const run=game();
  const r=run(`(()=>{
    const a={id:'cpu-pb',category:'high',specialty:'fr100',stats:Object.fromEntries(STATS.map(k=>[k,50])),bestTimes:{fr100:49.01},
      accolades:[{event:'fr200',time:110}]};
    for(let i=0;i<20;i++)refreshCpuPBs(a);
    const retained=a.bestTimes.fr100===49.01&&a.bestTimes.fr200<=110;
    a.stats=Object.fromEntries(STATS.map(k=>[k,200]));refreshCpuPBs(a);
    return {retained,improved:a.bestTimes.fr100<49.01,valid:EVENTS.every(e=>Number.isFinite(a.bestTimes[e])&&a.bestTimes[e]>0)};
  })()`);
  assert.ok(r.retained&&r.improved&&r.valid,JSON.stringify(r));
});

test('record repair aligns a ranked senior and scout candidate by ID, retains faster PBs and does not confuse equal names',()=>{
  const run=game();
  const r=run(`(()=>{
    const a={id:'ranked-senior',name:'同名選手',category:'high',grade:3,age:18,organization:'記録高校',specialty:'fr100',
      bestTimes:{fr100:53.65,fr50:22},stats:Object.fromEntries(STATS.map(k=>[k,120])),raceHistory:[],accolades:[],scouted:false,retired:false};
    const other={...deepClone(a),id:'different-senior',bestTimes:{fr100:55,fr50:25}};
    state.world=[a,other];
    const snapshot=deepClone(a);state.japanTeam={selectedSeason:state.season,athletes:[{id:a.id,snapshot}]};
    state.recordRankings={high:{fr100:[{kind:'individual',event:'fr100',athleteId:a.id,name:a.name,organization:a.organization,time:49.01,
      season:state.season,meet:'全国高校総体',stage:'決勝',schoolCategory:'high',gradeAtRecord:3}],
      fr50:[{kind:'individual',event:'fr50',athleteId:a.id,name:a.name,organization:a.organization,time:23,season:state.season,meet:'全国高校総体',stage:'決勝',schoolCategory:'high',gradeAtRecord:3}]}};
    const stats=JSON.stringify(a.stats),seed=state.rngSeed;refreshRecordRankings();
    const ranked=ranking('fr100','high',50)[0],candidate=refreshScoutBoard().find(p=>p.id===a.id),first=JSON.stringify(state);
    refreshRecordRankings();
    return {id:ranked.id,rankPB:ranked.bestTimes.fr100,scoutPB:candidate.bestTimes.fr100,record:state.recordRankings.high.fr100[0].time,
      faster:a.bestTimes.fr50,snapshot:snapshot.bestTimes.fr100,other:other.bestTimes.fr100,stats:stats===JSON.stringify(a.stats),
      stable:first===JSON.stringify(state),rng:state.rngSeed===seed};
  })()`);
  assert.equal(r.id,'ranked-senior');assert.equal(r.record,49.01);assert.equal(r.rankPB,r.record);assert.equal(r.scoutPB,r.record);
  assert.equal(r.snapshot,49.01);assert.equal(r.other,55);assert.equal(r.faster,22);assert.ok(r.stats&&r.stable&&r.rng);
});

test('repair restores a lifetime PB across advancement without moving its historical high-school record into student records',()=>{
  const run=game();
  const r=run(`(()=>{
    const a={id:'advanced-pb',name:'進学PB選手',category:'university',grade:1,age:19,organization:'進学大学',specialty:'fr100',
      stats:Object.fromEntries(STATS.map(k=>[k,100])),bestTimes:{fr100:55},raceHistory:[],accolades:[],retired:false};
    state.world=[a];state.recordRankings={high:{fr100:[{kind:'individual',event:'fr100',athleteId:a.id,name:a.name,organization:'記録時高校',
      time:50,season:state.season-1,meet:'全国高校総体',stage:'決勝',schoolCategory:'high',gradeAtRecord:3}]}};
    refreshRecordRankings();const high=deepClone(state.recordRankings.high.fr100[0]);
    return {pb:a.bestTimes.fr100,high,students:state.recordRankings.university?.fr100||[]};
  })()`);
  assert.equal(r.pb,50);assert.equal(r.high.organization,'記録時高校');assert.equal(r.high.gradeAtRecord,3);assert.deepEqual(r.students,[]);
});

test('repairing a recorded standard never generates another first-clear badge on the next race',()=>{
  const run=game();
  const r=run(`(()=>{
    const a={id:'repaired-standard',name:'標準復元選手',year:2,age:20,organization:state.playerUniversity,bestTimes:{fr100:70},
      stats:Object.fromEntries(STATS.map(k=>[k,100])),raceHistory:[],accolades:[],standardAchievementVersion:1,standardAchievements:{fr100:[]}};
    state.players=[a];state.recordRankings={university:{fr100:[{kind:'individual',event:'fr100',athleteId:a.id,name:a.name,
      organization:a.organization,time:49,season:state.season,meet:'japan_championship',stage:'決勝',schoolCategory:'university',gradeAtRecord:2}]}};
    refreshRecordRankings();const earned=[...a.standardAchievements.fr100],race=updateResultHistory(a,'fr100',49.1,'japan_championship','予選',1);
    return {earned,wanted:standardsCleared('fr100',49),race,pb:a.bestTimes.fr100};
  })()`);
  assert.deepEqual(r.earned,r.wanted);assert.deepEqual(r.race.newlyCleared,[]);assert.equal(r.race.pb,false);assert.equal(r.pb,49);
});

test('eight real year changes never worsen a surviving swimmer PB and keep active record holders consistent with scouting',()=>{
  const run=game();
  const rows=run(`(()=>{
    state=createState();const rows=[];
    for(let year=0;year<8;year++){
      const before=new Map(activeAthletes().map(a=>[a.id,deepClone(a.bestTimes)]));newSeason();
      const byId=new Map(activeAthletes().map(a=>[a.id,a])),board=refreshScoutBoard();let bad=0,worsened=0;
      for(const a of activeAthletes())for(const event of EVENTS){const old=before.get(a.id)?.[event];if(Number.isFinite(old)&&a.bestTimes[event]>old+.001)worsened++}
      for(const book of Object.values(state.recordRankings))for(const [event,records] of Object.entries(book))for(const r of records){
        const a=byId.get(r.athleteId);if(r.kind!=='relay'&&a&&(!Number.isFinite(a.bestTimes[event])||a.bestTimes[event]>r.time+.001))bad++;
      }
      rows.push({year,worsened,bad,scouts:board.every(a=>a===byId.get(a.id)&&a.bestTimes[scoutSpecialty(a)]===byId.get(a.id).bestTimes[scoutSpecialty(a)]),
        freshmen:state.players.filter(a=>a.year===1).length});
      const seed=state.rngSeed;reconcilePersonalBests();rows.at(-1).rng=state.rngSeed===seed;
    }
    return rows;
  })()`);
  for(const row of rows){assert.equal(row.worsened,0,JSON.stringify(row));assert.equal(row.bad,0,JSON.stringify(row));assert.equal(row.freshmen,8);assert.ok(row.scouts&&row.rng);}
});
