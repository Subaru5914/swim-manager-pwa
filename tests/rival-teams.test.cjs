const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(){
 const run=vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+`
 function swimmer(id,grade,pb){return attachMedleyStats({id,name:id,grade,category:'university',organization:'甲大学',specialty:'fr100',retired:false,stats:Object.fromEntries(STATS.map(k=>[k,140])),bestTimes:pb})}
 return code=>JSON.parse(JSON.stringify(eval(code)))`,[] )();
 run(`state={season:2026,rngSeed:5914,players:[],world:[],universities:[{id:'a',name:'甲大学',region:'kansai',reputation:200},{id:'b',name:'乙大学',region:'national',reputation:300},{id:'empty',name:'空大学',region:'kansai',reputation:20}]};true`);return run;
}
test('rival rosters use current university membership, exclude retirees and other ages, and sort PBs without changing athletes or RNG',()=>{
 const run=game(),r=run(`(()=>{
  const a=swimmer('one',1,{fr100:53}),b=swimmer('two',2,{fr100:50}),c=swimmer('no-pb',1,{}),retired={...swimmer('retired',1,{fr100:40}),retired:true},high={...swimmer('high',1,{fr100:41}),category:'high'},other={...swimmer('other',1,{fr100:42}),organization:'乙大学'};
  state.world=[b,a,c,retired,high,other];const saved=JSON.stringify(state);
  const original=rivalUniversityRoster('a').map(a=>a.id),sorted=rivalUniversityRoster('a','fr100').map(a=>a.id),regions=rivalUniversities('kansai').map(u=>u.id),universities=rivalUniversities().map(u=>u.id),empty=rivalUniversityRoster('empty');
  const stable=saved===JSON.stringify(state);state.universities[0].name='新名称';[a,b,c,retired,high].forEach(a=>a.organization='新名称');const renamed=rivalUniversityRoster('a','fr100').map(a=>a.id);b.category='adult';return{original,sorted,regions,universities,empty,stable,renamed,afterGraduation:rivalUniversityRoster('a','fr100').map(a=>a.id)};
 })()`);
 assert.deepEqual(r.original,['one','no-pb','two']);assert.deepEqual(r.sorted,['two','one','no-pb']);assert.deepEqual(r.regions,['a','empty']);assert.deepEqual(r.universities,['b','a','empty']);assert.deepEqual(r.empty,[]);assert.ok(r.stable);assert.deepEqual(r.renamed,r.sorted);assert.deepEqual(r.afterGraduation,['one','no-pb']);
});
test('relay previews choose the actual PB-based starters, prohibit duplicate medley swimmers, and show PB totals rather than invented race records',()=>{
 const run=game(),r=run(`(()=>{
  const roster=Array.from({length:6},(_,i)=>swimmer('p'+i,i%4+1,{fr100:50+i,fr200:110+i,ba100:58+(5-i),br100:64+Math.abs(2-i),fly100:55+Math.abs(3-i)}));
  state.world=roster;const saved=JSON.stringify(state),relays=RELAYS.map(kind=>rivalRelayCandidates(roster,kind));
  return{relays:relays.map(r=>({kind:r.kind,ids:r.members.map(a=>a.id),legs:r.legs.map(l=>({id:l.athlete.id,event:l.event,time:l.time,estimated:l.estimated})),total:r.total,estimated:r.estimated})),stable:saved===JSON.stringify(state)};
 })()`);
 assert.ok(r.stable);assert.deepEqual(r.relays[0].ids,['p0','p1','p2','p3']);assert.deepEqual(r.relays[1].ids,['p0','p1','p2','p3']);assert.deepEqual(r.relays[2].ids,['p5','p2','p3','p0']);
 for(const relay of r.relays){assert.equal(new Set(relay.ids).size,4);assert.equal(relay.total,Math.round(relay.legs.reduce((n,l)=>n+l.time,0)*100)/100);assert.equal(relay.estimated,false)}
 assert.equal(r.relays[0].total,206);assert.equal(r.relays[1].total,446);
});
test('unmeasured relay legs are marked as estimates, stay unrecorded, and short teams do not receive a fabricated lineup or clock',()=>{
 const run=game(),r=run(`(()=>{
  const roster=Array.from({length:4},(_,i)=>swimmer('p'+i,1,{}));state.world=roster;const saved=JSON.stringify(state);
  const estimated=rivalRelayCandidates(roster,'4x100medley'),short=rivalRelayCandidates(roster.slice(0,3),'4x100fr');return{estimated:{legs:estimated.legs.map(l=>({time:l.time,estimated:l.estimated})),total:estimated.total,estimated:estimated.estimated},short,stable:saved===JSON.stringify(state)};
 })()`);
 assert.ok(r.stable&&r.estimated.estimated&&r.estimated.legs.every(l=>l.estimated&&l.time>0));assert.equal(r.estimated.total,Math.round(r.estimated.legs.reduce((n,l)=>n+l.time,0)*100)/100);assert.deepEqual(r.short.members,[]);assert.equal(r.short.total,null);
});
