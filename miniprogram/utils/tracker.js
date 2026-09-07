/**
 * tracker.js — 埋点底座（T15 基础部分）
 *
 * 职责：
 * 1. 提供 track(event, params) 统一埋点入口，内置 14 事件参数 schema 校验；
 * 2. 本地队列：满 5 条或 10 秒合并上报一次（调 user 云函数 track action）；
 * 3. 失败容错：上报失败落本地离线缓存，App 启动时 flushOffline() 补发；
 * 4. 隐私合规：setConsent(true) 之前不采集不上报；openid 由服务端补齐，前端不传。
 *
 * 上报链路：tracker → user 云函数（action: track）→ events 集合
 * events 集合 schema：{ openid, event, params, invalid, ts, scene, createdAt }
 */
/** 离线缓存 storage key */
const STORAGE_KEY = '__tracker_offline_events__';

/** 队列长度达到该值立即上报 */
const FLUSH_SIZE = 5;

/** 队列定时上报间隔（毫秒） */
const FLUSH_INTERVAL_MS = 10 * 1000;

/** 离线缓存最大条数，超出丢最旧（防无限膨胀） */
const OFFLINE_MAX = 200;

/** 单次上报最大批量（与 user 云函数 handleTrack 的切片上限一致） */
const BATCH_MAX = 50;

/**
 * 14 事件参数 schema（与交接包第六节事件字典逐字对齐，缺一不可）
 * value 为必传参数名数组；track() 缺参时 console.warn 且打 invalid:true 标记仍上报
 */
const EVENT_SCHEMAS = {
  enter: ['scene'],                                        // 进入（搜索/分享/扫码）
  input_submit: ['has_styles', 'has_constraints'],         // 提交起名表单
  generate_success: ['jobId', 'latency_ms', 'degraded', 'source'], // 生成成功
  generate_fail: ['stage', 'code'],                        // 生成失败
  candidate_view: ['candidateId'],                         // 查看候选详情
  collect: ['candidateId', 'batch_index'],                 // 收藏（WNKU 口径）
  vote_invite: ['roomId', 'candidate_count'],              // 发起投票邀请
  vote_cast: ['roomId', 'voterKey'],                       // 投票（匿名 voterKey）
  poster_save: ['template'],                               // 海报保存
  report_share: ['type'],                                  // 报告分享（poster/manual）
  ad_batch: ['placement'],                                 // 激励视频换批次
  pay_success: ['sku', 'env', 'price_fen'],                // 付费成功
  compliance_block: ['stage'],                             // 合规拦截
  audit_status: ['result']                                 // 审核状态（人工记录）
};

/** 模块内运行时状态（不持久化） */
const state = {
  queue: [],      // 待上报队列
  timer: null,    // 10s 定时器句柄
  flushing: false,// 防并发上报
  consented: false// 隐私授权标记
};

/**
 * 初始化（App.onLaunch 调用）：清点并回灌离线缓存到队列
 */
function init() {
  const offline = readOffline();
  if (offline.length > 0) {
    state.queue = offline.concat(state.queue).slice(0, OFFLINE_MAX);
    clearOffline();
  }
}

/**
 * 隐私授权开关：首次启动弹隐私授权、用户同意后调用
 * 只有 consented = true 时 track() 才会入队与上报（合规要求：采集前依赖隐私指引同意）
 * @param {boolean} agreed 用户是否同意隐私指引
 */
function setConsent(agreed) {
  state.consented = !!agreed;
}

/**
 * 埋点统一入口
 * @param {string} event 事件名，见 EVENT_SCHEMAS
 * @param {Object} params 事件参数对象
 */
function track(event, params = {}) {
  // 1. 事件名合法性
  const schema = EVENT_SCHEMAS[event];
  if (!schema) {
    console.warn('[tracker] 未知事件，拒绝上报：', event);
    return;
  }

  // 2. 隐私授权前不采集
  if (!state.consented) {
    console.info('[tracker] 隐私授权前不采集：', event);
    return;
  }

  // 3. schema 校验：缺参/类型不符 → console.warn + 打 invalid 标记，仍上报（便于线上发现漂移）
  const invalid = validate(event, schema, params);

  // 4. 入队（openid 由服务端补齐，这里绝不携带任何身份字段）
  state.queue.push({
    event: event,
    params: params,
    invalid: invalid,
    ts: Date.now()
  });

  // 5. 触发上报：满 FLUSH_SIZE 立即，否则等定时器
  if (state.queue.length >= FLUSH_SIZE) {
    flush();
  } else {
    schedule();
  }
}

/**
 * schema 校验，缺参返回 true（表示该条事件无效）
 * @param {string} event 事件名
 * @param {string[]} schema 必传参数名数组
 * @param {Object} params 实际参数
 * @returns {boolean} 是否 invalid
 */
function validate(event, schema, params) {
  const missing = [];
  for (let i = 0; i < schema.length; i++) {
    const key = schema[i];
    const value = params[key];
    if (value === undefined || value === null || value === '') {
      missing.push(key);
    }
  }
  if (missing.length > 0) {
    console.warn('[tracker] 事件参数缺失：', event, '缺少：', missing.join(', '));
    return true;
  }
  return false;
}

/** 启动/重置 10s 定时上报 */
function schedule() {
  if (state.timer) {
    return; // 已有定时器，不重复
  }
  state.timer = setTimeout(() => {
    state.timer = null;
    flush();
  }, FLUSH_INTERVAL_MS);
}

/**
 * 合并上报：取队列头部一批发往 user 云函数 track action
 * 失败时整批落离线缓存，等下次 init/flushOffline 补发
 */
function flush() {
  if (state.flushing || state.queue.length === 0) {
    return;
  }
  state.flushing = true;
  const batch = state.queue.splice(0, BATCH_MAX);

  wx.cloud.callFunction({
    name: 'user',
    data: {
      action: 'track',
      events: batch
    }
  })
    .then((res) => {
      const body = res && res.result ? res.result : {};
      if (body.code !== 0) {
        // 云函数返回业务错误：落离线缓存，不丢数据
        console.warn('[tracker] 上报返回错误，转入离线缓存：', body.code, body.msg);
        saveOffline(batch);
      }
    })
    .catch((err) => {
      // 网络失败（弱网/飞行模式）：落离线缓存，App 启动时补发
      console.warn('[tracker] 上报网络失败，转入离线缓存：', err && err.errMsg);
      saveOffline(batch);
    })
    .then(() => {
      state.flushing = false;
      // 队列仍有积压则继续
      if (state.queue.length > 0) {
        schedule();
      }
    });
}

/**
 * App 启动补发离线事件：回灌缓存 → 立即 flush
 */
function flushOffline() {
  init(); // 确保缓存已回灌
  if (state.queue.length > 0) {
    flush();
  }
}

/** 读取离线缓存 */
function readOffline() {
  try {
    const list = wx.getStorageSync(STORAGE_KEY);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

/** 清空离线缓存 */
function clearOffline() {
  try {
    wx.removeStorageSync(STORAGE_KEY);
  } catch (e) {
    // storage 异常不阻断主流程
  }
}

/** 失败批量落离线缓存（超出上限丢最旧） */
function saveOffline(batch) {
  try {
    const merged = readOffline().concat(batch);
    wx.setStorageSync(STORAGE_KEY, merged.slice(-OFFLINE_MAX));
  } catch (e) {
    console.warn('[tracker] 离线缓存写入失败：', e);
  }
}

module.exports = {
  init: init,
  track: track,
  setConsent: setConsent,
  flush: flush,
  flushOffline: flushOffline,
  EVENT_SCHEMAS: EVENT_SCHEMAS
};
