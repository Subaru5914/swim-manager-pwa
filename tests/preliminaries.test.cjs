const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(){
  const context=vm.createContext({});vm.runInContext(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener')),context);
  vm.runInContext('state={rngSeed:12345,season:2026,players:[],world:[],playerUniversity:"自大学"}',context);
  return code=>JSON.parse(vm.runInContext('JSON.stringify('+code+')',context));
}
const ranges={50:[.08,.22],100:[.18,.45],200:[.9,2.2],400:[2,4.5]};

test('all individual prelims add a distance-dependent delay and retain exact splits and the recorded finish',()=>{
  const run=game(),rows=run(`(()=>{
    rng=()=>.5;gauss=()=>0;
    const p={stats:Object.fromEntries(STATS.map(k=>[k,138])),bestTimes:{}};
    const before=JSON.stringify(p);
    return EVENTS.map(event=>{
      const final=simulateRace(p,event,true,true),prelim=simulateRace(p,event,true,true,false,true),cpu=simulateMeetRace(p,event,'intercollege',false,true);
      return{event,distance:distanceOf(event),base:final.physics.targetTime,delay:prelim.physics.preliminaryDelay,finalDelay:final.physics.preliminaryDelay??null,
        total:prelim.total,cpu:cpu.total,last:prelim.cumulative.at(-1),sum:round2(prelim.splits.reduce((a,b)=>a+b,0)),finish:prelim.trajectory.at(-1),unchanged:before===JSON.stringify(p)};
    });
  })()`);
  assert.equal(rows.length,15);
  for(const row of rows){
    const [min,max]=ranges[row.distance],delay=(min+max)/2;
    assert.ok(Math.abs(row.delay-delay)<1e-10);assert.equal(row.finalDelay,null);
    assert.equal(row.total,Math.round((row.base+delay)*100)/100);assert.equal(row.total,row.cpu);
    assert.equal(row.last,row.total);assert.equal(row.sum,row.total);assert.equal(row.finish.distance,row.distance);assert.ok(Math.abs(row.finish.t-row.total)<1e-8);assert.ok(row.unchanged);
  }
});

test('every relay prelim applies the delay to four swimmers and keeps laps, total and playback on the same clock',()=>{
  const run=game(),rows=run(`(()=>{
    rng=()=>.5;gauss=()=>0;
    const members=Array.from({length:4},(_,i)=>({id:'relay-'+i,name:'泳者'+i,stats:Object.fromEntries(STATS.map(k=>[k,138])),bestTimes:{}})),before=JSON.stringify(members);
    return RELAYS.map(event=>{
      const final=simulateRelay(members,event,true),prelim=simulateRelay(members,event,true,true),cpu=simulateCpuRelay(members,event,'intercollege',true);
      return{event,legDistance:event==='4x200fr'?200:100,base:final.total,total:prelim.total,cpu:cpu.total,legs:prelim.legs,last:prelim.cumulativeLegs.at(-1),
        delay:prelim.preliminaryDelay,finalDelay:final.preliminaryDelay??null,finish:prelim.trajectory.at(-1),distance:prelim.distance,unchanged:before===JSON.stringify(members)};
    });
  })()`);
  for(const row of rows){
    const [min,max]=ranges[row.legDistance];assert.ok(Math.abs(row.delay-4*(min+max)/2)<1e-10);assert.equal(row.finalDelay,null);
    assert.ok(row.total>=row.base+4*min-.02&&row.total<=row.base+4*max+.02);assert.equal(row.cpu,row.total);
    assert.equal(Math.round(row.legs.reduce((a,b)=>a+b,0)*100)/100,row.total);assert.equal(row.last,row.total);
    assert.equal(row.finish.distance,row.distance);assert.ok(Math.abs(row.finish.t-row.total)<1e-8);assert.ok(row.unchanged);
  }
});

test('mental alone changes neither random timing variance nor poor-race chances at the same form, including upper A',()=>{
  const run=game(),groups=run(`[138,173].map(value=>[0,100,150,200].map(mental=>{
    const p={stats:Object.fromEntries(STATS.map(k=>[k,k==='mental'?mental:value])),bestTimes:{}},base=expectedTime(p,'fr100');p.bestTimes.fr100=base+30;
    state.rngSeed=7654321;const normal=[];let poor=0;
    for(let i=0;i<10000;i++){const time=raceTarget(p,'fr100');if(time>p.bestTimes.fr100)poor++;else normal.push(time)}
    const mean=normal.reduce((a,b)=>a+b,0)/normal.length,sd=Math.sqrt(normal.reduce((sum,t)=>sum+(t-mean)**2,0)/normal.length);
    return{value,mental,rate:poor/10000,sd};
  }))`);
  for(const rows of groups){
    rows.forEach(row=>assert.ok(Math.abs(row.rate-.16)<.015,JSON.stringify(row)));
    for(let i=1;i<rows.length;i++){assert.equal(rows[i].rate,rows[0].rate);assert.equal(rows[i].sd,rows[0].sd)}
  }
});

test('final cards recover actual prelim times from old individual and relay results without using PB or new lineup times',()=>{
  const run=game(),r=run(`(()=>{
    const original=Array.from({length:4},(_,i)=>({id:'original-'+i,name:'旧泳者'+i,year:2})),replacement=Array.from({length:4},(_,i)=>({id:'new-'+i,name:'決勝泳者'+i,year:3}));
    state.players=[...original,...replacement];
    const athlete=replacement[0],race={total:49,trajectory:[{t:49,distance:100,phase:'finish'}]},individual={source:'PLAYER',athlete,entryPB:48,heatLane:4,race};
    const prelim={...individual,race:{total:51.23}},individualBlock={event:'fr100',phase:'final',stage:'final',ownIds:[athlete.id],rows:[individual],eventResult:{prelim:[prelim],final:[individual]}};
    const relay={organization:state.playerUniversity,members:replacement,heatLane:4,race:{total:210,trajectory:[{t:210,distance:400,phase:'finish'}]}};
    const relayBlock={event:'4x100medley',phase:'final',stage:'relay_final',ownIds:replacement.map(a=>a.id),rows:[relay],relayPrelim:[{organization:state.playerUniversity,members:original,race:{total:215.67}}]};
    const before=JSON.stringify([individualBlock,relayBlock]);
    const own=buildMeetBlockRaceQueue(individualBlock,0)[0].rows[0],team=buildMeetBlockRaceQueue(relayBlock,1)[0].rows[0];
    return{individual:own.prelimTime,relay:team.prelimTime,card:raceEntrantCard(own,0,'fr100'),relayCard:raceEntrantCard(team,0,'4x100medley'),
      newNames:team.members.map(a=>a.name),unchanged:before===JSON.stringify([individualBlock,relayBlock])};
  })()`);
  assert.equal(r.individual,51.23);assert.equal(r.relay,215.67);assert.match(r.card,/予選 <b>51\.23<\/b>/);assert.match(r.relayCard,/予選 <b>3:35\.67<\/b>/);
  assert.ok(r.newNames.every(name=>name.startsWith('決勝泳者')));assert.ok(r.unchanged);
});
