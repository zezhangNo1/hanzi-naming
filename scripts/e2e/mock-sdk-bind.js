'use strict';
/**
 * mock-sdk-bind.js — 把 wx-server-sdk 强制解析到本地 mock（测试基建）
 *
 * 背景：generate/user 云函数目录为「上传并部署：所有文件」装好了生产依赖
 * （含真实 wx-server-sdk），Node 模块解析优先命中真实包，NODE_PATH 里的
 * mock 被遮蔽，导致 e2e 测试直连真实云环境而报 -501007。
 * 本模块在模块解析层把 wx-server-sdk 重定向到 scripts/e2e/node_modules 的 mock。
 *
 * 用法：测试脚本顶部（任何云函数模块 require 之前）require('./mock-sdk-bind')。
 * 仅测试脚本可用，严禁被生产代码引用。
 */
const path = require('path');
const MOCK_SDK = path.resolve(__dirname, 'node_modules', 'wx-server-sdk', 'index.js');
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'wx-server-sdk') return MOCK_SDK;
  return origResolve.call(this, request, ...args);
};
