const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const load=vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+'\nreturn code=>JSON.parse(JSON.stringify(eval(code)))',[]);

test('final record collection refills displaced CPU PBs, preserves histories and owned data, and runs once without race draws',()=>{
 const run=load(),r=run(`(()=>{
  const own={id:'own',name:'自選手',organization:'自大学',year:2,bestTimes:{fr100:49.85},stats:{fr_speed:150}},
    roster=Array.from({length:12},(_,i)=>({id:'cpu'+i,name:'大学選手'+i,organization:'CPU大学',category:'university',grade:2,age:20,
      bestTimes:Object.fromEntries(EVENTS.map(e=>[e,i===0?58:59+i/10])),stats:{fr_speed:100+i}})),
    signed={id:'signed',name:'勧誘済み高校生',organization:'CPU高校',category:'high',grade:3,age:18,scouted:true,bestTimes:{fr100:57},stats:{fr_speed:140}};
  const historical={kind:'individual',event:'fr100',time:55,athleteId:'graduated',name:'卒業選手',organization:'過去大学',season:2023,slot:28,meet:'intercollege',stage:'決勝',schoolCategory:'university',gradeAtRecord:4};
  state={players:[own],world:[...roster,signed],playerUniversity:'自大学',season:2030,slot:18,points:77,reputation:160,rngSeed:12345,
    recordBook:{},recordRankings:{high:{},university:{fr100:[historical,...roster.slice(1,10).map(a=>({kind:'individual',event:'fr100',time:a.bestTimes.fr100,athleteId:a.id,name:a.name,organization:a.organization}))]},japan:{}},
    teamTop10:{fr100:[{athleteId:own.id,time:49.85,name:own.name}]},recruits:[signed.id],japanTeam:{year:2031,athletes:[]}};
  const protectedData=JSON.stringify([state.players,state.world,state.teamTop10,state.recruits,state.japanTeam]),progress=JSON.stringify([state.season,state.slot,state.points,state.reputation,state.rngSeed]);
  completeCpuRecordCollection();const first=JSON.stringify(state);completeCpuRecordCollection();
  return{fast:state.recordRankings.university.fr100.find(row=>row.athleteId==='cpu0'),
    signed:state.recordRankings.high.fr100.find(row=>row.athleteId==='signed'),historical:state.recordRankings.university.fr100.find(row=>row.athleteId==='graduated'),
    counts:EVENTS.map(e=>state.recordRankings.university[e].length),flag:state.cpuRecordCollectionVersion,once:first===JSON.stringify(state),
    protected:protectedData===JSON.stringify([state.players,state.world,state.teamTop10,state.recruits,state.japanTeam]),progress:progress===JSON.stringify([state.season,state.slot,state.points,state.reputation,state.rngSeed])};
 })()`);
 assert.equal(r.fast.time,58);assert.equal(r.fast.meet,'PB集計');assert.equal(r.fast.gradeAtRecord,null);assert.equal(r.fast.gradeAtCollection,2);
 assert.equal(r.signed.time,57);assert.equal(r.historical.time,55);assert.equal(r.historical.season,2023);assert.equal(r.historical.stage,'決勝');
 assert.ok(r.counts.every(n=>n===10));assert.equal(r.flag,1);assert.ok(r.once&&r.protected&&r.progress);
});
