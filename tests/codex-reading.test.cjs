const {test,before}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {CodexReading}=require('../codex/reading.js');
const {CodexEngine:{Session}}=require('../codex/engine.js');
const root=path.resolve(__dirname,'..');
const coreContext=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root,'quiz-core.js'),'utf8'),coreContext);
const core=vm.runInContext('QuizCore',coreContext);
let tokenizer,matcher;
before(async()=>{
  // Run the shipped browser build and real dictionary; only transport is replaced.
  class FileXHR {
    open(method,url){this.file=path.join(root,'codex/vendor/kuromoji/dict',path.basename(url));}
    send(){fs.readFile(this.file,(error,buffer)=>{
      if(error){this.onerror(error);return;}
      this.status=200;this.response=buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength);this.onload();
    });}
  }
  const context=vm.createContext({XMLHttpRequest:FileXHR,setTimeout,clearTimeout,console});
  vm.runInContext(fs.readFileSync(path.join(root,'codex/vendor/kuromoji/kuromoji.js'),'utf8'),context);
  tokenizer=await new Promise((resolve,reject)=>context.kuromoji.builder({dicPath:'dict/'}).build((error,value)=>error?reject(error):resolve(value)));
  matcher=CodexReading.create(core,{tokenizer});
});

test('real Japanese dictionary converts mixed kanji and kana to whole katakana readings',()=>{
  assert.equal(matcher.toReading('ストーン返事'),'ストーンヘンジ');
  assert.equal(matcher.toReading('万里の長城'),'バンリノチョウジョウ');
  assert.equal(matcher.toReading('ひめじじょう'),'ヒメジジョウ');
  assert.equal(matcher.matches('ストーン返事',['ストーンヘンジ']),true);
  assert.equal(matcher.matches('答えは万里の頂上です',['万里の長城','ばんりのちょうじょう']),true);
  assert.equal(matcher.matches('円略字',['延暦寺','えんりゃくじ']),true);
  assert.equal(matcher.toReading('トーキョー'),'トーキョー','reading conversion must preserve long marks');
});

test('reading matching rejects different answers, fragments, negations and unknown kanji',()=>{
  for(const [input,answers] of [
    ['金星',['金']],['イラク',['イラン']],['ストーン',['ストーンヘンジ']],
    ['ストーン返事ではない',['ストーンヘンジ']],['姫路城か松本城',['姫路城']],
    ['𠮷',['きち']],['𠮷ストーンヘンジ',['ストーンヘンジ']]
  ])assert.equal(matcher.matches(input,answers),false,input);
  assert.equal(matcher.matches('答えは姫路城です',['姫路城']),true);
});

test('a session accepts a previously unregistered kanji transcription through the same matcher',()=>{
  const game=new Session([{q:'テスト問題',answer:'万里の長城',aliases:['ばんりのちょうじょう']}],{seconds:0,now:()=>0,match:(...args)=>matcher.matches(...args)});
  game.buzz();game.submit('万里の頂上');
  assert.equal(game.history[0].status,'correct');assert.equal(game.history[0].answer,'万里の頂上');
});

test('dictionary preparation is shared and falls back to existing matching until ready',async()=>{
  let done,builds=0;
  const pending=CodexReading.create(core,{build:callback=>{builds++;done=callback;}});
  const first=pending.init();assert.equal(pending.init(),first);assert.equal(builds,1);
  assert.equal(pending.state,'loading');
  assert.equal(pending.matches('ストーン返事',['ストーンヘンジ']),false);
  assert.equal(pending.matches('姫路城',['姫路城']),true);
  done(null,tokenizer);await first;
  assert.equal(pending.state,'ready');assert.equal(pending.matches('ストーン返事',['ストーンヘンジ']),true);
});

test('failed dictionary loading or tokenization preserves exact matching and never drops unknown text',async()=>{
  const failed=CodexReading.create(core,{build:callback=>callback(new Error('unavailable'))});
  await failed.init();assert.equal(failed.state,'failed');
  assert.equal(failed.matches('ひめじじょう',['ひめじじょう']),true);
  assert.equal(failed.matches('返事',['ヘンジ']),false);
  const broken=CodexReading.create(core,{tokenizer:{tokenize(){throw new Error('broken');}}});
  assert.equal(broken.matches('姫路城',['姫路城']),true);
  assert.equal(broken.matches('返事',['ヘンジ']),false);
});
