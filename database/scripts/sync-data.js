/**
 * sync-data.js — 将 database/ 下云函数所需数据同步到 cloudfunctions/generate/data/
 *
 * 背景：微信云函数按目录整包上传，运行时无法读取仓库其他目录。
 * 本脚本把规则引擎所需数据文件拷贝到 generate 函数目录内（数据体积 <1MB，远低于云函数包限制）。
 * 数据更新后需重跑：node sync-data.js（后续 B3 可挂 CI）。
 *
 * 同步清单：whitelist-8105.json / hanzi-core.json / hanzi-strokes.json /
 *           redline-llm.json / engine-params.json
 */
'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DB_DIR = path.join(PROJECT_ROOT, 'database');
const OUT_DIR = path.join(PROJECT_ROOT, 'cloudfunctions', 'generate', 'data');

const FILES = [
  'whitelist-8105.json',
  'hanzi-core.json',
  'hanzi-strokes.json',
  'redline-llm.json',
  'engine-params.json'
];

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let total = 0;
  for (const name of FILES) {
    const src = path.join(DB_DIR, name);
    const dst = path.join(OUT_DIR, name);
    fs.copyFileSync(src, dst);
    const size = fs.statSync(dst).size;
    total += size;
    console.log('[sync-data] ' + name + ' → ' + (size / 1024).toFixed(1) + ' KB');
  }
  console.log('[sync-data] 完成，共 ' + (total / 1024 / 1024).toFixed(2) + ' MB（<15MB 无需拆分）');
}

main();
