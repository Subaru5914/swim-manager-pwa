const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function game(){
  let saved,alerts=[];
  const context=vm.createContext({crypto:{getRandomValues:a=>{a[0]=12345;return a}},console:{warn(){},error(){}},
    alert:message=>alerts.push(message),localStorage:{getItem:key=>key==='swimManagerSave'?saved:null},
    FileReader:class{readAsText(text){this.result=text;this.onload()}}});
  vm.runInContext(source.slice(0,source.indexOf('document.getElementById("nav").addEventListener')),context);
  const run=code=>vm.runInContext(code,context);
  run('state=createState();renderAll=()=>{};showToast=()=>{};state.points=321;selectedTrainingId=state.players[0].id;let originalState=state;let originalText=JSON.stringify(state);let originalTraining=selectedTrainingId');
  return{run,alerts,store:value=>saved=value};
}
test('failed local loads and JSON imports keep current progress, records and selected training swimmer',()=>{
  const {run,alerts,store}=game();
  for(const text of ['{}','{"players":null}','[]','{"season":2026,"slot":0}']){
    store(text);assert.equal(run('loadLocal(true)'),false);run(`importJson(${JSON.stringify(text)})`);
    assert.ok(run('state===originalState&&JSON.stringify(state)===originalText&&selectedTrainingId===originalTraining'));
  }
  assert.equal(alerts.length,8);
});
test('failed migration rolls back a structurally valid save without mutating the current roster',()=>{
  const {run}=game();
  assert.throws(()=>run('let damaged=JSON.parse(originalText);damaged.world[0].stats=null;damaged.cpuDiversityVersion=0;applyLoadedSave(damaged,true)'));
  assert.ok(run('state===originalState&&JSON.stringify(state)===originalText&&selectedTrainingId===originalTraining'));
});
test('valid older saves load player stats, PBs and progress with automatic migration',()=>{
  const {run,store}=game();
  const saved=run(`(()=>{let old=JSON.parse(originalText);old.version='pwa-v1.30';old.points=987;old.players[0].stats.fr_speed=170;old.players[0].bestTimes.fr100=48.5;delete old.recordRankings;delete old.recordRankingVersion;return JSON.stringify(old)})()`);
  store(saved);assert.equal(run('loadLocal(true)'),true);
  assert.equal(run('state.points'),987);assert.equal(run('state.players[0].stats.fr_speed'),170);assert.equal(run('state.players[0].bestTimes.fr100'),48.5);
  assert.equal(run('state.recordRankingVersion'),2);assert.equal(run('selectedTrainingId'),null);
});
