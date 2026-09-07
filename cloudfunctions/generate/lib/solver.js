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

  // 避讳过滤 + 姓字回避（解空间内不含避讳字与姓氏本身）
  const pool = [];
  for (const entry of loader.hanziCore.chars) {
    if (entry.char === input.surname) continue;
    if (avoidSet.has(entry.char)) continue;
    pool.push({
      char: entry.char,
      strokes: entry.strokes,
      pinyin: entry.pinyin,
      tone: entry.tone,
      freqLevel: entry.freqLevel,
      imageryTags: entry.imageryTags,
      meaning: entry.meaning,
      possibleQuotes: [] // B3：语料索引接入后填充 3-5 条佳句
    });
  }

  // 字辈字强制入池（绕过避讳过滤不成立——避讳优先级高于字辈，二者冲突时避讳胜出）
  if (generationChar && !avoidSet.has(generationChar) && !loader.coreMap[generationChar]) {
    // 字辈字不在精选库时，从全量笔画库补入（仍须在白名单内）
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
        possibleQuotes: []
      });
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
