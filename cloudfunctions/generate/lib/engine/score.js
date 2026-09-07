/**
 * score.js — styles 加权与四维合成排序（T06）
 *
 * 四维：姓氏适配（surname-fit）+ 风格意象（styles→imageryTags 加权）
 *      + 笔画均衡（strokes）+ 字频重名（freq）。权重外置 engine-params.score。
 * 职责边界：本模块只算「内部排序分」，输出 candidates 前必须剥离一切分值字段
 * （验收 INTENT-T06：引擎任何输出不含 score/星级字段）。
 */
'use strict';

const freq = require('./freq');

/**
 * 单字风格加权分：8 风格映射 imageryTags 集合，多选风格取并集，命中累加。
 * @param {string[]} styles 用户选择的风格（可空 = 不限）
 * @param {string[]} tags 该字 imageryTags
 * @param {Object} styleParams engine-params.styles
 * @param {Object} genderBiasParams engine-params.genderBias（可空）
 * @param {string} gender male|female（可空）
 * @returns {number} 风格分
 */
function charStyleScore(styles, tags, styleParams, genderBiasParams, gender) {
  if (!styles || styles.length === 0) return 0;
  let score = 0;
  for (const styleName of styles) {
    const weights = styleParams.weights[styleName];
    if (!weights) continue;
    for (const tag of tags || []) {
      score += weights[tag] !== undefined ? weights[tag] : styleParams.defaultWeight;
    }
  }
  // 性别气质粗调（粗标 v0）
  if (genderBiasParams && gender && genderBiasParams[gender]) {
    for (const tag of tags || []) {
      const bias = genderBiasParams[gender][tag];
      if (bias) score += bias;
    }
  }
  return score;
}

/**
 * 四维合成总分（含字辈命中奖励，供 generate.js 排序）
 * @param {Object} dims { surnameFit, style, stroke, freq, generationCharHit }
 * @param {Object} p engine-params.score
 * @returns {number} 总分（内部使用）
 */
function totalScore(dims, p) {
  let s = dims.surnameFit * p.surnameFitWeight
    + dims.style * p.styleWeight
    + dims.stroke * p.strokeWeight
    + dims.freq * p.freqWeight;
  if (dims.generationCharHit) s += p.generationCharBonus;
  return s;
}

module.exports = {
  charStyleScore: charStyleScore,
  totalScore: totalScore,
  nameDuplicateLevel: freq.nameDuplicateLevel
};
