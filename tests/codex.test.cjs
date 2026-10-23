const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const {CodexEngine:{Session,drawQuestions,parseWeak}}=require('../codex/engine.js');
const ctx=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../quiz-core.js'),'utf8'),ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../codex/questions.js'),'utf8'),ctx);
const questions=vm.runInContext('CODEX_QUESTIONS',ctx);
const match=vm.runInContext('(input,answers)=>QuizCore.matches(input,answers)',ctx);
const fixture=()=>{let time=0;const game=new Session(questions.slice(0,3).map(q=>({...q,q:'あ'.repeat(70)})),{now:()=>time,match});return {game,setTime:value=>{time=value;}};};

test('Codex bank has 100 unique stable IDs, 25 per category, and all answers match',()=>{
  assert.equal(questions.length,100);assert.equal(new Set(questions.map(q=>q.id)).size,100);
  for(const category of ['heritage','geography','general','geosign'])assert.equal(questions.filter(q=>q.category===category).length,25);
  for(const q of questions){assert.ok(q.explanation);assert.ok(q.hint);assert.ok(match(q.answer,[q.answer,...q.aliases]));}
});
test('Stonehenge accepts the reported speech transcription without accepting partial or negative answers',()=>{
  const question=questions.find(q=>q.answer==='ストーンヘンジ');
  for(const input of ['ストーン返事','ストーン 返事','ストーン返事です']){
    const game=new Session([question],{seconds:0,now:()=>0,match});
    game.buzz();assert.equal(game.submit(input),true,input);
    assert.equal(game.history[0].status,'correct');
  }
  const answers=[question.answer,...question.aliases];
  for(const input of ['ストーン','返事','ストーン返事ではない','イエローストーン'])assert.equal(match(input,answers),false,input);
});

test('reading has no answer deadline; buzz freezes exact position and starts a fresh clock',()=>{
  const {game,setTime}=fixture();setTime(50000);game.tick();assert.equal(game.phase,'reading');
  assert.equal(game.revealed,game.question.q.length);assert.ok(game.buzz());assert.equal(game.remaining,12);
  setTime(51900);game.tick();assert.equal(game.phase,'answering');assert.ok(Math.abs(game.remaining-10.1)<.001);
  assert.equal(game.buzz(),false);
});
test('correct answer scores once; feedback cannot be submitted or passed again',()=>{
  const {game,setTime}=fixture();setTime(650);game.buzz();
  assert.equal(game.buzzIndex,10);assert.ok(game.submit(game.question.answer));
  assert.equal(game.history.length,1);assert.equal(game.submit(game.question.answer),false);
  assert.equal(game.finish('','pass'),false);assert.ok(game.summary().score>=100);assert.ok(game.summary().score<=150);
});
test('partial words are not accepted; timeout does not score an answer at or after the deadline',()=>{
  const {game,setTime}=fixture();game.buzz();setTime(12000);
  assert.equal(game.submit(game.question.answer),false);assert.equal(game.history[0].status,'timeout');assert.equal(game.summary().score,0);
  assert.equal(match('金星',['金']),false);assert.equal(match('姫路城ではない',['姫路城']),false);
});
test('pause freezes both reveal and answer time, including repeated pause / resume',()=>{
  const {game,setTime}=fixture();setTime(650);game.tick();assert.equal(game.revealed,10);game.pause();
  setTime(10000);game.tick();assert.equal(game.revealed,10);game.resume();
  setTime(10650);game.tick();assert.equal(game.revealed,20);game.buzz();
  setTime(12650);game.tick();assert.equal(game.remaining,10);game.pause();
  setTime(100000);game.tick();assert.equal(game.remaining,10);game.resume();game.tick();assert.equal(game.remaining,10);
  game.pause();setTime(200000);game.resume();game.tick();assert.equal(game.remaining,10);
});
test('manual rescue is separate from automatic correctness and never awards points',()=>{
  const {game}=fixture();game.buzz();game.submit('違う答え');assert.ok(game.rescue());assert.equal(game.rescue(),false);
  assert.deepEqual(game.summary(),{correct:0,total:1,score:0,rescued:1});
  game.next();game.buzz();game.submit(game.question.answer);assert.equal(game.rescue(),false);
});
test('speech extension is bounded and cannot revive an expired answer window',()=>{
  const {game,setTime}=fixture();game.buzz();setTime(11000);game.holdSpeech();assert.equal(game.deadline,13200);
  for(let time=12000;time<=17500;time+=500){setTime(time);game.holdSpeech();}
  assert.equal(game.deadline,18000);setTime(18001);game.holdSpeech();game.tick();assert.equal(game.phase,'feedback');assert.equal(game.history[0].status,'timeout');
});
test('untimed practice keeps listening without a timeout and can still be paused',()=>{
  let time=0;const game=new Session([questions[0]],{seconds:0,now:()=>time,match});
  game.buzz();time=1e7;game.tick();assert.equal(game.phase,'answering');assert.equal(game.remaining,Infinity);
  game.pause();time=2e7;game.resume();game.tick();assert.equal(game.phase,'answering');game.submit(game.question.answer);assert.equal(game.phase,'feedback');
});
test('sessions advance only after feedback and end after the final question',()=>{
  const {game}=fixture();assert.equal(game.next(),false);
  for(let i=0;i<3;i++){game.finish('','pass');assert.equal(game.history.length,i+1);assert.ok(game.next());}
  assert.equal(game.phase,'result');assert.equal(game.next(),false);assert.equal(game.history.length,3);
});
test('question drawing prioritizes unseen, then fills without repeating inside a round',()=>{
  const pool=questions.filter(q=>q.category==='heritage'),seen=new Set(),ids=new Set();
  for(let i=0;i<5;i++){const round=drawQuestions(pool,5,seen);for(const q of round){assert.ok(!ids.has(q.id));ids.add(q.id);}}
  assert.equal(ids.size,25);assert.equal(new Set(drawQuestions(pool,20,seen).map(q=>q.id)).size,20);
  assert.equal(new Set(drawQuestions(pool,0,seen).map(q=>q.id)).size,25);
});
test('saved weak IDs reject invalid shapes, stale entries, non-strings and duplicates',()=>{
  const known=new Set(questions.map(q=>q.id)),id=questions[0].id;
  for(const raw of [null,'broken','[]','{"version":2,"ids":[]}','{"version":1,"ids":"bad"}'])assert.equal(parseWeak(raw,known).size,0);
  assert.deepEqual([...parseWeak(JSON.stringify({version:1,ids:[id,id,'stale',null,3]}),known)],[id]);
});
test('progressive reveal never splits emoji sequences or combining Thai characters',()=>{
  let time=0;const text='A👨‍👩‍👧‍👦ก้B';
  const game=new Session([{...questions[0],q:text}],{now:()=>time,match});
  time=130;game.tick();assert.equal(text.slice(0,game.revealed),'A👨‍👩‍👧‍👦');
  time=195;game.tick();assert.equal(text.slice(0,game.revealed),'A👨‍👩‍👧‍👦ก้');
});
test('all shipped JS parses, all local HTML dependencies exist, generated bank stays synchronized',()=>{
  for(const file of ['app.js','engine.js','questions.js'])new vm.Script(fs.readFileSync(path.join(__dirname,'../codex',file),'utf8'),{filename:file});
  const html=fs.readFileSync(path.join(__dirname,'../codex/index.html'),'utf8');
  for(const [,ref] of html.matchAll(/(?:src|href)="([^"]+\.(?:js|css)(?:\?[^"]*)?)"/g))assert.ok(fs.existsSync(path.join(__dirname,'../codex',ref.split('?')[0])),ref);
  const original=fs.readFileSync(path.join(__dirname,'../voice_answer_quiz.html'),'utf8');
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../question-bank.js'),'utf8'),ctx);
  vm.runInContext(original.slice(original.indexOf('const BUILTIN_QUIZZES'),original.indexOf('class SoundEffects')),ctx);
  const maintained=vm.runInContext('Object.values(BUILTIN_QUIZZES).flatMap(p=>p.questions)',ctx);
  assert.equal(maintained.length,questions.length);
  assert.deepEqual(new Set(maintained.map(q=>JSON.stringify(q))),new Set(questions.map(({id,category,...q})=>JSON.stringify(q))));
});
