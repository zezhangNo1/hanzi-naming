'use strict';
/**
 * test-real-load.js — 真实 wx-server-sdk 模块加载测试（不挂 mock）
 *
 * 背景：2026-11 收藏/选名夹持续 -504002 崩溃的根因是 user/index.js 的
 * require('./lib/ensure-collections') 早于 cloud.init() 执行（其模块顶层
 * 调用 cloud.database()，真实 sdk 在 init 前调用会抛「Cloud API isn't
 * enabled」→ 模块加载失败 → 云函数进程崩溃）。mock sdk 不校验 init 顺序，
 * 全部业务测试绿灯也无法暴露，故本测试用本地安装的真实 wx-server-sdk
 * 直接 require 两个云函数入口做加载级验证。
 * 运行：node scripts/e2e/test-real-load.js（无需 NODE_PATH）
 */
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
let pass = 0, failCnt = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { failCnt++; failures.push(name); console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}

async function main() {
  console.log('\n[1] 真实 sdk 模块加载（云函数冷启动路径）');
  for (const name of ['user', 'generate', 'vote', 'order', 'admin']) {
    const p = path.join(ROOT, 'cloudfunctions', name, 'index.js');
    try {
      delete require.cache[require.resolve(p)];
      const fn = require(p);
      check(name + '/index.js 真实加载成功且 exports.main 为函数', fn && typeof fn.main === 'function');
    } catch (e) {
      check(name + '/index.js 真实加载成功且 exports.main 为函数', false, e.message.slice(0, 120));
    }
  }

  console.log('\n[2] init 顺序静态检查（ensure-collections 不在顶层调用 database）');
  const fs = require('fs');
  for (const p of [
    path.join(ROOT, 'cloudfunctions', 'user', 'lib', 'ensure-collections.js'),
    path.join(ROOT, 'cloudfunctions', 'generate', 'lib', 'ensure-collections.js')
  ]) {
    const src = fs.readFileSync(p, 'utf8');
    const lazy = /let _db = null/.test(src) && !/^const db = cloud\.database\(\)/m.test(src);
    check(p.split('cloudfunctions/')[1] + ' db 惰性化', lazy);
  }
  const userIdx = fs.readFileSync(path.join(ROOT, 'cloudfunctions', 'user', 'index.js'), 'utf8');
  const initPos = userIdx.indexOf('cloud.init(');
  const reqPos = userIdx.indexOf("require('./lib/ensure-collections')");
  check('user/index.js 的 cloud.init 先于 ensure-collections require', initPos !== -1 && reqPos !== -1 && initPos < reqPos,
    'init@' + initPos + ' require@' + reqPos);

  console.log('\n=========================================');
  console.log('真实加载测试结果：通过 ' + pass + ' / 失败 ' + failCnt);
  if (failCnt > 0) {
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('ALL PASS ✅');
}

main().catch((e) => { console.error('测试脚本异常：', e); process.exit(1); });
