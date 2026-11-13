/**
 * ai-pick.js — AI 帮选（选名夹收藏名的 AI 点评与推荐）
 *
 * 职责：prompt 组装 / 规则引擎降级摘要 / LLM 输出消毒。三个纯函数，供
 * generate.aiPick action 编排（LLM 调用走 llm.callChat，不在此模块）。
 *
 * 红线（对齐 redline-ui 口径）：
 *   - 点评只谈字义/音律/典籍出处/与寄语的契合，禁止命理/五行/吉凶/运势类表述；
 *   - 禁止任何分值/星级/量化排序词（评分/总分/评级…），推荐理由用客观事实；
 *   - LLM 输出逐条消毒：词表命中即整条替换为客观兜底文案，宁缺毋编。
 */
'use strict';

/** 点评消毒词表：前端 UI 红线词（命理/量化两类）+ LLM 红线词（由调用方注入合并） */
const UI_REDLINE = ['吉', '凶', '数理', '三才', '五格', '命格', '命局', '喜用神', '日主',
  '五行缺', '补缺', '卦象', '宜忌', '冲克', '运势', '打分', '评分', '总分', '评级',
  '星级', '测算', '算命', '占卜', '改运', '化解', '招财', '克父', '克母', '犯太岁',
  '开光', '灵符', '转运', '注定', '匹配度', '五行', '八字', '生辰八字'];

/** 客观兜底点评（消毒替换用；仅陈述可验证事实的模板） */
const FALLBACK_COMMENT = '字义清晰，音律和谐，可结合朗读习惯再感受';

/** 重名度 → 客观描述 */
const DUP_TEXT = { low: '重名较少', mid: '重名中等', high: '重名较高' };

/**
 * 组装帮选 prompt
 * @param {Object} ctx { wishes, items } items: [{name,pinyin,meaning,quote,style,dupLevel,homophonePass}]
 * @returns {{system:string,user:string}}
 */
function buildPickPrompt(ctx) {
  const wishes = (ctx.wishes || '').trim();
  const items = ctx.items.map((i) => ({
    name: i.name,
    pinyin: i.pinyin,
    meaning: i.meaning,
    quote: i.quote ? (i.quote.title + '·' + i.quote.sentence) : '',
    style: i.style || ''
  }));
  const system = [
    '你是汉字起名顾问。家长会给你一组已收藏的宝宝候选名，请逐个点评并给出推荐排序。',
    '只能依据：字义、拼音与声调（音律）、典籍出处、风格、家长寄语。逐项给客观、具体的观察，',
    '例如某个字的意思、连读是否顺口、出处原句的意境、与寄语的呼应。',
    '严禁出现：命理、五行、八字、吉凶、运势、宜忌、测算等表述；严禁打分、星级、百分比等量化。',
    '不确定的信息不要编造（如不确定出处就只字不提）。',
    '输出严格 JSON：{"comments":[{"name":"全名","comment":"点评≤40字"}],',
    '"top3":[{"name":"全名","reason":"推荐理由≤60字"}]}。',
    'comments 必须覆盖输入的每一个名字；top3 最多 3 个、从输入名字中选。'
  ].join('');
  const user = (wishes ? ('家长寄语：' + wishes + '\n') : '（家长未填写寄语）\n')
    + '候选名单：' + JSON.stringify(items);
  return { system: system, user: user };
}

/**
 * 规则引擎降级摘要（LLM 不可用/失败时的兜底；确定性输出）
 * 客观维度排序：谐音全过 > 有典籍出处 > 重名较低；点评为可验证事实拼接。
 * @param {Object} ctx 同 buildPickPrompt
 * @returns {{comments:Object[], top3:Object[]}}
 */
function ruleSummary(ctx) {
  const items = ctx.items.slice();
  const quality = (i) => (i.homophonePass ? 2 : 0)
    + (i.quote ? 2 : 0)
    + (i.dupLevel === 'low' ? 2 : i.dupLevel === 'mid' ? 1 : 0);
  items.sort((a, b) => quality(b) - quality(a) || (a.name < b.name ? -1 : 1));

  const comments = items.map((i) => {
    const facts = [];
    facts.push(i.homophonePass ? '谐音检测通过' : '谐音检测有提示');
    facts.push(DUP_TEXT[i.dupLevel] || '重名中等');
    if (i.quote && i.quote.title) facts.push('出自《' + i.quote.title + '》');
    return { name: i.name, comment: facts.join('，') };
  });
  const top3 = items.slice(0, Math.min(3, items.length)).map((i) => {
    const facts = [];
    if (i.quote && i.quote.title) facts.push('有典籍出处《' + i.quote.title + '》');
    if (i.dupLevel === 'low') facts.push('用字相对少见');
    if (i.homophonePass) facts.push('谐音检测通过');
    return { name: i.name, reason: facts.join('，') || '各维度均衡，无明显短板' };
  });
  return { comments: comments, top3: top3 };
}

/**
 * LLM 输出消毒：名白名单过滤、长度截断、红线词整条替换
 * @param {Object} parsed LLM JSON（comments/top3）
 * @param {string[]} validNames 合法名列表（调用方候选名）
 * @param {string[]} [extraWords] 额外红线词（LLM 词表，注入合并）
 * @returns {Object|null} 消毒结果；结构不可用返回 null（调用方走降级）
 */
function sanitizePick(parsed, validNames, extraWords) {
  if (!parsed || typeof parsed !== 'object') return null;
  const words = UI_REDLINE.concat(extraWords || []);
  const hits = (text) => words.some((w) => text.indexOf(w) !== -1);
  const valid = new Set(validNames);

  const commentsIn = Array.isArray(parsed.comments) ? parsed.comments : [];
  const comments = [];
  for (const c of commentsIn) {
    if (!c || !valid.has(c.name)) continue;
    const raw = typeof c.comment === 'string' ? c.comment.trim().slice(0, 60) : '';
    comments.push({ name: c.name, comment: (raw && !hits(raw)) ? raw : FALLBACK_COMMENT });
  }
  if (comments.length === 0) return null;

  const topIn = Array.isArray(parsed.top3) ? parsed.top3 : [];
  const top3 = [];
  const used = new Set();
  for (const t of topIn) {
    if (!t || !valid.has(t.name) || used.has(t.name)) continue;
    const raw = typeof t.reason === 'string' ? t.reason.trim().slice(0, 80) : '';
    top3.push({ name: t.name, reason: (raw && !hits(raw)) ? raw : '各维度均衡，无明显短板' });
    used.add(t.name);
    if (top3.length === 3) break;
  }
  if (top3.length === 0) {
    // top3 缺失/全部非法：用 comments 顺序前 3 补（点评顺序即模型偏好）
    for (const c of comments) {
      if (used.has(c.name)) continue;
      top3.push({ name: c.name, reason: c.comment });
      used.add(c.name);
      if (top3.length === 3) break;
    }
  }
  return { comments: comments, top3: top3 };
}

module.exports = {
  UI_REDLINE: UI_REDLINE,
  FALLBACK_COMMENT: FALLBACK_COMMENT,
  buildPickPrompt: buildPickPrompt,
  ruleSummary: ruleSummary,
  sanitizePick: sanitizePick
};
