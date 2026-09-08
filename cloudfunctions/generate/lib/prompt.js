/**
 * prompt.js — LLM 提示词组装（B3，对齐 INTENT-T04 prompt v1）
 *
 * buildPrompt({ surname, gender, styles, constraints, llmPool, quotes }) → { system, user }。
 * system 硬规则（红线）：
 *   ① 名字用字只能来自提供的候选字集；
 *   ② 严格禁止一切命理测算词汇（八字/五格/运势/吉凶等）；
 *   ③ quoteRef.key 只能从提供的语料列表中选，禁止编造作者/篇名/原句，无合适引用给 null；
 *   ④ meaning ≤30 字，祝福不夸大；性别气质与 gender 一致；尊重避讳字/字辈约束。
 * 输出契约：严格 JSON，单批 30 个名字。
 */
'use strict';

/** 命理敏感词（system 提示中点名禁止，另由 redline 过滤器硬拦截） */
const FORBIDDEN_TERMS = '八字、五格、三才、数理、命格、运势、吉凶、喜用神、五行、测算、占卜、改运';

/**
 * 组装 chat/completions 的 messages
 * @param {Object} input
 *   - surname: string（1 字）
 *   - gender: 'male' | 'female'
 *   - styles: string[]
 *   - constraints: { generationChar, avoidChars, wishes }
 *   - llmPool: 候选字集 [{ char, pinyin, imageryTags, meaning }]
 *   - quotes: 可用语料 [{ key, author, title, sentence, chars }]
 * @returns {{ system: string, user: string }}
 */
function buildPrompt(input) {
  const surname = input.surname || '';
  const gender = input.gender === 'female' ? 'female' : 'male';
  const styles = (Array.isArray(input.styles) && input.styles.length > 0)
    ? input.styles.join('、')
    : '不限';
  const constraints = input.constraints || {};
  const avoidChars = (Array.isArray(constraints.avoidChars) && constraints.avoidChars.length > 0)
    ? constraints.avoidChars.join('、')
    : '无';
  const generationChar = constraints.generationChar || '';
  const wishes = constraints.wishes || '';

  // 候选字集：截断到前 80 个字（含注音/意象），避免 user 消息超长
  const pool = (Array.isArray(input.llmPool) ? input.llmPool : []).slice(0, 80);
  const poolText = pool
    .map((c) => c.char + '(音' + (c.pinyin || '') + '；' + (c.imageryTags || []).join('/') + '；' + (c.meaning || '') + ')')
    .join('、');

  // 可用语料：与候选字集有交集的条目（上游已筛），最多 30 条
  const quotes = (Array.isArray(input.quotes) ? input.quotes : []).slice(0, 30);
  const quotesText = quotes.length > 0
    ? quotes.map((q) => '- key: ' + q.key + ' | ' + q.author + '《' + q.title + '》：' + q.sentence).join('\n')
    : '（无）';

  const system = [
    '你是一位中文命名顾问，为新生儿起两字名（姓氏已定，你只出名字部分，共输出完整三字姓名）。',
    '硬性规则，违反任何一条即为不合格输出：',
    '1. 名字用字只能来自下方「候选字集」，每个候选字附有拼音/意象标签/释义供参考；不得使用字集以外的任何汉字。',
    '2. 严格禁止一切命理测算词汇，包括但不限于：' + FORBIDDEN_TERMS + '。寓意文案只谈文学意象与美好期许。',
    '3. quoteRef.key 只能从下方「可用语料」列表中选取，且所选语料的用字须与名字相关；严禁编造作者、篇名或原句；若没有合适的引用，quoteRef 必须为 null。',
    '4. meaning 不超过 30 字，表达祝福但不夸大；名字的性别气质须与指定性别一致。',
    '5. 若指定了避讳字，名字中绝对不得出现；若指定了字辈用字，名字的第二字必须使用该字。',
    '输出要求：只输出一个 JSON 对象，不要任何解释、不要 markdown 代码块之外的多余文本，格式为：',
    '{"names":[{"name":"完整三字姓名","pinyin":["姓拼音","字一拼音","字二拼音"],"style":"风格标签","meaning":"不超过30字的寓意","quoteRef":{"key":"语料key"} 或 null,"wishesEcho":"一句话呼应家长期许"}]}',
    '单批输出 30 个名字，名字之间不得重复。'
  ].join('\n');

  const user = [
    '姓氏：' + surname,
    '性别：' + (gender === 'female' ? '女孩' : '男孩'),
    '期望风格：' + styles,
    '避讳字（禁用）：' + avoidChars,
    generationChar ? '字辈用字（名字第二字必须为）：' + generationChar : '字辈用字：无',
    wishes ? '家长期许：' + wishes : '家长期许：无',
    '',
    '候选字集（只能从中取字，最多使用前 80 字）：',
    poolText || '（无）',
    '',
    '可用语料（quoteRef.key 只能取下列 key）：',
    quotesText
  ].join('\n');

  return { system: system, user: user };
}

module.exports = {
  buildPrompt: buildPrompt
};
