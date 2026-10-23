const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
function load() {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, {value:'',textContent:'',innerHTML:'',style:{},
        classList:{add(){},remove(){},contains(){return true;}},setAttribute(){},focus(){}});
      return elements.get(id);
    }
  };
  const context = vm.createContext({document,window:{addEventListener(){}},console,Map,Set,AbortSignal,
    setTimeout,clearTimeout,setInterval,clearInterval});
  const run = code => vm.runInContext(code,context);
  for (const file of ['quiz-core.js','question-bank.js']) run(fs.readFileSync(path.join(root,file),'utf8'));
  for (const file of ['voice_answer_quiz.html','geo_go.html']) {
    const html = fs.readFileSync(path.join(root,file),'utf8');
    for (const [,code] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
      new vm.Script(code,{filename:file});
      if (code.includes('const BUILTIN_QUIZZES') || code.includes('const GEO_PACKS'))
        run(code.replace('const app = new GeoGoApp();',''));
    }
  }
  return {context,run,document};
}
test('100 valid, unique voice questions and 57 unique sign cities', () => {
  const {run} = load();
  const packs = run('BUILTIN_QUIZZES');
  assert.equal(Object.values(packs).reduce((n,p)=>n+p.questions.length,0),100);
  for (const p of Object.values(packs)) {
    assert.equal(p.questions.length,25);
    assert.equal(new Set(p.questions.map(q=>q.q)).size,25);
    run(`QuizCore.validateQuestions(${JSON.stringify(p.questions)},25)`);
    for (const q of p.questions) {
      assert.ok(run(`AnswerMatcher.isMatch(${JSON.stringify(q.answer)},${JSON.stringify(q.answer)},${JSON.stringify(q.aliases)})`));
      for (const alias of q.aliases) assert.ok(run(`AnswerMatcher.isMatch(${JSON.stringify(alias)},${JSON.stringify(q.answer)},${JSON.stringify(q.aliases)})`));
    }
  }
  const geo = run('GEO_PACKS');
  const cities = new Set(geo.flatMap(p=>p.questions.map(q=>q.native)));
  console.log('Unique sign cities:',cities.size);
  assert.equal(cities.size,57);
  for (const p of geo) {
    assert.equal(new Set(p.questions.map(q=>q.native)).size,p.questions.length);
    for (const q of p.questions) {
      for (const k of ['native','reading','country','script','note','signStyle','distance']) assert.ok(q[k],k);
      assert.ok(q.breakdown.length);
      for (const alias of q.accepted) assert.ok(run(`QuizCore.matches(${JSON.stringify(alias)},${JSON.stringify(q.accepted)})`));
    }
  }
});
test('whole-answer matching accepts spoken fillers and rejects fragments / alternatives', () => {
  const {run} = load();
  for (const input of ['姫路城','ひめじじょう','ヒメジジョウ','答えは姫路城です','えーっとね、ひめじじょうだと思います','あのね、姫路城かな'])
    assert.ok(run(`QuizCore.matches(${JSON.stringify(input)},['姫路城','ひめじじょう'])`),input);
  for (const input of ['姫路城ではない','姫路城か松本城','姫路','ひめ',''])
    assert.equal(run(`QuizCore.matches(${JSON.stringify(input)},['姫路城','ひめじじょう'])`),false,input);
  assert.ok(run("QuizCore.matches('カナダ',['カナダ'])"));
  assert.ok(run("QuizCore.matches('ｷｬﾝﾍﾞﾗ',['キャンベラ'])"));
  assert.equal(run("QuizCore.matches('金星',['金'])"),false);
});
test('sessions exhaust unseen questions; crossing a cycle or selecting all has no duplicates', () => {
  const {run} = load();
  run("var voice=Object.create(VoiceQuizApp.prototype); voice.questionPools=new Map(); voice.questionLimit=5; voice.beginQuizSession=(title,qs)=>{voice.selected=qs;}; var seen=new Set();");
  for (let i=0;i<5;i++) {
    run("voice.startBuiltInQuiz('heritage')");
    assert.equal(run('voice.selected.some(q=>seen.has(q))'),false);
    run('voice.selected.forEach(q=>seen.add(q))');
  }
  run("voice.questionLimit=8; voice.startBuiltInQuiz('geography'); voice.questionLimit=20; voice.startBuiltInQuiz('geography')");
  assert.equal(run('new Set(voice.selected).size'),20);
  run("voice.questionLimit=0; voice.startBuiltInQuiz('all')");
  assert.equal(run('new Set(voice.selected).size'),100);
});
test('switching off mic keeps sign quiz running; permission/network errors stop reconnecting', () => {
  const {run,context} = load();
  context.window.SpeechRecognition = class {
    constructor(){this.starts=0;this.aborts=0;}
    start(){this.starts++;}
    abort(){this.aborts++;this.onend?.();}
  };
  run('var geo=Object.create(GeoGoApp.prototype); geo.isAnswering=true; geo.micEnabled=true; geo.micBlocked=false; geo.initSpeechRecognition(); geo.toggleMic();');
  assert.equal(run('geo.isAnswering'),true);
  assert.equal(run('geo.recognition.starts'),0);
  run('geo.toggleMic();');
  assert.equal(run('geo.recognition.starts'),1);
  for (const error of ['not-allowed','network','audio-capture']) {
    run(`geo.micEnabled=true; geo.recognition.onerror({error:'${error}'}); geo.recognition.onend();`);
    assert.equal(run('geo.recognition.starts'),1);
    assert.equal(run('geo.isAnswering'),true);
  }
});
test('leaving sign quiz cancels feedback and automatic next-question timers', async () => {
  const {run,context} = load();
  context.calls = 0;
  run('var geo=Object.create(GeoGoApp.prototype); geo.worker={postMessage(){}}; geo.feedbackTimer=setTimeout(()=>calls++,15); geo.autoNextTimer=setTimeout(()=>calls++,15); geo.showHome();');
  await new Promise(r=>setTimeout(r,35));
  assert.equal(context.calls,0);
});
test('empty AI key sends nothing, invalid AI payloads fail before starting a game', async () => {
  const {run,context,document} = load();
  context.fetch = () => {throw new Error('Unexpected network request');};
  run('var voice=Object.create(VoiceQuizApp.prototype); voice.showToast=()=>{};');
  await run('voice.generateAIQuiz()');
  assert.throws(()=>run('QuizCore.validateQuestions([{q:"broken"}],1)'));
  document.getElementById('ai-api-key').value = 'test-only-placeholder';
  document.getElementById('ai-model').value = 'test-model';
  let requests = 0;
  context.fetch = async (url,options) => {
    requests++;
    assert.ok(!url.includes('test-only-placeholder'));
    assert.equal(options.headers['x-goog-api-key'],'test-only-placeholder');
    return {ok:false,status:403};
  };
  await assert.rejects(run("voice.fetchGeminiQuiz('test','standard',5)"),/HTTP 403/);
  assert.equal(requests,1);
});
