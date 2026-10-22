const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(){
 const context=vm.createContext({crypto:{getRandomValues:a=>{a[0]=12345;return a}}});
 vm.runInContext(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener')),context);
 const run=code=>JSON.parse(JSON.stringify(vm.runInContext(code,context)));
 run(`state={players:[],world:[{id:'one',name:'同姓 同名',organization:'甲大学',category:'university',grade:3,specialty:'fr200',stats:{fr_speed:151},bestTimes:{fr200:112.4}}, {id:'two',name:'同姓 同名',organization:'乙大学',category:'university',grade:2,specialty:'fr200',stats:{fr_speed:140},bestTimes:{fr200:115}}, {id:'high',name:'高校生',organization:'甲大学',category:'high'}, {id:'retired',name:'引退済',organization:'甲大学',category:'university',retired:true}],universities:[{name:'甲大学'},{name:'乙大学'}],rngSeed:5914};true`);
 return run;
}
test('favorite registration distinguishes IDs and changes only the favorites, with no duplicate or ineligible registrations',()=>{
 const run=game(),r=run(`(()=>{
  const before=JSON.stringify(state);normalizeFavoriteRivals();
  const added=[setFavoriteRival('one',true),setFavoriteRival('one',true),setFavoriteRival('two',true)];
  const rejected=['high','retired','missing'].map(id=>setFavoriteRival(id,true));
  const rows=deepClone(state.favoriteRivals),after=deepClone(state);delete after.favoriteRivals;
  const removed=[setFavoriteRival('one',false),setFavoriteRival('one',false)];
  return{added,rejected,rows,unchanged:JSON.stringify(after)===before,removed,remaining:state.favoriteRivals};
 })()`);
 assert.deepEqual(r.added,[true,false,true]);assert.deepEqual(r.rejected,[false,false,false]);assert.ok(r.unchanged);
 assert.deepEqual(r.rows.map(a=>a.id),['one','two']);assert.deepEqual(Object.keys(r.rows[0]),['id','name','organization']);
 assert.deepEqual(r.removed,[true,false]);assert.deepEqual(r.remaining.map(a=>a.id),['two']);
});
test('favorites read current athletes after renaming, PB updates and graduation and retain removable registrations when athletes disappear',()=>{
 const run=game(),r=run(`(()=>{
  normalizeFavoriteRivals();setFavoriteRival('one',true);const a=state.world[0];
  a.name='変更後の名前';a.organization='改称大学';a.grade=4;a.bestTimes.fr200=111.25;
  const before=JSON.stringify(state),current=favoriteRivalRows()[0],readonly=before===JSON.stringify(state);
  const college=deepClone(current);a.category='adult';a.age=23;a.organization='実業団';const adult=deepClone(favoriteRivalRows()[0]);
  state.world=state.world.filter(a=>a.id!=='one');const unavailable=deepClone(favoriteRivalRows()[0]);
  const removed=setFavoriteRival('one',false);return{college,adult,unavailable,removed,readonly};
 })()`);
 assert.ok(r.readonly&&r.removed);assert.equal(r.college.athlete.name,'変更後の名前');assert.equal(r.college.athlete.grade,4);assert.equal(r.college.athlete.bestTimes.fr200,111.25);
 assert.equal(r.adult.athlete.organization,'実業団');assert.equal(r.adult.athlete.category,'adult');
 assert.equal(r.unavailable.athlete,null);assert.deepEqual(r.unavailable.entry,{id:'one',name:'同姓 同名',organization:'甲大学'});
});
test('normalization adds an empty list to existing saves and cleans duplicate and malformed favorites without losing unavailable entries',()=>{
 const run=game(),r=run(`(()=>{
  normalizeFavoriteRivals();const empty=deepClone(state.favoriteRivals);
  state.favoriteRivals=[null,{},7,{id:'',name:'空ID'},{id:1,name:'数値ID'},{id:'one',name:'同姓 同名',organization:'甲大学',stats:{fr_speed:200}},{id:'one',name:'重複'},{id:'two',name:'   '},{id:'gone',name:'情報なし',organization:123}];
  normalizeFavoriteRivals();const clean=JSON.stringify(state.favoriteRivals);normalizeFavoriteRivals();
  return{empty,clean:state.favoriteRivals,stable:clean===JSON.stringify(state.favoriteRivals)};
 })()`);
 assert.deepEqual(r.empty,[]);assert.ok(r.stable);assert.deepEqual(r.clean,[{id:'one',name:'同姓 同名',organization:'甲大学'},{id:'gone',name:'情報なし',organization:''}]);
});
test('favorites group by current organization, sort grades ascending and use names and IDs for stable ties without rewriting registration order',()=>{
 const run=game(),r=run(`(()=>{
  state.world=[['b4','B大学',4,'Z'],['a4','A大学',4,'A'],['b1','B大学',1,'A'],['a2z','A大学',2,'Z'],['a2b','A大学',2,'A'],['a2a','A大学',2,'A'],['a1','A大学',1,'Z']].map(([id,organization,grade,name])=>({id,organization,grade,name,category:'university'}));
  state.favoriteRivals=state.world.map(a=>({id:a.id,name:a.name,organization:'登録時の大学'}));state.favoriteRivals.push({id:'gone',name:'不明選手',organization:'A大学'});
  const before=JSON.stringify(state),first=favoriteRivalRows().map(row=>row.entry.id),stable=before===JSON.stringify(state);
  state.world.find(a=>a.id==='a4').grade=1;state.world.find(a=>a.id==='b1').organization='A大学';
  return{first,stable,next:favoriteRivalRows().map(row=>row.entry.id),registered:state.favoriteRivals.map(a=>a.id)};
 })()`);
 assert.ok(r.stable);assert.deepEqual(r.first,['a1','a2a','a2b','a2z','a4','gone','b1','b4']);
 assert.deepEqual(r.next,['a4','b1','a1','a2a','a2b','a2z','gone','b4']);
 assert.deepEqual(r.registered,['b4','a4','b1','a2z','a2b','a2a','a1','gone']);
});
test('full save loading and JSON round trips keep favorites and all athlete stats, records and RNG',()=>{
 const run=game(),r=run(`(()=>{
  state=createState();migrateState();const a=state.world.find(a=>a.category==='university'&&!a.retired);setFavoriteRival(a.id,true);
  const before=JSON.stringify(state),saved=deepClone(state),favorites=deepClone(state.favoriteRivals);
  state.favoriteRivals=[];applyLoadedSave(saved);const unchanged=before===JSON.stringify(state);
  const old=deepClone(state);delete old.favoriteRivals;applyLoadedSave(old);
  return{favorites,unchanged,empty:state.favoriteRivals};
 })()`);
 assert.ok(r.unchanged);assert.equal(r.favorites.length,1);assert.deepEqual(r.empty,[]);
});
test('favorite universities follow the dropdown reputation order, including ties, region filters, renames and later reputation changes',()=>{
 const run=game(),r=run(`(()=>{
  state.universities=[{id:'a',name:'A大学',region:'kansai',reputation:100},{id:'b',name:'B大学',region:'national',reputation:300},{id:'c',name:'C大学',region:'kansai',reputation:300}];
  state.world=state.universities.flatMap(u=>[4,1,3,2].map(grade=>({id:u.id+grade,name:u.id+grade,organization:u.name,grade,category:'university'})));
  state.world.push({id:'adult',name:'卒業生',organization:'A実業団',category:'adult',age:23});
  state.favoriteRivals=state.world.map(a=>({id:a.id,name:a.name,organization:a.organization}));state.favoriteRivals.push({id:'gone',name:'情報なし',organization:'A大学'});
  const before=JSON.stringify(state),first=favoriteRivalRows().map(row=>row.entry.id),stable=before===JSON.stringify(state);
  const dropdown=rivalUniversities().map(u=>u.name),regional=rivalUniversities('kansai').map(u=>u.name);
  state.universities[0].reputation=400;
  const changed=favoriteRivalRows().map(row=>row.entry.id);
  state.universities[1].name='Z大学';state.world.filter(a=>a.organization==='B大学').forEach(a=>a.organization='Z大学');
  const renamed=favoriteRivalRows().map(row=>row.entry.id);
  return{stable,first,dropdown,regional,changed,renamed};
 })()`);
 assert.ok(r.stable);assert.deepEqual(r.dropdown,['B大学','C大学','A大学']);assert.deepEqual(r.regional,['C大学','A大学']);
 assert.deepEqual(r.first,['b1','b2','b3','b4','c1','c2','c3','c4','a1','a2','a3','a4','gone','adult']);
 assert.deepEqual(r.changed,['a1','a2','a3','a4','gone','b1','b2','b3','b4','c1','c2','c3','c4','adult']);
 assert.deepEqual(r.renamed,['a1','a2','a3','a4','gone','c1','c2','c3','c4','b1','b2','b3','b4','adult']);
});
