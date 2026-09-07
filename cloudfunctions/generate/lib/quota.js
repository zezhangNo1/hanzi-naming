/**
 * quota.js — free/ad/paid 三源额度校验与扣减（T04）
 *
 * 规则（交接包 3.1 流水线第 2 步）：
 * - free：users.freeUsed < FREE_BATCH_LIMIT（config 为字符串，必须 parseInt）；
 * - ad：当日激励视频次数 < AD_BATCH_LIMIT（B2 仅留接口，前端激励视频 B4 接入）；
 * - paid：paidUntil 剩余次数（B2 仅留接口，虚拟支付 B4 接入）。
 * 超限统一 code 2001（前端弹解锁卡）。
 */
'use strict';

const ERR = { OK: 0, PARAM: 1001, QUOTA_EXCEEDED: 2001 };

/** 免费批次上限（config.json envVariables 中为字符串，必须 parseInt） */
function freeBatchLimit() {
  return parseInt(process.env.FREE_BATCH_LIMIT || '2', 10);
}

/** 广告换批次上限 */
function adBatchLimit() {
  return parseInt(process.env.AD_BATCH_LIMIT || '1', 10);
}

/** 今日日期串（按天重置 adFreeToday） */
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 确保用户文档存在（ensure 初始化）：
 * freeUsed:0、adFreeToday:{date:今天,count:0}、paidUntil:null、privacy 默认
 * @param {Object} db 云数据库实例
 * @param {string} openid 用户 openid
 * @returns {Object} users 文档数据（无则已新建）
 */
async function ensureUser(db, openid) {
  const coll = db.collection('users');
  const found = await coll.where({ _openid: openid }).limit(1).get();
  if (found.data && found.data.length > 0) {
    return found.data[0];
  }
  const now = Date.now();
  const doc = {
    freeUsed: 0,
    adFreeToday: { date: todayStr(), count: 0 },
    paidUntil: null,
    privacy: { birthConsent: false, agreeVersion: 'v1.0' },
    deletedAt: null,
    createdAt: now,
    updatedAt: now
  };
  await coll.add({ data: doc });
  return doc;
}

/**
 * 校验并扣减额度（B2 默认 source=free；ad/paid 只留接口）
 * @param {Object} db 云数据库实例
 * @param {string} openid 用户 openid
 * @param {string} source 'free' | 'ad' | 'paid'
 * @returns {{ ok: boolean, code: number, msg: string, userDoc: Object }}
 */
async function checkAndConsume(db, openid, source) {
  const userDoc = await ensureUser(db, openid);

  if (source === 'paid') {
    // B2 接口预留：paidUntil 为剩余批次次数（int 或 null），虚拟支付接入后启用
    const paidLeft = typeof userDoc.paidUntil === 'number' ? userDoc.paidUntil : 0;
    if (paidLeft <= 0) {
      return { ok: false, code: ERR.QUOTA_EXCEEDED, msg: '付费批次已用完', userDoc: userDoc };
    }
    await db.collection('users').where({ _openid: openid }).update({
      data: { paidUntil: paidLeft - 1, updatedAt: Date.now() }
    });
    return { ok: true, code: ERR.OK, msg: 'ok', userDoc: userDoc };
  }

  if (source === 'ad') {
    // B2 接口预留：激励视频当日换批次，接入后由前端回调触发
    const today = userDoc.adFreeToday || { date: todayStr(), count: 0 };
    const count = today.date === todayStr() ? today.count : 0;
    if (count >= adBatchLimit()) {
      return { ok: false, code: ERR.QUOTA_EXCEEDED, msg: '今日广告批次已用完', userDoc: userDoc };
    }
    await db.collection('users').where({ _openid: openid }).update({
      data: { adFreeToday: { date: todayStr(), count: count + 1 }, updatedAt: Date.now() }
    });
    return { ok: true, code: ERR.OK, msg: 'ok', userDoc: userDoc };
  }

  // 默认 free
  const freeUsed = userDoc.freeUsed || 0;
  if (freeUsed >= freeBatchLimit()) {
    return { ok: false, code: ERR.QUOTA_EXCEEDED, msg: '免费批次已用完', userDoc: userDoc };
  }
  await db.collection('users').where({ _openid: openid }).update({
    data: { freeUsed: freeUsed + 1, updatedAt: Date.now() }
  });
  return { ok: true, code: ERR.OK, msg: 'ok', userDoc: userDoc };
}

/** 查询剩余额度（poll 响应的 quota 字段口径） */
async function quotaOf(db, openid) {
  const userDoc = await ensureUser(db, openid);
  const today = userDoc.adFreeToday || { date: todayStr(), count: 0 };
  return {
    freeLeft: Math.max(0, freeBatchLimit() - (userDoc.freeUsed || 0)),
    adLeft: Math.max(0, adBatchLimit() - (today.date === todayStr() ? today.count : 0)),
    paidLeft: typeof userDoc.paidUntil === 'number' ? userDoc.paidUntil : 0
  };
}

module.exports = {
  ensureUser: ensureUser,
  checkAndConsume: checkAndConsume,
  quotaOf: quotaOf,
  freeBatchLimit: freeBatchLimit,
  adBatchLimit: adBatchLimit,
  ERR: ERR
};
