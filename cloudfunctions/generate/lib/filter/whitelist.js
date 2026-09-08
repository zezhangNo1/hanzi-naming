/**
 * whitelist.js — 白名单/避讳过滤（B3 过滤流水线第 2 层）
 *
 * 规则：名字（含姓氏）每个字必须 ∈ 白名单 8105，且 ∉ constraints.avoidChars。
 * 任一字不满足 → 剔除该候选。通过项回写 checks.whitelist 与 chars[].inWhitelist。
 */
'use strict';

const loader = require('../data-loader');

/**
 * 单候选检测
 * @param {Object} cand 候选名
 * @param {Object} constraints { avoidChars }
 * @returns {string|null} 命中描述；通过返回 null
 */
function check(cand, constraints) {
  const chars = Array.from(cand.name || '');
  const avoid = new Set((constraints && constraints.avoidChars) || []);
  for (const ch of chars) {
    if (avoid.has(ch)) return '避讳字「' + ch + '」';
    if (!loader.whitelistSet.has(ch)) return '白名单外字「' + ch + '」';
  }
  return null;
}

/**
 * 过滤候选数组（回写 checks；原地不修改被剔除项）
 * @param {Object[]} candidates
 * @param {Object} constraints { avoidChars }
 * @returns {{ passed: Object[], blocked: Array<{ name: string, detail: string }> }}
 */
function filterCandidates(candidates, constraints) {
  const passed = [];
  const blocked = [];
  for (const cand of candidates || []) {
    const hit = check(cand, constraints);
    if (hit) {
      blocked.push({ name: cand.name, detail: hit });
      continue;
    }
    if (cand.checks) cand.checks.whitelist = true;
    for (const ch of cand.chars || []) ch.inWhitelist = true;
    passed.push(cand);
  }
  return { passed: passed, blocked: blocked };
}

module.exports = {
  check: check,
  filterCandidates: filterCandidates
};
