'use strict';
/**
 * 候选字库测试（pages/chars 数据链路）
 * 覆盖：listChars action 接线 / 分组定义完备（18 标签恰一分组）/ 字池全覆盖 /
 *       字段齐备与合法值域 / 分组派生一致性 / 排序确定性 / 释义红线零命中 /
 *       无内部字段外泄 / 热门冷门数据健全性。
 * 运行：NODE_PATH=scripts/e2e/node_modules node scripts/e2e/test-chars.js
 */
const path = require('path');
require('./mock-sdk-bind');

const ROOT = path.resolve(__dirname, '../..');
const GEN = path.join(ROOT, 'cloudfunctions', 'generate');

let pass = 0, failCnt = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { failCnt++; failures.push(name + (detail ? ' —— ' + detail : '')); console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}

const loader = require(path.join(GEN, 'lib', 'data-loader.js'));
const charBoard = require(path.join(GEN, 'lib', 'char-board.js'));
const redlineWords = require(path.join(ROOT, 'database', 'redline-llm.json')).words;

async function main() {
  const t0 = Date.now();
  console.log('\n[1] generate.listChars action 接线');
  const gen = require(path.join(GEN, 'index.js'));
  const r = await gen.main({ action: 'listChars' }, {});
  check('1a listChars code=0', r.code === 0, JSON.stringify(r).slice(0, 120));
  const board = (r.data && r.data.board) || r.data || {};
  const groups = board.groups || [];
  const chars = board.chars || [];
  check('1b 返回 groups 与 chars', groups.length === 6 && chars.length > 500,
    'groups=' + groups.length + ' chars=' + chars.length);

  console.log('\n[2] 分组定义完备性');
  const TAG_VOCAB = ['品德', '文采', '自然', '水泽', '草木', '山岳', '光亮', '美玉', '心性', '刚毅',
    '温柔', '灵动', '高远', '丰茂', '言信', '音律', '力量', '家宅'];
  const flat = groups.flatMap((g) => g.tags);
  check('2a 6 组标签并集 = tagVocab 18 类', TAG_VOCAB.every((t) => flat.indexOf(t) !== -1) && flat.length === 18,
    '实际 ' + flat.length + ' 类');
  check('2b 标签跨组不重复（每标签恰属一组）', new Set(flat).size === flat.length);
  check('2c 组字段齐备（key/label/desc/tags）',
    groups.every((g) => g.key && g.label && g.desc && Array.isArray(g.tags) && g.tags.length === 3));

  console.log('\n[3] 字池覆盖与字段');
  const poolSet = new Set([
    ...loader.namePool.chars.m, ...loader.namePool.chars.f, ...loader.namePool.chars.n
  ]);
  const gotSet = new Set(chars.map((c) => c.char));
  check('3a chars = 字池全集（' + poolSet.size + ' 字）',
    poolSet.size === gotSet.size && [...poolSet].every((c) => gotSet.has(c)),
    '池 ' + poolSet.size + ' / 板 ' + gotSet.size);
  check('3b 每字字段齐备（char/pinyin/strokes/meaning/freqLevel/gender）',
    chars.every((c) => c.char && typeof c.pinyin === 'string' && c.pinyin
      && typeof c.strokes === 'number' && c.strokes > 0
      && typeof c.meaning === 'string' && c.meaning));
  check('3c freqLevel 值域合法', chars.every((c) => ['high', 'mid', 'low'].indexOf(c.freqLevel) !== -1));
  check('3d gender 值域合法', chars.every((c) => ['m', 'f', 'n'].indexOf(c.gender) !== -1));

  console.log('\n[4] 分组派生一致性');
  const groupKeys = new Set(groups.map((g) => g.key));
  const tagToGroup = {};
  for (const g of groups) for (const t of g.tags) tagToGroup[t] = g.key;
  check('4a groups ⊆ 6 组 key', chars.every((c) => (c.groups || []).every((k) => groupKeys.has(k))));
  let mismatch = null;
  for (const c of chars) {
    const expect = [...new Set((c.tags || []).map((t) => tagToGroup[t]).filter(Boolean))];
    const got = c.groups || [];
    if (expect.length !== got.length || !expect.every((k) => got.indexOf(k) !== -1)) {
      mismatch = c.char; break;
    }
  }
  check('4b 每字 groups 由 tags 正确派生（全量校验）', mismatch === null, '首例 ' + mismatch);
  const inAnyGroup = chars.filter((c) => (c.groups || []).length > 0).length;
  check('4c 有标签字均落入至少一组（≥95%）', inAnyGroup >= chars.length * 0.95,
    inAnyGroup + '/' + chars.length);

  console.log('\n[5] 排序 / 热度 / 红线 / 脱敏');
  const RANK = { high: 0, mid: 1, low: 2 };
  let sortedOk = true;
  for (let i = 1; i < chars.length; i++) {
    if (RANK[chars[i - 1].freqLevel] > RANK[chars[i].freqLevel]) { sortedOk = false; break; }
  }
  check('5a 热门在前（freqRank 单调不减）', sortedOk);
  const highCnt = chars.filter((c) => c.freqLevel === 'high').length;
  const lowCnt = chars.filter((c) => c.freqLevel === 'low').length;
  check('5b 热门/冷门数据健全（high≥150、low≥10）', highCnt >= 150 && lowCnt >= 10,
    'high=' + highCnt + ' low=' + lowCnt);
  const redHit = [];
  for (const c of chars) {
    for (const w of redlineWords) {
      if (w.length > 1 && ((c.meaning || '').includes(w) || (c.tags || []).join('').includes(w))) {
        redHit.push(c.char + ':' + w);
      }
    }
  }
  check('5c 释义/标签红线零命中', redHit.length === 0, redHit.slice(0, 5).join(','));
  const s = JSON.stringify(board);
  check('5d 无内部字段外泄', !/score|_openid|jobId|quoteRef/i.test(s));

  console.log('\n[6] 装配确定性');
  // 清模块缓存重载，跨实例构建应完全一致
  for (const k of Object.keys(require.cache)) {
    if (k.includes(path.join('lib', 'char-board.js'))) delete require.cache[k];
  }
  const charBoard2 = require(path.join(GEN, 'lib', 'char-board.js'));
  const again = charBoard2.buildBoard(loader);
  check('6a 跨实例构建完全一致', JSON.stringify(again) === JSON.stringify(board));

  console.log('\n=========================================');
  console.log('候选字库测试结果：通过 ' + pass + ' / 失败 ' + failCnt + '，总耗时 ' + (Date.now() - t0) + 'ms');
  if (failCnt > 0) {
    console.log('失败项：');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('ALL PASS ✅');
}

main().catch((e) => { console.error('测试脚本异常：', e); process.exit(1); });
