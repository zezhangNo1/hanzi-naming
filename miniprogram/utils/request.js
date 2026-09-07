/**
 * request.js — 云函数调用统一封装
 *
 * 约定（与交接包第三节错误码表严格对齐）：
 * - 调用签名：call(name, action, data) -> Promise<data>，resolve 时返回业务 data 字段；
 * - 云函数统一返回 { code, msg, data }；code === 0 成功；
 * - 网络失败 / 调用异常统一按 code = -1 处理并 toast；
 * - 鉴权：前端绝不传 openid，云函数内取 context.OPENID。
 */
/** 错误码常量（与 docs/deploy.md 及交接包错误码表一致） */
const ERR = {
  OK: 0,                // 成功
  PARAM: 1001,          // 参数不合法
  QUOTA_EXCEEDED: 2001, // 免费额度用完 → 页面弹解锁卡
  PAY_NOT_ARRIVED: 2002,// 支付未到账 → 页面保留 reconcile 重试入口
  DEGRADED: 3001,       // 生成超时已降级 → 正常展示，标记 degraded
  SECURITY_BLOCK: 3002, // 内容安全拦截 → toast 提示重试
  ROOM_GONE: 4001,      // 房间不存在/已关闭 → toast
  INTERNAL: 5000        // 服务内部错误（骨架阶段预留，前端按默认分支处理）
};

/** 网络失败统一错误码 */
const NETWORK_ERROR_CODE = -1;

/** 轻提示 */
function toast(msg) {
  wx.showToast({
    title: msg,
    icon: 'none',
    duration: 2200
  });
}

/**
 * 调用云函数并按统一协议解析返回值
 * @param {string} name 云函数名：generate | vote | order | user | admin（admin 禁止前端调用）
 * @param {string} action 业务动作名，如 'ping' / 'create'
 * @param {Object} data 业务入参（不含 action；openid 禁止传入，服务端自动补齐）
 * @returns {Promise<*>} 成功时 resolve 云函数返回的 data；code=3001 时 resolve 并附加 degraded: true
 */
function call(name, action, data = {}) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: name,
      data: Object.assign({ action: action }, data)
    })
      .then((res) => {
        const body = res && res.result ? res.result : {};
        const code = typeof body.code === 'number' ? body.code : ERR.INTERNAL;
        const msg = body.msg || '未知错误';
        const payload = body.data === undefined ? null : body.data;

        // 成功：直接透出业务数据
        if (code === ERR.OK) {
          resolve(payload);
          return;
        }

        // 3001 降级：结果有效，正常展示但带 degraded 标记（resolve，不 reject）
        if (code === ERR.DEGRADED) {
          const degradedPayload = Object.assign({}, payload || {}, { degraded: true });
          resolve(degradedPayload);
          return;
        }

        // 其余错误码：reject({ code, msg })，按错误码表映射 UI 行为
        reject(handleBusinessError(code, msg));
      })
      .catch((err) => {
        // 网络失败 / 云函数不存在 / 超时等：统一 code = -1
        const errMsg = (err && err.errMsg) || '网络异常';
        console.error('[request] 云函数调用失败：', name, action, errMsg);
        // 云环境未就绪（-501000 Environment invalid 等）：给出可操作的提示
        if (/(-501000|Environment invalid|envCheckError|cloud function execution error)/i.test(errMsg) ||
            (err && err.errCode === -501000)) {
          toast('云开发环境未就绪：请在工具内开通「云开发」并部署云函数');
        } else {
          toast('网络异常，请检查网络后重试');
        }
        reject({ code: NETWORK_ERROR_CODE, msg: errMsg, raw: err });
      });
  });
}

/**
 * 业务错误码 → UI 行为映射（交接包第三节错误码表）
 * @param {number} code 业务错误码
 * @param {string} msg 错误信息
 * @returns {{code: number, msg: string}} 统一 reject 载荷
 */
function handleBusinessError(code, msg) {
  const payload = { code: code, msg: msg };
  switch (code) {
    case ERR.PARAM:
      // 1001 参数不合法：toast
      toast(msg || '参数不合法，请检查输入');
      break;
    case ERR.QUOTA_EXCEEDED:
      // 2001 免费额度用完：不弹 toast，静默 reject，交由页面渲染「解锁卡」（屏 06）
      break;
    case ERR.PAY_NOT_ARRIVED:
      // 2002 支付未到账：不弹 toast，reject 保留 code，页面展示提示并保留 reconcile 重试入口
      break;
    case ERR.SECURITY_BLOCK:
      // 3002 内容安全拦截：toast 固定契约文案（不依赖服务端 msg，空 msg 时兜底文案可达）
      toast('本次生成失败，请重试');
      break;
    case ERR.ROOM_GONE:
      // 4001 房间不存在/已关闭：toast 固定契约文案（不依赖服务端 msg）
      toast('房间不存在或已关闭');
      break;
    default:
      // 未收录错误码（含 5000 内部错误）：兜底 toast，避免用户无感知
      toast(msg || '服务开小差了，请稍后再试');
      break;
  }
  return payload;
}

module.exports = {
  call: call,
  ERR: ERR,
  NETWORK_ERROR_CODE: NETWORK_ERROR_CODE
};
