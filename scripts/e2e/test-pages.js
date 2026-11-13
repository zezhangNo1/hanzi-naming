'use strict';
/**
 * test-pages.js — 页面静态一致性测试（防「组件未注册渲染为空」类静默 bug）
 * 背景：2026-11 真机反馈「风格偏好什么都选不到」——根因是 index.json 的
 * usingComponents 漏注册 style-chips/aigc-banner/progressive-card，小程序框架
 * 对未注册的自定义组件标签不报错、静默渲染为空节点，测试期极难发现。
 * 检查：
 *   a) 每个页面 wxml 使用的自定义组件标签（kebab-case 约定）都已在页面 json 注册；
 *   b) 注册指向的组件四件套文件存在；
 *   c) app.json 声明的每个页面四件套存在（防改名滑落）；
 *   d) 页面 wxml 引用的每个组件自身 json 声明 component: true。
 * 运行：node scripts/e2e/test-pages.js（纯静态，无需 NODE_PATH）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const MP = path.join(ROOT, 'miniprogram');

let pass = 0, failCnt = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { failCnt++; failures.push(name + (detail ? ' —— ' + detail : '')); console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}

/** 从 wxml 提取自定义组件标签（含连字符的标签 = 组件约定） */
function customTagsOf(wxml) {
  const tags = new Set();
  const re = /<([a-z][a-z0-9]*(?:-[a-z0-9]+)+)[\s/>]/g;
  let m;
  while ((m = re.exec(wxml)) !== null) tags.add(m[1]);
  return [...tags];
}

const appJson = JSON.parse(fs.readFileSync(path.join(MP, 'app.json'), 'utf8'));
const pages = appJson.pages || [];

console.log('\n[1] app.json 页面声明 vs 磁盘四件套');
const pageDirs = [];
for (const p of pages) {
  const base = path.join(MP, p);
  const missing = ['.js', '.wxml', '.wxss', '.json'].filter((ext) => !fs.existsSync(base + ext));
  check('页面 ' + p + ' 四件套齐全', missing.length === 0, '缺 ' + missing.join(','));
  pageDirs.push({ route: p, dir: path.dirname(base), name: path.basename(base) });
}

console.log('\n[2] 页面组件使用 vs usingComponents 注册');
for (const pg of pageDirs) {
  const wxml = fs.readFileSync(path.join(pg.dir, pg.name + '.wxml'), 'utf8');
  const tags = customTagsOf(wxml);
  if (tags.length === 0) continue; // 无组件使用的页面跳过
  const cfg = JSON.parse(fs.readFileSync(path.join(pg.dir, pg.name + '.json'), 'utf8'));
  const reg = cfg.usingComponents || {};
  for (const tag of tags) {
    check(pg.route + ' 使用的 <' + tag + '> 已注册', !!reg[tag],
      '页面 json usingComponents 缺 "' + tag + '"');
  }
}

console.log('\n[3] 注册组件四件套存在 + 自身 component:true 声明');
for (const pg of pageDirs) {
  const cfgPath = path.join(pg.dir, pg.name + '.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const reg = cfg.usingComponents || {};
  for (const tag of Object.keys(reg)) {
    const cpath = path.join(MP, reg[tag].replace(/^\//, ''));
    const missing = ['.js', '.wxml', '.wxss', '.json'].filter((ext) => !fs.existsSync(cpath + ext));
    check(pg.route + ' 注册的 ' + tag + ' 四件套齐全', missing.length === 0,
      (reg[tag]) + ' 缺 ' + missing.join(','));
    if (!missing.includes('.json')) {
      const cjson = JSON.parse(fs.readFileSync(cpath + '.json', 'utf8'));
      check(tag + ' 自身声明 component:true', cjson.component === true);
    }
  }
}

console.log('\n=========================================');
console.log('页面静态一致性结果：通过 ' + pass + ' / 失败 ' + failCnt);
if (failCnt > 0) {
  console.log('失败项：');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
console.log('ALL PASS ✅');
