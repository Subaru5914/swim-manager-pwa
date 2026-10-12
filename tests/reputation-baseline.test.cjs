const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(){
  const context=vm.createContext({});
  vm.runInContext(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener')),context);
  vm.runInContext('state={season:2026,reputation:35,universities:[],meetParticipationHistory:[],reputationEvaluations:[],participationModelVersion:1};initializeReputationHistory()',context);
  return code=>JSON.parse(vm.runInContext('JSON.stringify('+code+')',context));
}

test('only initial college meets use zero when the preceding year has no participation data',()=>{
  const run=game(),r=run(`(()=>{
    const first=Object.keys(REPUTATION_WEIGHTS).map(meet=>reputationComparison(2026,meet,'player'));
    const later=reputationComparison(2028,'intercollege','player');
    state.meetParticipationHistory.push({season:2026,meet:'intercollege',counts:{player:7}});
    const second=reputationComparison(2027,'intercollege','player');
    return{first,later,second};
  })()`);
  assert.deepEqual(r.first.map(r=>r.previous),[0,0,null,null]);
  assert.equal(r.later.previous,null);assert.equal(r.later.delta,0);
  assert.equal(r.second.previous,7);assert.equal(r.second.delta,-70);
});

test('first-year college attendance raises reputation at the intercollege checkpoint exactly once',()=>{
  const run=game(),r=run(`(()=>{
    state.meetParticipationHistory=[{season:2026,meet:'kansai_college',counts:{player:5}},{season:2026,meet:'intercollege',counts:{player:3}}];
    const early=settleUniversityReputations(2026,'kansai_college'),before=state.reputation;
    const result=settleUniversityReputations(2026,'intercollege'),again=settleUniversityReputations(2026,'intercollege');
    migrateInitialCollegeReputation();
    return{early,before,result,again,reputation:state.reputation};
  })()`);
  assert.equal(r.early,null);assert.equal(r.before,35);assert.equal(r.result.delta,40);
  assert.equal(r.reputation,75);assert.equal(r.again,null);
  assert.deepEqual(r.result.comparisons.map(c=>[c.previous,c.current]),[[0,5],[0,3]]);
});

test('old completed first-year meets add only the missing amount while later-year comparisons remain actual attendance',()=>{
  const run=game(),r=run(`(()=>{
    state.season=2027;state.reputation=55;
    state.reputationEvaluations=[
      {season:2026,meet:'intercollege',before:35,reputation:35,delta:0,comparisons:[{meet:'kansai_college',previous:null,current:5,delta:0},{meet:'intercollege',previous:null,current:4,delta:0}]},
      {season:2026,meet:'japan_championship',before:35,reputation:35,delta:0,comparisons:[{meet:'japan_open',previous:null,current:1,delta:0},{meet:'japan_championship',previous:null,current:1,delta:0}]},
      {season:2027,meet:'intercollege',before:35,reputation:55,delta:20,comparisons:[{meet:'kansai_college',previous:5,current:5,delta:0},{meet:'intercollege',previous:4,current:6,delta:20}]}
    ];
    migrateInitialCollegeReputation();const first=JSON.stringify(state);migrateInitialCollegeReputation();
    return{reputation:state.reputation,evaluations:state.reputationEvaluations,notices:state.pendingSeasonNotices,once:first===JSON.stringify(state)};
  })()`);
  assert.equal(r.reputation,105);assert.equal(r.evaluations[0].delta,50);
  assert.deepEqual(r.evaluations.map(e=>[e.before,e.reputation]),[[35,85],[85,85],[85,105]]);
  assert.equal(r.evaluations[2].comparisons[1].previous,4);assert.equal(r.evaluations[2].delta,20);
  assert.equal(r.notices.length,1);assert.ok(r.once);
});

test('migration respects reputation caps and does not duplicate already credited or known previous counts',()=>{
  const run=game(),r=run(`(()=>{
    state.reputation=595;
    state.reputationEvaluations=[{season:2026,meet:'intercollege',before:595,reputation:595,delta:0,comparisons:[{meet:'kansai_college',previous:null,current:8,delta:0},{meet:'intercollege',previous:null,current:8,delta:0}]}];
    migrateInitialCollegeReputation();const capped=state.reputation,delta=state.reputationEvaluations[0].delta;
    delete state.collegeReputationBaselineVersion;migrateInitialCollegeReputation();
    const again=state.reputation;
    state.reputation=35;state.reputationEvaluations=[{season:2026,meet:'intercollege',before:35,reputation:35,delta:0,comparisons:[{meet:'kansai_college',previous:8,current:8,delta:0},{meet:'intercollege',previous:8,current:8,delta:0}]}];
    delete state.collegeReputationBaselineVersion;migrateInitialCollegeReputation();
    return{capped,delta,again,known:state.reputation};
  })()`);
  assert.equal(r.capped,600);assert.equal(r.delta,5);assert.equal(r.again,600);assert.equal(r.known,35);
});

test('later attendance penalties still apply when they consumed the initially missing bonus',()=>{
  const run=game(),r=run(`(()=>{
    state.season=2027;state.reputation=0;
    state.reputationEvaluations=[
      {season:2026,meet:'intercollege',before:35,reputation:35,delta:0,comparisons:[{meet:'kansai_college',previous:null,current:2,delta:0},{meet:'intercollege',previous:null,current:2,delta:0}]},
      {season:2027,meet:'intercollege',before:35,reputation:0,delta:-35,comparisons:[{meet:'kansai_college',previous:2,current:0,delta:-4},{meet:'intercollege',previous:10,current:0,delta:-100}]}
    ];
    migrateInitialCollegeReputation();return{reputation:state.reputation,rows:state.reputationEvaluations};
  })()`);
  assert.equal(r.reputation,0);assert.equal(r.rows[0].reputation,59);
  assert.equal(r.rows[1].before,59);assert.equal(r.rows[1].delta,-59);
});
