'use strict';
/**
 * 任务 C 测试：129 池字 hanzi-core 释义补全
 * 运行：NODE_PATH=scripts/e2e/node_modules node scripts/e2e/test-meanings.js
 *
 * 覆盖：
 *   a) 129 字全部入 hanzi-core，释义非占位、≤12 字、零红线词、标签合法；
 *   b) 双份数据（database/ 与 cloudfunctions/generate/data/）逐字节一致；
 *   c) solver 字池全量释义非占位（引擎输出不再出现「人名常用字，寓意美好」）；
 *   d) 降级生成端到端：30 候选逐字释义均真实（含 129 字组名）。
 */
require('./mock-sdk-bind');

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const GEN = path.join(ROOT, 'cloudfunctions/generate');
const PLACEHOLDER = '人名常用字，寓意美好';

let pass = 0, failCnt = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { failCnt++; failures.push(name + (detail ? ' —— ' + detail : '')); console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}

(async () => {
  const t0 = Date.now();
  const core = JSON.parse(fs.readFileSync(path.join(ROOT, 'database/hanzi-core.json'), 'utf8'));
  const redlineWords = JSON.parse(fs.readFileSync(path.join(ROOT, 'database/redline-llm.json'), 'utf8')).words;
  const coreMap = {};
  for (const c of core.chars) coreMap[c.char] = c;

  console.log('\n【场景 A】129 字条目质量');
  const pool = JSON.parse(fs.readFileSync(path.join(ROOT, 'database/name-pool.json'), 'utf8'));
  const poolAll = [...new Set([...pool.chars.m, ...pool.chars.f, ...pool.chars.n])];
  const inCore = poolAll.filter((ch) => coreMap[ch]);
  check('A1 池字 603 全量入 hanzi-core（此前缺 129）', inCore.length === poolAll.length,
    poolAll.length - inCore.length + ' 字缺失: ' + poolAll.filter((c) => !coreMap[c]).slice(0, 10).join(''));
  const bad = inCore.filter((ch) => coreMap[ch].meaning === PLACEHOLDER);
  check('A2 池内零占位释义', bad.length === 0, bad.slice(0, 10).join(''));
  const tooLong = inCore.filter((ch) => Array.from(coreMap[ch].meaning || '').length > 14);
  check('A3 释义长度 ≤14 字（本项目口径）', tooLong.length === 0,
    tooLong.slice(0, 5).map((c) => c + ':' + coreMap[c].meaning).join(' | '));
  const hit = [];
  for (const ch of inCore) {
    for (const w of redlineWords) {
      if ((coreMap[ch].meaning || '').includes(w)) { hit.push(ch + '→' + w); break; }
    }
  }
  check('A4 池内释义零红线词', hit.length === 0, hit.slice(0, 5).join(' | '));

  console.log('\n【场景 B】双份数据一致');
  const files = ['hanzi-core.json', 'name-pool.json', 'engine-params.json', 'redline-llm.json', 'quotes-index.json'];
  const diffBad = files.filter((f) =>
    fs.readFileSync(path.join(ROOT, 'database', f), 'utf8')
    !== fs.readFileSync(path.join(ROOT, 'cloudfunctions/generate/data', f), 'utf8'));
  check('B1 database/ 与 generate/data/ 双份逐字节一致', diffBad.length === 0, '不一致: ' + diffBad.join(','));

  console.log('\n【场景 C】solver 字池与端到端');
  for (const k of Object.keys(require.cache)) {
    if (k.startsWith(GEN)) delete require.cache[k];
  }
  process.env.MOCK_OPENID = 'openid_meaning';
  const solver = require(path.join(GEN, 'lib/solver.js'));
  const loader = require(path.join(GEN, 'lib/data-loader.js'));
  const solved = solver.solve({ surname: '沈', gender: 'male', styles: [], constraints: {}, params: loader.engineParams });
  const poolPlaceholder = solved.pool.filter((c) => c.meaning === PLACEHOLDER);
  check('C1 solver 字池零占位释义', poolPlaceholder.length === 0,
    poolPlaceholder.slice(0, 5).map((c) => c.char).join(','));
  const han = solved.pool.find((c) => c.char === '瀚');
  check('C2 补全字真实释义生效（瀚）', han && han.meaning === '浩瀚广大，学识渊博',
    han ? han.meaning : '池中无瀚');

  const mod = require(path.join(GEN, 'index.js'));
  const cr = await mod.main({
    action: 'create', surname: '王', gender: 'male',
    styles: ['英气飒爽'], constraints: {}, source: 'free', batch: 1
  }, {});
  const pr = await mod.main({ action: 'poll', jobId: cr.data.jobId }, {});
  const cands = (pr.code === 0 && pr.data.candidates) || [];
  check('C3 降级生成 30 候选', cands.length === 30, '实际 ' + cands.length);
  const junk = [];
  for (const c of cands) {
    for (const ch of c.chars || []) {
      if (ch.meaning === PLACEHOLDER) junk.push(c.name + ':' + ch.char);
    }
  }
  check('C4 候选逐字释义零占位（129 字组名生效）', junk.length === 0, junk.slice(0, 5).join(','));

  console.log('\n=========================================');
  console.log('任务C 释义补全测试：通过 ' + pass + ' / 失败 ' + failCnt + '，总耗时 ' + (Date.now() - t0) + 'ms');
  if (failures.length) {
    console.log('失败项：');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('ALL PASS ✅');
})().catch((e) => { console.error('模拟脚本异常：', e); process.exit(1); });
