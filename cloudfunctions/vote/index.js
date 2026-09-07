/**
 * vote 云函数 — 家人共选（骨架空壳）
 * 职责（T0x 共选任务实现）：房间创建 / 匿名投票 / 结果查询 / 关房。
 * 合规：投票者不要求登录、不采集昵称头像，匿名 voterKey 由前端首次进入 initRoom 下发并本地存储。
 * 鉴权：房主身份从 context.OPENID 取，前端不传。
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

/** action 路由表（接口契约见交接包 3.3） */
const ACTIONS = {
  // 创建房间 → { roomId, sharePath }（仅房主 openid）
  createRoom: (event) => notImplemented('createRoom'),
  // 进入房间初始化 → 下发匿名 voterKey 与候选列表
  initRoom: (event) => notImplemented('initRoom'),
  // 匿名投票 { roomId, candidateId, choice, comment }
  castVote: (event) => notImplemented('castVote'),
  // 结果查询 { roomId } → 逐候选票数与评论
  getResult: (event) => notImplemented('getResult'),
  // 关房（仅房主 openid 可调）
  closeRoom: (event) => notImplemented('closeRoom')
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
    console.error('[vote] 处理失败：', action, err);
    return { code: 5000, msg: '服务内部错误', data: null };
  }
};
