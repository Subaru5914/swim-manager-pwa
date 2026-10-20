const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(){return vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+`
 function fixture(){
  state={season:2026,slot:94,rngSeed:12345,playerUniversity:'自大学',players:[],world:[],retiredArchive:[],universities:[],japanTeamHistory:[],meetHistory:[],recordRankings:{},recordBook:{},teamTop10:{},teamPodiumHistory:[],points:0,trainingFocus:{},trainingPlans:{}};
  const all=Array.from({length:12},(_,i)=>attachMedleyStats({id:'candidate-'+i,name:'候補'+i,category:i===0||i===1?'university':i%3===0?'high':i%3===1?'adult':'university',year:i<2?i+1:null,grade:i%3+1,age:i%3===1?24:19,organization:i<2?'自大学':'所属'+i,stats:Object.fromEntries(STATS.map(k=>[k,165])),imAptitude:{speed:0,stamina:0},specialty:'fr100',bestTimes:{},raceHistory:[],accolades:[]}));
  for(const a of all)for(const e of EVENTS)a.bestTimes[e]=coherentCpuPB(a,e);
  state.players=all.slice(0,2);state.world=all.slice(2);
  const row=(i,time)=>({athlete:all[i],source:i<2?'PLAYER':'CPU',race:{total:time}}),results=Object.fromEntries(EVENTS.map(e=>[e,{final:[]}]));
  results.fr100.final=[2,3,4,0,5,6,7,8].map((id,i)=>row(id,dispatchStandard('fr100')+(i<2?-.2+i*.1:i)));
  results.fr200.final=[4,5,6,7,1,8,9,10].map((id,i)=>row(id,dispatchStandard('fr200')+(i===0?-.1:i+1)));
  results.ba100.final=[8,9,10,11,5,6,7,1].map((id,i)=>row(id,dispatchStandard('ba100')+i+1));
  selectJapanTeam(results,2027);return{all,results};
 }
 return code=>JSON.parse(JSON.stringify(eval(code)))`,[])()}

test('automatic standard qualifiers and relay choices stay fixed while each event exposes its top-eight finishers and representatives of every team',()=>{
 const r=game()(`(()=>{const {all}=fixture(),before=JSON.stringify([state.japanTeam.individual,state.japanTeam.relays]),seed=state.rngSeed,o=worldAdditionalEntryOptions(2027);
  const noFinals=o.byEvent.im400.map(a=>a.id),ba=o.byEvent.ba100.map(a=>a.id);setWorldAdditionalEntries(2027,{ba100:[all[1].id,all[9].id]});
  return{before,after:JSON.stringify([state.japanTeam.individual,state.japanTeam.relays]),seed:seed===state.rngSeed,auto:state.japanTeam.individual.fr100,finalists:o.finalists.ba100,ba,noFinals,own:all[1].id,cpu:all[9].id,roster:state.japanTeam.athletes.map(a=>a.id),extra:worldAutoEntries(2027).individual.ba100};
 })()`);
 assert.equal(r.before,r.after);assert.ok(r.seed);assert.deepEqual(r.auto,['candidate-2','candidate-3']);assert.equal(r.finalists.length,8);assert.equal(r.finalists.at(-1).rank,8);
 assert.ok(r.ba.includes(r.own)&&r.ba.includes(r.cpu));assert.ok(!r.noFinals.includes(r.own)&&!r.noFinals.includes(r.cpu));assert.deepEqual(r.extra,[r.own,r.cpu]);assert.ok(r.extra.every(id=>r.roster.includes(id)));
});

test('a newly selected finalist can enter other events in any request order, but unqualified cycles, duplicate/full slots and strangers are rejected atomically',()=>{
 const r=game()(`(()=>{const {all}=fixture(),entries={im400:[all[1].id],ba100:[all[1].id]};setWorldAdditionalEntries(2027,entries);const saved=JSON.stringify(state);
  const invalid=[{fr100:[all[1].id]},{ba100:[all[1].id,all[1].id]},{ba100:[all[1].id,all[9].id,all[10].id]},{im400:[all[1].id]},
   {im400:[all[1].id],im200:[all[1].id]},{ba100:['unknown']},{ba100:'bad'}];
  const rejected=invalid.map(x=>{try{setWorldAdditionalEntries(2027,x);return false}catch(e){return saved===JSON.stringify(state)}});
  const valid=worldAutoEntries(2027),withoutOrigin=worldAdditionalEntryOptions(2027,{im400:[all[1].id]}).valid;
  setWorldAdditionalEntries(2027,{});return{rejected,valid,withoutOrigin,cleared:Object.values(state.japanTeam.additionalIndividual).every(ids=>!ids.length),removed:!state.japanTeam.athletes.some(a=>a.id===all[1].id)};
 })()`);
 assert.ok(r.rejected.every(Boolean));assert.deepEqual(r.valid.individual.im400,['candidate-1']);assert.deepEqual(r.withoutOrigin.im400,[]);assert.ok(r.cleared&&r.removed);
});

test('old final clocks recover tied eighth places independently of current PBs, and snapshots survive graduation and preserve selection identity',()=>{
 const r=game()(`(()=>{const {all}=fixture(),team=state.japanTeam,own=all[1],saved=team.selectionCandidates.find(a=>a.id===own.id).snapshot;
  team.selectionTimes.ba100=Object.fromEntries(all.slice(0,10).map((a,i)=>[a.id,60+(i<7?i:i<9?7:8)]));delete team.selectionFinalists;
  all.forEach(a=>a.bestTimes.ba100=99);const first=worldAdditionalEntryOptions(2027).finalists.ba100;
  const identity=JSON.stringify(saved);state.players=state.players.filter(a=>a.id!==own.id);state.world=state.world.filter(a=>a.id!==own.id);
  setWorldAdditionalEntries(2027,{ba100:[own.id]});const after=state.japanTeam.athletes.find(a=>a.id===own.id);
  return{first,snapshot:japanTeamAthlete(own.id).id,own:ownJapanAthlete(own.id),identity:identity===JSON.stringify(after.snapshot),grade:after.snapshot.year,archive:state.japanTeamHistory[0].athletes.find(a=>a.id===own.id),profile:worldCandidateProfileHtml(japanTeamAthlete(own.id),'ba100',worldAdditionalEntryOptions(2027))};
 })()`);
 assert.equal(r.first.length,9);assert.deepEqual(r.first.slice(-2).map(a=>a.rank),[8,8]);assert.ok(r.first.every(a=>a.time<99));assert.equal(r.snapshot,'candidate-1');assert.ok(r.own&&r.identity);assert.equal(r.archive.gradeAtRecord,2);assert.ok(r.archive.own);
 assert.equal((r.profile.match(/data-entry-stat=/g)||[]).length,16);assert.equal((r.profile.match(/data-world-profile-pb=/g)||[]).length,15);assert.match(r.profile,/日本選手権 2位/);
});

test('reading options and profiles never changes athletes, PBs or RNG, and selection is locked once world races start',()=>{
 const r=game()(`(()=>{const {all}=fixture(),before=JSON.stringify(state);for(let i=0;i<3;i++){const o=worldAdditionalEntryOptions(2027);worldAutoEntries(2027);worldCandidateProfileHtml(all[1],'ba100',o)}
  const unchanged=before===JSON.stringify(state);state.japanTeamHistory[0].worldStatus='in_progress';const saved=JSON.stringify(state);let rejected=false;try{setWorldAdditionalEntries(2027,{ba100:[all[1].id]})}catch(e){rejected=true}
  return{unchanged,rejected,locked:!canEditWorldSelection(2027),atomic:saved===JSON.stringify(state),wrong:worldAutoEntries(2029)};
 })()`);
 assert.ok(r.unchanged&&r.rejected&&r.locked&&r.atomic);assert.ok(Object.values(r.wrong.individual).every(ids=>!ids.length));
});

test('manual CPU and own finalists reach actual world heats, recorded results and the owned playback queue after save and reload',()=>{
 const r=game()(`(()=>{const {all}=fixture();setWorldAdditionalEntries(2027,{ba100:[all[1].id,all[9].id],im400:[all[1].id]});
  const serialized=JSON.stringify(state);state=JSON.parse(serialized);for(const a of [...state.players,...state.world,...state.japanTeam.athletes.map(m=>m.snapshot),...state.japanTeam.selectionCandidates.map(m=>m.snapshot)])attachMedleyStats(a);
  state.season=2027;state.slot=36;state.activeCompetitionSeason=2027;state.activeCompetitionSlot=36;
  const race=withMeetRaceContext('world_championship',36,2027,()=>runWorldEvent('ba100',2027));
  const result={meet:'world_championship',season:2027,slot:36,entries:worldOwnEntries(2027).individual,events:Object.fromEntries(EVENTS.map(e=>[e,e==='ba100'?race:{prelim:[],final:[],heats:[]}])),relays:[]};
  recordJapanWorldResults(result,true);const queue=buildMeetRaceQueue(result,result.entries),japanese=race.prelim.filter(r=>r.nationality==='日本');
  return{entries:japanese.map(r=>[r.athlete.id,r.source]),count:japanese.length,queue:queue.some(q=>q.event==='ba100'&&q.rows.some(r=>r.athlete.id===all[1].id)),own:worldOwnEntries(2027).individual.ba100,archive:state.japanTeamHistory[0].results.individual.ba100,locked:!canEditWorldSelection(2027)};
 })()`);
 assert.equal(r.count,2);assert.ok(r.entries.some(([id,source])=>id==='candidate-1'&&source==='PLAYER'));assert.ok(r.entries.some(([id,source])=>id==='candidate-9'&&source==='CPU'));assert.deepEqual(r.own,['candidate-1']);assert.ok(r.queue&&r.locked);assert.equal(r.archive.length,2);assert.ok(r.archive.every(row=>row.prelim&&row.prelim.time>0));
});

test('the April representative celebration includes manually chosen individual events, and candidate snapshots follow own-player renames',()=>{
 const r=game()(`(()=>{const {all}=fixture();applyPlayerRename(all[1].id,'改名した代表');
  const candidate=state.japanTeam.selectionCandidates.find(a=>a.id===all[1].id);setWorldAdditionalEntries(2027,{ba100:[all[1].id],im400:[all[1].id]});
  let shown='';showModal=html=>{shown=html;return{classList:{add(){}},querySelector:()=>({})}};showJapanTeamCelebration();
  const ownRow=shown.split('<tr').find(row=>row.includes('改名した代表'));return{candidateName:candidate.snapshot.name,row:ownRow};
 })()`);
 assert.equal(r.candidateName,'改名した代表');assert.match(r.row,/100mBa/);assert.match(r.row,/400mIM/);
});
