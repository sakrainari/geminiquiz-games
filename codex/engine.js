/* Pure game rules: browser, microphone and persistence live outside this module. */
(function(root) {
  const shuffle = items => {
    const result = [...items];
    for (let i=result.length-1;i>0;i--) {
      const j=Math.floor(Math.random()*(i+1));
      [result[i],result[j]]=[result[j],result[i]];
    }
    return result;
  };
  function drawQuestions(questions,count,seen=new Set()) {
    const limit=Math.min(count || questions.length,questions.length);
    const fresh=shuffle(questions.filter(q=>!seen.has(q.id)));
    const selected=fresh.slice(0,limit);
    if (selected.length<limit) {
      // Finish the cycle, then fill from old questions without duplicating this round.
      seen.clear();
      const ids=new Set(selected.map(q=>q.id));
      selected.push(...shuffle(questions.filter(q=>!ids.has(q.id))).slice(0,limit-selected.length));
    }
    selected.forEach(q=>seen.add(q.id));
    return selected;
  }
  function parseWeak(raw,knownIds) {
    try {
      const data=JSON.parse(raw);
      if (!data || data.version!==1 || !Array.isArray(data.ids)) return new Set();
      return new Set(data.ids.filter(id=>typeof id==='string' && knownIds.has(id)));
    } catch { return new Set(); }
  }
  function characterEnds(text) {
    if(typeof Intl.Segmenter==='function') return Array.from(new Intl.Segmenter('ja',{granularity:'grapheme'}).segment(text),part=>part.index+part.segment.length);
    let offset=0;return Array.from(text,part=>(offset+=part.length));
  }
  class Session {
    constructor(questions,{style='buzzer',seconds=12,now=()=>performance.now(),match}={}) {
      if (!questions.length) throw new Error('問題がありません');
      if (typeof match!=='function') throw new Error('回答判定がありません');
      this.questions=[...questions];
      this.style=style;
      this.seconds=[0,8,12,20].includes(seconds)?seconds:12;
      this.now=now;
      this.match=match;
      this.history=[];
      this.index=0;
      this.load();
    }
    get question(){return this.questions[this.index];}
    load() {
      this.phase=this.style==='buzzer'?'reading':'answering';
      this.started=this.now();
      this.deadline=this.started+(this.seconds || Infinity)*1000;
      this.hardDeadline=this.deadline+6000;
      this.revealed=this.style==='buzzer'?0:this.question.q.length;
      this.characterEnds=characterEnds(this.question.q);
      this.buzzIndex=null;
      this.hinted=false;
      this.remaining=this.seconds || Infinity;
    }
    tick() {
      if (this.phase==='reading') {
        const count=Math.min(this.characterEnds.length,Math.floor((this.now()-this.started)/65));
        this.revealed=count>0?this.characterEnds[count-1]:0;
      }
      if (this.phase==='answering') {
        this.remaining=Math.max(0,(this.deadline-this.now())/1000);
        if (this.remaining===0) this.finish('', 'timeout');
      }
    }
    buzz() {
      if(this.phase!=='reading') return false;
      this.tick();
      this.buzzIndex=this.revealed;
      this.phase='answering';
      this.deadline=this.now()+(this.seconds || Infinity)*1000;
      this.hardDeadline=this.deadline+6000;
      this.remaining=this.seconds || Infinity;
      return true;
    }
    holdSpeech() {
      if(this.phase!=='answering' || this.now()>=this.deadline) return;
      this.deadline=Math.min(this.hardDeadline,Math.max(this.deadline,this.now()+2200));
    }
    submit(answer) {
      if(this.phase!=='answering' || !answer.trim()) return false;
      this.tick();
      if(this.phase!=='answering') return false;
      this.finish(answer, this.match(answer,[this.question.answer,...this.question.aliases])?'correct':'wrong');
      return true;
    }
    finish(answer,status) {
      if(!['reading','answering'].includes(this.phase)) return false;
      const fraction=this.buzzIndex===null?1:this.buzzIndex/this.question.q.length;
      const points=status==='correct'?100+(this.style==='buzzer'?Math.round((1-fraction)*50):0):0;
      this.history.push({question:this.question,answer,status,points,buzzIndex:this.buzzIndex,hinted:this.hinted,rescued:false});
      this.phase='feedback';
      return true;
    }
    pause() {
      if(!['reading','answering'].includes(this.phase)) return false;
      this.beforePause=this.phase;
      this.pausedAt=this.now();
      this.phase='paused';
      return true;
    }
    resume() {
      if(this.phase!=='paused') return false;
      const elapsed=this.now()-this.pausedAt;
      this.started+=elapsed;
      this.deadline+=elapsed;
      this.hardDeadline+=elapsed;
      this.phase=this.beforePause;
      return true;
    }
    rescue() {
      const item=this.history.at(-1);
      if(this.phase!=='feedback' || !item || item.status==='correct' || item.rescued) return false;
      item.rescued=true;
      return true;
    }
    next() {
      if(this.phase!=='feedback') return false;
      if(this.index+1===this.questions.length) this.phase='result';
      else {this.index++;this.load();}
      return true;
    }
    summary() {
      const correct=this.history.filter(h=>h.status==='correct').length;
      return {correct,total:this.history.length,score:this.history.reduce((n,h)=>n+h.points,0),rescued:this.history.filter(h=>h.rescued).length};
    }
  }
  root.CodexEngine={Session,shuffle,drawQuestions,parseWeak};
})(typeof module==='object'?module.exports:globalThis);
