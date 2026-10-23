/* Convert recognized text to readings locally; whole-answer rules remain in QuizCore. */
(function(root){
  'use strict';
  const han=/\p{Script=Han}/u;
  const katakana=text=>String(text ?? '').normalize('NFKC')
    .replace(/[ぁ-ゖ]/g,c=>String.fromCharCode(c.charCodeAt(0)+0x60));

  function create(core,options={}){
    let tokenizer=options.tokenizer || null,state=tokenizer?'ready':'idle',loading=null;
    const cache=new Map();
    const build=options.build || (callback=>{
      if(!root.kuromoji)throw new Error('Reading library unavailable');
      root.kuromoji.builder({dicPath:'vendor/kuromoji/dict/'}).build(callback);
    });
    function init(){
      if(loading)return loading;
      if(tokenizer)return Promise.resolve(true);
      state='loading';
      loading=new Promise(resolve=>{
        let finished=false;
        const timeout=setTimeout(()=>finish(new Error('Dictionary preparation timed out')),30000);
        function finish(error,value){
          if(finished)return;finished=true;clearTimeout(timeout);
          if(error || !value || typeof value.tokenize!=='function'){state='failed';resolve(false);return;}
          tokenizer=value;state='ready';resolve(true);
        }
        try{build(finish);}catch(error){finish(error);}
      });
      return loading;
    }
    function toReading(value){
      const text=String(value ?? '').normalize('NFKC');
      if(!text || text.length>200)return null;
      if(!han.test(text))return katakana(text);
      if(!tokenizer)return null;
      if(cache.has(text))return cache.get(text);
      let reading=null;
      try{
        const tokens=tokenizer.tokenize(text);
        // Unknown kanji must remain in place, never disappear into a false match.
        if(tokens.length)reading=katakana(tokens.map(token=>
          token.reading && token.reading!=='*'?token.reading:token.surface_form).join(''));
      }catch{ /* Exact text matching remains available when conversion fails. */ }
      if(cache.size>=512)cache.delete(cache.keys().next().value);
      cache.set(text,reading);
      return reading;
    }
    function matches(input,answers){
      if(core.matches(input,answers))return true;
      if(!tokenizer)return false;
      const reading=toReading(input);
      if(!reading || han.test(reading))return false;
      const candidates=answers.map(toReading).filter(value=>value && !han.test(value));
      return core.matches(reading,candidates);
    }
    return {init,toReading,matches,get state(){return state;},get ready(){return state==='ready';}};
  }
  const CodexReading={create};
  if(typeof module==='object' && module.exports)module.exports={CodexReading};
  else root.CodexReading=CodexReading;
})(typeof window==='object'?window:globalThis);
