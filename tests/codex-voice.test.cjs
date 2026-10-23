const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
function harness(tokenizer=null) {
  const elements=new Map(),records=[],timers=new Map();let timerId=0;
  function element(){return {value:'',textContent:'',hidden:false,open:false,disabled:false,style:{},dataset:{},children:[],handlers:{},
    classList:{toggle(){},add(){},remove(){}},addEventListener(type,fn){this.handlers[type]=fn;},
    setAttribute(){},replaceChildren(...children){this.children=children;},append(...children){this.children.push(...children);},
    focus(){},scrollIntoView(){},querySelectorAll(){return [];},showModal(){this.open=true;},close(){this.open=false;},
    click(){this.handlers.click?.({target:this});}};}
  const document={hidden:false,getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},
    createElement:element,createTextNode:text=>({textContent:text}),addEventListener(){},querySelector(){return null;}};
  class FakeRecognition {
    constructor(){records.push(this);this.aborts=0;}
    start(){this.onstart?.();}
    abort(){this.aborts++;this.onend?.();}
    phrase(text,isFinal=true){const result=Object.assign([{transcript:text}],{isFinal});this.onresult?.({resultIndex:0,results:[result]});}
  }
  const window={SpeechRecognition:FakeRecognition,addEventListener(){}};
  if(tokenizer)window.kuromoji={builder:()=>({build:callback=>callback(null,tokenizer)})};
  const context=vm.createContext({document,window,console,performance:{now:()=>0},localStorage:{getItem(){return null;},setItem(){}},
    setInterval(){},setTimeout(fn){timers.set(++timerId,fn);return timerId;},clearTimeout(id){timers.delete(id);}});
  for(const file of ['quiz-core.js','codex/questions.js','codex/engine.js','codex/reading.js']) {
    if(fs.existsSync(path.join(root,file)))vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context);
  }
  const app=fs.readFileSync(path.join(root,'codex/app.js'),'utf8');
  const last=app.lastIndexOf('})();');
  // Test-only access to the actual app handlers, without changing the shipped source.
  vm.runInContext(app.slice(0,last)+"globalThis.voiceHarness={startMic,stopMic,start,preferences,getSession:()=>session};"+app.slice(last),context);
  const hooks=context.voiceHarness;
  const question=vm.runInContext('CODEX_QUESTIONS[0]',context);
  hooks.start([question],'Voice test');
  return {hooks,records,timers,document,question,
    buzz(){document.getElementById('buzz').click();},
    flush(){const pending=[...timers.values()];timers.clear();pending.forEach(fn=>fn());}};
}
test('buzzer starts the microphone automatically and keeps continuous recognition enabled',()=>{
  const h=harness();h.buzz();assert.equal(h.records.length,1,'buzzer must start microphone');assert.equal(h.records[0].continuous,true);
});

test('final speech and manual submission use reading matching while interim speech cannot score',()=>{
  const h=harness({tokenize:text=>[{surface_form:text,reading:text==='富士山'?'フジサン':text}]});
  h.hooks.start([{...h.question,answer:'フジサン',aliases:[]}],'Reading test');h.buzz();
  const rec=h.records[0];rec.phrase('富士山',false);
  assert.equal(h.hooks.getSession().phase,'answering');
  assert.match(h.document.getElementById('reading-transcript').textContent,/フジサン/);
  rec.phrase('富士山');assert.equal(h.hooks.getSession().history[0].status,'correct');
  h.hooks.start([{...h.question,answer:'フジサン',aliases:[]}],'Manual reading test');h.buzz();
  h.document.getElementById('answer').value='富士山';
  h.document.getElementById('answer-form').handlers.submit({preventDefault(){}});
  assert.equal(h.hooks.getSession().history[0].status,'correct');
  assert.match(h.document.getElementById('judge-detail').textContent,/読みが一致/);
});
test('recognition ending after silence reconnects while the same question accepts answers',()=>{
  const h=harness();h.buzz();if(!h.records.length)h.hooks.startMic();
  h.records[0].onend();h.flush();assert.equal(h.records.length,2,'silence must not require clicking the microphone again');
});
test('wrong phrase permits another phrase; a correct final phrase settles only once',()=>{
  const h=harness();h.buzz();if(!h.records.length)h.hooks.startMic();const rec=h.records[0];
  rec.phrase('違う答え');assert.equal(h.hooks.getSession().phase,'answering');
  rec.phrase(h.question.answer,false);assert.equal(h.hooks.getSession().phase,'answering','interim fragments must not score');
  rec.phrase(h.question.answer,true);assert.equal(h.hooks.getSession().phase,'feedback');assert.equal(h.hooks.getSession().history.length,1);
  rec.phrase(h.question.answer,true);assert.equal(h.hooks.getSession().history.length,1);h.flush();assert.equal(h.records.length,1);
});
test('permission rejection never loops, and microphone OFF cancels queued reconnects',()=>{
  const h=harness();h.buzz();if(!h.records.length)h.hooks.startMic();
  h.records[0].onerror({error:'not-allowed'});h.records[0].onend();h.flush();assert.equal(h.records.length,1);
  h.hooks.startMic();h.records.at(-1).onend();h.hooks.stopMic();h.flush();assert.equal(h.records.length,2);
});
test('callbacks from an old question cannot answer or reconnect into a new round',()=>{
  const h=harness();h.buzz();if(!h.records.length)h.hooks.startMic();const old=h.records[0];
  h.hooks.start([h.question],'New round');old.phrase(h.question.answer);old.onend();h.flush();
  assert.equal(h.hooks.getSession().phase,'reading');assert.equal(h.hooks.getSession().history.length,0);assert.equal(h.records.length,1);
});
test('repeated network failure backs off and stops after three errors',()=>{
  const h=harness();h.buzz();
  for(let i=0;i<3;i++){h.records.at(-1).onerror({error:'network'});h.records.at(-1).onend();h.flush();}
  assert.equal(h.records.length,3);assert.equal(h.timers.size,0);assert.match(h.document.getElementById('mic-status').textContent,/繰り返し/);
});
test('service connection is distinguished from actual audio and speech detection',()=>{
  const h=harness();h.buzz();const rec=h.records[0];
  assert.match(h.document.getElementById('mic-status').textContent,/入力待ち/);
  assert.equal(typeof rec.onaudiostart,'function');rec.onaudiostart();
  assert.match(h.document.getElementById('mic-status').textContent,/マイク入力/);
  assert.equal(typeof rec.onspeechstart,'function');rec.onspeechstart();
  assert.match(h.document.getElementById('mic-status').textContent,/発話/);
});
test('a connected recognizer that produces no text directs the player to the microphone check',()=>{
  const h=harness();h.buzz();h.flush();
  assert.match(h.document.getElementById('mic-status').textContent,/文字が届いていません/);
  assert.equal(h.hooks.getSession().phase,'answering');
});
