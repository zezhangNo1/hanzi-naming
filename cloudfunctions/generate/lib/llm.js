/**
 * llm.js — LLM HTTP 调用（B2 仅留接口 stub，不接真实 LLM）
 *
 * B3 实现要点（交接包 3.2 prompt v1，此处仅占位声明）：
 * - 环境变量只读 process.env（LLM_API_KEY / LLM_BASE_URL / LLM_MODEL），严禁写死；
 * - 12s 超时；输出严格 JSON schema 校验；3 次重试后仍失败 → degrade.js 兜底；
 * - quoteRef 只能指向本地语料索引 key，服务端回查（B3 语料索引接入后启用）。
 */
'use strict';

/**
 * LLM 生成（B2 stub：永远返回 null，表示"不适用/未启用"，调用方必须走降级路径）
 * @param {Object} input 与 prompt v1 对齐的输入 { surname, gender, styles, constraints, charPool }
 * @returns {Promise<Object|null>} B2 恒为 null
 */
async function callLlm(input) { // eslint-disable-line no-unused-vars
  console.info('[llm] B2 stub：LLM 通道未启用，直接走规则引擎降级路径');
  return null;
}

/** LLM 是否已配置（B2 恒 false；B3 依据 env 判定） */
function isConfigured() {
  return false;
}

module.exports = {
  callLlm: callLlm,
  isConfigured: isConfigured
};
