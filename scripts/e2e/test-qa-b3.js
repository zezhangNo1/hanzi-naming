'use strict';
/**
 * B3 QA 边界测试（独立验证，QA-Edward）
 * 运行：NODE_PATH=scripts/e2e/node_modules node scripts/e2e/test-qa-b3.js
 *
 * 覆盖（主理人指定边界 + 代码审查发现）：
 *   Q1 mapLlmCandidates：重复名字去重 / 字集外字淘汰 / 非 3 字名·错姓·双字重复淘汰
 *   Q2 pipeline：LLM 返回超 30 个 → 落库候选不得超过 30（批次上限）
 *   Q3 LLM 返回 names:[] / 解析失败 → 3 次尝试后整批降级
 *   Q4 constraints.generationChar：LLM 路径产物是否含字辈（服务端是否强制）
 *   Q5 constraints.avoidChars：LLM 路径由 whitelist.js 正确拦截
 *   Q6 ENGINE_VERSION 变化 → jobHash 变化（同参请求不命中旧缓存）
 *   Q7 内部字段外泄：score/星级/quoteRef/wishesEcho 等不得出现在落库对象（LLM 路径）
 *   Q8 seccheck 三路径 + errCode 缺省行为（约定：只有明确 errCode≠0 才整批 fail）
 *   Q9 谐音误杀面扫描（信息项：正常名字不得被 fail 级误杀）
 *   Q10 降级补齐：batch>1 起始段 / 不死循环 / 补齐去重
 */
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..', '..');
const GEN = path.join(ROOT, 'cloudfunctions', 'generate');

process.env.LLM_API_KEY = 'test-key-fake';
process.env.LLM_BASE_URL = 'https://llm.example.invalid';
process.env.LLM_MODEL = 'test-model-fake';
process.env.MOCK_OPENID = 'openid_qa_b3';

const cloud = require('wx-server-sdk'); // NODE_PATH 指向 mock
const pipeline = require(path.join(GEN, 'lib', 'pipeline.js'));
const llm = require(path.join(GEN, 'lib', 'llm.js'));
const solver = require(path.join(GEN, 'lib', 'solver.js'));
const loader = require(path.join(GEN, 'lib', 'data-loader.js'));
const filter = require(path.join(GEN, 'lib', 'filter', 'index.js'));
const homophone = require(path.join(GEN, 'lib', 'filter', 'homophone.js'));
const seccheck = require(path.join(GEN, 'lib', 'filter', 'seccheck.js'));
const cache = require(path.join(GEN, 'lib', 'cache.js'));
const db = cloud.database();
const store = cloud.__store;

let pass = 0, failCnt = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { failCnt++; failures.push(name + (detail ? ' —— ' + detail : '')); console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}
function info(name, detail) {
  console.log('  ℹ️ [信息项] ' + name + (detail ? ' —— ' + detail : ''));
}

function okTransport(payload) {
  return async () => JSON.stringify(payload);
}
async function withTransport(transport, fn) {
  const orig = llm.callLlm;
  llm.callLlm = (input, options) => orig(input, Object.assign({}, options, { transport: transport }));
  try { return await fn(); } finally { llm.callLlm = orig; }
}
async function freshJob() {
  const added = await db.collection('name_jobs').add({
    data: { status: 'pending', surname: '沈', createdAt: Date.now() }
  });
  return added._id;
}
function jobOf(jobId, extra) {
  return Object.assign({
    jobId: jobId,
    openid: process.env.MOCK_OPENID,
    surname: '沈',
    gender: 'male',
    styles: ['古风雅致'],
    constraints: {},
    source: 'free',
    batch: 1
  }, extra || {});
}

const solved = solver.solve({ surname: '沈', gender: 'male', styles: ['古风雅致'], constraints: {}, params: loader.engineParams });
const metaMap = solved.pool.reduce((m, c) => { m[c.char] = c; return m; }, {});

/** 从 llmPool 组 40 个「沈AB」名，先用谐音检测自筛，保证过滤可通过 */
function buildBatchNames(n) {
  const pool = solved.llmPool.filter((c) => c.char !== '沈');
  const out = [];
  let i = 0;
  while (out.length < n && i < pool.length * pool.length) {
    const a = pool[i % pool.length], b = pool[Math.floor(i / pool.length) % pool.length];
    i++;
    if (a.char === b.char) continue;
    const cand = { name: '沈' + a.char + b.char, pinyin: ['shěn', a.pinyin, b.pinyin] };
    if (homophone.check(cand).pass) out.push(cand.name);
  }
  return out.slice(0, n);
}
function namePayload(names, meaningFn) {
  return names.map((nm, idx) => ({
    name: nm,
    pinyin: ['shěn', 'x', 'x'],
    style: '古风雅致',
    meaning: meaningFn ? meaningFn(nm, idx) : '高远温润',
    quoteRef: null
  }));
}

async function main() {
  const t0 = Date.now();

  // ===== Q1 mapLlmCandidates 边界 =====
  console.log('\n【Q1】mapLlmCandidates：重复 / 字集外 / 结构非法');
  const names1 = ['沈宇航', '沈明轩'];
  const dup = namePayload(names1).concat(namePayload(names1)); // 重复一次
  dup.push({ name: '沈玉核弹', meaning: 'x' });                 // 「核」若不在字池应淘汰
  dup.push({ name: '沈宇', meaning: 'x' });                     // 非 3 字名
  dup.push({ name: '王宇航', meaning: 'x' });                   // 姓氏不符
  dup.push({ name: '沈宇宇', meaning: 'x' });                   // 名字两字重复
  dup.push({ name: '  沈宇航  ', meaning: 'x' });               // 带空白（trim 后重复，应去重）
  const mapped1 = pipeline.mapLlmCandidates(dup, {
    surname: '沈', surnameMeta: solved.surnameMeta, charMetaMap: metaMap, constraints: {}, styles: ['古风雅致']
  });
  const uniq1 = new Set(mapped1.map((c) => c.name));
  check('Q1a 重复名去重且trim后归并（2 个唯一名）', mapped1.length === 2 && uniq1.size === 2, JSON.stringify(mapped1.map((c) => c.name)));
  check('Q1b 字集外字整名淘汰', !mapped1.some((c) => c.name === '沈玉核弹'));
  check('Q1c 结构非法全淘汰', !mapped1.some((c) => ['沈宇', '王宇航', '沈宇宇'].includes(c.name)));

  // ===== Q2 LLM 返回超 30 个 → 落库不超过 30 =====
  console.log('\n【Q2】LLM 返回超 30 个名字');
  const names40 = buildBatchNames(40);
  check('Q2-前置 组出 40 个可过谐音的名字', names40.length === 40, '实际 ' + names40.length);
  let jobId2 = await freshJob();
  const res2 = await withTransport(okTransport({ names: namePayload(names40) }), () => pipeline.run(jobOf(jobId2)));
  check('Q2a LLM 超量返回时落库候选 ≤ 30（批次上限）', res2.candidateIds.length <= 30, '实际落库 ' + res2.candidateIds.length + '，llmUsed=' + res2.llmUsed);

  // ===== Q3 LLM 返回空 names / 解析失败 → 3 次后降级 =====
  console.log('\n【Q3】LLM 返回 names:[] → 整批降级');
  const jobId3 = await freshJob();
  const res3 = await withTransport(okTransport({ names: [] }), () => pipeline.run(jobOf(jobId3)));
  check('Q3a names 为空视为失败', res3.degraded === true && res3.llmUsed === false);
  check('Q3b 尝试满 3 次后降级', res3.attemptCount === 3, '实际 ' + res3.attemptCount);
  check('Q3c 降级批仍补齐 30 候选', res3.candidateIds.length === 30, '实际 ' + res3.candidateIds.length);
  const jobId3b = await freshJob();
  const res3b = await withTransport(async () => '完全不是 JSON', () => pipeline.run(jobOf(jobId3b)));
  check('Q3d 解析失败同样走 3 次尝试 → 降级', res3b.degraded === true && res3b.attemptCount === 3);

  // ===== Q4 字辈 generationChar =====
  console.log('\n【Q4】generationChar（LLM 路径）');
  // 注（engine 修订）：QA 第 1 轮原前置用 constraints:{} 的 solved 检查——与主理人裁决口径
  // 「generationChar 非空才追加进 llmPool」不一致（无字辈约束时本不应出现字辈字）。
  // 修正为按字辈约束求解后检查，与 pipeline 内部行为一致。
  const solvedGen = solver.solve({ surname: '沈', gender: 'male', styles: ['古风雅致'], constraints: { generationChar: '承' }, params: loader.engineParams });
  check('Q4-前置 字辈字「承」在 llmPool 中（prompt 候选字集可见，constraints.generationChar=承）', solvedGen.llmPool.some((c) => c.char === '承'),
    'llmPool 含承=' + solvedGen.llmPool.some((c) => c.char === '承') + '（不在则 LLM 被规则1禁止使用字辈字，与规则5矛盾）');
  // 场景 4a：LLM 遵从字辈（名字第二字=承）
  const genNames = buildBatchNames(14).map((nm) => '沈承' + nm.charAt(2));
  const jobId4a = await freshJob();
  const res4a = await withTransport(okTransport({ names: namePayload(genNames) }), () => pipeline.run(jobOf(jobId4a, { constraints: { generationChar: '承' } })));
  const docs4a = (await db.collection('candidates').where({ _id: db.command.in(res4a.candidateIds) }).get()).data;
  const llmDocs4a = docs4a.filter((c) => genNames.includes(c.name));
  check('Q4a LLM 遵从字辈时产物含字辈（LLM 候选第 2 字=承）', llmDocs4a.length > 0 && llmDocs4a.every((c) => Array.from(c.name)[1] === '承'),
    'LLM 候选 ' + llmDocs4a.length + ' 个');
  // 场景 4b：LLM 无视字辈 → 服务端是否强制？（约定：字辈为硬约束）
  const jobId4b = await freshJob();
  const res4b = await withTransport(okTransport({ names: namePayload(buildBatchNames(14)) }), () => pipeline.run(jobOf(jobId4b, { constraints: { generationChar: '承' } })));
  const docs4b = (await db.collection('candidates').where({ _id: db.command.in(res4b.candidateIds) }).get()).data;
  const noCheng = docs4b.filter((c) => Array.from(c.name)[1] !== '承');
  check('Q4b [P1] LLM 无视字辈时服务端应拦截/重试，而非直接放行', noCheng.length === 0, '无字辈候选被落库 ' + noCheng.length + ' 个：' + noCheng.slice(0, 5).map((c) => c.name).join('、'));

  // ===== Q5 avoidChars（LLM 路径 whitelist 拦截）=====
  console.log('\n【Q5】avoidChars（LLM 路径）');
  const names5 = ['沈宇航', '沈明轩', '沈泽楷'];
  const mapped5 = pipeline.mapLlmCandidates(namePayload(names5), {
    surname: '沈', surnameMeta: solved.surnameMeta, charMetaMap: metaMap, constraints: { avoidChars: ['宇'] }, styles: ['古风雅致']
  });
  const fr5 = await filter.runAll(mapped5, { db: db, jobId: await freshJob(), constraints: { avoidChars: ['宇'] } });
  check('Q5a 避讳字「宇」候选在 whitelist 层被拦截', !fr5.passed.some((c) => c.name.includes('宇')) && fr5.blocked.some((b) => b.stage === 'whitelist' && b.raw === '沈宇航'),
    JSON.stringify(fr5.blocked));
  check('Q5b 其余候选保留', fr5.passed.length === 2, '实际 ' + fr5.passed.length);
  // 全链路：LLM 全部含避讳字 → 3 次后降级（而非放行避讳名）
  const avoidNames = buildBatchNames(14).map((nm) => '沈' + '宇' + nm.charAt(2));
  const jobId5 = await freshJob();
  const res5 = await withTransport(okTransport({ names: namePayload(avoidNames) }), () => pipeline.run(jobOf(jobId5, { constraints: { avoidChars: ['宇'] } })));
  const docs5 = (await db.collection('candidates').where({ _id: db.command.in(res5.candidateIds) }).get()).data;
  check('Q5c 全批含避讳字 → 降级补齐且落库 0 个避讳名', docs5.every((c) => !c.name.includes('宇')), '含宇落库 ' + docs5.filter((c) => c.name.includes('宇')).length + ' 个');

  // ===== Q6 ENGINE_VERSION 变化 → jobHash 变化 =====
  console.log('\n【Q6】ENGINE_VERSION 参与缓存指纹');
  const tmpDir = path.join(__dirname, 'tmp-qa');
  fs.mkdirSync(tmpDir, { recursive: true });
  const src = fs.readFileSync(path.join(GEN, 'lib', 'cache.js'), 'utf8');
  const bumped = src.replace(/ENGINE_VERSION = '[^']+'/, "ENGINE_VERSION = 'v4-llm-20260908-QATEST'");
  fs.writeFileSync(path.join(tmpDir, 'cache-bumped.js'), bumped);
  const cacheBumped = require(path.join(tmpDir, 'cache-bumped.js'));
  const input = { surname: '沈', gender: 'male', styles: ['古风雅致'], constraints: { avoidChars: ['祖'] }, batch: 1 };
  const h1 = cache.jobHash(input);
  const h2 = cacheBumped.jobHash(input);
  check('Q6a 版本变化 → 同参 jobHash 不同', h1 !== h2, h1 + ' vs ' + h2);
  check('Q6b 同版本同参 hash 稳定', h1 === cache.jobHash(Object.assign({}, input)));
  check('Q6c batch 变化 → hash 变化', h1 !== cache.jobHash(Object.assign({}, input, { batch: 2 })));
  check('Q6d 当前版本号为 v5-distinct-20260908', cache.ENGINE_VERSION === 'v5-distinct-20260908', cache.ENGINE_VERSION);

  // ===== Q7 内部字段外泄（LLM 路径，落库前对象）=====
  console.log('\n【Q7】内部字段外泄扫描（LLM 恶意附加字段）');
  const evilNames = buildBatchNames(12);
  const evilPayload = evilNames.map((nm, i) => ({
    name: nm, pinyin: ['shěn', 'x', 'x'], style: '古风雅致', meaning: '高远温润', quoteRef: null,
    score: 99.5, stars: 5, totalScore: 99, grade: 'S', wishesEcho: '内测回显', quoteRefFake: 1,
    innerDebug: { quoteRef: { key: 'hack' } }
  }));
  const mapped7 = pipeline.mapLlmCandidates(evilPayload, {
    surname: '沈', surnameMeta: solved.surnameMeta, charMetaMap: metaMap, constraints: {}, styles: ['古风雅致']
  });
  const fr7 = await filter.runAll(mapped7, { db: null, jobId: '', constraints: {} });
  const leak7 = JSON.stringify(fr7.passed).match(/score|星级|总分|评分|打分|grade|wishesEcho|quoteRef|innerDebug/i);
  check('Q7a LLM 附加的 score/stars/grade/wishesEcho/quoteRef 等不落入候选对象', leak7 === null, leak7 && ('命中: ' + leak7[0]));
  check('Q7b 恶意字段不影响正常候选数', fr7.passed.length === 12, '实际 ' + fr7.passed.length);

  // ===== Q8 seccheck 三路径 + errCode 缺省 =====
  console.log('\n【Q8】seccheck 路径行为');
  const batch8 = [{ name: '沈宇航', meaning: '高远' }];
  const origOpenapi = cloud.openapi;
  cloud.openapi = { security: { msgSecCheck: async () => ({ errCode: 87014, errMsg: 'risky' }) } };
  let r8 = await seccheck.checkBatch(batch8);
  check('Q8a errCode=87014 → 整批 fail', r8.pass === false && r8.warn === false, JSON.stringify(r8));
  cloud.openapi = { security: { msgSecCheck: async () => { throw new Error('频控'); } } };
  r8 = await seccheck.checkBatch(batch8);
  check('Q8b API 抛错 → warn 放行不阻断', r8.pass === true && r8.warn === true, JSON.stringify(r8));
  cloud.openapi = { security: { msgSecCheck: async () => ({ errMsg: 'ok' }) } }; // errCode 缺省
  r8 = await seccheck.checkBatch(batch8);
  check('Q8c [P2] errCode 缺省（非明确≠0）按约定应 warn 放行', r8.pass === true && r8.warn === true, JSON.stringify(r8));
  cloud.openapi = undefined;
  r8 = await seccheck.checkBatch(batch8);
  check('Q8d openapi 缺失 → warn 放行', r8.pass === true && r8.warn === true, JSON.stringify(r8));
  cloud.openapi = origOpenapi;
  r8 = await seccheck.checkBatch([]);
  check('Q8e 空批次直接 pass', r8.pass === true && r8.warn === false);
  // 全链路验证：errCode≠0 → runAll 整批清空
  cloud.openapi = { security: { msgSecCheck: async () => ({ errCode: 87014 }) } };
  const mapped8 = pipeline.mapLlmCandidates(namePayload(names5), {
    surname: '沈', surnameMeta: solved.surnameMeta, charMetaMap: metaMap, constraints: {}, styles: ['古风雅致']
  });
  const fr8 = await filter.runAll(mapped8, { db: null, jobId: '', constraints: {} });
  check('Q8f runAll 在 errCode≠0 时整批清空', fr8.passed.length === 0 && fr8.blocked.length === 3 && fr8.blocked.every((b) => b.stage === 'seccheck'));
  cloud.openapi = origOpenapi;

  // ===== Q9 谐音误杀面（信息项扫描 + 常用名必须通过）=====
  console.log('\n【Q9】谐音误杀面');
  const mustPass = [
    ['沈宇航', ['shěn', 'yǔ', 'háng']], ['沈浩然', ['shěn', 'hào', 'rán']],
    ['沈雨桐', ['shěn', 'yǔ', 'tóng']], ['沈静姝', ['shěn', 'jìng', 'shū']],
    ['沈梦瑶', ['shěn', 'mèng', 'yáo']], ['沈清扬', ['shěn', 'qīng', 'yáng']]
  ];
  const misKill = [];
  for (const [nm, py] of mustPass) {
    const r = homophone.check({ name: nm, pinyin: py });
    if (!r.pass) misKill.push(nm + '(' + (r.detail || '') + ')');
  }
  check('Q9a 常见正常名不被 fail 级误杀', misKill.length === 0, misKill.join('、'));
  const sweep = [
    ['沈世棠', ['shěn', 'shì', 'táng']], ['沈诗腾', ['shěn', 'shī', 'téng']],
    ['沈麦琪', ['shěn', 'mài', 'qí']], ['沈奇思', ['shěn', 'qí', 'sī']],
    ['沈思婷', ['shěn', 'sī', 'tíng']], ['沈世通', ['shěn', 'shì', 'tōng']]
  ];
  for (const [nm, py] of sweep) {
    const r = homophone.check({ name: nm, pinyin: py });
    info(nm + ' → ' + (r.pass ? (r.homophonePutonghua === 'warn' ? 'WARN(保留)' : 'pass') : 'FAIL(剔除)') + (r.detail ? ' ' + r.detail : ''));
  }

  // ===== Q10 降级补齐护栏 =====
  console.log('\n【Q10】降级补齐：batch>1 / 去重 / 不死循环');
  const jobId10 = await freshJob();
  const t10 = Date.now();
  const res10 = await withTransport(async () => { throw new Error('强制降级'); }, () => pipeline.run(jobOf(jobId10, { batch: 7 })));
  const took10 = Date.now() - t10;
  check('Q10a batch=7 降级批正常完成（30 候选）', res10.candidateIds.length === 30, '实际 ' + res10.candidateIds.length);
  check('Q10b 补齐在护栏段数内完成（<5s，无死循环）', took10 < 5000, '耗时 ' + took10 + 'ms');
  const docs10 = (await db.collection('candidates').where({ _id: db.command.in(res10.candidateIds) }).get()).data;
  const uniq10 = new Set(docs10.map((c) => c.name));
  check('Q10c 落库名字无重复', uniq10.size === docs10.length, '唯一 ' + uniq10.size + '/' + docs10.length);

  // ===== 汇总 =====
  console.log('\n=========================================');
  console.log('QA B3 边界测试结果：通过 ' + pass + ' / 失败 ' + failCnt + '，总耗时 ' + (Date.now() - t0) + 'ms');
  if (failures.length) {
    console.log('失败项：');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('ALL PASS ✅');
}

main().catch((e) => { console.error('测试脚本异常：', e); process.exit(1); });
