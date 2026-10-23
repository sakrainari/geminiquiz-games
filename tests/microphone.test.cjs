const {test}=require('node:test');
const assert=require('node:assert/strict');
const {level,conclusion,InputProbe}=require('../codex/microphone.js');
function fixture(getUserMedia){
  let stopped=0,closed=0,device='',levels=[];const frames=new Map();let id=0;
  const stream={getTracks:()=>[{stop(){stopped++;}}],getAudioTracks:()=>[{label:'Test microphone'}]};
  class AudioContext{async resume(){}async close(){closed++;}createMediaStreamSource(){return {connect(){},disconnect(){}};}createAnalyser(){return {fftSize:1024,getFloatTimeDomainData(array){array.fill(.03);}};}}
  const probe=new InputProbe({mediaDevices:{getUserMedia:getUserMedia || (async()=>stream)},AudioContext,
    onDevice:value=>{device=value;},onLevel:value=>levels.push(value),raf:fn=>{frames.set(++id,fn);return id;},caf:key=>frames.delete(key)});
  return {probe,stream,levels,frames,getDevice:()=>device,getStopped:()=>stopped,getClosed:()=>closed};
}
test('input meter distinguishes silence from signal and clamps loud input',()=>{
  assert.equal(level(new Float32Array(1024)),0);assert.equal(level([]),0);
  assert.ok(level([.03,-.03,.03])>=4);assert.equal(level([1,-1]),100);
});
test('diagnosis separates microphone silence, speech-service failure, and successful transcription',()=>{
  assert.match(conclusion({inputTested:true,peak:0}),/十分な音の入力を確認できません/);
  assert.match(conclusion({inputTested:true,peak:20,speechTested:true}),/文字はまだ届いていません/);
  assert.match(conclusion({inputTested:true,peak:20,speechError:'network'}),/network/);
  assert.match(conclusion({text:true,inputError:'old failure'}),/文字への変換まで確認/);
  assert.match(conclusion({}),/まず①/);
});
test('input probe releases microphone and audio context on stop',async()=>{
  const f=fixture();assert.ok(await f.probe.start());assert.equal(f.getDevice(),'Test microphone');assert.ok(f.levels[0]>=4);
  f.probe.stop();assert.equal(f.getStopped(),1);assert.equal(f.getClosed(),1);assert.equal(f.frames.size,0);
});
test('permission granted after stopping cannot leave a microphone stream open',async()=>{
  let resolve;const f=fixture(()=>new Promise(r=>{resolve=r;}));const pending=f.probe.start();
  await Promise.resolve();f.probe.stop();resolve(f.stream);assert.equal(await pending,false);
  assert.equal(f.getStopped(),1);assert.equal(f.levels.length,0);assert.equal(f.getClosed(),1);
});
test('permission denial closes the audio context and reports an error',async()=>{
  const f=fixture(async()=>{throw Object.assign(new Error('denied'),{name:'NotAllowedError'});});
  await assert.rejects(f.probe.start(),{name:'NotAllowedError'});assert.equal(f.getClosed(),1);assert.equal(f.frames.size,0);
});
test('default animation callbacks retain the browser Window receiver',async t=>{
  const oldRaf=globalThis.requestAnimationFrame,oldCaf=globalThis.cancelAnimationFrame;
  t.after(()=>{if(oldRaf)globalThis.requestAnimationFrame=oldRaf;else delete globalThis.requestAnimationFrame;if(oldCaf)globalThis.cancelAnimationFrame=oldCaf;else delete globalThis.cancelAnimationFrame;});
  globalThis.requestAnimationFrame=function(){assert.equal(this,globalThis,'requestAnimationFrame requires Window receiver');return 1;};
  globalThis.cancelAnimationFrame=function(){assert.equal(this,globalThis,'cancelAnimationFrame requires Window receiver');};
  const f=fixture();const probe=new InputProbe({mediaDevices:f.probe.mediaDevices,AudioContext:f.probe.AudioContext,onLevel(){},onDevice(){}});
  assert.ok(await probe.start());probe.stop();
});
