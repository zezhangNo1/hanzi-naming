/**
 * surname-fit.js — 姓氏声韵适配（T06 可解释规则核心）
 *
 * 规则（INTENT-T06 第 5 节，参数外置 engine-params.surnameFit）：
 * 1. 姓氏尾字为仄（如 沈 shěn 上声）→ 名首字优先平声（加分）；姓平 → 名首字轻推仄声；
 * 2. 双字名避免姓+名首+名次声母完全相同（如 沈书诗 s-s-s 拗口，扣分）；
 * 3. 相邻字韵母完全相同（叠韵拗口）扣分；
 * 4. 三字同调扣分。
 * 所有分值仅用于内部排序，绝不外泄（验收：引擎任何输出不含 score/星级字段）。
 */
'use strict';

/** 拼音（带调）→ 声母：zh/ch/sh 双声母优先匹配 */
function initialOf(pinyin) {
  if (!pinyin) return '';
  const two = pinyin.slice(0, 2);
  if (two === 'zh' || two === 'ch' || two === 'sh') return two;
  const BILABIAL = ['b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's', 'y', 'w'];
  const first = pinyin[0];
  return BILABIAL.includes(first) ? first : '';
}

/** 拼音（带调）→ 韵母：去声母后的剩余部分（仅用于相等比较，不追求音系精确） */
function finalOf(pinyin) {
  const init = initialOf(pinyin);
  return init ? pinyin.slice(init.length) : pinyin;
}

/**
 * 姓氏适配分（越高越好）
 * @param {Object} ctx { surnamePinyin, surnameTone, namePinyins[], nameTones[] }
 * @param {Object} p engine-params.surnameFit
 * @returns {number} 适配分
 */
function fitScore(ctx, p) {
  const surnamePz = ctx.surnameTone === 1 || ctx.surnameTone === 2 ? 'ping' : 'ze';
  const firstTone = ctx.nameTones[0];
  const secondTone = ctx.nameTones[1];
  let score = 0;

  // 规则 1：姓仄 → 名首字平声加分（验收锚点：沈姓 + 古风雅致 top10 ≥7 个名首字平声）
  if (firstTone) {
    const firstPz = firstTone === 1 || firstTone === 2 ? 'ping' : 'ze';
    if (surnamePz === 'ze' && firstPz === 'ping') score += p.surnameZePreferPingBonus;
    if (surnamePz === 'ping' && firstPz === 'ze') score += p.surnamePingPreferZeBonus;
  }

  // 规则 2：声母三连同（姓-名首-名次）
  const surnameInit = initialOf(ctx.surnamePinyin);
  const initA = initialOf(ctx.namePinyins[0]);
  const initB = initialOf(ctx.namePinyins[1]);
  if (surnameInit && surnameInit === initA && (ctx.namePinyins.length < 2 || initA === initB)) {
    score -= p.sameInitialTriplePenalty;
  }

  // 规则 3：相邻韵母相同（姓-名首 叠韵，或 名首-名次 叠韵）
  const surnameFinal = finalOf(ctx.surnamePinyin);
  const finA = finalOf(ctx.namePinyins[0]);
  const finB = finalOf(ctx.namePinyins[1]);
  if (surnameFinal && surnameFinal === finA) score -= p.sameFinalPenalty;
  if (finA && finA === finB) score -= p.sameFinalPenalty;

  // 规则 4：三字同调（由 tones.js 判定）
  if (ctx.nameTones.length >= 2) {
    const triple = [ctx.surnameTone, firstTone, secondTone];
    const valid = triple.filter((t) => t > 0);
    if (valid.length === 3 && valid[0] === valid[1] && valid[1] === valid[2]) {
      score -= p.sameToneTriplePenalty;
    }
  }

  return score;
}

module.exports = {
  initialOf: initialOf,
  finalOf: finalOf,
  fitScore: fitScore
};
