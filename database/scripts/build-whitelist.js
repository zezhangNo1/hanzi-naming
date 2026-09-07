/**
 * build-whitelist.js — 构建《通用规范汉字表》8105 字白名单
 *
 * 数据源（优先级从高到低）：
 * 1. 本地已下载的 level-1/2/3.txt（jsDelivr 镜像 txwdzxq/common-standard-chinese-characters-table，
 *    对应教育部 2013 年《通用规范汉字表》：一级 3500 + 二级 3000 + 三级 1605 = 8105 字）；
 * 2. 兜底：npm 包 togscc（jaywcjlove/table-of-general-standard-chinese-characters）。
 *
 * 输出：database/whitelist-8105.json —— { metadata, chars: [{ char, unicode }] }
 *
 * 用法：node build-whitelist.js [源目录]，源目录默认 ../hanzi-src-cache（脚本同级）。
 *       源文件不存在时自动尝试 npm 兜底源（需 NODE_PATH 指向含 node_modules 的目录）。
 */
'use strict';

const fs = require('fs');
const path = require('path');

/** 项目根（database/scripts 的上两级） */
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
/** 输出文件路径 */
const OUT_PATH = path.join(PROJECT_ROOT, 'database', 'whitelist-8105.json');

/** 默认源文件目录（构建时用临时缓存目录） */
const DEFAULT_SRC_DIR = process.argv[2] || '/tmp/hanzi-src';

/** 三个等级文件与对应级别标注 */
const LEVEL_FILES = [
  { file: 'level-1.txt', level: 1, count: 3500, desc: '一级字表（常用字 3500）' },
  { file: 'level-2.txt', level: 2, count: 3000, desc: '二级字表（3000）' },
  { file: 'level-3.txt', level: 3, count: 1605, desc: '三级字表（人名地名等 1605）' }
];

/** 汉字 → Unicode 码位字符串（如 "U+4E00"） */
function toUnicode(ch) {
  const cp = ch.codePointAt(0);
  return 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
}

/** 方案 A：从本地 level 文件读取 */
function loadFromLevelFiles(srcDir) {
  const seen = new Set();
  const chars = [];
  const sourceLevels = [];
  for (const item of LEVEL_FILES) {
    const filePath = path.join(srcDir, item.file);
    if (!fs.existsSync(filePath)) {
      throw new Error('缺少源文件：' + filePath);
    }
    const text = fs.readFileSync(filePath, 'utf8');
    let count = 0;
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      // 每行可能含注释或空格分隔的额外信息，仅取首个汉字字符
      const ch = Array.from(line).find((c) => c.codePointAt(0) >= 0x3400);
      if (!ch) continue;
      if (seen.has(ch)) continue;
      seen.add(ch);
      chars.push({ char: ch, unicode: toUnicode(ch) });
      count++;
    }
    sourceLevels.push({ level: item.level, desc: item.desc, count: count });
  }
  return { chars: chars, sourceLevels: sourceLevels };
}

/** 方案 B（兜底）：npm 包 togscc 的 characters.json */
function loadFromTogscc() {
  let data;
  try {
    // eslint-disable-next-line global-require
    data = require('togscc/data/characters.json');
  } catch (e) {
    throw new Error('无法加载 togscc 包，请先安装或提供 level 源文件：' + e.message);
  }
  if (!Array.isArray(data)) {
    throw new Error('togscc characters.json 格式异常');
  }
  const seen = new Set();
  const chars = [];
  for (const ch of data) {
    if (typeof ch !== 'string' || ch.length !== 1 || seen.has(ch)) continue;
    seen.add(ch);
    chars.push({ char: ch, unicode: toUnicode(ch) });
  }
  return { chars: chars, sourceLevels: null };
}

function main() {
  let result;
  let source;
  try {
    result = loadFromLevelFiles(DEFAULT_SRC_DIR);
    source = 'txwdzxq/common-standard-chinese-characters-table（教育部 2013《通用规范汉字表》开源镜像）';
  } catch (e) {
    console.warn('[build-whitelist] 本地源缺失，转用 togscc 兜底：', e.message);
    result = loadFromTogscc();
    source = 'npm:togscc（jaywcjlove/table-of-general-standard-chinese-characters，MIT）';
  }

  // 去重校验与字数校验
  const total = result.chars.length;
  if (total < 8000) {
    throw new Error('白名单字数不足 8000（实际 ' + total + '），中止输出');
  }

  const output = {
    metadata: {
      name: '通用规范汉字表白名单',
      version: '2013 官方表 / 构建于 ' + new Date().toISOString().slice(0, 10),
      source: source,
      total: total,
      levels: result.sourceLevels,
      note: total === 8105
        ? '与官方 8105 字一致'
        : '⚠️ 字数 ' + total + ' ≠ 8105，请核对数据源后重建'
    },
    chars: result.chars
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 0), 'utf8');
  console.log('[build-whitelist] 完成：' + total + ' 字 → ' + OUT_PATH);
  if (result.sourceLevels) {
    for (const lv of result.sourceLevels) {
      console.log('  ' + lv.desc + '：' + lv.count + ' 字');
    }
  }
}

main();
