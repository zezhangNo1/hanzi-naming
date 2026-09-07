/**
 * ensure-collections.js — 云数据库集合自动创建兜底
 *
 * 背景：云开发集合需手动创建或 API 创建，直接 add() 到不存在的集合会抛异常（表现为 5000）。
 * 本模块在写入前确保集合存在；已存在时 createCollection 会报错，静默吞掉即可。
 * 进程内缓存避免重复调用（云函数实例热启动时只建一次）。
 */
const cloud = require('wx-server-sdk');
const db = cloud.database();

const ensured = {};

async function ensureCollection(name) {
  if (ensured[name]) return;
  try {
    await db.createCollection(name);
    console.log('[ensure-collection] 已创建集合：', name);
  } catch (err) {
    // 集合已存在 / 无权限等：已存在属正常路径，其余错误打日志但不阻断业务（后续 add 会给出真实错误）
    const msg = (err && err.message) || '';
    if (!/exist/i.test(msg)) {
      console.warn('[ensure-collection] 创建集合未成功（可能已存在）：', name, msg);
    }
  }
  ensured[name] = true;
}

/** 批量确保多个集合 */
async function ensureCollections(names) {
  for (const n of names) {
    await ensureCollection(n);
  }
}

module.exports = { ensureCollection, ensureCollections };
