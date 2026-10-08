const assert=require('node:assert/strict');
const {test}=require('node:test');
const Cloud=require('../cloud-sync.js');
const {config,storage,backend,clone}=require('./cloud-fixture.cjs');
function save(points=0){return{season:2026,slot:1,points,reputation:35,playerUniversity:'試験大学',rngSeed:12345,players:[{id:'P1',name:'試験 太郎',stats:{fr_speed:112},bestTimes:{fr100:53.4}}],world:[],facilities:{fr_speed:0},japanTeam:{year:2027,relays:{'4x100medley':['P1','W2','W3','W4']}}}}
async function device(server,points=0,store=storage()){
  let current=save(points),online=true,idle=true;
  const client=new Cloud({storage:store,fetch:server.fetch,getSave:()=>JSON.stringify(current),applySave:next=>{current=next},online:()=>online,canApply:()=>idle});
  await client.start(config);
  return{client,store,get current(){return current},set current(value){current=value},set online(value){online=value},set idle(value){idle=value}};
}
test('one account transfers complete saves between PC and iPhone and checks unchanged revisions without downloading saves',async t=>{
  const server=backend(),pc=await device(server,100),phone=await device(server,0);
  t.after(()=>{pc.client.stop();phone.client.stop()});
  await pc.client.login('owner@example.test','test-password',true);
  assert.equal(pc.client.status.kind,'synced');
  await phone.client.login('owner@example.test','test-password');
  assert.equal(phone.client.status.kind,'conflict');
  assert.equal(phone.current.points,0);
  await phone.client.resolve('remote');
  assert.deepEqual(phone.current,pc.current);
  pc.current.points=120;pc.current.players[0].stats.fr_speed=113.5;
  pc.client.changed();await pc.client.sync();await phone.client.sync();
  assert.deepEqual(phone.current,pc.current);
  const count=server.calls.length;await phone.client.sync();
  assert.equal(server.calls.length,count+1);
  assert.match(server.calls.at(-1).path,/\/revision\.json$/);
  const sessionValues=[...pc.store.values.values()].join('');
  assert.ok(!sessionValues.includes('test-password'));
  assert.ok(!JSON.stringify(pc.current).includes('refreshToken'));
});
test('offline changes survive and upload automatically when the connection returns',async t=>{
  const server=backend(),pc=await device(server,50);t.after(()=>pc.client.stop());
  await pc.client.login('owner@example.test','test-password');
  const original=clone(server.saves.get(pc.client.session.uid));
  pc.online=false;pc.current.slot=96;pc.current.points=80;pc.client.changed();
  await pc.client.sync();assert.deepEqual(server.saves.get(pc.client.session.uid),original);
  assert.equal(pc.client.status.kind,'pending');
  pc.online=true;await pc.client.sync();
  assert.equal((await Cloud.decode(server.saves.get(pc.client.session.uid))).slot,96);
  assert.equal(pc.client.status.kind,'synced');
});
test('diverging devices preserve both saves until the user chooses a version',async t=>{
  const server=backend(),pc=await device(server,10),phone=await device(server,10);t.after(()=>{pc.client.stop();phone.client.stop()});
  await pc.client.login('owner@example.test','test-password');await phone.client.login('owner@example.test','test-password');
  pc.current.points=20;await pc.client.sync();phone.current.points=30;await phone.client.sync();
  assert.equal(phone.client.status.kind,'conflict');assert.equal(phone.current.points,30);
  assert.equal((await Cloud.decode(server.saves.get(pc.client.session.uid))).points,20);
  await phone.client.resolve('local');assert.equal(phone.client.status.kind,'synced');
  await pc.client.sync();assert.equal(pc.current.points,30);
});
test('conditional writes reject a concurrent update between reading and uploading',async t=>{
  const server=backend(),pc=await device(server,10);t.after(()=>pc.client.stop());
  await pc.client.login('owner@example.test','test-password');const id=pc.client.session.uid;
  const other=clone(server.saves.get(id));other.revision='other-device-revision';
  server.beforePut=()=>{server.beforePut=null;server.set(id,other)};
  pc.current.points=99;await pc.client.sync();
  assert.equal(pc.current.points,99);assert.equal(server.saves.get(id).revision,'other-device-revision');
  assert.equal(pc.client.status.kind,'conflict');
});
test('a newer cloud update requires another conflict decision rather than silently replacing it',async t=>{
  const server=backend(),pc=await device(server,10),phone=await device(server,0);t.after(()=>{pc.client.stop();phone.client.stop()});
  await pc.client.login('owner@example.test','test-password');await phone.client.login('owner@example.test','test-password');
  pc.current.points=20;await pc.client.sync();
  await assert.rejects(phone.client.resolve('local'),/他の端末で更新/);
  assert.equal(phone.current.points,0);
  await phone.client.resolve('remote');assert.equal(phone.current.points,20);
});
test('remote data never replaces progress made during a download or while a race is showing',async t=>{
  const server=backend(),pc=await device(server,10),phone=await device(server,10);t.after(()=>{pc.client.stop();phone.client.stop()});
  await pc.client.login('owner@example.test','test-password');await phone.client.login('owner@example.test','test-password');
  pc.current.points=20;await pc.client.sync();phone.idle=false;
  await phone.client.sync();assert.equal(phone.current.points,10);
  phone.idle=true;
  server.beforeGet=(_id,revision)=>{if(!revision){server.beforeGet=null;phone.current.points=30}};
  await phone.client.sync();assert.equal(phone.current.points,30);assert.equal(phone.client.status.kind,'conflict');
});
test('progress saved during an unchanged revision check remains pending and is sent in the next sync',async t=>{
  const server=backend(),pc=await device(server,10);t.after(()=>pc.client.stop());
  await pc.client.login('owner@example.test','test-password');
  server.beforeGet=(_id,revision)=>{if(revision){server.beforeGet=null;pc.current.points=77;pc.client.changed()}};
  await pc.client.sync();assert.equal(pc.client.status.kind,'pending');
  await pc.client.sync();assert.equal(pc.client.status.kind,'synced');
  assert.equal((await Cloud.decode(server.saves.get(pc.client.session.uid))).points,77);
});
test('saved sessions refresh tokens after reload and different accounts keep separate cloud data',async t=>{
  const server=backend(),pc=await device(server,10),other=await device(server,88);t.after(()=>{pc.client.stop();other.client.stop()});
  await pc.client.login('owner@example.test','test-password');await other.client.login('another@example.test','test-password');
  assert.notEqual(pc.client.session.uid,other.client.session.uid);
  pc.client.session.expiresAt=0;pc.client.saveSession();
  const reloaded=await device(server,10,pc.store);t.after(()=>reloaded.client.stop());
  assert.equal(server.refreshes,1);assert.equal(reloaded.client.status.kind,'synced');
  assert.equal((await Cloud.decode(server.saves.get(other.client.session.uid))).points,88);
  reloaded.client.logout();assert.equal(reloaded.store.getItem('swimManagerCloudSession'),null);
  reloaded.current.points=999;await reloaded.client.sync();
  assert.equal((await Cloud.decode(server.saves.get(pc.client.session.uid))).points,10);
});
test('damaged or structurally invalid cloud saves leave local data intact',async t=>{
  const server=backend(),pc=await device(server,10);t.after(()=>pc.client.stop());
  await pc.client.login('owner@example.test','test-password');const id=pc.client.session.uid;
  const bad=clone(server.saves.get(id));bad.revision='corrupt';bad.fingerprint='0'.repeat(64);server.set(id,bad);
  await pc.client.sync();assert.equal(pc.current.points,10);assert.equal(pc.client.status.kind,'error');
  const text=JSON.stringify({players:[]});
  server.set(id,{...bad,encoding:'json',payload:text,fingerprint:await Cloud.fingerprint(text),revision:'invalid'});
  await pc.client.sync();assert.equal(pc.current.points,10);assert.equal(pc.client.status.kind,'error');
});
test('large Japanese saves compress, preserve records and reject altered payloads',async()=>{
  const data=save();data.raceHistory=Array.from({length:10000},(_,i)=>({name:'選手の苗字 名前',event:'fr100',time:50+i/10000}));
  const text=JSON.stringify(data),packed=await Cloud.encode(text);
  assert.equal(packed.encoding,'gzip-base64');assert.ok(packed.payload.length<text.length/2);
  const value={...packed,schemaVersion:1,revision:'large-save',fingerprint:await Cloud.fingerprint(text)};
  assert.deepEqual(await Cloud.decode(value),data);
  await assert.rejects(Cloud.decode({...value,fingerprint:'0'.repeat(64)}),/破損/);
});
test('login errors and rejected database access are recoverable and never replace local saves',async t=>{
  const server=backend(),pc=await device(server,42);t.after(()=>pc.client.stop());
  await assert.rejects(pc.client.login('owner@example.test','wrong-password'),/パスワード/);
  assert.equal(pc.client.session,null);assert.equal(pc.current.points,42);
  const original=server.fetch;
  pc.client.request=(url,options)=>new URL(url).origin===config.databaseURL?Promise.resolve(new Response('{"error":"Permission denied"}',{status:401})):original(url,options);
  await pc.client.login('owner@example.test','test-password');assert.equal(pc.client.status.kind,'error');
  pc.client.request=original;await pc.client.sync();assert.equal(pc.client.status.kind,'synced');
  assert.equal((await Cloud.decode(server.saves.get(pc.client.session.uid))).points,42);
});
