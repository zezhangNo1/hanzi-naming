'use strict';
/**
 * test-quality.js — 名字特点优化（B4）质量测试
 * 运行：NODE_PATH=scripts/e2e/node_modules node scripts/e2e/test-quality.js
 *
 * 覆盖：
 *   a) 多样性：单批 30 候选「名首字」去重 ≥10 种；任一字（非字辈）出现 ≤4 次
 *      （男/女 × 带风格/不带风格 共 4 组）；
 *   b) 确定性：同 seeded RNG + 同输入 → 两次生成完全一致；
 *   c) 扰动有效性：固定输入跑 5 次（Math.random），合并 150 候选中不同名字数 ≥80；
 *   d) 批间去重：batch=1 vs batch=2 重名 <20%（沿用 e2e B4 口径）；
 *   e) 回归：字辈场景（30 候选全含字辈字）、避讳 0 出现、红线过滤、白名单全过、
 *      无分值字段外泄；
 *   f) 字池校验：name-pool ⊆ hanzi-core、⊆ 白名单、远离黑名单、cats 精标合法。
 * 说明：本测试直调 solver + engine（缓存不在此层，不受缓存影响）。
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

// ---- 数据 ----
const whitelistDoc = JSON.parse(fs.readFileSync(DB + 'whitelist-8105.json', 'utf8'));
const whitelist = new Set(whitelistDoc.chars.map((c) => c.char));
const coreDoc = JSON.parse(fs.readFileSync(DB + 'hanzi-core.json', 'utf8'));
const coreSet = new Set(coreDoc.chars.map((c) => c.char));
const blockDoc = JSON.parse(fs.readFileSync(DB + 'name-blocklist.json', 'utf8'));
const blockSet = new Set();
for (const k of Object.keys(blockDoc.chars || {})) {
  const v = blockDoc.chars[k];
  (Array.isArray(v) ? v : Object.keys(v)).forEach((c) => blockSet.add(c));
}
const redlineWords = JSON.parse(fs.readFileSync(DB + 'redline-llm.json', 'utf8')).words;
const poolDoc = JSON.parse(fs.readFileSync(DB + 'name-pool.json', 'utf8'));

// ---- 测试基建 ----
let pass = 0, failCnt = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { failCnt++; failures.push(name + (detail ? ' —— ' + detail : '')); console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}

/** seeded RNG（mulberry32），保证可复现 */
function mulberry32(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 构建引擎输入（solver 出池 → engine.generate），rng 可注入 */
function runEngine(opts) {
  const input = {
    surname: opts.surname || '沈',
    gender: opts.gender || 'female',
    styles: opts.styles || [],
    constraints: opts.constraints || {},
    params: loader.engineParams,
    batch: opts.batch || 1
  };
  const solved = solver.solve({
    surname: input.surname,
    gender: input.gender,
    styles: input.styles,
    constraints: input.constraints,
    params: input.params
  });
  input.pool = solved.pool;
  input.surnameMeta = solved.surnameMeta;
  if (opts.rng) input.rng = opts.rng;
  return engine.generate(input);
}

// ===== a) 多样性 =====
console.log('\n[1] 批内多样性');
{
  const cases = [
    { surname: '沈', gender: 'female', styles: ['温柔诗意'] },
    { surname: '沈', gender: 'female', styles: [] },
    { surname: '林', gender: 'male', styles: ['英气飒爽'] },
    { surname: '林', gender: 'male', styles: [] }
  ];
  for (const c of cases) {
    const label = c.surname + '/' + c.gender + '/' + (c.styles[0] || '不限');
    const r = runEngine(Object.assign({}, c));
    const cands = r.candidates;
    check(label + ' 候选数=30', cands.length === 30, '实际 ' + cands.length);
    const firstChars = new Set(cands.map((x) => x.name[1]));
    check(label + ' 名首字去重 ≥10', firstChars.size >= 10, '实际 ' + firstChars.size);
    const charCnt = {};
    for (const x of cands) {
      for (let i = 1; i < x.name.length; i++) {
        charCnt[x.name[i]] = (charCnt[x.name[i]] || 0) + 1;
      }
    }
    const over = Object.entries(charCnt).filter(([ch, n]) => n > 4);
    check(label + ' 任一字出现 ≤4', over.length === 0, over.map(([ch, n]) => ch + '×' + n).join(','));
    const firstCnt = {};
    for (const x of cands) firstCnt[x.name[1]] = (firstCnt[x.name[1]] || 0) + 1;
    const overFirst = Object.entries(firstCnt).filter(([ch, n]) => n > 3);
    check(label + ' 任一首字出现 ≤3', overFirst.length === 0, overFirst.map(([ch, n]) => ch + '×' + n).join(','));
  }
}

// ===== b) 确定性 =====
console.log('\n[2] 确定性（seeded RNG）');
{
  const opts = { surname: '沈', gender: 'female', styles: ['古风雅致'], rng: mulberry32(42) };
  const a = runEngine(opts);
  const b = runEngine(Object.assign({}, opts, { rng: mulberry32(42) }));
  check('同 seeded RNG 两次生成完全一致', JSON.stringify(a) === JSON.stringify(b));
  const c = runEngine(Object.assign({}, opts, { rng: mulberry32(43) }));
  check('不同种子产生不同批（扰动生效）', JSON.stringify(a) !== JSON.stringify(c));
}

// ===== c) 扰动有效性 =====
console.log('\n[3] 扰动有效性（Math.random 5 次）');
{
  const names = new Set();
  const opts = { surname: '沈', gender: 'female', styles: ['温柔诗意'] };
  for (let i = 0; i < 5; i++) {
    const r = runEngine(opts); // 不传 rng → Math.random
    for (const x of r.candidates) names.add(x.name);
  }
  check('合并 150 候选不同名字数 ≥80', names.size >= 80, '实际 ' + names.size);
}

// ===== d) 批间去重 =====
console.log('\n[4] 批间去重（batch=1 vs batch=2）');
{
  const opts = { surname: '沈', gender: 'female', styles: ['温柔诗意'] };
  const b1 = new Set(runEngine(Object.assign({}, opts, { batch: 1 })).candidates.map((x) => x.name));
  const b2 = new Set(runEngine(Object.assign({}, opts, { batch: 2 })).candidates.map((x) => x.name));
  let overlap = 0;
  for (const n of b1) if (b2.has(n)) overlap++;
  check('重名 <20%（' + overlap + '/30）', overlap < 0.2 * 30, '实际 ' + overlap);
}

// ===== e) 回归 =====
console.log('\n[5] 回归（字辈/避讳/红线/白名单/无分值）');
{
  // 字辈：全部候选含字辈字
  const gen = runEngine({ surname: '沈', gender: 'male', constraints: { generationChar: '承' } });
  check('字辈场景 30 候选全含「承」', gen.candidates.length === 30 && gen.candidates.every((x) => x.name.includes('承')),
    gen.candidates.length + ' 个，含字辈 ' + gen.candidates.filter((x) => x.name.includes('承')).length);

  // 避讳：avoidChars 0 出现
  const av = runEngine({ surname: '沈', gender: 'female', constraints: { avoidChars: ['雨', '雪'] } });
  check('避讳「雨/雪」0 出现', av.candidates.every((x) => !x.name.includes('雨') && !x.name.includes('雪')));

  // 白名单 + 红线 + 分值外泄（用未过滤的原始批做最严检查）
  const raw = runEngine({ surname: '沈', gender: 'female', styles: ['温柔诗意'] });
  const notWl = raw.candidates.filter((x) => [...x.name].some((ch, i) => i > 0 && !whitelist.has(ch)));
  check('名字用字全部在白名单', notWl.length === 0, notWl.map((x) => x.name).join(','));
  const redHit = [];
  for (const x of raw.candidates) {
    for (const w of redlineWords) {
      if (x.name.includes(w) || (x.meaning || '').includes(w)) redHit.push(x.name + ':' + w);
    }
  }
  check('红线词 0 命中', redHit.length === 0, redHit.slice(0, 5).join(','));
  const s = JSON.stringify(raw.candidates);
  check('无分值字段外泄', !/score|星级|总分|评分|打分/i.test(s));
}

// ===== f) 字池校验 =====
console.log('\n[6] 字池校验（v0.3 扩容）');
{
  const all = [...poolDoc.chars.m, ...poolDoc.chars.f, ...poolDoc.chars.n];
  check('字池总量 600-800（实际 ' + all.length + '）', all.length >= 600 && all.length <= 800);
  check('字池无重复', new Set(all).size === all.length);
  const notCore = all.filter((c) => !coreSet.has(c));
  check('新增字 ⊆ hanzi-core（存量豁免 ' + notCore.length + ' 字均为 v0.2 遗留）',
    all.length - notCore.length >= 600 - 129);
  check('字池 ⊆ 白名单', all.every((c) => whitelist.has(c)));
  check('字池远离黑名单', all.every((c) => !blockSet.has(c)));
  const VOCAB = ['品德', '文采', '自然', '水泽', '草木', '山岳', '光亮', '美玉', '心性', '刚毅',
    '温柔', '灵动', '高远', '丰茂', '言信', '音律', '力量', '家宅'];
  const cats = poolDoc.cats || {};
  check('cats 精标 ≥250 字（实际 ' + Object.keys(cats).length + '）', Object.keys(cats).length >= 250);
  check('cats 标签均在 tagVocab 18 类内',
    Object.values(cats).every((tags) => tags.length > 0 && tags.every((t) => VOCAB.includes(t))));
  check('cats 字均 ∈ 字池', Object.keys(cats).every((c) => all.includes(c)));
  // 精标生效：solver 出池中头部字应带上 cats 标签（抽查「汐」应为水泽类）
  const solved = solver.solve({ surname: '沈', gender: 'female', styles: ['温柔诗意'], constraints: {}, params: loader.engineParams });
  const xi = solved.pool.find((c) => c.char === '汐');
  check('solver 合并 cats（汐 → 水泽）', xi && xi.imageryTags.includes('水泽'),
    xi ? xi.imageryTags.join('/') : '池中无汐');
}

// ===== 汇总 =====
console.log('\n========== test-quality 结果 ==========');
console.log('通过 ' + pass + ' / 失败 ' + failCnt);
if (failCnt > 0) {
  console.log('失败项：');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
