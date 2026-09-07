/**
 * order 云函数 — 虚拟支付（骨架空壳）
 * 职责（T0x 支付任务实现）：下单 / 支付回调 / 查单补发（reconcile）。
 * 注意：全端走 wx.requestVirtualPayment；iOS/安卓费率差异不影响 SKU 定价；
 *       orders 集合记录 env（android|ios|harmony|windows）用于费率与退款策略分端。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/** 骨架占位：未实现的 action 统一返回 */
function notImplemented(action) {
  return {
    code: 5000,
    msg: 'action[' + action + '] 尚未实现（工程骨架占位）',
    data: null
  };
}

/** action 路由表（接口契约见交接包 3.4） */
const ACTIONS = {
  // 下单 { sku } → { wxPayParams }（wx.requestVirtualPayment 所需参数）
  create: (event) => notImplemented('create'),
  // 微信支付回调（验签后置 paid + deliveries；由支付系统触发，非前端直达）
  onPayNotify: (event) => notImplemented('onPayNotify'),
  // 查单补发 { orderId }：前端支付后查单，未 delivered 则补发（错误码 2002 对应此入口的重试）
  reconcile: (event) => notImplemented('reconcile')
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
    console.error('[order] 处理失败：', action, err);
    return { code: 5000, msg: '服务内部错误', data: null };
  }
};
