/**
 * redline.js — 红线词过滤兜底（T05 过滤流水线第 1 层，B2 服务端兜底实现）
 *
 * 数据源：redline-llm.json（v1.1，29 词；单字「吉/凶」已移除——寓意文案中
 * 的「平安吉祥」属正常祝福，名字用字层面的吉/凶由名字适用性黑名单兜住）。
 * 规则（交接包第五节）：对候选名 + 寓意文案逐词扫描，命中 → 丢弃该候选 → 记 block_log。
 * 降级模式文案由模板生成，理论不命中；此层为兜底防线（拦截率目标 100%）。
 * 落库统一走 filter/log.js（本模块不再自带 logBlocked 实现）。
 */
'use strict';

const loader = require('../data-loader');

/** 命中检测：文本含任一红线词即命中 */
function hit(text) {
  if (!text) return null;
  for (const word of loader.redlineLlm.words) {
    if (text.indexOf(word) !== -1) return word;
  }
  return null;
}

/**
 * 过滤候选数组（原地剔除命中项）
 * @param {Object[]} candidates 候选名数组
 * @returns {{ passed: Object[], blocked: Array<{ name: string, word: string }> }}
 */
function filterCandidates(candidates) {
  const passed = [];
  const blocked = [];
  for (const cand of candidates || []) {
    // 扫描范围：名字本身 + 寓意文案 + 每字释义
    const text = [cand.name, cand.meaning || '']
      .concat((cand.chars || []).map((c) => c.meaning || ''))
      .join(' ');
    const word = hit(text);
    if (word) {
      blocked.push({ name: cand.name, word: word });
    } else {
      passed.push(cand);
    }
  }
  return { passed: passed, blocked: blocked };
}

module.exports = {
  hit: hit,
  filterCandidates: filterCandidates
};
