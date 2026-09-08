/**
 * filter/index.js — 过滤流水线汇编（B3，T05 全链路）
 *
 * 顺序：redline → whitelist → homophone → quote-verify → seccheck。
 * 每阶段剔除项统一经 log.logBlocked 落 block_log（schema 不变）；
 * warn 级（音近/引用缺失/安全检测 API 异常）保留候选并汇总到 warns。
 *
 * runAll(candidates, ctx) → { passed, blocked, warns }
 *   blocked: [{ stage, raw, detail }]  warns: [{ stage, raw, detail }]
 */
'use strict';

const redline = require('./redline');
const whitelist = require('./whitelist');
const homophone = require('./homophone');
const quoteVerify = require('./quote-verify');
const seccheck = require('./seccheck');
const log = require('./log');

/**
 * 执行全链路过滤
 * @param {Object[]} candidates 候选数组（会被各阶段回写 checks/quote）
 * @param {Object} ctx { db, jobId, constraints }
 * @returns {Promise<{ passed: Object[], blocked: Array<{stage,raw,detail}>, warns: Array<{stage,raw,detail}> }>}
 */
async function runAll(candidates, ctx) {
  const db = ctx && ctx.db;
  const jobId = (ctx && ctx.jobId) || '';
  const constraints = (ctx && ctx.constraints) || {};
  const blocked = [];
  const warns = [];
  let current = (candidates || []).slice();

  // 1. 红线词（命中剔除，兜底防线）
  const rl = redline.filterCandidates(current);
  for (const b of rl.blocked) {
    blocked.push({ stage: 'redline', raw: b.name, detail: '命中词：' + b.word });
  }
  current = rl.passed;

  // 2. 白名单 + 避讳
  const wl = whitelist.filterCandidates(current, constraints);
  for (const b of wl.blocked) {
    blocked.push({ stage: 'whitelist', raw: b.name, detail: b.detail });
  }
  current = wl.passed;

  // 2.5 字辈约束（服务端硬校验）：名字第二字必须为字辈字。
  // 规则引擎产物由组合阶段保证（本层对降级产物应零剔除，回归点）；
  // 此层主要拦截 LLM 路径无视字辈的输出。
  const generationChar = (constraints && constraints.generationChar) || '';
  if (generationChar) {
    const genPassed = [];
    for (const cand of current) {
      const chars = Array.from(cand.name || '');
      if (chars.length > 1 && chars[1] === generationChar) {
        genPassed.push(cand);
      } else {
        blocked.push({
          stage: 'generation',
          raw: cand.name,
          detail: '字辈字「' + generationChar + '」未置于名字第二字'
        });
      }
    }
    current = genPassed;
  }

  // 3. 谐音（普通话 fail 剔除 / warn 保留；方言 TODO B3.1）
  const hp = homophone.filterCandidates(current);
  for (const b of hp.blocked) {
    blocked.push({ stage: 'homophone', raw: b.name, detail: b.detail });
  }
  for (const w of hp.warns) {
    warns.push({ stage: 'homophone', raw: w.name, detail: w.detail });
  }
  current = hp.passed;

  // 4. 典籍出处校验（不剔除；warn 记录）
  for (const w of quoteVerify.applyBatch(current)) {
    warns.push({ stage: 'quote-verify', raw: w.name, detail: w.detail });
  }

  // 5. 内容安全（整批；API 异常走 warn 不阻断）
  if (current.length > 0) {
    const sc = await seccheck.checkBatch(current);
    if (!sc.pass) {
      for (const c of current) {
        blocked.push({ stage: 'seccheck', raw: c.name, detail: sc.detail || 'msgSecCheck 未通过' });
      }
      current = [];
    } else if (sc.warn) {
      warns.push({ stage: 'seccheck', raw: '(batch)', detail: sc.detail || 'seccheck-api-error' });
    }
  }

  // 落 block_log（按阶段分组批量写）
  if (db && jobId) {
    const byStage = {};
    for (const b of blocked) {
      (byStage[b.stage] = byStage[b.stage] || []).push({ raw: b.raw, detail: b.detail });
    }
    for (const stage of Object.keys(byStage)) {
      await log.logBlocked(db, jobId, stage, byStage[stage]);
    }
  }

  return { passed: current, blocked: blocked, warns: warns };
}

module.exports = {
  runAll: runAll
};
