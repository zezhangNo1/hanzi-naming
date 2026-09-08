/**
 * solver.js — 白名单解空间筛选（T04 流水线第 3 步）
 *
 * 职责（INTENT-T04 第 5 节）：姓氏适配字集 → styles 加权 → 避讳过滤 → 输出字池。
 * B2 简化口径：字池来源为 hanzi-core 精选字（本身 ⊆ 白名单），产出「60-100 字」
 * 供 LLM 模式的 user 消息拼装；降级模式直接把全池交给规则引擎。
 *
 * LLM 模式字池（60-100 字）：按风格分排序取前 90；每字附 possible_quotes（B3 语料
 * 索引接入前为空数组，schema 先行）。
 */
'use strict';

const loader = require('./data-loader');
const score = require('./engine/score');

/**
 * 产出解空间字池
 * @param {Object} input { surname, gender, styles, constraints, params }
 * @returns {{
 *   pool: Array<{char,strokes,pinyin,tone,freqLevel,imageryTags,meaning,possibleQuotes}>,
 *   surnameMeta: { pinyin, tone, strokes, meaning, freqLevel },
 *   llmPool: Array（60-100 字 LLM 模式子集）
 * }}
 */
function solve(input) {
  const constraints = input.constraints || {};
  const avoidChars = Array.isArray(constraints.avoidChars) ? constraints.avoidChars : [];
  const avoidSet = new Set(avoidChars);
  const generationChar = constraints.generationChar || '';

  // 姓氏元数据：拼音/声调/笔画取自 hanzi-strokes；释义取 hanzi-core（若有）
  const surnameMeta = buildSurnameMeta(input.surname);

  // 字池来源：人名精选字池（正向白名单，v0.2 起替代 hanzi-core 全量粗标池——
  // 粗标按部首打标签混入奴/奸/钓/钙等不宜入名字，逐字黑名单不可穷尽）。
  // 元数据（拼音/笔画/声调/意象/释义）回查 hanzi-core，缺失时退 hanzi-strokes + 通用释义。
  // 过滤：避讳字、姓氏本身、名字适用性黑名单（字辈字豁免）。
  const pool = [];
  const poolChars = new Set();
  for (const charKey of Object.keys(loader.namePoolMap)) {
    if (charKey === input.surname) continue;
    if (avoidSet.has(charKey)) continue;
    if (loader.nameBlockSet.has(charKey) && charKey !== generationChar) continue;
    if (loader.redlineSingleCharSet.has(charKey)) continue; // 字形本身是红线词（吉/凶等）不入名
    const core = loader.coreMap[charKey];
    const meta = core || loader.strokesMap[charKey];
    if (!meta || !meta.pinyin || !meta.strokes) continue; // 无拼音/笔画的字无法参与组合
    poolChars.add(charKey);
    // 意象标签合并：字池 v0.3 人工精标 cats 优先（粗标按部首打标签不准），
    // 未精标字回退 hanzi-core 粗标
    const cats = loader.namePoolCats[charKey];
    const imageryTags = (cats && cats.length > 0)
      ? cats
      : (core ? core.imageryTags : []);
    pool.push({
      char: charKey,
      strokes: meta.strokes,
      pinyin: meta.pinyin,
      tone: meta.tone,
      freqLevel: core ? core.freqLevel : 'mid',
      imageryTags: imageryTags,
      meaning: core ? core.meaning : '人名常用字，寓意美好',
      genderAffinity: loader.namePoolMap[charKey], // m|f|n，引擎性别偏置用
      possibleQuotes: loader.quotesByChar[charKey] || [] // 语料索引倒排：该字可引的名句 key（B3）
    });
  }

  // 字辈字强制入池（避讳优先级高于字辈，二者冲突时避讳胜出；
  // 字辈字不在精选池时从全量笔画库补入，仍须在白名单内）
  if (generationChar && !avoidSet.has(generationChar) && !poolChars.has(generationChar)) {
    const meta = loader.strokesMap[generationChar];
    if (meta && loader.whitelistSet.has(generationChar)) {
      pool.push({
        char: generationChar,
        strokes: meta.strokes,
        pinyin: meta.pinyin,
        tone: meta.tone,
        freqLevel: 'mid',
        imageryTags: ['自然'],
        meaning: '字辈用字',
        genderAffinity: 'n',
        possibleQuotes: []
      });
      poolChars.add(generationChar); // 同步登记，保证下方 llmPool 注入条件对生僻字辈同样成立
    }
  }

  // styles 加权排序 → LLM 模式子集（60-100 字，取 90）
  const ranked = pool
    .map((c) => ({
      c: c,
      s: score.charStyleScore(input.styles, c.imageryTags, input.params.styles, input.params.genderBias, input.gender)
    }))
    .sort((a, b) => b.s - a.s || (a.c.char < b.c.char ? -1 : 1));
  const llmPool = ranked.slice(0, 90).map((x) => x.c);

  // 字辈字强制进入 LLM 候选字集：否则 prompt 规则 1（只能用候选字集）与
  // 规则 5（第二字必须字辈字）自相矛盾。去重追加（避讳冲突时仍以避讳胜出）。
  if (generationChar && !avoidSet.has(generationChar) && poolChars.has(generationChar)
    && !llmPool.some((c) => c.char === generationChar)) {
    const genEntry = pool.find((c) => c.char === generationChar);
    if (genEntry) llmPool.push(genEntry);
  }

  return {
    pool: pool,
    surnameMeta: surnameMeta,
    llmPool: llmPool
  };
}

/** 姓氏元数据（拼音/声调/笔画/释义） */
function buildSurnameMeta(surname) {
  const meta = loader.strokesMap[surname] || { pinyin: '', tone: 0, strokes: 0 };
  const core = loader.coreMap[surname];
  return {
    pinyin: meta.pinyin,
    tone: meta.tone,
    strokes: meta.strokes,
    meaning: core ? core.meaning : '姓氏用字',
    freqLevel: core ? core.freqLevel : 'mid'
  };
}

module.exports = {
  solve: solve,
  buildSurnameMeta: buildSurnameMeta
};
