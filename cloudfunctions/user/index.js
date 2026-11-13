/**
 * user 云函数 — 用户数据与埋点服务
 * 已实现：ping（连通性自检）、track（埋点批量写入 events 集合）、
 *         collect/uncollect（收藏，favorites 集合）、listFolder（选名夹列表，T09）、
 *         feedback（报告反馈，feedbacks 集合）。
 * 待实现（T0x 用户数据任务）：setBirthConsent / deleteMyData。
 * 鉴权：openid 从 context.OPENID 取（云开发自动注入），前端绝不传身份字段。
 */
const cloud = require('wx-server-sdk');
const { ensureCollection } = require('./lib/ensure-collections');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/** 每次请求内调用 getWXContext 获取调用方身份（SCF 的 context 参数不含 OPENID） */
function wxOpenid() {
  return (cloud.getWXContext() || {}).OPENID || '';
}

/** 单次 track 上报最大事件数（与 tracker.js BATCH_MAX 一致） */
const TRACK_BATCH_MAX = 50;

/**
 * ping：连通性自检，供验收用例 call('user','ping') -> { code: 0 }
 * 不返回 openid 明文，只回 pong 标记
 */
async function handlePing(event, context) {
  return {
    code: 0,
    msg: 'ok',
    data: { pong: true, ts: Date.now() }
  };
}

/**
 * track：埋点批量写入 events 集合
 * events 集合 schema：{ openid, event, params, invalid, ts, scene, createdAt }
 * - openid 由服务端补齐（前端不传，防止伪造他人数据）；
 * - invalid 标记透传自 tracker.js schema 校验结果（缺参事件仍上报，便于发现参数漂移）。
 */
async function handleTrack(event, context) {
  const openid = wxOpenid();
  const events = Array.isArray(event.events) ? event.events : [];
  if (events.length === 0) {
    return { code: 1001, msg: 'events 不能为空', data: null };
  }
  const now = Date.now();
  const docs = events.slice(0, TRACK_BATCH_MAX).map((item) => {
    const params = (item && item.params) || {};
    return {
      openid: openid,                    // 服务端补齐，前端不传
      event: (item && item.event) || 'unknown',
      params: params,
      // 顶层 scene 与 database/README.md 声明的 schema 对齐：取 params.scene（如 enter 事件），无则空串
      scene: typeof params.scene === 'string' ? params.scene : '',
      invalid: !!(item && item.invalid), // schema 校验缺参标记
      ts: (item && item.ts) || now,
      createdAt: now
    };
  });
  // 集合不存在时自动创建（首例写入兜底），再批量写入（云函数端 add 支持数组一次性插入）
  await ensureCollection('events');
  await db.collection('events').add({ data: docs });
  return { code: 0, msg: 'ok', data: { count: docs.length } };
}

/** 骨架占位：未实现的 action 统一返回 */
function notImplemented(action) {
  return {
    code: 5000,
    msg: 'action[' + action + '] 尚未实现（工程骨架占位）',
    data: null
  };
}

/** 反馈 type 白名单（T08 报告页反馈入口；处置流 T17 扩展） */
const FEEDBACK_TYPES = ['meaning', 'quote', 'homophone', 'other'];

/**
 * collect：收藏候选名（幂等，重复收藏只更新备注）
 * 入参：{ candidateId, note? }；favorites 集合：{ _openid, candidateId, note, createdAt, updatedAt }
 */
async function handleCollect(event) {
  const openid = wxOpenid();
  const candidateId = typeof event.candidateId === 'string' ? event.candidateId.trim() : '';
  const note = typeof event.note === 'string' ? event.note.slice(0, 100) : '';
  if (!candidateId) {
    return { code: 1001, msg: '缺少 candidateId', data: null };
  }
  await ensureCollection('favorites');
  const found = await db.collection('favorites')
    .where({ _openid: openid, candidateId: candidateId })
    .limit(1)
    .get()
    .catch(() => ({ data: [] }));
  const now = Date.now();
  const exist = found && found.data && found.data.length > 0 ? found.data[0] : null;
  if (exist) {
    await db.collection('favorites').doc(exist._id).update({
      data: { note: note, updatedAt: now }
    });
  } else {
    await db.collection('favorites').add({
      data: { _openid: openid, candidateId: candidateId, note: note, createdAt: now, updatedAt: now }
    });
  }
  return { code: 0, msg: 'ok', data: { candidateId: candidateId, collected: true } };
}

/**
 * uncollect：取消收藏 { candidateId }
 */
async function handleUncollect(event) {
  const openid = wxOpenid();
  const candidateId = typeof event.candidateId === 'string' ? event.candidateId.trim() : '';
  if (!candidateId) {
    return { code: 1001, msg: '缺少 candidateId', data: null };
  }
  await db.collection('favorites')
    .where({ _openid: openid, candidateId: candidateId })
    .remove()
    .catch(() => {});
  return { code: 0, msg: 'ok', data: { candidateId: candidateId, collected: false } };
}

/**
 * listFolder：选名夹列表（T09）
 * 入参：{ limit? }（默认 50，1-100）
 * 出参：{ total, list: [{ candidateId, note, collectedAt, candidate }] }
 * - favorites 按 updatedAt 倒序（最近操作在前；查询后服务端再排一次，不依赖 DB 排序实现）；
 * - candidate 为候选摘要，脱敏口径与 generate.getDetail 一致（剥离 _openid/jobId 与分值内部字段）；
 * - 候选文档已不存在（历史数据被清理）时跳过该行，不阻断列表；
 * - 防御：候选 _openid 必须等于调用方（正常收藏只会来自本人候选，此处双保险）。
 */
async function handleListFolder(event) {
  const openid = wxOpenid();
  const limit = Math.min(Math.max(parseInt(event.limit, 10) || 50, 1), 100);
  const found = await db.collection('favorites')
    .where({ _openid: openid })
    .limit(limit)
    .get()
    .catch(() => ({ data: [] }));
  const favs = (found && found.data) || [];
  if (favs.length === 0) {
    return { code: 0, msg: 'ok', data: { total: 0, list: [] } };
  }
  // 最近操作在前（updatedAt 兜底 createdAt；同刻稳定序用 candidateId）
  favs.sort((a, b) => ((b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
    || String(a.candidateId).localeCompare(String(b.candidateId)));
  // 查询侧已 limit；此处再截一次防驱动实现差异
  const paged = favs.slice(0, limit);

  // 批量拉候选文档（where-in 上限 100 内；limit 已被夹到 ≤100）
  const ids = favs.map((f) => f.candidateId).filter(Boolean);
  const candFound = await db.collection('candidates')
    .where({ _id: db.command.in(ids) })
    .limit(100)
    .get()
    .catch(() => ({ data: [] }));
  const byId = {};
  for (const doc of (candFound && candFound.data) || []) byId[doc._id] = doc;

  const list = [];
  for (const f of paged) {
    const doc = byId[f.candidateId];
    if (!doc || doc._openid !== openid) continue;
    list.push({
      candidateId: f.candidateId,
      note: f.note || '',
      collectedAt: f.updatedAt || f.createdAt || 0,
      candidate: sanitizeCandidate(doc)
    });
  }
  return { code: 0, msg: 'ok', data: { total: list.length, list: list } };
}

/** 候选摘要脱敏：与 generate/index.js sanitizeCandidate 同口径（红线：输出不携带分值） */
function sanitizeCandidate(doc) {
  const c = Object.assign({}, doc);
  delete c._openid;
  delete c.jobId;
  delete c.score;
  delete c._internalScore;
  delete c.quoteRef;
  return c;
}

/**
 * feedback：报告解析反馈落库 { candidateId, type, comment? }
 * feedbacks 集合：{ _openid, candidateId, type, comment, createdAt }
 */
async function handleFeedback(event) {
  const openid = wxOpenid();
  const candidateId = typeof event.candidateId === 'string' ? event.candidateId.trim() : '';
  const type = FEEDBACK_TYPES.indexOf(event.type) !== -1 ? event.type : '';
  const comment = typeof event.comment === 'string' ? event.comment.slice(0, 200) : '';
  if (!candidateId || !type) {
    return { code: 1001, msg: 'candidateId 或 type 参数不合法', data: null };
  }
  await ensureCollection('feedbacks');
  await db.collection('feedbacks').add({
    data: {
      _openid: openid,
      candidateId: candidateId,
      type: type,
      comment: comment,
      createdAt: Date.now()
    }
  });
  return { code: 0, msg: 'ok', data: { candidateId: candidateId, accepted: true } };
}

/** action 路由表（接口契约见交接包 3.5） */
const ACTIONS = {
  ping: handlePing,
  track: handleTrack,
  // 收藏 { candidateId, note }（WNKU 口径数据源）
  collect: handleCollect,
  // 取消收藏 { candidateId }
  uncollect: handleUncollect,
  // 收藏列表 { limit? }（含候选摘要；家人投票状态 T10 扩展）
  listFolder: handleListFolder,
  // 生辰授权单独记录 { consent }
  setBirthConsent: (e) => notImplemented('setBirthConsent'),
  // 反馈 { candidateId, type, comment }
  feedback: handleFeedback,
  // 硬删除本人全部数据（15.3.9；orders 保留必要支付记录并脱敏）
  deleteMyData: (e) => notImplemented('deleteMyData')
};

exports.main = async (event, context) => {
  const action = event && event.action;
  const handler = ACTIONS[action];
  if (!handler) {
    return { code: 1001, msg: '未知 action: ' + action, data: null };
  }
  try {
    return await handler(event, context);
  } catch (err) {
    console.error('[user] 处理失败：', action, err);
    return { code: 5000, msg: '服务内部错误', data: null };
  }
};
