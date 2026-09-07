/**
 * build-strokes.js — 构建全量笔画/拼音/声调数据 hanzi-strokes.json
 *
 * 数据源：
 * - 笔画：Unihan kTotalStrokes（Unihan_IRGSources.txt，Unicode 官方，自由分发）；
 * - 拼音/声调：pinyin-pro（npm，MIT）。
 *
 * 覆盖范围：whitelist-8105.json 全部字（本批不做 CJK 扩展全集，注释中说明扩展方式）。
 *
 * 输出：database/hanzi-strokes.json —— { metadata, chars: { 字: { strokes, pinyin, tone } } }
 * tone 取值：0=轻声/未知，1=阴平，2=阳平，3=上声，4=去声。
 *
 * 用法：node build-strokes.js [unihan目录]
 * 依赖：pinyin-pro 安装于 /Users/karl/.workbuddy/binaries/node/workspace（构建机本地），
 *       通过 NODE_PATH 或绝对路径 require。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DB_DIR = path.join(PROJECT_ROOT, 'database');
const UNIHAN_DIR = process.argv[2] || '/tmp/hanzi-src';

/** pinyin-pro 安装位置（构建机本地工作区，脚本内绝对路径 require） */
const PINYIN_PRO_PATH = '/Users/karl/.workbuddy/binaries/node/workspace/node_modules/pinyin-pro';

function loadPinyinPro() {
  try {
    return require(PINYIN_PRO_PATH);
  } catch (e) {
    // 兜底：依赖 NODE_PATH
    return require('pinyin-pro');
  }
}

/** 带声调符号 → 数字声调（1-4），无声调符号返回 0 */
function toneNumber(pinyinWithTone) {
  const TONE_MAP = {
    'ā': 1, 'á': 2, 'ǎ': 3, 'à': 4,
    'ē': 1, 'é': 2, 'ě': 3, 'è': 4,
    'ī': 1, 'í': 2, 'ǐ': 3, 'ì': 4,
    'ō': 1, 'ó': 2, 'ǒ': 3, 'ò': 4,
    'ū': 1, 'ú': 2, 'ǔ': 3, 'ù': 4,
    'ǖ': 1, 'ǘ': 2, 'ǚ': 3, 'ǜ': 4
  };
  for (const ch of pinyinWithTone) {
    if (TONE_MAP[ch] !== undefined) return TONE_MAP[ch];
  }
  return 0;
}

/** 解析 Unihan 文件 → { 'U+4E00': strokes } */
function loadKTotalStrokes(unihanDir) {
  const file = path.join(unihanDir, 'Unihan_IRGSources.txt');
  if (!fs.existsSync(file)) {
    // kTotalStrokes 也可能单独成文件（不同版本），兜底全目录扫描
    return loadFieldFromAny(unihanDir, 'kTotalStrokes');
  }
  return parseField(file, 'kTotalStrokes');
}

/** 解析 Unihan 文件 → { 'U+4E00': radical }（kRSUnicode 首段 "部首.剩余笔画"） */
function loadKRSUnicode(unihanDir) {
  const file = path.join(unihanDir, 'Unihan_IRGSources.txt');
  if (!fs.existsSync(file)) {
    return loadFieldFromAny(unihanDir, 'kRSUnicode');
  }
  const map = parseField(file, 'kRSUnicode');
  // 只保留主部首号（radical.residual → radical）
  const radicals = {};
  for (const key of Object.keys(map)) {
    const first = String(map[key]).split(/\s+/)[0];
    radicals[key] = parseInt(first.split('.')[0], 10) || 0;
  }
  return radicals;
}

function parseField(filePath, fieldName) {
  const map = {};
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf(fieldName);
    if (idx === -1) continue;
    const parts = line.split('\t');
    if (parts.length < 3 || parts[1] !== fieldName) continue;
    map[parts[0]] = parts[2];
  }
  return map;
}

function loadFieldFromAny(unihanDir, fieldName) {
  const files = fs.readdirSync(unihanDir).filter((f) => f.startsWith('Unihan_') && f.endsWith('.txt'));
  for (const f of files) {
    const map = parseField(path.join(unihanDir, f), fieldName);
    if (Object.keys(map).length > 0) return map;
  }
  throw new Error('Unihan 数据中未找到字段 ' + fieldName);
}

function main() {
  const pinyinPro = loadPinyinPro();
  const whitelist = JSON.parse(fs.readFileSync(path.join(DB_DIR, 'whitelist-8105.json'), 'utf8'));
  const strokesMap = loadKTotalStrokes(UNIHAN_DIR);

  const chars = {};
  let missingStrokes = 0;
  let missingPinyin = 0;

  for (const item of whitelist.chars) {
    const ch = item.char;
    const key = item.unicode;

    // 笔画：Unihan kTotalStrokes
    let strokes = parseInt(strokesMap[key], 10);
    if (!strokes || strokes <= 0) {
      strokes = 0;
      missingStrokes++;
    }

    // 拼音（带声调）+ 数字声调
    const py = pinyinPro.pinyin(ch, { toneType: 'symbol', type: 'string', multiple: false });
    const clean = (py || '').trim();
    let tone = 0;
    if (clean && clean.length > 0) {
      tone = toneNumber(clean);
    } else {
      missingPinyin++;
    }

    chars[ch] = { strokes: strokes, pinyin: clean, tone: tone };
  }

  const output = {
    metadata: {
      name: '汉字笔画/拼音/声调数据',
      version: 'Unihan 16.0 kTotalStrokes + pinyin-pro 3.x，构建于 ' + new Date().toISOString().slice(0, 10),
      source: 'Unicode Unihan Database（kTotalStrokes，自由分发）+ npm:pinyin-pro（MIT）',
      total: Object.keys(chars).length,
      coverage: 'whitelist-8105 全量',
      missingStrokes: missingStrokes,
      missingPinyin: missingPinyin,
      note: '本批仅覆盖白名单 8105 字；如需扩展至 CJK 基本区全集，修改本脚本输入源即可'
    },
    chars: chars
  };

  fs.writeFileSync(path.join(DB_DIR, 'hanzi-strokes.json'), JSON.stringify(output, null, 0), 'utf8');
  console.log('[build-strokes] 完成：' + Object.keys(chars).length + ' 字 → hanzi-strokes.json');
  console.log('  缺笔画：' + missingStrokes + '，缺拼音：' + missingPinyin);
}

main();
