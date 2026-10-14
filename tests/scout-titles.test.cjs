const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(seed=5914){
  const run=vm.compileFunction(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener'))+`
    function candidate(i){return {id:'candidate-'+i,name:'候補'+i,category:'high',grade:3,age:18,retired:false,specialty:'fr100',stats:Object.fromEntries(STATS.map(k=>[k,140])),imAptitude:{speed:0,stamina:0},bestTimes:Object.fromEntries(EVENTS.map(e=>[e,round2(JAPAN_RECORD[e]*1.2+i*.1)])),accolades:[],scoutPreferences:{version:3,worldAmbition:false,preferredRegion:null,earlyCompetition:false,prestigeSchool:false}}}
    return code=>JSON.parse(JSON.stringify(eval(code)))`,['globalThis'])({crypto:{getRandomValues:a=>{a[0]=seed;return a}}});
  run('state={season:2026,rngSeed:5914,players:[],world:[],recruits:[],reputation:35,facilities:{},recordRankings:{},recordBook:{}}');return run;
}
test('titles cover specialty ranks 1–16, include younger rivals and exclude retired and adult swimmers',()=>{
  const run=game(),r=run(`(()=>{
    state.world=Array.from({length:20},(_,i)=>candidate(i));state.world[0].grade=1;state.world[1].grade=2;
    state.world.push({...candidate(-1),id:'retired',retired:true},{...candidate(-2),id:'adult',category:'adult'});
    const fields=highSchoolScoutRankings();
    return state.world.slice(2,20).map(a=>({id:a.id,pb:a.bestTimes.fr100,event:scoutSpecialty(a,fields),rank:scoutHighSchoolRank(a,'fr100',fields),title:scoutRankingTitle(a,fields),untitled:scoutProbabilityDetails(a,fields).untitledBonus}));
  })()`);
  for(const row of r){assert.equal(row.event,'fr100');if(row.rank<=16){assert.equal(row.title.rank,row.rank);assert.equal(row.title.event,'fr100');assert.equal(row.title.time,row.pb);assert.match(row.title.title,new RegExp('高校ランキング'+row.rank+'位$'));assert.equal(row.untitled,0)}else{assert.equal(row.title,null);assert.equal(row.untitled,.04)}}
});
test('the highest ranked eligible event becomes the specialty; extra 50m events are excluded and ties preserve the specialty',()=>{
  const run=game(),r=run(`(()=>{
    state.world=Array.from({length:70},(_,i)=>candidate(i));const a=state.world[38];
    a.bestTimes.fr100=state.world[16].bestTimes.fr100+.05;a.bestTimes.ba100=state.world[1].bestTimes.ba100+.05;
    for(const e of SPRINT_EVENTS)a.bestTimes[e]=1;
    const before=JSON.stringify([a.stats,a.bestTimes,a.accolades]),fields=highSchoolScoutRankings(),selected=scoutSpecialty(a,fields),title=scoutRankingTitle(a,fields);
    refreshScoutBoard(fields);const persisted=a.specialty,unchanged=before===JSON.stringify([a.stats,a.bestTimes,a.accolades]);
    a.bestTimes.br100=state.world[1].bestTimes.br100+.05;
    const tied=scoutSpecialty(a,highSchoolScoutRankings());
    return{selected,persisted,tied,title,unchanged};
  })()`);
  assert.equal(r.selected,'ba100');assert.equal(r.persisted,'ba100');assert.equal(r.tied,'ba100');assert.equal(r.title.rank,3);assert.equal(r.title.event,'ba100');assert.ok(r.unchanged);
});
test('rankings outside fifty lose internal PBs in one snapshot, keep signed candidates, and reload without changing abilities or history',()=>{
  const run=game(),r=run(`(()=>{
    state.world=Array.from({length:70},(_,i)=>candidate(i));const signed=state.world[69];signed.scouted=true;state.recruits=[signed.id];
    signed.accolades=[{competition:'全国高校総体',event:'fr100',rank:1,title:'古い優勝',time:49,season:2020}];
    const before=JSON.stringify(state.world.map(a=>[a.stats,a.accolades])),seed=state.rngSeed;
    const board=refreshScoutBoard(),rows=EVENTS.map(e=>highSchoolScoutRankings().get(e).rows.length),counts=state.world.map(a=>Object.keys(a.bestTimes).length);
    const first=JSON.stringify(state);state=JSON.parse(first);refreshScoutBoard();
    return{rows,counts,signed:board.some(a=>a.id===signed.id),title:scoutRankingTitle(signed),probability:scoutProbabilityDetails(signed),stable:first===JSON.stringify(state),protected:before===JSON.stringify(state.world.map(a=>[a.stats,a.accolades]))&&seed===state.rngSeed};
  })()`);
  assert.deepEqual(r.rows,Array(15).fill(50));assert.deepEqual(r.counts.slice(0,50),Array(50).fill(15));assert.deepEqual(r.counts.slice(50),Array(20).fill(0));assert.ok(r.signed&&r.stable&&r.protected);assert.equal(r.title,null);assert.equal(r.probability.rank,null);assert.equal(r.probability.untitledBonus,.04);
});
test('equal PBs receive tied ranks but only the fifty displayed swimmers keep their PB',()=>{
  const run=game(),r=run(`(()=>{
    state.world=Array.from({length:55},(_,i)=>candidate(i));state.world[16].bestTimes.fr100=state.world[15].bestTimes.fr100;
    state.world[50].bestTimes.fr100=state.world[49].bestTimes.fr100;
    const tied=scoutRankingTitle(state.world[16]);refreshScoutBoard();
    return{tied,edgeKnown:validRaceTime(state.world[49].bestTimes.fr100),edgeMissing:!Object.hasOwn(state.world[50].bestTimes,'fr100'),count:ranking('fr100','high',50).length};
  })()`);
  assert.equal(r.tied.rank,16);assert.ok(r.edgeKnown&&r.edgeMissing);assert.equal(r.count,50);
});
test('PB updates change the selected event, title and scouting difficulty without editing historic accolades or consuming RNG',()=>{
  const run=game(),r=run(`(()=>{
    state.world=Array.from({length:40},(_,i)=>candidate(i));const a=state.world[20];
    a.accolades=[{competition:'全国高校総体',event:'fr100',rank:1,title:'過去の優勝',season:2025,time:49}];
    const old=JSON.stringify(a.accolades),seed=state.rngSeed,first=scoutProbabilityDetails(a);
    a.bestTimes.fly200=state.world[2].bestTimes.fly200-.01;refreshScoutBoard();const second=scoutProbabilityDetails(a);
    return{first,second,specialty:a.specialty,history:old===JSON.stringify(a.accolades),seed:seed===state.rngSeed};
  })()`);
  assert.equal(r.first.rank,21);assert.equal(r.first.title,null);assert.equal(r.first.untitledBonus,.04);assert.equal(r.specialty,'fly200');assert.equal(r.second.rank,3);assert.equal(r.second.title.event,'fly200');assert.equal(r.second.untitledBonus,0);assert.ok(r.second.probability<r.first.probability);assert.ok(r.history&&r.seed);
});
test('new generation keeps multiple distances of strong strokes, adds secondary strong strokes, and records previously unmeasured races from abilities',()=>{
  const run=game(),r=run(`(()=>{
    const a=candidate(0);a.category='university';a.grade=1;a.imAptitude={speed:-20,stamina:-20};
    for(const [s,value]of [['fr',160],['ba',155],['br',90],['fly',80]])for(const component of ['speed','stamina','turn'])a.stats[s+'_'+component]=value;
    for(const e of EVENTS)a.bestTimes[e]=round2(expectedTime(a,e));state.world=[a];
    const before=JSON.stringify(a.stats),seed=state.rngSeed;selectGeneratedPBs(a);const initial=Object.keys(a.bestTimes),selectionSeed=state.rngSeed;
    const race=withMeetRaceContext('joint_record',77,2026,()=>simulateRace(a,'br100',true,false));
    const result=updateResultHistory(a,'br100',race.total,'joint_record','予選',1);
    return{initial,secondary:initial.includes('ba100')&&initial.includes('ba200'),noWeak:!initial.some(e=>['br','fly','im'].includes(strokeForEvent(e))),unchanged:before===JSON.stringify(a.stats),seed:seed===selectionSeed,measured:result.pb&&a.bestTimes.br100===race.total,clock:race.physics.abilityBase===expectedTime(a,'br100'),version:a.pbEventSelectionVersion};
  })()`);
  assert.deepEqual(r.initial,['fr50','fr100','fr200','fr400','ba50','ba100','ba200']);assert.ok(r.secondary&&r.noWeak&&r.unchanged&&r.seed&&r.measured&&r.clock);assert.equal(r.version,1);
});
test('high-school admission can register an unmeasured secondary stroke when its ability clock enters the top fifty',()=>{
  const run=game(),r=run(`(()=>{
    state.world=Array.from({length:70},(_,i)=>candidate(i));const a=state.world[0];a.grade=1;
    for(const [s,value]of [['fr',165],['ba',140],['br',70],['fly',60]])for(const k of ['speed','stamina','turn'])a.stats[s+'_'+k]=value;
    a.imAptitude={speed:-20,stamina:-20};for(const e of EVENTS)a.bestTimes[e]=round2(expectedTime(a,e));
    const intended=generatedPBEvents(a),fields=highSchoolScoutRankings();selectGeneratedPBs(a,[],fields);refreshScoutBoard();
    return{ordinarySelection:intended.includes('ba100'),rank:scoutHighSchoolRank(a,'ba100'),registered:validRaceTime(a.bestTimes.ba100),clock:expectedTime(a,'ba100'),pb:a.bestTimes.ba100};
  })()`);
  assert.equal(r.ordinarySelection,false);assert.ok(r.rank<=50&&r.registered);assert.equal(r.pb,Math.round(r.clock*100)/100);
});
test('current fresh generation, reload, reset and April progression retain selective PBs and ranking-based titles',()=>{
  for(const seed of [5914,24680]){
    const run=game(seed),r=run(`(()=>{
      state=createState();migrateState();const errors=[],samples=[];
      function check(label){
        const fields=highSchoolScoutRankings(),board=refreshScoutBoard(fields);
        for(const e of EVENTS)if(fields.get(e).rows.length>50)errors.push(label+' high '+e);
        for(const a of board){const event=scoutSpecialty(a,fields),rank=scoutHighSchoolRank(a,event,fields),title=scoutRankingTitle(a,fields);if(a.specialty!==event||SPRINT_EVENTS.includes(event)||SPECIALTY_EVENTS.some(e=>(scoutHighSchoolRank(a,e,fields)??Infinity)<(rank??Infinity)))errors.push(label+' specialty '+a.id);if((rank!=null&&rank<=16)!==!!title||title&&(title.time!==a.bestTimes[event]||title.event!==event||title.rank!==rank))errors.push(label+' title '+a.id)}
        for(const a of state.world)for(const e of EVENTS)if(validRaceTime(a.bestTimes[e])){const d=distanceOf(e),base=expectedTime(a,e),low=base+Math.min(...MEET_FORM_TIME_RANGES[d].map(r=>r[0]))-RACE_EXECUTION_RANGE[d];if(a.bestTimes[e]<low-.025)errors.push(label+' pace '+a.id+' '+e)}
        samples.push({label,cpu:state.world.length,partial:state.world.filter(a=>Object.keys(a.bestTimes).length<15).length,knownPBs:state.world.reduce((n,a)=>n+Object.keys(a.bestTimes).length,0),candidates:board.length});
      }
      check('new');const first=JSON.stringify(state),seedBefore=state.rngSeed;state=JSON.parse(first);migrateState();if(first!==JSON.stringify(state)||seedBefore!==state.rngSeed)errors.push('reload');
      const signed=refreshScoutBoard().slice(0,8),saved=new Map(signed.map(a=>[a.id,JSON.stringify([a.stats,a.bestTimes,a.specialty])]));signed.forEach(a=>a.scouted=true);state.recruits=signed.map(a=>a.id);
      newSeason();if(state.players.filter(a=>a.year===1).length!==8||!signed.every(a=>state.players.some(p=>p.id===a.id&&saved.get(p.id)===JSON.stringify([p.stats,p.bestTimes,p.specialty]))))errors.push('enrollment');check('April');
      const second=JSON.stringify(state);state=JSON.parse(second);migrateState();if(second!==JSON.stringify(state))errors.push('April reload');
      state=createState();migrateState();check('reset');return{errors,samples};
    })()`);
    assert.deepEqual(r.errors,[],JSON.stringify(r));for(const s of r.samples){assert.ok(s.partial>s.cpu/2);assert.ok(s.knownPBs>0&&s.knownPBs<s.cpu*15);assert.ok(s.candidates>=8)}
  }
});
