/**
 * tones.js — 声调与平仄标注（T06 音律层之一）
 *
 * 职责：数字声调 → 平/仄 标注；输出对齐 candidates schema 的 tones 数组。
 * 规则（INTENT-T06 第 5 节）：阴平(1)/阳平(2) → ping；上声(3)/去声(4) → ze；
 * 轻声/未知(0) → null（排序时按中性处理）。粤音入声仅作参考，排序一律以普调为准。
 */
'use strict';

/** 数字声调 → 'ping' | 'ze' | null（轻声/未知） */
function toPingZe(tone) {
  if (tone === 1 || tone === 2) return 'ping';
  if (tone === 3 || tone === 4) return 'ze';
  return null;
}

/** 全名声调数组 → tones 数组（['ping','ze',...]），非法声调落 null */
function annotateTones(toneArr) {
  return (toneArr || []).map((t) => toPingZe(t));
}

/**
 * 全名是否三字同调（拗口信号之一，供 surname-fit 扣分）
 * @param {number[]} toneArr 含姓氏在内的 3 字声调
 * @returns {boolean}
 */
function isSameToneTriple(toneArr) {
  if (!toneArr || toneArr.length < 3) return false;
  const valid = toneArr.filter((t) => t > 0);
  if (valid.length < 3) return false;
  return valid[0] === valid[1] && valid[1] === valid[2];
}

module.exports = {
  toPingZe: toPingZe,
  annotateTones: annotateTones,
  isSameToneTriple: isSameToneTriple
};
