/**
 * log.js — block_log 通用落库（B3：redline.logBlocked 泛化而成）
 *
 * schema 不变：{ jobId, stage, detail, raw, createdAt }。
 * 各过滤阶段统一调用，stage 取 'redline' | 'whitelist' | 'homophone' | 'seccheck'。
 */
'use strict';

/**
 * 批量落 block_log
 * @param {Object} db 云数据库实例
 * @param {string} jobId 任务 id
 * @param {string} stage 过滤阶段名
 * @param {Array<{raw: string, detail: string}>} items 拦截明细
 */
async function logBlocked(db, jobId, stage, items) {
  if (!items || items.length === 0) return;
  const now = Date.now();
  for (const it of items) {
    try {
      await db.collection('block_log').add({
        data: {
          jobId: jobId,
          stage: stage,
          detail: it.detail || '',
          raw: it.raw || '',
          createdAt: now
        }
      });
    } catch (err) {
      // 落日志失败不阻断生成主链路
      console.error('[filter/log] block_log 写入失败：' + ((err && err.message) || err));
    }
  }
}

module.exports = {
  logBlocked: logBlocked
};
