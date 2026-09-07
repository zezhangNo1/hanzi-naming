/**
 * freq.js — 字频/重名度层（T06）
 *
 * 口径说明（INTENT-T06 第 5 节）：
 * - hanzi-core 的 freqLevel（low|mid|high）是「字常用度」粗标；
 * - candidates.checks.duplicateLevel 是「重名度参考」标签：名中出现常用度越高的字，
 *   重名概率越高。本批两者直接映射（low↔low、mid↔mid、high↔high），
 *   正式口径待公安热名榜数据接入后校准（T02 后续批次）。
 * - duplicateLevel 是标签化表述，允许外显；数值分仅用于内部排序，绝不输出。
 */
'use strict';

/** 单字常用度 → 重名度标签（映射关系外置 engine-params.freq.duplicateMap） */
function duplicateLevelOf(freqLevel, p) {
  return p.duplicateMap[freqLevel] || 'mid';
}

/** 全名重名度 = 名中最高档（high > mid > low） */
function nameDuplicateLevel(freqLevels, p) {
  const order = { high: 3, mid: 2, low: 1 };
  let best = 'low';
  let bestRank = 0;
  for (const lv of freqLevels || []) {
    const rank = order[lv] || 0;
    if (rank > bestRank) {
      bestRank = rank;
      best = lv;
    }
  }
  return duplicateLevelOf(best, p);
}

/** 字频维度内部排序分：重名度低加分、高扣分 */
function freqScore(freqLevel, p) {
  if (freqLevel === 'low') return p.lowDuplicateBonus;
  if (freqLevel === 'mid') return p.midDuplicateBonus;
  return -p.highDuplicatePenalty;
}

module.exports = {
  duplicateLevelOf: duplicateLevelOf,
  nameDuplicateLevel: nameDuplicateLevel,
  freqScore: freqScore
};
