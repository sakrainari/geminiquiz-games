/* Shared quiz helpers. No account, storage or API connection is required. */
const QuizCore = {
  shuffle(items) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  },
  normalize(value) {
    return String(value || '').normalize('NFKC').toLowerCase()
      .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
      .replace(/[\s・、。！？!?,.\-ー〜～「」『』（）()]/g, '');
  },
  matches(input, answers) {
    const raw = this.normalize(input);
    if (!raw) return false;
    // Match whole answers first: endings such as カナダ must remain intact.
    const candidates = answers.map(a => this.normalize(a)).filter(Boolean);
    if (candidates.includes(raw)) return true;
    const spoken = raw.replace(/^(?:(?:答えは|こたえは|正解は|せいかいは|えっとね|えっと|えと|あのね|あの|うんと|たぶん|おそらく))+/, '')
      .replace(/(?:だと思います|だと思う|だとおもいます|だとおもう|でしょうか|でしょう|です|だよ|だね|かな)$/, '');
    return !!spoken && candidates.includes(spoken);
  },
  validateQuestions(data, count) {
    if (!Array.isArray(data) || data.length !== count) throw new Error('問題数が不正です');
    return data.map(q => {
      if (!q || !['q', 'answer', 'hint', 'explanation'].every(k => typeof q[k] === 'string' && q[k].trim() && q[k].length <= 2000)
          || !Array.isArray(q.aliases) || q.aliases.length > 30 || !q.aliases.every(a => typeof a === 'string' && a.length <= 200)) {
        throw new Error('問題の形式が不正です');
      }
      return {q:q.q, answer:q.answer, hint:q.hint, explanation:q.explanation, aliases:q.aliases};
    });
  }
};
