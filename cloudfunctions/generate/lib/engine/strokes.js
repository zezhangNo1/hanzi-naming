/**
 * strokes.js — 笔画均衡与书写成本（T06 书写层）
 *
 * 职责：writeCost（全名逐字笔画和，candidates.checks.writeCost 口径）
 * 与笔画均衡分（相邻字笔画差越小书写越协调）。
 * 参数（理想区间/惩罚步长）外置 engine-params.json 的 strokes 节。
 */
'use strict';

/** 全名书写总笔画 = 逐字笔画和 */
function writeCost(strokeArr) {
  return (strokeArr || []).reduce((sum, s) => sum + (Number(s) || 0), 0);
}

/**
 * 笔画均衡分（越高越好，内部排序用，绝不外泄）
 * 规则：
 * - 全名笔画和落在理想区间 [min, max] 内加分，超出按步长扣分；
 * - 相邻两字笔画差按步长累计扣分（首字为姓，一并参与）。
 * @param {number[]} strokeArr 含姓氏在内的笔画数组
 * @param {Object} p engine-params.strokes
 * @returns {number} 均衡分
 */
function balanceScore(strokeArr, p) {
  if (!strokeArr || strokeArr.length === 0) return 0;
  let score = 0;
  const total = writeCost(strokeArr);
  if (total < p.idealRange[0]) {
    score -= (p.idealRange[0] - total) * p.balancePenaltyPerStep;
  } else if (total > p.idealRange[1]) {
    score -= (total - p.idealRange[1]) * p.overCostPenalty;
  }
  for (let i = 1; i < strokeArr.length; i++) {
    const diff = Math.abs(strokeArr[i] - strokeArr[i - 1]);
    if (diff > 6) score -= (diff - 6) * p.balancePenaltyPerStep;
  }
  return score;
}

module.exports = {
  writeCost: writeCost,
  balanceScore: balanceScore
};
