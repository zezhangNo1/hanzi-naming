/**
 * 临时联调测试：用 e2e mock 实测 user 云函数 track/ping 全链路
 * 复用 scripts/e2e 的 mock wx-server-sdk（含 createCollection）
 */
const path = require('path');
const USER = path.resolve(__dirname, '../../cloudfunctions/user');
process.env.MOCK_OPENID = 'openid_usertest';

// mock open 条件：require 时注入 wx-server-sdk 解析路径
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'wx-server-sdk') return path.resolve(__dirname, 'node_modules/wx-server-sdk/index.js');
  return origResolve.call(this, request, ...args);
};

const sdk = require('wx-server-sdk');
const mod = require(USER + '/index.js');

(async () => {
  const ping = await mod.main({ action: 'ping' }, {});
  console.log('ping:', JSON.stringify(ping));

  const tr = await mod.main({ action: 'track', events: [{ event: 'enter', params: { scene: 'test' }, ts: Date.now() }, { event: 'input_submit', params: { has_styles: true } }] }, {});
  console.log('track:', JSON.stringify(tr));

  const tr2 = await mod.main({ action: 'track', events: [{ event: 'generate_success', params: {} }] }, {});
  console.log('track2:', JSON.stringify(tr2));

  const store = sdk.__store;
  if (store && store.events) {
    console.log('events 集合文档数:', store.events.docs.length);
    console.log('样例:', JSON.stringify(store.events.docs[0]));
  } else {
    console.log('events 集合不存在于 mock store');
  }
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
