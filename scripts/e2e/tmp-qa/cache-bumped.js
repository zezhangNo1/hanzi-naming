/**
 * cache.js — 生成结果缓存查重（T04 流水线第 6 步）
 *
 * 口径：hash(surname + gender + styles + constraints + batch)。
 * 同一用户、同 hash、status=done 的历史任务命中 → 直接返回既有 candidateIds
 * （换一批 batch+1 → hash 变化 → 强制新组合，符合交接包 3.1 第 6 步）。
 */
'use strict';

const crypto = require('crypto');

/**
 * 引擎版本号：参与缓存指纹计算。
 * 引擎/字池/参数有任何影响输出的变更时必须 +1，使历史缓存自然失效，
 * 避免「云端已更新但同参请求永远命中旧结果」。
 */
const ENGINE_VERSION = 'v4-llm-20260908-QATEST';

/**
 * 计算任务指纹
 * @param {Object} input { surname, gender, styles, constraints, batch }
 * @returns {string} md5 指纹
 */
function jobHash(input) {
  const normalized = JSON.stringify({
    v: ENGINE_VERSION,
    s: input.surname,
    g: input.gender,
    st: (input.styles || []).slice().sort(),
    c: {
      generationChar: (input.constraints && input.constraints.generationChar) || '',
      avoidChars: ((input.constraints && input.constraints.avoidChars) || []).slice().sort(),
      wishes: (input.constraints && input.constraints.wishes) || '',
      dialects: ((input.constraints && input.constraints.dialects) || []).slice().sort(),
      birth: null // birth 不参与 hash（敏感项不入指纹，B4 生辰授权后单独处理）
    },
    b: input.batch || 1
  });
  return crypto.createHash('md5').update(normalized, 'utf8').digest('hex');
}

/**
 * 查缓存：同用户 + 同指纹 + 已完成的任务
 * @param {Object} db 云数据库实例
 * @param {string} openid 用户 openid
 * @param {string} hash 任务指纹
 * @returns {Object|null} 命中的历史 job 文档（含 candidateIds），未命中返回 null
 */
async function lookup(db, openid, hash) {
  const found = await db.collection('name_jobs')
    .where({ _openid: openid, hash: hash, status: 'done' })
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();
  return (found.data && found.data.length > 0) ? found.data[0] : null;
}

module.exports = {
  jobHash: jobHash,
  lookup: lookup,
  ENGINE_VERSION: ENGINE_VERSION
};
