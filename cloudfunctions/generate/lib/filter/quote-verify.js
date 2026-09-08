/**
 * quote-verify.js — 典籍出处校验（B3 过滤流水线第 4 层）
 *
 * 规则：cand.quoteRef.key 必须存在于语料索引（quotesByKey），且若 LLM 附带了
 * author/title/sentence，三元组须与语料完全一致 → 通过并把 cand.quote 回填为
 * { author, title, sentence }。key 不存在 / 三元组不匹配 → cand.quote = null
 * （warn 级：不剔除、不丢弃候选），并移除 quoteRef 字段（输出 schema 不含它）。
 */
'use strict';

const loader = require('../data-loader');

/**
 * 单候选校验（原地回写 cand.quote / 删除 cand.quoteRef）
 * @param {Object} cand 候选名
 * @returns {{ quote: Object|null, warn: string|null }}
 */
function check(cand) {
  const ref = cand.quoteRef;
  delete cand.quoteRef;
  if (!ref || !ref.key) {
    cand.quote = null;
    return { quote: null, warn: null }; // 无引用是合法输出
  }
  const entry = loader.quotesByKey[ref.key];
  if (!entry) {
    cand.quote = null;
    return { quote: null, warn: 'quoteRef.key 不在语料索引：' + ref.key };
  }
  // LLM 若附带三元组则须与语料完全一致；只给 key 则直接采信语料原文
  const tripleOk = (ref.author === undefined || ref.author === entry.author)
    && (ref.title === undefined || ref.title === entry.title)
    && (ref.sentence === undefined || ref.sentence === entry.sentence);
  if (!tripleOk) {
    cand.quote = null;
    return { quote: null, warn: 'quoteRef 三元组与语料不一致：' + ref.key };
  }
  cand.quote = { author: entry.author, title: entry.title, sentence: entry.sentence };
  return { quote: cand.quote, warn: null };
}

/**
 * 批量校验（不剔除候选）
 * @param {Object[]} candidates
 * @returns {Array<{name: string, detail: string}>} warn 列表
 */
function applyBatch(candidates) {
  const warns = [];
  for (const cand of candidates || []) {
    const r = check(cand);
    if (r.warn) warns.push({ name: cand.name, detail: r.warn });
  }
  return warns;
}

module.exports = {
  check: check,
  applyBatch: applyBatch
};
