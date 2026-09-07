/**
 * redline.js — 红线词过滤兜底（T05 过滤流水线第 1 层，B2 服务端兜底实现）
 *
 * 数据源：redline-llm.json（与 PRD 3.2 逐词一致的 31 词）。
 * 规则（交接包第五节）：对候选名 + 寓意文案逐词扫描，命中 → 丢弃该候选 → 记 block_log。
 * 降级模式文案由模板生成，理论不命中；此层为兜底防线（拦截率目标 100%）。
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

/**
 * 落 block_log（合规元指标数据源，交接包第二节 schema）
 * @param {Object} db 云数据库实例
 * @param {string} jobId 任务 id
 * @param {Array<{name:string, word:string}>} blocked 拦截明细
 */
async function logBlocked(db, jobId, blocked) {
  if (!blocked || blocked.length === 0) return;
  const docs = blocked.map((b) => ({
    jobId: jobId,
    stage: 'redline',
    detail: '命中词：' + b.word,
    raw: b.name,
    createdAt: Date.now()
  }));
  await db.collection('block_log').add({ data: docs });
}

module.exports = {
  hit: hit,
  filterCandidates: filterCandidates,
  logBlocked: logBlocked
};
