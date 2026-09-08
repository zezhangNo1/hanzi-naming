'use strict';
/**
 * test-quality-qa.js — QA 独立终审实验（Edward，不改任何源码）
 * 运行：NODE_PATH=scripts/e2e/node_modules node scripts/e2e/test-quality-qa.js
 *
 * 覆盖（独立于 test-quality.js 的口径）：
 *  [A] 多样性矩阵：李/王/林 × male/female × 有风格/无风格 × batch 1-3
 *      单批：候选数=30、名首字去重 ≥10、任一字 ≤4、任一首字 ≤3
 *      批间：同 seed 跨批重名 =0（机制验证）+ Math.random 生产条件 20 轮分布
 *  [B] 确定性：同 seeded rng + 同输入 → 两次生成 JSON 逐字段一致（含 batch>1）
 *  [C] 扰动：5 个随机种子合并唯一名数
 *  [D] 大批次护栏：batch=50/118/119/200 候选数与去重情况（找 exclusion Set 边界）
 *  [E] 字池独立校验：603 字 ⊆ 白名单 / 0 命中黑名单 / cats ⊆ tagVocab / cats 键 ⊆ 字池
 *      + 随机抽 40 字打印供人工核验
 *  [F] 规模偏差复核：hanzi-core 未入池的女性向字存量统计
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const GEN = path.join(ROOT, 'cloudfunctions', 'generate');
const DB = path.join(ROOT, 'database') + path.sep;

const solver = require(path.join(GEN, 'lib', 'solver.js'));
const engine = require(path.join(GEN, 'lib', 'engine', 'generate.js'));
const loader = require(path.join(GEN, 'lib', 'data-loader.js'));

const whitelistDoc = JSON.parse(fs.readFileSync(DB + 'whitelist-8105.json', 'utf8'));
const whitelist = new Set(whitelistDoc.chars.map((c) => c.char));
const coreDoc = JSON.parse(fs.readFileSync(DB + 'hanzi-core.json', 'utf8'));
const coreByChar = {};
for (const c of coreDoc.chars) coreByChar[c.char] = c;
const blockDoc = JSON.parse(fs.readFileSync(DB + 'name-blocklist.json', 'utf8'));
const blockSet = new Set();
for (const k of Object.keys(blockDoc.chars || {})) {
  const v = blockDoc.chars[k];
  (Array.isArray(v) ? v : Object.keys(v)).forEach((c) => blockSet.add(c));
}
const poolDoc = JSON.parse(fs.readFileSync(DB + 'name-pool.json', 'utf8'));

let pass = 0, failCnt = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { failCnt++; failures.push(name + (detail ? ' —— ' + detail : '')); console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}
function info(msg) { console.log('  ℹ️ ' + msg); }

function mulberry32(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function runEngine(opts) {
  const input = {
    surname: opts.surname,
    gender: opts.gender,
    styles: opts.styles || [],
    constraints: opts.constraints || {},
    params: loader.engineParams,
    batch: opts.batch || 1
  };
  const solved = solver.solve({
    surname: input.surname, gender: input.gender, styles: input.styles,
    constraints: input.constraints, params: input.params
  });
  input.pool = solved.pool;
  input.surnameMeta = solved.surnameMeta;
  if (opts.rng) input.rng = opts.rng;
  return engine.generate(input);
}

// ===== [A] 多样性矩阵 =====
console.log('\n[A] 多样性矩阵（3 姓 × 2 性别 × 风格有无 × batch1-3）');
{
  const surnames = ['李', '王', '林'];
  const genders = ['male', 'female'];
  const styleSets = [['温柔诗意'], []];
  let batchStats = [];
  for (const surname of surnames) {
    for (const gender of genders) {
      for (const styles of styleSets) {
        const label = surname + '/' + gender + '/' + (styles[0] || '不限');
        const perBatchNames = [];
        for (let batch = 1; batch <= 3; batch++) {
          // 每批独立同 seed（模拟「同种子可复现」口径下的跨批机制）
          const r = runEngine({ surname, gender, styles, batch, rng: mulberry32(1000 + batch) });
          const cands = r.candidates;
          check(label + ' b' + batch + ' 候选数=30', cands.length === 30, '实际 ' + cands.length);
          const firstChars = new Set(cands.map((x) => x.name[1]));
          check(label + ' b' + batch + ' 名首字去重 ≥10', firstChars.size >= 10, '实际 ' + firstChars.size);
          const charCnt = {};
          const firstCnt = {};
          for (const x of cands) {
            firstCnt[x.name[1]] = (firstCnt[x.name[1]] || 0) + 1;
            for (let i = 1; i < x.name.length; i++) charCnt[x.name[i]] = (charCnt[x.name[i]] || 0) + 1;
          }
          const over = Object.entries(charCnt).filter(([, n]) => n > 4);
          check(label + ' b' + batch + ' 任一字 ≤4', over.length === 0, over.map(([c, n]) => c + '×' + n).join(','));
          const overFirst = Object.entries(firstCnt).filter(([, n]) => n > 3);
          check(label + ' b' + batch + ' 任一首字 ≤3', overFirst.length === 0, overFirst.map(([c, n]) => c + '×' + n).join(','));
          perBatchNames.push(new Set(cands.map((x) => x.name)));
        }
        // 批间：Math.random 生产条件口径（与 e2e B4/test-quality [4] 一致）。
        // 已知该口径受 jitter 影响，机制本身（同 seed）在 [A2] 验证为 0 重名；
        // 此处对 12 组取均值做硬断言，单组波动作为分布样本输出。
        const b1 = new Set(runEngine({ surname, gender, styles, batch: 1 }).candidates.map((x) => x.name));
        const b2 = new Set(runEngine({ surname, gender, styles, batch: 2 }).candidates.map((x) => x.name));
        let ov = 0;
        for (const n of b1) if (b2.has(n)) ov++;
        batchStats.push(ov);
        info(label + ' 批1vs批2(Math.random) 重名 ' + ov + '/30');
      }
    }
  }
  const mean = batchStats.reduce((a, b) => a + b, 0) / batchStats.length;
  info('Math.random 批1vs批2 重名样本（12 组）: ' + batchStats.join(',') + ' /30，均值 ' + mean.toFixed(1));
  check('12 组 Math.random 跨批重名均值 <6（20% 红线）', mean < 6, '实际 ' + mean.toFixed(1));
}

// 机制验证：同 seed 跨批（同输入同 jitter 序列 → exclusion Set 精确命中）
console.log('\n[A2] 批间去重机制验证（同 seed，应完全不相交）');
{
  const b1 = new Set(runEngine({ surname: '沈', gender: 'female', styles: ['温柔诗意'], batch: 1, rng: mulberry32(7) }).candidates.map((x) => x.name));
  const b2 = new Set(runEngine({ surname: '沈', gender: 'female', styles: ['温柔诗意'], batch: 2, rng: mulberry32(7) }).candidates.map((x) => x.name));
  let ov = 0;
  for (const n of b1) if (b2.has(n)) ov++;
  check('同 seed 批1 vs 批2 重名 =0', ov === 0, '实际 ' + ov);
  const b3 = new Set(runEngine({ surname: '沈', gender: 'female', styles: ['温柔诗意'], batch: 3, rng: mulberry32(7) }).candidates.map((x) => x.name));
  let ov13 = 0, ov23 = 0;
  for (const n of b1) if (b3.has(n)) ov13++;
  for (const n of b2) if (b3.has(n)) ov23++;
  check('同 seed 批1 vs 批3 重名 =0', ov13 === 0, '实际 ' + ov13);
  check('同 seed 批2 vs 批3 重名 =0', ov23 === 0, '实际 ' + ov23);
}

// Math.random 生产条件分布（20 轮，量化抖动导致的失效概率）
console.log('\n[A3] Math.random 跨批重名分布（20 轮，量化 flakiness）');
{
  let over = 0, ge6 = 0;
  const samples = [];
  for (let i = 0; i < 20; i++) {
    const b1 = new Set(runEngine({ surname: '沈', gender: 'female', styles: ['温柔诗意'], batch: 1 }).candidates.map((x) => x.name));
    const b2 = new Set(runEngine({ surname: '沈', gender: 'female', styles: ['温柔诗意'], batch: 2 }).candidates.map((x) => x.name));
    let ov = 0;
    for (const n of b1) if (b2.has(n)) ov++;
    samples.push(ov);
    over += ov;
    if (ov >= 6) ge6++;
  }
  info('20 轮重名数: ' + samples.join(',') + '；均值 ' + (over / 20).toFixed(1) + '；≥6（超 20% 红线）轮数 ' + ge6);
  check('[A3] 20 轮中超 20% 红线轮数 ≤4（实测失效率约 10%）', ge6 <= 4, '实际 ' + ge6);
}

// ===== [B] 确定性 =====
console.log('\n[B] 确定性（seeded RNG 两次逐字段一致）');
{
  for (const batch of [1, 2, 5]) {
    const opts = { surname: '王', gender: 'female', styles: ['古风雅致'], batch, rng: mulberry32(99) };
    const a = runEngine(opts);
    const b = runEngine(Object.assign({}, opts, { rng: mulberry32(99) }));
    check('batch=' + batch + ' 同 seed 两次 JSON 一致', JSON.stringify(a) === JSON.stringify(b));
  }
  const d1 = runEngine({ surname: '王', gender: 'female', constraints: { generationChar: '承' }, batch: 2, rng: mulberry32(55) });
  const d2 = runEngine({ surname: '王', gender: 'female', constraints: { generationChar: '承' }, batch: 2, rng: mulberry32(55) });
  check('字辈场景 batch=2 同 seed 两次一致', JSON.stringify(d1) === JSON.stringify(d2));
}

// ===== [C] 扰动有效性 =====
console.log('\n[C] 扰动有效性（5 个随机种子 / Math.random，3 组场景）');
{
  const cases = [
    { surname: '李', gender: 'male', styles: ['英气飒爽'] },
    { surname: '沈', gender: 'female', styles: ['温柔诗意'] },
    { surname: '王', gender: 'female', styles: [] }
  ];
  for (const c of cases) {
    const label = c.surname + '/' + c.gender + '/' + (c.styles[0] || '不限');
    const seedNames = new Set();
    for (const seed of [11, 22, 33, 44, 55]) {
      const r = runEngine(Object.assign({}, c, { rng: mulberry32(seed) }));
      for (const x of r.candidates) seedNames.add(x.name);
    }
    check(label + ' 5 种子合并唯一名数 ≥70', seedNames.size >= 70, '实际 ' + seedNames.size);
    const mrNames = new Set();
    for (let i = 0; i < 5; i++) {
      const r = runEngine(c); // Math.random
      for (const x of r.candidates) mrNames.add(x.name);
    }
    check(label + ' Math.random 5 次合并唯一名数 ≥70', mrNames.size >= 70, '实际 ' + mrNames.size);
    info(label + ' 唯一名数: seeds=' + seedNames.size + ' mathrandom=' + mrNames.size
      + '（工程师 80 目标：男性池实测 72-83，边际偏薄）');
  }
}

// ===== [D] 大批次护栏 =====
console.log('\n[D] 大批次护栏（exclusion Set 边界）');
{
  // 现实范围契约：batch 2..20 每批恒 30
  let all30 = true, detail = [];
  for (let b = 2; b <= 20; b++) {
    const r = runEngine({ surname: '沈', gender: 'female', styles: ['温柔诗意'], batch: b, rng: mulberry32(b) });
    if (r.candidates.length !== 30) { all30 = false; detail.push('batch=' + b + '→' + r.candidates.length); }
  }
  check('batch 2..20 每批候选数恒 =30（同 seed）', all30, detail.join(','));
  // 大批次衰减画像（已知问题，信息项）
  for (const batch of [100, 110, 118, 119, 200]) {
    const t0 = Date.now();
    const r = runEngine({ surname: '沈', gender: 'female', styles: ['温柔诗意'], batch });
    info('batch=' + batch + ' → 候选数 ' + r.candidates.length + '（' + (Date.now() - t0) + 'ms，poolSize=' + r.poolSize + '）');
  }
}

// ===== [E] 字池独立校验 + 抽样 =====
console.log('\n[E] 字池独立校验（v0.3）');
{
  const all = [...poolDoc.chars.m, ...poolDoc.chars.f, ...poolDoc.chars.n];
  check('字池总量 =603', all.length === 603, '实际 ' + all.length);
  check('字池无重复', new Set(all).size === all.length);
  const notWl = all.filter((c) => !whitelist.has(c));
  check('字池 ⊆ 白名单 8105', notWl.length === 0, notWl.slice(0, 10).join(','));
  const hitBl = all.filter((c) => blockSet.has(c));
  check('字池 0 命中黑名单', hitBl.length === 0, hitBl.slice(0, 10).join(','));

  const VOCAB = ['品德', '文采', '自然', '水泽', '草木', '山岳', '光亮', '美玉', '心性', '刚毅',
    '温柔', '灵动', '高远', '丰茂', '言信', '音律', '力量', '家宅'];
  const cats = poolDoc.cats || {};
  const badTags = [];
  for (const [ch, tags] of Object.entries(cats)) {
    if (!Array.isArray(tags) || tags.length === 0 || !tags.every((t) => VOCAB.includes(t))) badTags.push(ch);
  }
  check('cats 标签 ⊆ tagVocab 18 类（335 字）', Object.keys(cats).length === 335 && badTags.length === 0,
    'cats=' + Object.keys(cats).length + ' 违规:' + badTags.slice(0, 5).join(','));
  const catsNotInPool = Object.keys(cats).filter((c) => !all.includes(c));
  check('cats 键 ⊆ 字池', catsNotInPool.length === 0, catsNotInPool.slice(0, 5).join(','));

  // cats 与 m/f/n 分组交叉合理性粗查：f 组字不应被精标为刚毅/力量（允许少量中性）
  const fSet = new Set(poolDoc.chars.f);
  const fMasc = Object.entries(cats).filter(([ch, tags]) => fSet.has(ch) && tags.includes('刚毅'));
  info('f 组被标「刚毅」的字数: ' + fMasc.length + (fMasc.length ? '（' + fMasc.map(([c]) => c).join('') + '）' : ''));

  // 随机抽 40 字人工核验
  const shuffled = all.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const sample40 = shuffled.slice(0, 40);
  console.log('\n  —— 随机抽 40 字（人工核验：真实汉字/适合入名/无不雅）——');
  const lines = [];
  for (let i = 0; i < 40; i += 8) {
    lines.push('    ' + sample40.slice(i, i + 8).map((ch) => {
      const g = poolDoc.chars.m.includes(ch) ? 'm' : (poolDoc.chars.f.includes(ch) ? 'f' : 'n');
      const t = (cats[ch] || []).join('/');
      return ch + '(' + g + (t ? ':' + t : '') + ')';
    }).join(' '));
  }
  console.log(lines.join('\n'));
  const noMeaning = sample40.filter((ch) => { const meta = coreByChar[ch]; return !meta || !meta.meaning; });
  info('抽样 40 字中缺 hanzi-core 释义的字数: ' + noMeaning.length + (noMeaning.length ? '（' + noMeaning.join('') + '）' : ''));
}

// ===== [F] 规模偏差复核：hanzi-core 未入池女性向字存量 =====
console.log('\n[F] hanzi-core 未入池女性向字存量（验证「女性字耗尽」说法）');
{
  const all = new Set([...poolDoc.chars.m, ...poolDoc.chars.f, ...poolDoc.chars.n]);
  // 女性向口径：hanzi-core 粗标含 温柔/草木/水泽/美玉/灵动 任一标签的字
  const femTags = new Set(['温柔', '草木', '水泽', '美玉', '灵动']);
  const leftover = coreDoc.chars.filter((c) => !all.has(c.char)
    && (c.imageryTags || []).some((t) => femTags.has(t)));
  info('未入池且粗标含女性向标签的字共 ' + leftover.length + ' 个:');
  for (let i = 0; i < leftover.length; i += 20) {
    console.log('    ' + leftover.slice(i, i + 20).map((c) => c.char + '(' + (c.imageryTags || []).join('/') + ')').join(' '));
  }
  const inBlock = leftover.filter((c) => blockSet.has(c.char));
  info('其中命中黑名单（本就不该入池）: ' + inBlock.length + ' 个');
  // 粗标噪声过滤： leftover 中大量为 氵/木/艹 部首普通名词（汗/污/桩/桌/税…），
  // 人工挑出其中真正适合入名的女性向字再评估「耗尽」说法
  const curatedUsable = leftover
    .map((c) => c.char)
    .filter((ch) => ['花', '芽', '芭', '苇', '芯', '芦', '苏', '姚', '妃', '姜', '姗', '妮', '婉', '婷',
      '滢', '潇', '溪', '槿', '柠', '茉', '苓', '茨', '莞', '菡', '玥', '玲', '珊', '珍'].includes(ch));
  info('黑名单外、人工判定仍适合入名的女性向字（' + curatedUsable.length + ' 个）: '
    + curatedUsable.join(' '));
  check('[F] 女性向可用存量 ≤20（验证工程师「女性字存量基本耗尽」说法）',
    curatedUsable.length <= 20, '实际 ' + curatedUsable.length);
}

console.log('\n========== test-quality-qa 结果 ==========');
console.log('通过 ' + pass + ' / 失败 ' + failCnt);
if (failCnt > 0) {
  console.log('失败项：');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
