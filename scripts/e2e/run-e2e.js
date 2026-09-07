'use strict';
/**
 * B2 端到端模拟（INTENT-T04 自检 + 主理人验收用）
 * 场景：mock 云数据库 + mock openid，直调 generate 云函数 exports.main。
 * 链路：create（返回 jobId）→ poll（返回 candidates）——对齐交接包 3.1 契约。
 * 覆盖：降级生成 30 候选 / 白名单 100% / 字辈「承」优先 / 避讳「祖」0 出现 /
 *       红线词零命中 / 缓存命中 / 免费额度 2001 / 无分值外泄 / 批次去重。
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..'); // 项目根 = hanzi-naming/
const GEN = path.join(ROOT, 'cloudfunctions', 'generate');
const DB = path.join(ROOT, 'database') + path.sep;

// ---- 数据加载 ----
const whitelist = new Set(
  JSON.parse(fs.readFileSync(DB + 'whitelist-8105.json', 'utf8')).chars.map((c) => c.char)
);
const redlineWords = JSON.parse(fs.readFileSync(DB + 'redline-llm.json', 'utf8')).words;

// ---- 工具 ----
let pass = 0, failCnt = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { failCnt++; failures.push(name + (detail ? ' —— ' + detail : '')); console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}
function freshMain(openid) {
  for (const k of Object.keys(require.cache)) {
    if (k.startsWith(GEN)) delete require.cache[k];
  }
  process.env.MOCK_OPENID = openid;
  return require(GEN + '/index.js');
}
async function createAndPoll(mod, params) {
  const t = Date.now();
  const cr = await mod.main(Object.assign({ action: 'create', source: 'free' }, params), {});
  const latency = Date.now() - t;
  let pr = null;
  if (cr.code === 0 && cr.data && cr.data.jobId) {
    pr = await mod.main({ action: 'poll', jobId: cr.data.jobId }, {});
  }
  return { cr: cr, pr: pr, latency: latency };
}
function forbiddenScan(cands) {
  const s = JSON.stringify(cands);
  if (/score|星级|总分|评分|打分/i.test(s)) return '命中分值字段';
  for (const w of redlineWords) {
    for (const c of cands) {
      if ((c.meaning || '').includes(w) || (c.name || '').includes(w)) return '红线词「' + w + '」';
    }
  }
  return null;
}

async function main() {
  const t0 = Date.now();
  const base = { surname: '沈', gender: 'male', styles: ['古风雅致', '温柔诗意'], constraints: {} };

  // ===== 用户 A：b1（create→poll）→ b1 重复（缓存）→ b2（额度 2001）=====
  console.log('\n【场景 A】沈/男/古风雅致+温柔诗意：降级生成、缓存、额度');
  let mod = freshMain('openid_A');
  const a1 = await createAndPoll(mod, Object.assign({}, base, { batch: 1 }));
  check('A1 首批 create code=0', a1.cr.code === 0, JSON.stringify(a1.cr).slice(0, 120));
  check('A1 create 返回 jobId/status=done/degraded=true', a1.cr.code === 0 && !!a1.cr.data.jobId && a1.cr.data.status === 'done' && a1.cr.data.degraded === true);
  check('A1 poll 返回 30 个候选', a1.pr && a1.pr.code === 0 && a1.pr.data.candidates.length === 30, '实际 ' + (a1.pr && a1.pr.data ? a1.pr.data.candidates.length : '无'));
  check('A1 全链路耗时 <2s（实际 ' + a1.latency + 'ms）', a1.latency < 2000);

  const a2 = await createAndPoll(mod, Object.assign({}, base, { batch: 1 }));
  check('A2 同参重生成 create 返回 cached=true', a2.cr.code === 0 && a2.cr.data.cached === true, 'cached=' + (a2.cr.data && a2.cr.data.cached));

  const a3 = await createAndPoll(mod, Object.assign({}, base, { batch: 2 }));
  check('A3 免费额度用尽 create 返回 2001', a3.cr.code === 2001, '实际 code=' + a3.cr.code + ' msg=' + a3.cr.msg);

  // ===== 用户 B：b1/b2 两批完整校验 =====
  console.log('\n【场景 B】沈/男：两批候选质量全检');
  mod = freshMain('openid_B');
  const b1 = await createAndPoll(mod, Object.assign({}, base, { batch: 1 }));
  const b2 = await createAndPoll(mod, Object.assign({}, base, { batch: 2 }));
  const cands = []
    .concat(b1.pr && b1.pr.code === 0 && b1.pr.data.candidates ? b1.pr.data.candidates : [])
    .concat(b2.pr && b2.pr.code === 0 && b2.pr.data.candidates ? b2.pr.data.candidates : []);
  check('B1 两批各 30 候选', cands.length === 60, '实际 ' + cands.length);

  const badChar = [];
  for (const c of cands) {
    for (const ch of Array.from(c.name)) if (!whitelist.has(ch)) badChar.push(c.name + ':' + ch);
  }
  check('B2 全部用字 ∈ 白名单 8105', badChar.length === 0, badChar.slice(0, 5).join(','));

  const badStruct = [];
  for (const c of cands) {
    if (!Array.isArray(c.pinyin) || c.pinyin.length !== 3 || c.pinyin.some((p) => !p)) badStruct.push(c.name + ':pinyin');
    if (!Array.isArray(c.tones) || c.tones.length !== 3 || c.tones.some((x) => !['ping', 'ze'].includes(x))) badStruct.push(c.name + ':tones');
    if (typeof c.checks.writeCost !== 'number') badStruct.push(c.name + ':writeCost');
  }
  check('B3 pinyin/tones/writeCost 结构合法', badStruct.length === 0, badStruct.slice(0, 5).join(','));

  const names1 = (b1.pr.data.candidates || []).map((c) => c.name);
  const names2 = (b2.pr.data.candidates || []).map((c) => c.name);
  const overlap = names1.filter((n) => names2.includes(n));
  console.log('  ℹ️ 批次1/2 重名 ' + overlap.length + ' 个：' + overlap.slice(0, 8).join('、'));
  check('B4 换一批重名率 <20%（目标 <6 个）', overlap.length < 6, '实际 ' + overlap.length);

  const scan = forbiddenScan(cands);
  check('B5 红线词零命中 + 无分值外泄', scan === null, scan || undefined);

  // ===== 用户 C：字辈「承」=====
  console.log('\n【场景 C】字辈约束');
  mod = freshMain('openid_C');
  const c1 = await createAndPoll(mod, { surname: '沈', gender: 'male', styles: ['典籍感'], constraints: { generationChar: '承' }, batch: 1 });
  const cc = c1.pr && c1.pr.code === 0 && c1.pr.data.candidates ? c1.pr.data.candidates : [];
  const missCheng = cc.filter((x) => !x.name.includes('承'));
  check('C1 30 候选全部含字辈「承」', c1.cr.code === 0 && cc.length === 30 && missCheng.length === 0, '未含 ' + missCheng.length + ' 个');

  // ===== 用户 D：避讳「祖」=====
  console.log('\n【场景 D】避讳约束');
  mod = freshMain('openid_D');
  const d1 = await createAndPoll(mod, { surname: '沈', gender: 'female', styles: ['温柔诗意'], constraints: { avoidChars: ['祖'] }, batch: 1 });
  const cd = d1.pr && d1.pr.code === 0 && d1.pr.data.candidates ? d1.pr.data.candidates : [];
  const hitZu = cd.filter((x) => x.name.includes('祖'));
  check('D1 避讳字「祖」0 出现', d1.cr.code === 0 && cd.length === 30 && hitZu.length === 0, '出现 ' + hitZu.length + ' 次');

  // ===== 红线过滤器直测 =====
  console.log('\n【场景 E】红线过滤器单元');
  const redline = require(GEN + '/lib/filter/redline');
  const mockBad = [
    { name: '沈砚清', meaning: '砚：文房之要；清：清朗立身' },
    { name: '沈五格', meaning: '数理大吉' }
  ];
  const fr = redline.filterCandidates(mockBad);
  check('E1 命中「五格」候选被剔除', fr.passed.length === 1 && fr.blocked.length === 1, JSON.stringify(fr.blocked).slice(0, 80));

  // ===== 汇总 =====
  console.log('\n=========================================');
  console.log('端到端模拟结果：通过 ' + pass + ' / 失败 ' + failCnt + '，总耗时 ' + (Date.now() - t0) + 'ms');
  if (failures.length) {
    console.log('失败项：');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('ALL PASS ✅');
}

main().catch((e) => { console.error('模拟脚本异常：', e); process.exit(1); });
