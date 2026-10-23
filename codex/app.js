(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const labels={all:'おまかせミックス',heritage:'世界遺産',geography:'世界の地理',general:'一般教養',geosign:'海外地名・文字'};
  const byId=new Map(CODEX_QUESTIONS.map(q=>[q.id,q]));
  const weakKey='codex-quiz-weak-v1';
  const preferences={category:'all',style:'buzzer',count:5,seconds:12,tts:false,sound:true,autoMic:true};
  let weak=new Set(),pools=new Map(),session=null,currentTitle='',roundKind='normal';
  let audio=null,recognition=null,micToken=0,listening=false,renderedTurn=-1,renderedPhase='',lastReading=-1;
  let speechToken=0,settingsPaused=false,quitPaused=false,composing=false;
  let micWanted=false,micRetry=null,micFailures=0,micMutedForQuestion=false;
  let micWatchdog=null;
  const SpeechRec=window.SpeechRecognition || window.webkitSpeechRecognition;

  function notice(message) {$('notice').textContent=message;$('notice').hidden=!message;}
  function saveWeak() {
    try {localStorage.setItem(weakKey,JSON.stringify({version:1,ids:[...weak]}));}
    catch {notice('このブラウザでは復習記録を保存できません。ページを開いている間は復習できます。');}
    updateWeak();
  }
  function updateWeak() {$('weak-count').textContent=`${weak.size}問`;$('weak-start').disabled=!weak.size;}
  try {weak=CodexEngine.parseWeak(localStorage.getItem(weakKey),new Set(byId.keys()));}
  catch {notice('復習記録を読み込めませんでした。ゲームはそのまま遊べます。');}
  updateWeak();

  function tone(kind) {
    if(!preferences.sound) return;
    try {
      const Ctx=window.AudioContext || window.webkitAudioContext;
      if(!Ctx) return;
      audio ||= new Ctx();
      if(audio.state==='suspended') audio.resume().catch(()=>{});
      const notes=kind==='correct'?[784,1047]:kind==='wrong'?[180,140]:kind==='buzz'?[660,990]:[523];
      notes.forEach((frequency,i)=>{
        const osc=audio.createOscillator(),gain=audio.createGain(),time=audio.currentTime+i*.11;
        osc.type=kind==='wrong'?'triangle':'sine';osc.frequency.value=frequency;
        gain.gain.setValueAtTime(0,time);gain.gain.linearRampToValueAtTime(.07,time+.015);gain.gain.exponentialRampToValueAtTime(.001,time+.15);
        osc.connect(gain);gain.connect(audio.destination);osc.start(time);osc.stop(time+.17);
      });
    } catch { /* Sound must never interrupt a round. */ }
  }
  function stopSpeech(){speechToken++;window.speechSynthesis?.cancel();}
  function speak(text) {
    stopSpeech();
    if(!preferences.tts || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
    const token=speechToken;
    const utterance=new SpeechSynthesisUtterance(text);
    utterance.lang='ja-JP';utterance.rate=1.05;
    const voices=window.speechSynthesis.getVoices();
    const japanese=voices.find(v=>v.lang.startsWith('ja'));
    if(japanese) utterance.voice=japanese;
    utterance.onerror=()=>{if(token===speechToken) $('mic-status').textContent='読み上げを利用できません。問題文を見て回答できます。';};
    window.speechSynthesis.speak(utterance);
  }
  function micUI() {
    $('mic').classList.toggle('listening',listening);
    $('mic').textContent=listening?'■ マイクを止める':micWanted?'■ 接続待ちを中止':'◉ 声で回答する';
    $('mic').disabled=!SpeechRec;
  }
  function stopMic() {
    micWanted=false;clearTimeout(micRetry);micRetry=null;
    clearTimeout(micWatchdog);micWatchdog=null;
    micToken++;
    const old=recognition;recognition=null;listening=false;
    if(old) try {old.abort();} catch {}
    micUI();
  }
  function startMic(reconnecting=false) {
    if(!session || session.phase!=='answering') return;
    if(!SpeechRec) {$('mic-status').textContent='音声認識に対応していません。文字入力で回答してください。';return;}
    if(!reconnecting){stopMic();micFailures=0;micMutedForQuestion=false;}
    else micToken++;
    clearTimeout(micRetry);micRetry=null;micWanted=true;stopSpeech();micUI();
    const token=micToken,activeSession=session,questionId=session.question.id;
    const active=()=>micWanted && token===micToken && session===activeSession && session.question.id===questionId && session.phase==='answering';
    try {
      recognition=new SpeechRec();
      const rec=recognition;
      rec.lang='ja-JP';rec.interimResults=true;rec.continuous=true;rec.maxAlternatives=3;
      rec.onstart=()=>{
        if(!active()){try{rec.abort();}catch{}return;}
        listening=true;micUI();$('mic-status').textContent='認識サービスに接続しました。マイクの音声入力待ちです。';
        clearTimeout(micWatchdog);
        micWatchdog=setTimeout(()=>{if(active())$('mic-status').textContent='認識した文字が届いていません。「マイクを確認」から入力音量をテストしてください。';},8000);
      };
      rec.onaudiostart=()=>{if(active())$('mic-status').textContent='マイク入力を開始しました。声を待っています。';};
      rec.onsoundstart=()=>{if(active())$('mic-status').textContent='音の入力を検知しました。発話の判定を待っています。';};
      rec.onspeechstart=()=>{if(active())$('mic-status').textContent='発話を検知しました。文字への変換を待っています。';};
      rec.onnomatch=()=>{if(active())$('mic-status').textContent='音声を検知しましたが文字にできませんでした。もう一度話せます。';};
      rec.onresult=event=>{
        if(!active()) return;
        micFailures=0;
        clearTimeout(micWatchdog);micWatchdog=null;
        for(let i=event.resultIndex;i<event.results.length;i++) {
          const result=event.results[i],transcript=result[0].transcript;
          $('transcript').textContent=`認識結果：${transcript}`;
          if(transcript.trim())session.holdSpeech();
          // Interim fragments such as 金 in 金星 must never score as a correct answer.
          if(!result.isFinal) continue;
          const candidates=Array.from(result,alternative=>alternative.transcript);
          const matched=candidates.find(value=>QuizCore.matches(value,[session.question.answer,...session.question.aliases]));
          if(matched) {session.submit(matched);render();return;}
          $('answer').value=transcript;
          $('mic-status').textContent='まだ正解と一致していません。そのまま言い直してOKです。';
        }
      };
      rec.onerror=event=>{
        if(!active()) return;
        clearTimeout(micWatchdog);micWatchdog=null;
        listening=false;micUI();
        if(event.error==='network')micFailures++;
        const fatal=['not-allowed','service-not-allowed','audio-capture','language-not-supported'].includes(event.error) || micFailures>=3;
        if(fatal){micWanted=false;micMutedForQuestion=true;clearTimeout(micRetry);micUI();}
        const messages={
          'not-allowed':'マイクの使用が許可されていません。文字入力で続けられます。',
          'service-not-allowed':'音声認識を利用できません。文字入力で続けられます。',
          'network':fatal?'音声認識の通信が繰り返し失敗しました。文字入力で続けられます。':'音声認識を再接続しています。そのままお待ちください。',
          'audio-capture':'マイクが見つかりません。文字入力で続けられます。',
          'no-speech':'聞き取りを続けています。そのまま話してください。'
        };
        if(event.error!=='aborted') $('mic-status').textContent=(messages[event.error] || '音声認識を終了しました。文字入力で続けられます。')+`（${event.error}）`;
      };
      rec.onend=()=>{
        if(token!==micToken)return;
        clearTimeout(micWatchdog);micWatchdog=null;
        listening=false;recognition=null;micUI();
        if(active()){
          $('mic-status').textContent='聞き取りを再接続中。そのまま話せます。';
          clearTimeout(micRetry);
          micRetry=setTimeout(()=>{if(active())startMic(true);},Math.min(2000,350*(micFailures+1)));
        }
      };
      rec.start();
    } catch {micWanted=false;micMutedForQuestion=true;listening=false;micUI();$('mic-status').textContent='マイクを起動できませんでした。文字入力で続けられます。';}
  }
  function stopAll(){stopMic();stopSpeech();}
  function show(view) {for(const id of ['home','play','result']) $(id).hidden=id!==view;}
  function pickButton(container,attribute,value) {
    for(const button of $(container).querySelectorAll('button')) {
      const selected=button.dataset[attribute]===String(value);
      button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));
    }
  }
  $('categories').addEventListener('click',e=>{
    const button=e.target.closest('button[data-category]');if(!button)return;
    preferences.category=button.dataset.category;pickButton('categories','category',preferences.category);
  });
  $('styles').addEventListener('click',e=>{
    const button=e.target.closest('button[data-style]');if(!button)return;
    preferences.style=button.dataset.style;pickButton('styles','style',preferences.style);
    $('style-note').textContent=preferences.style==='buzzer'?'少しずつ出る問題文。早く押して正解するとボーナス。':'問題文を最初から表示。声や文字でじっくり回答。';
  });
  $('counts').addEventListener('click',e=>{
    const button=e.target.closest('button[data-count]');if(!button)return;
    preferences.count=Number(button.dataset.count);pickButton('counts','count',preferences.count);
  });
  $('seconds').addEventListener('change',()=>{preferences.seconds=Number($('seconds').value);});
  function start(questions,title,kind='normal') {
    stopAll();
    for(const id of ['pause-dialog','settings-dialog','quit-dialog']) if($(id).open) $(id).close();
    settingsPaused=quitPaused=false;
    session=new CodexEngine.Session(questions,{...preferences,match:(input,answers)=>QuizCore.matches(input,answers)});
    currentTitle=title;roundKind=kind;renderedTurn=-1;renderedPhase='';
    $('round-title').textContent=title;
    show('play');render();
    $('play').scrollIntoView({block:'start',behavior:'instant'});
  }
  function startNormal() {
    const available=CODEX_QUESTIONS.filter(q=>preferences.category==='all' || q.category===preferences.category);
    const seen=pools.get(preferences.category) || new Set();
    const selected=CodexEngine.drawQuestions(available,preferences.count,seen);
    pools.set(preferences.category,seen);
    start(selected,labels[preferences.category]);
  }
  $('start').addEventListener('click',startNormal);
  $('weak-start').addEventListener('click',()=>{
    const questions=CodexEngine.shuffle([...weak].map(id=>byId.get(id)).filter(Boolean));
    if(questions.length) start(questions,'苦手な問題の復習','review');
  });
  function setQuestionText(feedback=false) {
    const q=session.question,el=$('question-text');el.replaceChildren();
    if(session.buzzIndex!==null && (feedback || session.phase==='answering')) {
      el.append(document.createTextNode(q.q.slice(0,session.buzzIndex)));
      const slash=document.createElement('span');slash.className='buzz-slash';slash.textContent='/';el.append(slash);
      const rest=document.createElement('span');rest.className='unread';rest.textContent=feedback?q.q.slice(session.buzzIndex):(session.buzzIndex<q.q.length?'…':'');el.append(rest);
    } else {
      const count=session.phase==='reading'?session.revealed:q.q.length;
      el.textContent=q.q.slice(0,count);
      if(session.phase==='reading' && count<q.q.length){const caret=document.createElement('span');caret.className='read-caret';caret.setAttribute('aria-hidden','true');el.append(caret);}
    }
  }
  function render() {
    if(!session) return;
    if(session.phase==='result'){if(renderedPhase!=='result'){stopAll();showResult();}renderedPhase='result';return;}
    if(session.phase==='paused')return;
    const phaseChanged=renderedPhase!==session.phase,turnChanged=renderedTurn!==session.index;
    if(turnChanged) {
      stopAll();lastReading=-1;
      micMutedForQuestion=false;
      $('answer').value='';$('transcript').textContent='';$('hint-text').hidden=true;
      $('hint-text').textContent=session.question.hint;
      $('category-badge').textContent=labels[session.question.category];
      $('mic-status').textContent=SpeechRec?'マイクを使うか、下の欄から文字で回答':'このブラウザは音声非対応です。文字入力で回答できます。';
      $('progress').replaceChildren(document.createTextNode(String(session.index+1).padStart(2,'0')));
      const total=document.createElement('span');total.textContent=`/ ${String(session.questions.length).padStart(2,'0')}`;$('progress').append(total);
      $('round-progress-bar').style.width=`${((session.index+1)/session.questions.length)*100}%`;
      $('hint').textContent='ヒントを見る';
      tone('question');
      if(session.phase==='reading') speak(`問題。${session.question.q}`);
    }
    const summary=session.summary();
    $('score').textContent=String(summary.score).padStart(4,'0');$('correct').textContent=`${summary.correct}問`;
    $('buzzer-area').hidden=session.phase!=='reading';
    $('answer-area').hidden=session.phase!=='answering';
    $('feedback').hidden=session.phase!=='feedback';
    $('reading-status').hidden=session.phase!=='reading';
    $('answer-clock').hidden=session.phase!=='answering';
    $('pass').hidden=session.phase==='feedback';
    $('pause').disabled=session.phase==='feedback';
    $('hint').hidden=session.phase==='feedback';
    $('phase-label').textContent=({reading:'READING',answering:'YOUR ANSWER',feedback:'ANSWER & LEARN'})[session.phase];
    if(session.phase==='reading') {
      if(lastReading!==session.revealed || phaseChanged){setQuestionText();lastReading=session.revealed;}
      if(phaseChanged || turnChanged) $('buzz').focus({preventScroll:true});
      const percent=Math.round(session.revealed/session.question.q.length*100);
      $('reveal-count').textContent=`${percent}%`;
      $('buzzer-help').textContent=percent===100?'全文が出ました。ボタンを押すと回答時間が始まります。':'わかった瞬間に押そう。押してから回答時間が始まります。';
    }
    if(session.phase==='answering') {
      $('remaining').textContent=session.seconds?`${session.remaining.toFixed(1)} 秒`:'制限なし';
      $('clock-bar').style.width=session.seconds?`${session.remaining/session.seconds*100}%`:'100%';
      $('answer-clock').classList.toggle('urgent',session.remaining<=3);
      if(phaseChanged || turnChanged) {
        setQuestionText();
        if(preferences.autoMic && !micMutedForQuestion) startMic();
        else {$('answer').focus({preventScroll:true});}
      }
    }
    if(session.phase==='feedback' && phaseChanged) {
      stopAll();setQuestionText(true);renderFeedback();
    }
    renderedTurn=session.index;renderedPhase=session.phase;
  }
  function renderFeedback() {
    const item=session.history.at(-1),correct=item.status==='correct';
    $('feedback').classList.toggle('wrong',!correct);
    $('judge-symbol').textContent=correct?'✓':'×';
    $('judge-label').textContent=correct?'CORRECT':item.status==='timeout'?'TIME UP':item.status==='pass'?'PASS':'TRY AGAIN';
    $('judge-title').textContent=correct?'正解！':item.status==='timeout'?'時間切れ':item.status==='pass'?'次につなげよう':'惜しい！';
    const reason=correct?'登録された正解・別解に一致しました。':item.status==='wrong'?'登録された正解・別解と一致しませんでした。':item.status==='timeout'?'回答時間が終了しました。':'パスした問題も復習できます。';
    $('judge-detail').textContent=`${item.answer?`あなたの回答：${item.answer} ／ `:''}${reason}`;
    $('points').textContent=correct?`+${item.points}`:'';
    $('canonical').textContent=item.question.answer;
    $('explanation').textContent=item.question.explanation;
    $('aliases').textContent=item.question.aliases.join(' ／ ');
    $('rescue').hidden=correct || item.status==='pass';
    $('rescue').disabled=false;$('rescue').textContent='認識違いだった（自己申告）';
    $('next').textContent=session.index+1===session.questions.length?'結果を見る →':'次の問題へ →';
    if(correct)weak.delete(item.question.id);else weak.add(item.question.id);
    saveWeak();tone(correct?'correct':'wrong');
    if(preferences.tts) speak(`${correct?'正解。':'正解は、'+item.question.answer+'。'}${item.question.explanation}`);
    $('next').focus({preventScroll:true});
  }
  function buzz() {if(session?.buzz()){tone('buzz');stopSpeech();render();}}
  $('buzz').addEventListener('click',buzz);
  $('answer-form').addEventListener('submit',event=>{
    event.preventDefault();
    if(composing || !session || session.phase!=='answering')return;
    if(!$('answer').value.trim()){$('mic-status').textContent='答えを入力するか、マイクで話してください。';return;}
    session.submit($('answer').value.trim());render();
  });
  $('answer').addEventListener('compositionstart',()=>{composing=true;});
  $('answer').addEventListener('compositionend',()=>{composing=false;});
  $('mic').addEventListener('click',()=>{if(listening || micWanted){micMutedForQuestion=true;stopMic();$('mic-status').textContent='マイクを停止しました。文字入力で回答できます。';}else startMic();});
  $('hint').addEventListener('click',()=>{if(!session)return;session.hinted=true;$('hint-text').hidden=!$('hint-text').hidden;$('hint').textContent=$('hint-text').hidden?'ヒントを見る':'ヒントを閉じる';});
  $('pass').addEventListener('click',()=>{if(session?.finish('','pass'))render();});
  $('rescue').addEventListener('click',()=>{
    if(!session?.rescue())return;
    $('rescue').textContent='自己申告を記録しました（自動採点は変更しません）';$('rescue').disabled=true;
    weak.delete(session.question.id);saveWeak();
  });
  $('next').addEventListener('click',()=>{if(session?.next()){stopAll();render();}});
  setInterval(()=>{if(!session || !['reading','answering'].includes(session.phase))return;session.tick();render();},80);

  function pauseGame(){if(session?.pause()){stopAll();$('pause-dialog').showModal();}}
  function resumeGame(){if($('pause-dialog').open)$('pause-dialog').close();if(session?.resume()){renderedPhase='paused';render();}}
  $('pause').addEventListener('click',pauseGame);
  $('resume').addEventListener('click',resumeGame);
  $('pause-dialog').addEventListener('cancel',event=>{event.preventDefault();resumeGame();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden && !$('settings-dialog').open && !$('quit-dialog').open)pauseGame();});
  window.addEventListener('pagehide',stopAll);
  $('settings-button').addEventListener('click',()=>{
    if($('pause-dialog').open)return;
    settingsPaused=!!session?.pause();stopAll();$('settings-dialog').showModal();
  });
  $('settings-dialog').addEventListener('close',()=>{if(settingsPaused){settingsPaused=false;session.resume();renderedPhase='paused';render();}});
  $('tts-setting').addEventListener('change',()=>{preferences.tts=$('tts-setting').checked;if(!preferences.tts)stopSpeech();});
  $('sound-setting').addEventListener('change',()=>{preferences.sound=$('sound-setting').checked;});
  $('mic-setting').addEventListener('change',()=>{preferences.autoMic=$('mic-setting').checked;if(!preferences.autoMic)stopMic();});
  if(!SpeechRec){$('mic-setting').disabled=true;$('support-note').textContent='このブラウザは音声認識非対応です。読み上げと文字回答で遊べます。';}
  $('quit').addEventListener('click',()=>{quitPaused=!!session?.pause();stopAll();$('quit-dialog').showModal();});
  function cancelQuit(){if($('quit-dialog').open)$('quit-dialog').close();if(quitPaused){session.resume();renderedPhase='paused';render();}quitPaused=false;}
  $('cancel-quit').addEventListener('click',cancelQuit);
  $('quit-dialog').addEventListener('cancel',event=>{event.preventDefault();cancelQuit();});
  $('confirm-quit').addEventListener('click',()=>{$('quit-dialog').close();quitPaused=false;stopAll();session.phase='result';render();});
  function showResult() {
    show('result');const summary=session.summary();
    $('result-correct').textContent=`${summary.correct} / ${summary.total}`;
    $('result-score').textContent=String(summary.score);
    $('result-rescued').textContent=`${summary.rescued}件`;
    $('result-message').textContent=summary.total===0?'今回は未回答です。もう一度、気軽に挑戦しよう。':summary.correct===summary.total?'全問正解！次は別のカテゴリにも挑戦してみよう。':'今日知ったことが、次のひらめきになる。';
    $('retry-wrong').disabled=!session.history.some(h=>h.status!=='correct');
    $('review-list').replaceChildren();
    session.history.forEach((item,index)=>{
      const details=document.createElement('details');details.className='review-item';
      const summary=document.createElement('summary');
      const number=document.createElement('span');number.className='review-index';number.textContent=`Q${index+1}`;
      const status=document.createElement('span');status.className='review-status'+(item.status==='correct'?'':' miss');status.textContent=item.status==='correct'?'✓':'×';status.setAttribute('aria-label',item.status==='correct'?'正解':'未正解');
      const answer=document.createElement('span');answer.className='review-answer';answer.textContent=item.question.answer+(item.rescued?'（自己申告あり）':'');
      summary.append(number,status,answer);details.append(summary);
      const body=document.createElement('div');body.className='review-body';
      const q=document.createElement('p');q.className='review-question';
      q.textContent=item.buzzIndex===null?item.question.q:item.question.q.slice(0,item.buzzIndex)+' / '+item.question.q.slice(item.buzzIndex);
      const own=document.createElement('p');own.className='review-you';
      own.textContent=`あなたの回答：${item.answer || (item.status==='timeout'?'時間切れ':'パス')} ／ ${item.points}点${item.hinted?' ／ ヒント利用':''}`;
      const explanation=document.createElement('p');explanation.textContent=item.question.explanation;
      body.append(q,own,explanation);details.append(body);$('review-list').append(details);
    });
    $('result-title').focus({preventScroll:true});$('result').scrollIntoView({block:'start',behavior:'instant'});updateWeak();
  }
  $('retry-wrong').addEventListener('click',()=>{
    const questions=session.history.filter(h=>h.status!=='correct').map(h=>h.question);
    if(questions.length)start(CodexEngine.shuffle(questions),'今回間違えた問題','review');
  });
  $('again').addEventListener('click',()=>{
    if(roundKind==='review') start(CodexEngine.shuffle(session.questions),currentTitle,'review');else startNormal();
  });
  $('home-button').addEventListener('click',()=>{stopAll();session=null;show('home');updateWeak();$('start').focus({preventScroll:true});$('home').scrollIntoView({block:'start',behavior:'instant'});});
  document.addEventListener('keydown',event=>{
    if(event.isComposing || composing || event.repeat || event.altKey || event.ctrlKey || event.metaKey)return;
    if(document.querySelector('dialog[open]'))return;
    if(event.target.closest('input,textarea,select,button,a,summary,[contenteditable="true"]'))return;
    if(event.code==='Space' && session?.phase==='reading'){event.preventDefault();buzz();}
    else if(event.key==='Enter' && session?.phase==='feedback'){event.preventDefault();$('next').click();}
  });
  micUI();
})();
