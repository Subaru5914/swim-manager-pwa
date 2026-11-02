const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(){return vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+`
 let fields,rolls=0;
 function fixture(rank=1,reputation=500){
  const a={id:'candidate',name:'同名選手',category:'high',grade:3,specialty:'fr100',stats:{fr_speed:150},bestTimes:{fr100:52}};
  state={season:2026,slot:1,points:100,reputation,rngSeed:5914,playerUniversity:'自大学',players:[],world:[a],recruits:[],universities:[{id:'cpu',name:'他大学',reputation}],scoutingCompetition:{season:2026,randomState:12345,processedMonths:[],notices:[],schools:{cpu:{budget:100,remaining:100}},candidates:{candidate:{interests:{player:20,cpu:20},contacts:{},offers:[],cpuTargets:['cpu'],destination:null}}}};
  fields=new Map(EVENTS.map(e=>[e,{byId:new Map(e==='fr100'&&rank!=null?[[a.id,rank]]:[])}]));rolls=0;
  return a;
 }
 scoutingAffinity=()=>.5;highSchoolScoutRankings=()=>fields;
 scoutingRoll=()=>{rolls++;return .5};
 return code=>JSON.parse(JSON.stringify(eval(code)))`,[])()}

test('prestige multipliers follow every rank boundary, require reputation 500, and use the best event rather than the specialty',()=>{
 const r=game()(`(()=>{
  const rows=[1,8,9,16,17,50,51,null].map(rank=>{
   const a=fixture(rank);return{rank,normal:scoutingPrestigeMultipliers(a,499.99,fields),prestige:scoutingPrestigeMultipliers(a,500,fields),maximum:scoutingPrestigeMultipliers(a,1000,fields)};
  });const a=fixture(100);fields.get('ba50').byId.set(a.id,8);
  const before=JSON.stringify([state,[...fields].map(([e,r])=>[e,[...r.byId]])]),other=scoutingPrestigeMultipliers(a,500,fields);
  return{rows,other,unchanged:before===JSON.stringify([state,[...fields].map(([e,r])=>[e,[...r.byId]])]),invalid:scoutingPrestigeMultipliers(a,NaN,fields)};
 })()`);
 const contacts=[1.1,1.1,1.05,1.05,1.03,1.03,1,1];
 r.rows.forEach((row,i)=>{assert.deepEqual(row.normal,{contact:1,priority:1});assert.deepEqual(row.prestige,{contact:contacts[i],priority:i<4?1.2:1});assert.deepEqual(row.maximum,row.prestige)});
 assert.deepEqual(r.other,{contact:1.1,priority:1.2});assert.deepEqual(r.invalid,{contact:1,priority:1});assert.ok(r.unchanged);
});

test('actual own and CPU contacts boost only the increase, charge the same five points and draw once without changing abilities or PBs',()=>{
 const r=game()(`(()=>{
  return [499,500].flatMap(reputation=>[1,9,17,51,null].flatMap(rank=>['player','cpu'].map(school=>{
   const a=fixture(rank,reputation),before=JSON.stringify([a.stats,a.bestTimes,state.rngSeed]),contact=scoutingContact(a.id,school);
   const saved=JSON.stringify(state),duplicate=scoutingContact(a.id,school);
   return{reputation,rank,school,contact,points:state.points,budget:state.scoutingCompetition.schools.cpu.remaining,rolls,duplicate:!duplicate.ok&&saved===JSON.stringify(state),unchanged:before===JSON.stringify([a.stats,a.bestTimes,state.rngSeed])};
  })));
 })()`);
 for(const row of r){const after=row.reputation<500||row.rank==null||row.rank>50?33.33:row.rank<=8?34.67:row.rank<=16?34:33.73;assert.equal(row.contact.after,after,JSON.stringify(row));assert.equal(row.contact.before,20);assert.ok(row.contact.ok&&row.duplicate&&row.unchanged);assert.equal(row.rolls,1);assert.equal(row.points,row.school==='player'?95:100);assert.equal(row.budget,row.school==='cpu'?95:100)}
});

test('contact caps, saved negotiations, existing commitments and the next contact remain stable after JSON reload',()=>{
 const r=game()(`(()=>{
  const a=fixture(),record=scoutingRecord(a.id);record.interests.player=99.9;
  const cap=scoutingContact(a.id);record.interests.cpu=37;record.offers=['cpu'];record.contacts.cpu=4;
  const first=JSON.stringify(state);state=JSON.parse(first);const stable=first===JSON.stringify(state),stored=scoutingRecord(a.id),existing=JSON.stringify([stored.interests.cpu,stored.contacts.cpu,stored.offers]);
  const next=scoutingContact(a.id,'player',5);stored.destination='cpu';const committed=JSON.stringify(state),blocked=scoutingContact(a.id,'player',6);
  return{cap,next,stable,existing:existing===JSON.stringify([stored.interests.cpu,stored.contacts.cpu,stored.offers]),commitment:!blocked.ok&&committed===JSON.stringify(state)};
 })()`);
 assert.equal(r.cap.after,100);assert.equal(r.next.after,100);assert.ok(r.cap.ok&&r.next.ok&&r.stable&&r.existing&&r.commitment);
});

test('monthly prestige priority actually changes the chosen target among otherwise equal candidates without extra spending or draws',()=>{
 const r=game()(`(()=>{
  initializeScoutingCompetition=()=>state.scoutingCompetition;refreshScoutingTargets=()=>{};scoutingNeed=()=>1;scoutingTalentQuality=()=>.5;
  return [499,500].map(reputation=>{
   const a=fixture(17,reputation),strong={...a,id:'strong'},c=state.scoutingCompetition;state.world.push(strong);
   c.candidates.strong={interests:{cpu:20},contacts:{},offers:[],cpuTargets:['cpu'],destination:null};fields.get('ba100').byId.set(strong.id,8);c.schools.cpu.remaining=5;
   processScoutingMonth();const saved=JSON.stringify(state);processScoutingMonth();
   return{reputation,contacted:Object.entries(c.candidates).filter(([,r])=>r.contacts.cpu===4).map(([id])=>id),remaining:c.schools.cpu.remaining,rolls,duplicate:saved===JSON.stringify(state),seed:state.rngSeed};
  });
 })()`);
 assert.deepEqual(r[0].contacted,['candidate']);assert.deepEqual(r[1].contacted,['strong']);for(const row of r){assert.equal(row.remaining,0);assert.equal(row.rolls,3);assert.ok(row.duplicate);assert.equal(row.seed,5914)}
});
