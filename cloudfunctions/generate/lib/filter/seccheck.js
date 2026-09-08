/**
 * seccheck.js — 内容安全检测（B3 过滤流水线第 5 层，security.msgSecCheck 输入侧）
 *
 * 规则：把整批候选的 name+meaning 合并为一段 content（换行分隔）调
 * cloud.openapi.security.msgSecCheck。明确的数字型 errCode≠0 → 整批 fail；
 * errCode 缺省/非数字、API 抛错（频控/权限未生效/mock 环境无 openapi）→
 * warn 不阻断生成（console.error + block_log 记 detail:'seccheck-api-error'，由 runAll 落库）。
 * 该模块必须可安全降级：无 openapi 能力时走 warn 分支，绝不抛错上抛。
 */
'use strict';

const cloud = require('wx-server-sdk');

/**
 * 整批内容安全检测
 * @param {Object[]} candidates 本轮待出名单候选
 * @returns {Promise<{ pass: boolean, warn: boolean, detail: string|null }>}
 */
async function checkBatch(candidates) {
  const content = (candidates || [])
    .map((c) => (c.name || '') + '：' + (c.meaning || ''))
    .join('\n');
  if (!content) return { pass: true, warn: false, detail: null };

  try {
    const openapi = cloud.openapi; // mock 环境/权限未生效时可能为 undefined
    if (!openapi || !openapi.security || !openapi.security.msgSecCheck) {
      console.error('[seccheck] openapi.security.msgSecCheck 不可用，跳过（warn）');
      return { pass: true, warn: true, detail: 'seccheck-api-error' };
    }
    const res = await openapi.security.msgSecCheck({ content: content });
    if (res && typeof res.errCode === 'number') {
      if (res.errCode !== 0) {
        return { pass: false, warn: false, detail: 'msgSecCheck errCode=' + res.errCode };
      }
      return { pass: true, warn: false, detail: null };
    }
    // errCode 缺省/非数字：无法确认安全，按约定 warn 放行（不阻断生成）
    console.error('[seccheck] 响应缺少数字型 errCode，warn 放行');
    return { pass: true, warn: true, detail: 'seccheck-api-error' };
  } catch (err) {
    // 频控/权限未生效等：不阻断生成，仅记录
    console.error('[seccheck] API 调用异常（warn 放行）：' + ((err && err.message) || err));
    return { pass: true, warn: true, detail: 'seccheck-api-error' };
  }
}

module.exports = {
  checkBatch: checkBatch
};
