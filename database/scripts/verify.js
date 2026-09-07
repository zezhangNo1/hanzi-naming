/**
 * verify.js — database/ 数据自检（B2 批次验收辅助）
 *
 * 检查项：
 * 1. 全部 JSON 文件可被 JSON.parse（合法性）；
 * 2. 白名单 8105 字（±容差标注）、无重复；
 * 3. hanzi-strokes 覆盖白名单全量，tone ∈ {0,1,2,3,4}；
 * 4. hanzi-core 字数 ∈ [1200, 3000]、全字 ∈ 白名单、imageryTags ∈ 标签域、
 *    freqLevel ∈ {low, mid, high}、meaning 非空；
 * 5. redline-llm.json 与 PRD 3.2 权威 31 词逐词 diff 一致；
 * 6. engine-params.json 的 8 风格权重表键与前端风格词表一致。
 *
 * 用法：node verify.js；全部通过退出码 0（"全绿"），任一失败退出码 1。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DB_DIR = path.resolve(__dirname, '..');

/** PRD 3.2 权威红线词（31 词，逐字硬编码防两份都抄错） */
const PRD_REDLINE_WORDS = [
  '吉', '凶', '数理', '三才', '五格', '命格', '命局', '喜用神', '日主',
  '五行缺', '补缺', '卦象', '宜忌', '冲克', '运势', '打分', '评分',
  '总分', '评级', '星级', '测算', '算命', '占卜', '改运', '化解',
  '招财', '克父', '克母', '犯太岁', '开光', '灵符', '转运', '注定'
];

/** PRD 定义的 8 风格 */
const PRD_STYLES = ['古风雅致', '温柔诗意', '阳光开朗', '英气飒爽', '中性大方', '诗意江南', '典籍感', '自然清新'];

/** 结果收集 */
const results = [];
let failed = 0;

function check(name, ok, detail) {
  results.push({ name: name, ok: ok, detail: detail || '' });
  if (!ok) failed++;
}

function loadJson(fileName) {
  const filePath = path.join(DB_DIR, fileName);
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    check('JSON 合法性: ' + fileName, true);
    return data;
  } catch (e) {
    check('JSON 合法性: ' + fileName, false, e.message);
    return null;
  }
}

function main() {
  // ---- 1. 白名单 ----
  const whitelist = loadJson('whitelist-8105.json');
  if (whitelist) {
    const chars = whitelist.chars.map((c) => c.char);
    const unique = new Set(chars);
    check('白名单字数 = 8105', chars.length === 8105, '实际 ' + chars.length);
    check('白名单无重复字', unique.size === chars.length, '去重后 ' + unique.size);
  }

  // ---- 2. 笔画/拼音 ----
  const strokes = loadJson('hanzi-strokes.json');
  if (strokes && whitelist) {
    const keys = Object.keys(strokes.chars);
    const wlSet = new Set(whitelist.chars.map((c) => c.char));
    const missing = wlSet && Array.from(wlSet).filter((c) => !strokes.chars[c]);
    check('hanzi-strokes 覆盖白名单全量', missing.length === 0, '缺失 ' + missing.length + ' 字');
    const badTone = keys.filter((c) => ![0, 1, 2, 3, 4].includes(strokes.chars[c].tone));
    check('tone 全部合法(0-4)', badTone.length === 0, '异常 ' + badTone.length + ' 字');
  }

  // ---- 3. 精选字库 ----
  const core = loadJson('hanzi-core.json');
  if (core && whitelist) {
    const n = core.chars.length;
    check('hanzi-core 字数 ∈ [1200, 3000]', n >= 1200 && n <= 3000, '实际 ' + n);
    const wlSet = new Set(whitelist.chars.map((c) => c.char));
    const outOfWl = core.chars.filter((c) => !wlSet.has(c.char));
    check('hanzi-core 全字 ∈ 白名单', outOfWl.length === 0, '越界 ' + outOfWl.length + ' 字');
    const badFreq = core.chars.filter((c) => !['low', 'mid', 'high'].includes(c.freqLevel));
    check('freqLevel ∈ low|mid|high', badFreq.length === 0, '异常 ' + badFreq.length + ' 字');
    const badTag = core.chars.filter((c) => !Array.isArray(c.imageryTags) || c.imageryTags.length < 1
      || c.imageryTags.some((t) => !core.metadata.tagVocab.includes(t)));
    check('imageryTags ∈ 标签域且非空', badTag.length === 0, '异常 ' + badTag.length + ' 字');
    const emptyMeaning = core.chars.filter((c) => !c.meaning || c.meaning.length === 0);
    check('meaning 非空', emptyMeaning.length === 0, '空释义 ' + emptyMeaning.length + ' 字');
    const isRough = String(core.metadata.version).indexOf('粗标 v0') !== -1;
    check('metadata 标注「粗标 v0」', isRough);
  }

  // ---- 4. 红线词表与 PRD diff ----
  const redline = loadJson('redline-llm.json');
  if (redline) {
    const a = redline.words.slice().sort().join('|');
    const b = PRD_REDLINE_WORDS.slice().sort().join('|');
    check('redline-llm 与 PRD 3.2 逐词一致（31 词 diff 为空）', a === b,
      a === b ? '' : '不一致：' + diffWords(PRD_REDLINE_WORDS, redline.words));
  }
  const redlineUi = loadJson('redline-ui.json');
  if (redlineUi) {
    check('redline-ui 包含 llm 表全部词', PRD_REDLINE_WORDS.every((w) => redlineUi.words.includes(w)));
  }

  // ---- 5. 引擎参数 ----
  const params = loadJson('engine-params.json');
  if (params) {
    const styleKeys = Object.keys(params.styles.weights).sort().join('|');
    check('engine-params 8 风格与 PRD 一致', styleKeys === PRD_STYLES.slice().sort().join('|'), styleKeys);
    check('generate.topN = 30', params.generate.topN === 30);
  }

  // ---- 输出 ----
  console.log('========== database/ verify.js ==========');
  for (const r of results) {
    console.log((r.ok ? '  ✅ ' : '  ❌ ') + r.name + (r.detail ? ' —— ' + r.detail : ''));
  }
  console.log('=========================================');
  console.log(failed === 0 ? 'verify 全绿 ✅' : 'verify 失败 ' + failed + ' 项 ❌');
  process.exit(failed === 0 ? 0 : 1);
}

/** 找出两词表差异（多/少） */
function diffWords(expected, actual) {
  const missing = expected.filter((w) => !actual.includes(w));
  const extra = actual.filter((w) => !expected.includes(w));
  return '缺少 ' + JSON.stringify(missing) + '，多余 ' + JSON.stringify(extra);
}

main();
