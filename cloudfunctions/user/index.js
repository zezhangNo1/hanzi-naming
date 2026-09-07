/**
 * user 云函数 — 用户数据与埋点服务（骨架）
 * 已实现：ping（连通性自检）、track（埋点批量写入 events 集合）。
 * 待实现（T0x 用户数据任务）：collect / uncollect / listFolder / setBirthConsent / feedback / deleteMyData。
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

/** action 路由表（接口契约见交接包 3.5） */
const ACTIONS = {
  ping: handlePing,
  track: handleTrack,
  // 收藏 { candidateId, note }（WNKU 口径数据源）
  collect: (e) => notImplemented('collect'),
  // 取消收藏 { candidateId }
  uncollect: (e) => notImplemented('uncollect'),
  // 收藏列表（含家人投票状态）
  listFolder: (e) => notImplemented('listFolder'),
  // 生辰授权单独记录 { consent }
  setBirthConsent: (e) => notImplemented('setBirthConsent'),
  // 反馈 { candidateId, type, comment }
  feedback: (e) => notImplemented('feedback'),
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
    // 开发阶段临时在 msg 中附带错误信息便于定位（提审前移除 debug 字段）
    console.error('[user] 处理失败：', action, err);
    return { code: 5000, msg: '服务内部错误: ' + ((err && err.message) || '未知'), debug: String((err && err.stack) || err), data: null };
  }
};
