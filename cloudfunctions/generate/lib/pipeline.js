/**
 * pipeline.js — 生成流水线编排（T04，B2 降级版）
 *
 * B2 编排顺序（交接包 3.1 七步的降级裁剪版）：
 *   solver 解空间 → llm（B2 stub，恒走降级）→ degrade 规则引擎生成
 *   → 红线词过滤兜底（命中剔除 + block_log）→ 落库 candidates + 更新 name_jobs。
 * B3 待接入：真实 LLM 生成、过滤流水线全链路（白名单复核/出处校验/谐音/msgSecCheck）、
 *   3 次重试与降级计数。
 */
'use strict';

const cloud = require('wx-server-sdk');
const solver = require('./solver');
const llm = require('./llm');
const degrade = require('./degrade');
const redline = require('./filter/redline');
const loader = require('./data-loader');

// 独立入口保障：pipeline 可能被 index.js 之外的测试脚本直接 require，此处幂等 init
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/**
 * 执行一次生成任务（同步，降级引擎 <1s）
 * @param {Object} job { jobId, surname, gender, styles, constraints, source, batch }
 * @returns {Promise<{ status: 'done'|'failed', candidateIds: string[], degraded: boolean, latencyMs: number }>}
 */
async function run(job) {
  const startedAt = Date.now();

  // 3. 白名单解空间筛选
  const solved = solver.solve({
    surname: job.surname,
    gender: job.gender,
    styles: job.styles,
    constraints: job.constraints,
    params: loader.engineParams
  });

  // 4. LLM 生成（B2 stub 恒 null → 走降级；B3 在此接入真实调用与重试计数）
  let candidates = null;
  let degraded = false;
  if (llm.isConfigured()) {
    const llmResult = await llm.callLlm({
      surname: job.surname,
      gender: job.gender,
      styles: job.styles,
      constraints: job.constraints,
      charPool: solved.llmPool
    });
    if (llmResult) {
      candidates = llmResult.names;
    }
  }
  if (!candidates) {
    // 5. 降级规则引擎（B2 默认路径）
    const deg = degrade.runDegenerate({
      surname: job.surname,
      surnameMeta: solved.surnameMeta,
      gender: job.gender,
      styles: job.styles,
      constraints: job.constraints,
      pool: solved.pool,
      params: loader.engineParams,
      batch: job.batch
    });
    candidates = deg.candidates;
    degraded = deg.degraded;
  }

  // 5'. 红线词过滤兜底（命中剔除 + block_log）
  const filtered = redline.filterCandidates(candidates);
  await redline.logBlocked(db, job.jobId, filtered.blocked);
  candidates = filtered.passed;

  // 7. 落库 candidates + 更新 name_jobs
  const latencyMs = Date.now() - startedAt;
  const candidateIds = [];
  for (const cand of candidates) {
    const doc = Object.assign({}, cand, {
      _openid: job.openid,
      jobId: job.jobId,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    const added = await db.collection('candidates').add({ data: doc });
    candidateIds.push(added._id);
  }

  await db.collection('name_jobs').doc(job.jobId).update({
    data: {
      status: 'done',
      candidateIds: candidateIds,
      degraded: degraded,
      latencyMs: latencyMs,
      poolSize: solved.pool.length,
      updatedAt: Date.now()
    }
  });

  return { status: 'done', candidateIds: candidateIds, degraded: degraded, latencyMs: latencyMs };
}

module.exports = {
  run: run
};
