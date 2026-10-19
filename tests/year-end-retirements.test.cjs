const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),cp=require('node:child_process');
const {test}=require('node:test');
const SaveHistory=require('../save-history.js'),repo=path.join(__dirname,'..'),current=fs.readFileSync(path.join(repo,'index.html'),'utf8');
function game(html=current){
 const source=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 return vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+'\nreturn code=>JSON.parse(JSON.stringify(eval(code)))',['globalThis'])({crypto:{getRandomValues:a=>{a[0]=5914;return a}}});
}
test('year-end notices list exactly the actual retirees and preserve career decisions for the same ranked-specialty cohort',()=>{
 const initial=game()('(state=createState(),migrateState(),deepClone(state))');
 const snapshot=`(()=>{
  state=${JSON.stringify(initial)};migrateState();
  const seniors=state.players.filter(a=>a.year===4);seniors[0].bestTimes={};seniors[0].stats=Object.fromEntries(STATS.map(k=>[k,40]));seniors[1].bestTimes.fr100=standardFor('japan_open','fr100');
  const cpu=state.world.find(a=>a.category==='university'&&a.grade===4);cpu.bestTimes={};
  const adult=state.world.find(a=>a.category==='adult'),older={...deepClone(adult),id:'retire-alumnus',name:'卒業生引退検証',age:29,alumni:true,almaMater:state.playerUniversity,graduationSeason:2019},young={...deepClone(adult),id:'continue-young',age:23};
  state.world.push(attachMedleyStats(older),attachMedleyStats(young));state.alumniCareer.push({id:older.id,status:'社会人継続',season:2019});
  const before=activeAthletes().map(a=>({id:a.id,own:state.players.includes(a),category:state.players.includes(a)?'university':a.category,organization:a.organization,name:a.name}));
  const originalRng=rng,add=addMiddleSchoolCohort;let draws=0;rng=()=>{draws++;return .85};addMiddleSchoolCohort=()=>{rng=originalRng;add()};newSeason();addMiddleSchoolCohort=add;rng=originalRng;
  const after=activeAthletes().map(a=>a.id),copy=deepClone(state);delete copy.version;delete copy.pendingSeasonRetirements;
  return{state:copy,before,after,draws,ownRetired:seniors[0].id,continued:seniors[1].id,cpuRetired:cpu.id};
 })()`;
 const old=game(cp.execFileSync('git',['show','a571aae:index.html'],{cwd:repo,encoding:'utf8',maxBuffer:2000000}))(snapshot),run=game(),next=run(snapshot);
 assert.deepEqual(next.before,old.before);assert.equal(next.draws,old.draws);
 const originalIds=new Set(next.before.map(a=>a.id));
 assert.deepEqual(next.after.filter(id=>originalIds.has(id)).sort(),old.after.filter(id=>originalIds.has(id)).sort(),'the same existing swimmers continue and retire');
 for(const key of ['teamTop10','meetHistory','alumniCareer','retiredArchive'])assert.deepEqual(next.state[key],old.state[key],key);
 assert.deepEqual(next.state.players.filter(a=>a.year>1),old.state.players.filter(a=>a.year>1));
 for(const a of next.state.players.filter(a=>a.year>1))for(const key of ['trainingPlans','trainingFocus'])assert.deepEqual(next.state[key][a.id],old.state[key][a.id]);
 const oldById=new Map(old.state.world.map(a=>[a.id,a]));
 for(const a of next.state.world.filter(a=>originalIds.has(a.id))){const b=oldById.get(a.id);for(const key of ['stats','imAptitude','category','grade','age'])assert.deepEqual(a[key],b[key],a.id+' '+key)}
 const enrolled=new Map([...next.state.players,...next.state.world].map(a=>[a.id,a]));
 assert.ok(next.state.pendingCollegeAdmissions.rows.every(a=>enrolled.get(a.id)?.organization===a.to));
 const notice=run('deepClone(state.pendingSeasonRetirements)'),remaining=new Set(next.after),expected=next.before.filter(a=>!remaining.has(a.id)).map(a=>a.id).sort();
 assert.equal(notice.season,2026);assert.deepEqual(notice.rows.map(a=>a.id).sort(),expected);assert.equal(new Set(notice.rows.map(a=>a.id)).size,expected.length);
 for(const id of [next.ownRetired,next.cpuRetired,'retire-alumnus'])assert.ok(notice.rows.some(a=>a.id===id),id);
 assert.ok(!notice.rows.some(a=>a.id===next.continued||a.id==='continue-young'));
 const own=notice.rows.find(a=>a.id===next.ownRetired),alumnus=notice.rows.find(a=>a.id==='retire-alumnus');
 assert.ok(own.own);assert.equal(own.grade,4);assert.ok(alumnus.alumni);assert.equal(alumnus.category,'adult');assert.equal(alumnus.age,30);
 assert.ok(notice.rows.every(a=>!('stats' in a)&&!('bestTimes' in a)&&!('raceHistory' in a)));
 const restored=run(`(()=>{state=JSON.parse(JSON.stringify(state));migrateState();return state.pendingSeasonRetirements})()`);assert.deepEqual(restored,notice);
 run(`state=${JSON.stringify(old.state)};migrateState();true`);assert.equal(run('state.pendingSeasonRetirements'),null);assert.equal(run('showSeasonRetirements()'),false);
});
test('capacity cleanup retains the unacknowledged retirement list and does not retain whole player histories in the notification',()=>{
 const notice={season:2030,rows:[{id:'retired',name:'引退選手',organization:'大学',category:'university',grade:4,age:22,own:true,alumni:false,specialty:'fr100',specialtyPB:51.23}]};
 const state={season:2031,pendingSeasonRetirements:notice,players:[],world:[],retiredArchive:[],meetHistory:[{season:2020,slot:73,meet:'joint_record',padding:'x'.repeat(5000)}]};
 const result=SaveHistory.plan(state,{triggerBytes:1,targetBytes:1500});assert.ok(result.removed>0);assert.deepEqual(JSON.parse(result.text).pendingSeasonRetirements,notice);
});
