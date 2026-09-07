/**
 * admin 云函数 — 词库/语料更新（骨架空壳）
 * 安全约定：不开放前端调用。仅允许云开发控制台手动触发或其他云函数调用：
 * 1. config.json 不声明任何前端可用的 openapi 权限；
 * 2. 代码内通过 context.SOURCE 判断调用来源，含 "wx_client" 即为前端直达，直接拒绝；
 * 3. 部署后在云开发控制台将该函数权限设为「仅创建者及云函数可调用」双保险（见 docs/deploy.md）。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/**
 * 判断是否来自小程序前端的直连调用
 * context.SOURCE 形如 "wx_client"（前端）/ "wx_server"（云函数间）/ "wx_unknown"（控制台）
 */
function isFromClient(context) {
  const source = (context && context.SOURCE) || '';
  return String(source).indexOf('wx_client') !== -1;
}

/** 骨架占位：未实现的 action 统一返回 */
function notImplemented(action) {
  return {
    code: 5000,
    msg: 'action[' + action + '] 尚未实现（工程骨架占位）',
    data: null
  };
}

/** action 路由表（后续任务实现：词库导入/红线词更新/语料索引重建） */
const ACTIONS = {
  // 控制台连通性自检
  ping: async () => ({ code: 0, msg: 'ok', data: { pong: true } }),
  // 词库导入（database/ 目录 JSON → 集合）
  importLexicon: (e) => notImplemented('importLexicon'),
  // 红线词表更新（redline-ui / redline-llm）
  updateRedline: (e) => notImplemented('updateRedline'),
  // 典籍语料索引重建（quoteRef 校验索引）
  rebuildQuoteIndex: (e) => notImplemented('rebuildQuoteIndex')
};

exports.main = async (event, context) => {
  // 前端直连一律拒绝（2001 语义不适用，用 5000 + 明确 msg）
  if (isFromClient(context)) {
    console.warn('[admin] 拒绝前端直连调用，source =', context.SOURCE);
    return { code: 5000, msg: '无权调用：admin 仅限云开发控制台与其他云函数', data: null };
  }

  const action = event && event.action;
  const handler = ACTIONS[action];
  if (!handler) {
    return { code: 1001, msg: '未知 action: ' + action, data: null };
  }
  try {
    return await handler(event, context);
  } catch (err) {
    console.error('[admin] 处理失败：', action, err);
    return { code: 5000, msg: '服务内部错误', data: null };
  }
};
