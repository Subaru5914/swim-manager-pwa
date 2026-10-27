const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(full=false){return vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+`
 state=${full?'createState();migrateState()':"{season:2026,slot:16,rngSeed:12345,cpuCompetitionSeed:12345,playerUniversity:'自大学',players:[],world:[],universities:[{id:'K',name:'関西大学',region:'kansai'},{id:'N',name:'関東大学',region:'other'}],kansaiIds:['K'],interIds:['K','N']}"};
 function swimmer(id,specialty='fr100',org='関西大学'){return attachMedleyStats({id,name:id,specialty,category:'university',grade:4,age:22,organization:org,stats:Object.fromEntries(STATS.map(k=>[k,145])),bestTimes:{},imAptitude:{speed:0,stamina:0},accolades:[],raceHistory:[]})}
 return code=>JSON.parse(JSON.stringify(eval(code)))`,['globalThis'])({crypto:{getRandomValues:a=>{a[0]=12345;return a}}})}

test('spring Kansai replaces only the May trial, covers all fifteen events over four days and admits regional seniors without standards or relays',()=>{
 const r=game()(`(()=>{const meet='spring_kansai',senior=swimmer('senior');state.world=[senior];return{dates:[2026,2027,2030].map(year=>meetAt(slotDate(16),year)),other:[8,24,40,56].map(slot=>meetAt(slotDate(slot))),label:meetMonthLabel(meet),days:meetEventDays(meet),events:meetIndividualEvents(meet),standards:EVENTS.map(e=>standardFor(meet,e)),schools:meetUniversities(meet),senior:allowedCpu(senior,meet),own:qualified({year:4,bestTimes:{}},meet,'br50'),limit:collegeEventEntryLimit(meet)===Infinity,relays:runRelays(meet,{}),scoring:teamScoring(meet,{},[]),restricted:RESTRICTED.has(meet)}})()`);
 assert.deepEqual(r.dates,['spring_kansai','spring_kansai','spring_kansai']);assert.deepEqual(r.other,Array(4).fill('team_trial'));assert.equal(r.label,'5月春季関西選手権');assert.equal(r.days.length,4);assert.equal(r.events.length,15);assert.deepEqual(r.days.flat().sort(),r.events.sort());assert.ok(r.standards.every(x=>x===null));assert.deepEqual(r.schools,['自大学','関西大学']);assert.ok(r.senior&&r.own&&r.limit);assert.deepEqual(r.relays,[]);assert.deepEqual(r.scoring,{});assert.equal(r.restricted,false);
});

test('spring Kansai entry candidates combine same-stroke distances and the swimmers best university ranks without creating missing PBs',()=>{
 const r=game()(`(()=>{const a=swimmer('main'),others=Array.from({length:8},(_,i)=>swimmer('other-'+i));
  for(const p of [a,...others])p.bestTimes=Object.fromEntries(EVENTS.map(e=>[e,expectedTime(p,e)]));
  for(const p of others)for(const event of EVENTS)p.bestTimes[event]*=.99;for(const event of ['ba50','ba100','ba200'])a.bestTimes[event]*=.9;
  const before=JSON.stringify([a,...others]),first=springKansaiEntryCandidates(a,[a,...others]);
  const im=swimmer('medley','im200'),medley=springKansaiEntryCandidates(im,[im,...others]);
  return{first,medley,unchanged:before===JSON.stringify([a,...others])&&Object.keys(im.bestTimes).length===0}})()`);
 assert.equal(r.first.main,'fr100');assert.deepEqual([...r.first.candidates].sort(),['fr50','fr200','fr400','ba50','ba100','ba200'].sort());assert.equal(r.medley.main,'im200');assert.ok(r.medley.candidates.includes('im400')&&r.medley.candidates.length>=2);assert.ok(r.unchanged);
});

test('every eligible CPU swimmer enters the specialty plus exactly two distinct random candidate events, including unmeasured sprints and medley specialists',()=>{
 const r=game()(`(()=>{state.world=EVENTS.flatMap((e,i)=>Array.from({length:3},(_,j)=>swimmer('K-'+i+'-'+j,e)));state.world.push(swimmer('other','fr100','関東大学'),{...swimmer('high'),category:'high'},{...swimmer('adult'),category:'adult'},{...swimmer('retired'),retired:true});
  const eligible=state.world.filter(a=>allowedCpu(a,'spring_kansai')),before=JSON.stringify(state.world),plans=[],errors=[];
  for(let seed=1;seed<=12;seed++){state.rngSeed=seed;const entries=buildCpuCollegeEntries('spring_kansai');plans.push(JSON.stringify(entries));for(const a of eligible){const entered=EVENTS.filter(e=>entries[e].includes(a.id)),allowed=springKansaiEntryCandidates(a,eligible);
   if(entered.length!==3||!entered.includes(a.specialty)||entered.some(e=>e!==a.specialty&&!allowed.candidates.includes(e)))errors.push(a.id);}
   if(Object.values(entries).flat().some(id=>!eligible.some(a=>a.id===id)))errors.push('ineligible');}
  return{errors,variants:new Set(plans).size,same:before===JSON.stringify(state.world),unlimited:Math.max(...Object.values(JSON.parse(plans[0])).map(ids=>ids.length))>3}})()`);
 assert.deepEqual(r.errors,[]);assert.ok(r.variants>=6);assert.ok(r.same&&r.unlimited);
});

test('a real spring Kansai meet retains all selected swimmers, follows prelim-first days, and saves PBs, top tens, podiums and exact clocks',()=>{
 const r=game(true)(`(()=>{const meet='spring_kansai';state.slot=17;state.activeCompetitionSlot=16;state.activeCompetitionSeason=2026;
  const own=[...state.players.slice(0,4),state.players.find(a=>a.year===4)];for(const a of own){for(const k of STATS)a.stats[k]=200;attachMedleyStats(a)}
  const selections=Object.fromEntries(EVENTS.map(e=>[e,['fr50','ba50','br50'].includes(e)?own.map(a=>a.id):e==='fly50'?[own[0].id]:[]])),ids=own.map(a=>a.id),builder=buildCpuCollegeEntries;let selected;
  buildCpuCollegeEntries=m=>selected=builder(m);const result=executeMeet(meet,selections,{'4x100fr':ids.slice(0,4)},{deferRelayFinalEntries:true});buildCpuCollegeEntries=builder;
  const errors=[],counts={},schools=new Set(meetUniversities(meet));for(const [event,field]of Object.entries(result.events)){
   const expected=[...selected[event]].sort(),actual=field.prelim.filter(r=>r.source==='CPU').map(r=>r.athlete.id).sort();if(JSON.stringify(expected)!==JSON.stringify(actual))errors.push('lost entry '+event);
   if(field.heats.some(h=>h.length>8)||field.heats.length!==Math.ceil(field.prelim.length/8))errors.push('heat size '+event);
   for(const row of field.prelim){counts[row.athlete.id]=(counts[row.athlete.id]||0)+1;if(!schools.has(row.athlete.organization))errors.push('school '+event)}
   for(const row of [...field.prelim,...field.final]){if(row.race.total!==row.race.cumulative.at(-1)||Math.abs(row.race.total-row.race.splits.reduce((n,t)=>n+t,0))>.001)errors.push('clock '+event);if(row.athlete.bestTimes[event]>row.race.total+.001)errors.push('PB '+event)}
   for(const row of field.final)if(row.entryPB>row.prelimTime+.001)errors.push('comparison PB '+event);
  }
  if(Object.entries(counts).some(([id,n])=>n!==(id===ids[0]?4:3)))errors.push('athlete limit');
  const program=buildMeetProgram(result,selections);for(let day=1;day<=4;day++){const phases=program.filter(b=>b.day===day).map(b=>b.phase);if(phases.lastIndexOf('prelim')>phases.indexOf('final'))errors.push('day order')}
  completeMeet(result);const p=own[0],history=p.raceHistory.filter(h=>h.meet===meet),top=state.teamTop10.fr50.find(h=>h.athleteId===p.id),medals=playerMainResults(p).filter(h=>h.meet===meet);
  const saved=JSON.stringify([state.players,state.world,state.recordRankings,state.teamTop10,state.meetHistory,state.rngSeed]),historyEntry=result.historyEntry;state.activeCompetitionSlot=null;state.activeCompetitionSeason=null;state=JSON.parse(JSON.stringify(state));migrateState();
  return{errors,relays:result.relays,ownCount:result.events.fr50.prelim.filter(r=>r.source==='PLAYER').length,senior:result.events.fr50.prelim.some(r=>r.athlete.id===ids.at(-1)),program:program.length,events:EVENTS.length,history:history.map(h=>[h.season,h.slot,h.event,h.stage]),top:top.time,pb:p.bestTimes.fr50,medals:medals.length,saved:saved===JSON.stringify([state.players,state.world,state.recordRankings,state.teamTop10,state.meetHistory,state.rngSeed]),meet:historyEntry.meet,slot:historyEntry.slot};})()`);
 assert.deepEqual(r.errors,[]);assert.deepEqual(r.relays,[]);assert.equal(r.ownCount,5);assert.ok(r.senior);assert.equal(r.program,30);assert.equal(r.events,15);assert.ok(r.history.length>=8&&r.history.every(([year,slot])=>year===2026&&slot===16));assert.equal(r.top,r.pb);assert.ok(r.medals>0&&r.saved);assert.equal(r.meet,'spring_kansai');assert.equal(r.slot,16);
});
