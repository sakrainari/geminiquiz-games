const MicDiagnostics = (()=>{
  function level(samples){if(!samples.length)return 0;let sum=0;for(const value of samples)sum+=value*value;return Math.min(100,Math.round(Math.sqrt(sum/samples.length)*600));}
  function conclusion(report){
    if(report.text)return '音声から文字への変換まで確認できました。クイズで反応しない場合は、クイズを再読み込みし、同じマイク・同じブラウザで試してください。';
    if(report.inputError)return `音量テストでエラー：${report.inputError}。マイクの許可と接続を確認してください。`;
    if(report.inputTested && report.peak<4)return '音量テストでは、十分な音の入力を確認できませんでした。表示されたマイク名、Chromeの既定マイク、マイク本体のミュート、Windowsの入力音量を確認してください。';
    if(report.speechError)return `音声認識のエラー：${report.speechError}。${report.peak>=4?'音量テストでは入力がありました。文字変換側の接続・許可を確認してください。':'まず音量テストでマイク入力も確認してください。'}`;
    if(report.speechTested && report.peak>=4)return `音量テストでは音の入力を確認しましたが、認識した文字はまだ届いていません。${report.speech?'発話の検知までは進んでいます。':'音声認識側で発話を検知できているか、上の状態表示を確認してください。'}この結果だけでは機器・接続・認識サービスのどこが原因かは確定できません。`;
    if(report.inputTested && report.peak>=4)return '音量テストでは音の入力を確認しました。次に②の認識テストで、文字に変換できるか確認してください。';
    return 'まず①の音量テストから始めてください。';
  }
  class InputProbe {
    constructor({mediaDevices,AudioContext,onLevel,onDevice,raf=callback=>globalThis.requestAnimationFrame(callback),caf=id=>globalThis.cancelAnimationFrame(id)}){
      Object.assign(this,{mediaDevices,AudioContext,onLevel,onDevice,raf,caf});this.generation=0;
    }
    async start(){
      this.stop();const generation=this.generation;
      try{
        if(!this.mediaDevices?.getUserMedia || !this.AudioContext)throw new Error('このブラウザでは音量テストを利用できません');
        const context=new this.AudioContext();this.context=context;await context.resume();
        if(generation!==this.generation)return false;
        const stream=await this.mediaDevices.getUserMedia({audio:true});
        if(generation!==this.generation){stream.getTracks().forEach(track=>track.stop());return false;}
        this.stream=stream;this.onDevice(stream.getAudioTracks()[0]?.label || '既定のマイク');
        const source=context.createMediaStreamSource(stream),analyser=context.createAnalyser();this.source=source;
        analyser.fftSize=1024;source.connect(analyser);const samples=new Float32Array(analyser.fftSize);
        const tick=()=>{if(generation!==this.generation)return;analyser.getFloatTimeDomainData(samples);this.onLevel(level(samples));this.frame=this.raf(tick);};
        tick();return true;
      }catch(error){if(generation!==this.generation)return false;this.stop();throw error;}
    }
    stop(){
      this.generation++;this.caf(this.frame);this.source?.disconnect();this.source=null;
      this.stream?.getTracks().forEach(track=>track.stop());this.stream=null;
      if(this.context){this.context.close().catch(()=>{});this.context=null;}
    }
  }
  return {level,conclusion,InputProbe};
})();
if(typeof module==='object')module.exports=MicDiagnostics;
if(typeof document!=='undefined')(()=>{
  const $=id=>document.getElementById(id);
  const report={peak:0,inputTested:false,speechTested:false,audio:false,speech:false,text:false};
  let probeTimer=null,speechTimer=null,recognition=null,generation=0,meterGeneration=0;
  const errors={NotAllowedError:'マイクの使用が許可されていません',NotFoundError:'マイクが見つかりません',NotReadableError:'マイクを開けません。接続や他アプリの使用状況を確認してください'};
  const refresh=()=>{$('conclusion').textContent=MicDiagnostics.conclusion(report);};
  const probe=new MicDiagnostics.InputProbe({mediaDevices:navigator.mediaDevices,AudioContext:window.AudioContext || window.webkitAudioContext,
    onDevice:label=>{$('input-device').textContent=`使用マイク：${label}`;report.inputTested=true;},
    onLevel:value=>{report.peak=Math.max(report.peak,value);$('meter-fill').style.width=`${value}%`;$('meter').setAttribute('aria-valuenow',value);$('input-status').textContent=value>=4?'音の入力を検知しています（声かどうかは未判定）':'入力はほぼ無音です。マイクに向かって話してください。';$('input-peak').textContent=`最大入力：${report.peak}%`;}
  });
  function stopInput(finished=false){meterGeneration++;clearTimeout(probeTimer);probe.stop();$('input-start').disabled=false;$('input-stop').disabled=true;$('meter-fill').style.width='0%';$('meter').setAttribute('aria-valuenow','0');if(finished)$('input-status').textContent='音量テストを停止しました。';refresh();}
  function stopSpeech(){generation++;clearTimeout(speechTimer);const rec=recognition;recognition=null;if(rec)try{rec.abort();}catch{}$('speech-start').disabled=!SpeechRec;$('speech-stop').disabled=true;}
  const SpeechRec=window.SpeechRecognition || window.webkitSpeechRecognition;
  $('input-start').addEventListener('click',async()=>{
    stopSpeech();stopInput();const token=++meterGeneration;report.inputError='';report.peak=0;report.inputTested=false;
    $('input-start').disabled=true;$('input-stop').disabled=false;$('input-status').textContent='マイクの許可と接続を待っています…';$('input-peak').textContent='最大入力：未測定';
    try{const started=await probe.start();if(token!==meterGeneration)return;if(started)probeTimer=setTimeout(()=>stopInput(true),15000);}
    catch(error){if(token!==meterGeneration)return;report.inputError=errors[error.name] || error.message;stopInput();$('input-status').textContent=report.inputError;refresh();}
  });
  $('input-stop').addEventListener('click',()=>stopInput(true));
  $('speech-start').addEventListener('click',()=>{
    stopInput(true);stopSpeech();if(!SpeechRec)return;
    const token=generation;Object.assign(report,{speechTested:true,audio:false,speech:false,text:false,speechError:''});
    for(const id of ['stage-audio','stage-speech','stage-text'])$(id).textContent='未確認';
    $('stage-service').textContent='接続待ち';$('speech-text').textContent='認識した文字を待っています…';$('speech-status').textContent='マイクの許可と接続を待っています…';$('speech-start').disabled=true;$('speech-stop').disabled=false;
    try{
      const rec=new SpeechRec();recognition=rec;rec.lang='ja-JP';rec.continuous=true;rec.interimResults=true;rec.maxAlternatives=3;
      const active=()=>token===generation;
      rec.onstart=()=>{if(!active()){try{rec.abort();}catch{}return;}$('stage-service').textContent='認識を開始';$('speech-status').textContent='「こんにちは」と話してください。';};
      rec.onaudiostart=()=>{if(!active())return;report.audio=true;$('stage-audio').textContent='入力開始';};
      rec.onsoundstart=()=>{if(active())$('stage-audio').textContent='音を検知';};
      rec.onspeechstart=()=>{if(!active())return;report.speech=true;$('stage-speech').textContent='発話を検知';refresh();};
      rec.onresult=event=>{if(!active())return;const pieces=[];for(let i=0;i<event.results.length;i++)pieces.push(event.results[i][0].transcript);const text=pieces.join(' ');report.text=!!text.trim();$('stage-text').textContent=report.text?'文字を受信':'空の結果';$('speech-text').textContent=text || '空の認識結果';$('speech-status').textContent='文字変換の結果を受信しました。';refresh();};
      rec.onerror=event=>{if(!active() || event.error==='aborted')return;report.speechError=event.error;$('stage-service').textContent=`エラー：${event.error}`;$('speech-status').textContent=`認識エラー：${event.error}`;refresh();};
      rec.onend=()=>{if(!active())return;recognition=null;clearTimeout(speechTimer);$('speech-start').disabled=false;$('speech-stop').disabled=true;if(!report.speechError)$('speech-status').textContent=report.text?'認識テストが終了しました。':'文字が返らないまま認識が終了しました。';refresh();};
      rec.start();speechTimer=setTimeout(()=>{if(active()){stopSpeech();$('speech-status').textContent=report.text?'認識テストを終了しました。':'20秒間、文字の結果が返ってきませんでした。';refresh();}},20000);
    }catch(error){report.speechError=error.name || error.message;stopSpeech();$('speech-status').textContent=`起動エラー：${report.speechError}`;refresh();}
  });
  $('speech-stop').addEventListener('click',()=>{stopSpeech();$('speech-status').textContent='認識テストを停止しました。';refresh();});
  if(!SpeechRec){$('speech-start').disabled=true;$('speech-status').textContent='このブラウザでは音声認識を利用できません。';}
  document.addEventListener('visibilitychange',()=>{if(document.hidden){stopInput(true);stopSpeech();$('speech-status').textContent='別のタブに移ったため停止しました。';}});
  window.addEventListener('pagehide',()=>{stopInput();stopSpeech();});
})();
