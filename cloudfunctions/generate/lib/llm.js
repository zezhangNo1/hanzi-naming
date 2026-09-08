/**
 * llm.js — LLM HTTP 调用（B3 真实实现，替换 B2 stub）
 *
 * - OpenAI 兼容 chat/completions：POST {LLM_BASE_URL}/chat/completions，Bearer 鉴权；
 * - 密钥只读 process.env（LLM_API_KEY / LLM_BASE_URL / LLM_MODEL），严禁写死；
 * - 传输层用 Node https 核心模块（云函数无全局 fetch），12s 超时（手动 timer + req.destroy）；
 * - 输出严格 JSON（尽量带 response_format json_object），容忍 ```json 包裹；
 * - 任何失败（解析失败/超时/HTTP 非 2xx）→ 返回 null，由 pipeline 走重试与降级；
 * - options.transport 可注入 fake transport 供测试（返回模型 content 字符串）。
 */
'use strict';

const https = require('https');
const promptBuilder = require('./prompt');

/** 单次请求超时（ms） */
const TIMEOUT_MS = 12000;

/**
 * LLM 三项环境变量是否齐备
 * @returns {boolean}
 */
function isConfigured() {
  return Boolean(
    process.env.LLM_API_KEY
    && process.env.LLM_BASE_URL
    && process.env.LLM_MODEL
  );
}

/**
 * 解析 LLM 返回的 JSON 文本（容忍 ```json 包裹与前后杂讯）
 * @param {string} raw 模型 content
 * @returns {Object|null} 解析结果；失败返回 null
 */
function parseLlmJson(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) s = fence[1].trim();
  if (s.charAt(0) !== '{') {
    const start = s.indexOf('{');
    if (start > 0) s = s.slice(start);
  }
  try {
    const parsed = JSON.parse(s);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (err) {
    return null;
  }
}

/**
 * 默认传输层：https POST chat/completions，返回模型 content 字符串
 * @param {Object} reqCtx { baseUrl, apiKey, model, body, timeoutMs }
 * @returns {Promise<string>} choices[0].message.content
 */
function httpsTransport(reqCtx) {
  return new Promise((resolve, reject) => {
    let endpoint;
    try {
      endpoint = new URL(reqCtx.baseUrl.replace(/\/+$/, '') + '/chat/completions');
    } catch (err) {
      reject(new Error('LLM_BASE_URL 非法: ' + reqCtx.baseUrl));
      return;
    }
    const req = https.request({
      hostname: endpoint.hostname,
      port: endpoint.port || 443,
      path: endpoint.pathname + endpoint.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + reqCtx.apiKey,
        'Content-Length': Buffer.byteLength(reqCtx.body, 'utf8')
      }
    }, (res) => {
      let chunks = '';
      res.on('data', (d) => { chunks += d; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error('HTTP ' + res.statusCode + ': ' + chunks.slice(0, 200)));
          return;
        }
        try {
          const parsed = JSON.parse(chunks);
          const content = parsed && parsed.choices && parsed.choices[0]
            && parsed.choices[0].message && parsed.choices[0].message.content;
          if (typeof content !== 'string') {
            reject(new Error('响应缺少 choices[0].message.content'));
            return;
          }
          resolve(content);
        } catch (err) {
          reject(new Error('响应非 JSON: ' + chunks.slice(0, 200)));
        }
      });
    });
    // 12s 超时：手动 timer + req.destroy（AbortController 在部分 Node 运行时不可用）
    req.setTimeout(reqCtx.timeoutMs, () => {
      req.destroy(new Error('LLM 请求超时 ' + reqCtx.timeoutMs + 'ms'));
    });
    req.on('error', reject);
    req.write(reqCtx.body, 'utf8');
    req.end();
  });
}

/**
 * LLM 生成（B3）
 * @param {Object} input { surname, gender, styles, constraints, llmPool, quotes }
 * @param {Object} [options] { transport?: (reqCtx) => Promise<string> }
 * @returns {Promise<{names: Object[]}|null>} 成功返回解析后的 names 数组包装；失败 null
 */
async function callLlm(input, options) {
  const opts = options || {};
  const apiKey = process.env.LLM_API_KEY || '';
  const baseUrl = process.env.LLM_BASE_URL || '';
  const model = process.env.LLM_MODEL || '';
  if (!apiKey || !baseUrl || !model) {
    console.info('[llm] 环境变量未配置齐备，走降级路径');
    return null;
  }

  const built = promptBuilder.buildPrompt({
    surname: input.surname,
    gender: input.gender,
    styles: input.styles,
    constraints: input.constraints,
    llmPool: input.llmPool,
    quotes: input.quotes
  });
  const body = JSON.stringify({
    model: model,
    messages: [
      { role: 'system', content: built.system },
      { role: 'user', content: built.user }
    ],
    temperature: 0.8,
    response_format: { type: 'json_object' }
  });

  const transport = opts.transport || httpsTransport;
  try {
    const content = await transport({
      baseUrl: baseUrl,
      apiKey: apiKey,
      model: model,
      body: body,
      timeoutMs: TIMEOUT_MS
    });
    const parsed = parseLlmJson(content);
    if (!parsed || !Array.isArray(parsed.names) || parsed.names.length === 0) {
      console.error('[llm] 输出解析失败或 names 为空：' + String(content).slice(0, 200));
      return null;
    }
    return { names: parsed.names };
  } catch (err) {
    console.error('[llm] 调用失败：' + ((err && err.message) || String(err)));
    return null;
  }
}

module.exports = {
  callLlm: callLlm,
  isConfigured: isConfigured,
  parseLlmJson: parseLlmJson
};
