const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const load=vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+'\nreturn code=>JSON.parse(JSON.stringify(eval(code)))',[]);
function game(){const run=load();run(`(state={playerUniversity:'自大学',recordRankings:{},teamTop10:{}},true)`);return run}

test('six heats place PB ranks 1 through 24 into heats 6,5,4 at lanes 4,5,3,6,2,7,1,8',()=>{
 const run=game(),r=run(`(()=>{
  const field=Array.from({length:48},(_,i)=>({source:'CPU',athlete:{id:'p'+(i+1),bestTimes:{fr100:50+i/100}}}));
  const before=JSON.stringify(field),heats=seedRaceHeats(field,'fr100','japan_open');
  return{unchanged:before===JSON.stringify(field),groups:heats.map(h=>h.length),rows:heats.flat().map(r=>({rank:Number(r.athlete.id.slice(1)),heat:r.heatNo,lane:r.heatLane}))};
 })()`);
 assert.ok(r.unchanged);assert.deepEqual(r.groups,[8,8,8,8,8,8]);
 const lanes=[4,5,3,6,2,7,1,8];
 for(const row of r.rows){
  if(row.rank<=24){assert.equal(row.heat,6-(row.rank-1)%3);assert.equal(row.lane,lanes[Math.floor((row.rank-1)/3)])}
  else{assert.equal(row.heat,3-Math.floor((row.rank-25)/8));assert.equal(row.lane,lanes[(row.rank-25)%8])}
 }
});

test('all national and college entrants survive up to 160 heats, with partial heats, ties and frozen entry PBs',()=>{
 const run=game(),rows=run(`(()=>{
  const rows=[];
  for(let count=0;count<=1280;count++){
   const field=Array.from({length:count},(_,i)=>({source:i%13===0?'PLAYER':'CPU',entryPB:50+Math.floor(i/2)/100,athlete:{id:'p'+i,bestTimes:{fr100:1000-i/100}}}));
   const before=JSON.stringify(field),heats=seedRaceHeats(field,'fr100','japan_open'),flat=heats.flat(),n=heats.length,tail=heats.slice(-3).flat();
   const sorted=[...field].sort((a,b)=>a.entryPB-b.entryPB),circle=sorted.slice(0,tail.length),tailIds=new Set(tail.map(r=>r.athlete.id));
   const errors=[];
   if(flat.length!==count||new Set(flat.map(r=>r.athlete.id)).size!==count||before!==JSON.stringify(field))errors.push('roster');
   if(n!==Math.ceil(count/8)||heats.some((h,i)=>h.length>8||(n>1&&h.length<4&&!(i===0&&count>24&&count<28))))errors.push('packing');
   if(count>=24&&heats.slice(-3).some(h=>h.length!==8))errors.push('final three not full');
   if(circle.some(r=>!tailIds.has(r.athlete.id)))errors.push('fastest pool');
   for(let i=0;i<n;i++){
    const heat=heats[i],seeded=[...heat].sort((a,b)=>a.entryPB-b.entryPB||SEEDED_LANES.indexOf(a.heatLane)-SEEDED_LANES.indexOf(b.heatLane));
    if(heat.some(r=>r.heatNo!==i+1)||new Set(heat.map(r=>r.heatLane)).size!==heat.length||seeded.some((r,j)=>r.heatLane!==SEEDED_LANES[j]))errors.push('lanes');
   }
   // An eight-lane final-three block has the exact rank-to-heat mapping.
   if(n>=3&&heats.slice(-3).every(h=>h.length===8))for(let rank=0;rank<24;rank++){
    const row=tail.find(r=>r.athlete.id===sorted[rank].athlete.id);
    if(row.heatNo!==n-rank%3)errors.push('circle heat');
   }
   if(errors.length)rows.push({count,errors});
  }
  return rows;
 })()`);
 assert.deepEqual(rows,[]);
});

test('domestic and world individual fields circle-seed the final three or fewer actual heats',()=>{
 const run=game(),rows=run(`['kansai_college','intercollege','teijimayama_championship','japan_open','japan_championship','joint_record','world_championship'].flatMap(meet=>['fr50','fr100','fr200','fr400'].map(event=>{
  const count=preliminaryHeatCount(meet,event)*8,field=Array.from({length:count},(_,i)=>({source:'CPU',athlete:{id:'p'+i,bestTimes:{[event]:50+i}}})),heats=seedRaceHeats(field,event,meet),n=heats.length;
  return{meet,event,n,positions:field.slice(0,Math.min(3,n)).map(a=>{const row=heats.flat().find(r=>r.athlete.id===a.athlete.id);return{heat:row.heatNo,lane:row.heatLane}})};
 }))`);
 for(const row of rows)assert.deepEqual(row.positions,Array.from({length:Math.min(3,row.n)},(_,i)=>({heat:row.n-i,lane:4})),JSON.stringify(row));
});

test('all relay kinds use PB sum for circle seeding and preserve every member and country',()=>{
 const run=game(),rows=run(`['kansai_college','intercollege','joint_record','world_championship'].flatMap(meet=>RELAYS.map(kind=>{
  const count=preliminaryHeatCount(meet,kind)*8,teams=Array.from({length:count},(_,i)=>({organization:'team'+i,members:Array.from({length:4},(_,j)=>({id:i+'-'+j,bestTimes:Object.fromEntries(EVENTS.map(e=>[e,50+i]))}))}));
  const before=JSON.stringify(teams),heats=seedRelayHeats(teams,kind,meet),n=heats.length;
  return{meet,kind,n,count:heats.flat().length,unchanged:before===JSON.stringify(teams),positions:teams.slice(0,Math.min(3,n)).map(a=>{const row=heats.flat().find(r=>r.organization===a.organization);return{heat:row.heatNo,lane:row.heatLane}})};
 }))`);
 for(const row of rows){assert.ok(row.unchanged);assert.equal(row.count,row.n*8);assert.deepEqual(row.positions,Array.from({length:Math.min(3,row.n)},(_,i)=>({heat:row.n-i,lane:4})),JSON.stringify(row))}
});

test('finals stay in qualifying-time lane order and one-heat time trials retain PB lane order',()=>{
 const run=game(),r=run(`(()=>{const rows=[55,51,54,50,53,52,57,56].map((time,i)=>({id:i,prelimTime:time}));
 return{finals:assignSeededLanes(rows,r=>r.prelimTime).map(r=>({time:r.prelimTime,lane:r.heatLane})),
   trial:seedRaceHeats(rows.map(r=>({athlete:{id:r.id,bestTimes:{fr100:r.prelimTime}}})),'fr100','team_trial')[0].map(r=>({time:r.athlete.bestTimes.fr100,lane:r.heatLane}))};})()`);
 const expected=[50,51,52,53,54,55,56,57].map((time,i)=>({time,lane:[4,5,3,6,2,7,1,8][i]}));
 assert.deepEqual(r.finals,expected);assert.deepEqual(r.trial,expected);
});
