/**
 * degrade.js — 降级输出层（B2 即默认路径）
 *
 * 职责边界（本批）：LLM 失败/超时/未启用时的兜底出口 —— 组装引擎输入并调用
 * T06 规则引擎，附加 degraded 标记与模板文案说明。B3 接入真实 LLM 后，
 * 本模块仅在这些失败场景被触发（整体成功率 ≥98% 的兜底）。
 */
'use strict';

const engine = require('./engine/generate');

/**
 * 规则引擎降级生成
 * @param {Object} input
 *   - surname, surnameMeta, gender, styles, constraints, params, pool, batch
 * @returns {{ candidates: Object[], degraded: true, reason: string }}
 */
function runDegenerate(input) {
  const result = engine.generate(input);
  return {
    candidates: result.candidates,
    degraded: true,
    reason: 'B2 默认降级路径：规则引擎直出'
  };
}

module.exports = {
  runDegenerate: runDegenerate
};
