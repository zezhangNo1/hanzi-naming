'use strict';
/**
 * B3 单元/集成测试（INTENT-T04 增量 T04/T05 自检）
 * 运行：NODE_PATH=scripts/e2e/node_modules node scripts/e2e/test-b3.js
 *
 * 覆盖：
 *   a) LLM 正常 JSON（注入 fake transport）→ LLM 候选 + 引擎补齐 = 30，
 *      合法 quoteRef 回填三元组，name_jobs 记 llmUsed=true；
 *   b) LLM 返回含「五格」命中文案 → redline 剔除且 block_log 有 stage='redline' 记录；
 *   c) quoteRef.key 指向不存在语料 → quote=null 不剔除；
 *   d) 3 次尝试全失败（transport 恒抛错）→ 整批降级 degraded=true；
 *   e) 谐音单测：张诗婷 → homophoneEnglish 命中 Shiting → fail；
 *   f) parseLlmJson 容错（```json 包裹 / 前置杂讯 / 非法输入）；
 *   g) 降级路径候选 schema 完整性 + 无分值/过渡字段外泄。
 * mock wx-server-sdk（NODE_PATH）无 openapi → seccheck 走 warn 分支不抛错。
 */
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const GEN = path.join(ROOT, 'cloudfunctions', 'generate');

// fake LLM env（绝不写真实密钥；测试全程注入 fake transport，不发真实请求）
process.env.LLM_API_KEY = 'test-key-fake';
process.env.LLM_BASE_URL = 'https://llm.example.invalid';
process.env.LLM_MODEL = 'test-model-fake';
process.env.MOCK_OPENID = 'openid_b3';

const cloud = require('wx-server-sdk'); // NODE_PATH 指向 mock
const pipeline = require(path.join(GEN, 'lib', 'pipeline.js'));
const llm = require(path.join(GEN, 'lib', 'llm.js'));
const homophone = require(path.join(GEN, 'lib', 'filter', 'homophone.js'));
const solver = require(path.join(GEN, 'lib', 'solver.js'));
const loader = require(path.join(GEN, 'lib', 'data-loader.js'));
const filter = require(path.join(GEN, 'lib', 'filter', 'index.js'));
const db = cloud.database();
const store = cloud.__store;

let pass = 0, failCnt = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { failCnt++; failures.push(name + (detail ? ' —— ' + detail : '')); console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}

/** fake transport：返回固定 JSON（模拟 OpenAI 兼容 content） */
function okTransport(payload) {
  return async () => JSON.stringify(payload);
}
/** fake transport：恒抛错（模拟网络故障/超时） */
function errTransport() {
  return async () => { throw new Error('模拟网络故障'); };
}

/** 用 fake transport 临时接管 llm.callLlm（pipeline 内部直调 callLlm，运行时属性查找可 patch） */
async function withTransport(transport, fn) {
  const orig = llm.callLlm;
  llm.callLlm = (input, options) => orig(input, Object.assign({}, options, { transport: transport }));
  try {
    return await fn();
  } finally {
    llm.callLlm = orig;
  }
}

/** 预建 job 文档（pipeline.run 会按 jobId 更新 name_jobs） */
async function freshJob() {
  const added = await db.collection('name_jobs').add({
    data: { status: 'pending', surname: '沈', createdAt: Date.now() }
  });
  return added._id;
}

/** 标准 job 入参 */
function jobOf(jobId) {
  return {
    jobId: jobId,
    openid: process.env.MOCK_OPENID,
    surname: '沈',
    gender: 'male',
    styles: ['古风雅致'],
    constraints: {},
    source: 'free',
    batch: 1
  };
}

/** 14 个合法 LLM 候选（名字用字均在 name-pool 内） */
function validNames(meaningOf) {
  const chars = [
    ['宇', '航'], ['明', '轩'], ['泽', '楷'], ['志', '远'], ['博', '辉'], ['晨', '曦'],
    ['浩', '瀚'], ['睿', '诚'], ['嘉', '毅'], ['俊', '逸'], ['松', '岩'], ['柏', '森'],
    ['清', '泉'], ['涵', '洋']
  ];
  return chars.map((p, i) => ({
    name: '沈' + p[0] + p[1],
    pinyin: ['shěn', 'x', 'x'],
    style: '古风雅致',
    meaning: meaningOf ? meaningOf(i, p) : p[0] + '：高远；' + p[1] + '：温润',
    quoteRef: p[0] === '清' ? { key: 'wangwei-shanju' } : null,
    wishesEcho: '平安顺遂'
  }));
}

/** 求解一次解空间（供单元级映射用） */
function solvedOnce() {
  return solver.solve({ surname: '沈', gender: 'male', styles: ['古风雅致'], constraints: {}, params: loader.engineParams });
}
function charMetaMapOf(solved) {
  return solved.pool.reduce((m, c) => { m[c.char] = c; return m; }, {});
}

async function main() {
  const t0 = Date.now();
  const solved = solvedOnce();
  const metaMap = charMetaMapOf(solved);

  // ===== 场景 a：LLM 正常返回（注入 fake transport）→ 30 候选 + quote 回填 =====
  console.log('\n【场景 a】LLM 正常 JSON：候选+引擎补齐=30，quoteRef 回填');
  let jobId = await freshJob();
  let resA = await withTransport(okTransport({ names: validNames() }), () => pipeline.run(jobOf(jobId)));
  check('a1 create 成功且 degraded=false / llmUsed=true / attempt=1',
    resA.status === 'done' && resA.degraded === false && resA.llmUsed === true && resA.attemptCount === 1,
    JSON.stringify(resA));
  check('a2 LLM 候选 + 引擎补齐 = 30', resA.candidateIds.length === 30, '实际 ' + resA.candidateIds.length);
  const docsA = (await db.collection('candidates').where({ _id: db.command.in(resA.candidateIds) }).get()).data;
  const qing = docsA.find((c) => c.name === '沈清泉');
  check('a3 合法 quoteRef 回填三元组（王维/山居秋暝）', !!qing && !!qing.quote
    && qing.quote.author === '王维' && qing.quote.title === '山居秋暝'
    && qing.quote.sentence === '明月松间照，清泉石上流',
    JSON.stringify(qing && qing.quote));
  check('a4 输出无 quoteRef 过渡字段', docsA.every((c) => !('quoteRef' in c)));
  const llmDocsA = docsA.filter((c) => validNames().some((n) => n.name === c.name));
  check('a5 LLM 候选排前（14 个全部入选）', llmDocsA.length === 14, '实际 ' + llmDocsA.length);
  const jobA = store.name_jobs.docs.find((d) => d._id === jobId) || {};
  check('a6 name_jobs 记 llmUsed=true / attemptCount=1', jobA.llmUsed === true && jobA.attemptCount === 1);

  // ===== 场景 b：LLM 含「五格」→ redline 剔除 + block_log 记录 =====
  console.log('\n【场景 b】LLM 返回含命理文案 → redline 剔除');
  jobId = await freshJob();
  const namesB = validNames((i, p) => (i === 3 ? '五格数理大吉' : p[0] + '：高远；' + p[1] + '：温润'));
  const mappedB = pipeline.mapLlmCandidates(namesB, {
    surname: '沈', surnameMeta: solved.surnameMeta, charMetaMap: metaMap, constraints: {}, styles: ['古风雅致']
  });
  const frB = await filter.runAll(mappedB, { db: db, jobId: jobId, constraints: {} });
  check('b1 「五格」候选被剔除，其余 13 个保留', frB.passed.length === 13 && !frB.passed.some((c) => c.name === '沈志远'),
    'passed=' + frB.passed.length);
  const rlLog = (store.block_log ? store.block_log.docs : []).filter((d) => d.stage === 'redline' && d.raw === '沈志远');
  check('b2 block_log 有 stage=redline 记录', rlLog.length >= 1, JSON.stringify(rlLog));

  // ===== 场景 c：quoteRef.key 不存在 → quote=null 不剔除 =====
  console.log('\n【场景 c】非法 quoteRef.key → quote=null，候选保留');
  const namesC = validNames();
  namesC[2].quoteRef = { key: 'qy-not-exist' };
  const mappedC = pipeline.mapLlmCandidates(namesC, {
    surname: '沈', surnameMeta: solved.surnameMeta, charMetaMap: metaMap, constraints: {}, styles: ['古风雅致']
  });
  const frC = await filter.runAll(mappedC, { db: db, jobId: jobId, constraints: {} });
  const zek = frC.passed.find((c) => c.name === '沈泽楷');
  check('c1 候选未被剔除（14 全过）', frC.passed.length === 14 && !!zek);
  check('c2 quote=null 且无 quoteRef 字段', !!zek && zek.quote === null && !('quoteRef' in zek));

  // ===== 场景 d：transport 恒抛错 → 3 次尝试后整批降级 =====
  console.log('\n【场景 d】LLM 3 次失败 → 整批降级 degraded=true');
  jobId = await freshJob();
  const resD = await withTransport(errTransport(), () => pipeline.run(jobOf(jobId)));
  check('d1 整批降级 degraded=true / llmUsed=false', resD.degraded === true && resD.llmUsed === false);
  check('d2 尝试 3 次后降级', resD.attemptCount === 3, '实际 ' + resD.attemptCount);
  check('d3 降级批 30 候选', resD.candidateIds.length === 30, '实际 ' + resD.candidateIds.length);
  const jobD = store.name_jobs.docs.find((d) => d._id === jobId) || {};
  check('d4 name_jobs 记 llmUsed=false / attemptCount=3', jobD.llmUsed === false && jobD.attemptCount === 3);

  // ===== 场景 e：谐音单测 =====
  console.log('\n【场景 e】谐音检测单测');
  const e1 = homophone.check({ name: '张诗婷', pinyin: ['zhāng', 'shī', 'tíng'] });
  check('e1 张诗婷 homophoneEnglish 命中 Shiting → fail', e1.homophoneEnglish === 'fail' && e1.pass === false,
    JSON.stringify(e1));
  check('e1b 张诗婷 homophonePutonghua 命中 shiting → fail', e1.homophonePutonghua === 'fail');
  const e2 = homophone.check({ name: '沈宇航', pinyin: ['shěn', 'yǔ', 'háng'] });
  check('e2 沈宇航双通道 pass', e2.pass === true && e2.homophonePutonghua === 'pass' && e2.homophoneEnglish === 'pass');
  const e3 = { name: '测试', pinyin: ['cè', 'shì', 'yīn'] };
  check('e3 无声调连串正确（ceshiyin）', homophone.concatPinyin(e3) === 'ceshiyin', homophone.concatPinyin(e3));

  // ===== 场景 f：parseLlmJson 容错 =====
  console.log('\n【场景 f】parseLlmJson 容错');
  check('f1 裸 JSON', (llm.parseLlmJson('{"names":[]}') || {}).names !== undefined);
  const fenced = llm.parseLlmJson('好的，结果如下：\n```json\n{"names":[{"name":"沈清泉"}]}\n```');
  check('f2 ```json 包裹', !!fenced && !!fenced.names && fenced.names[0].name === '沈清泉');
  check('f3 前置杂讯 JSON', (llm.parseLlmJson('输出如下 {"names":[]}') || {}).names !== undefined);
  check('f4 非法输入 → null', llm.parseLlmJson('这不是JSON') === null
    && llm.parseLlmJson('') === null && llm.parseLlmJson(null) === null);

  // ===== 场景 g：降级路径 schema 完整性（回归保护）=====
  console.log('\n【场景 g】降级路径 schema 完整性');
  const candsD = (await db.collection('candidates').where({ _id: db.command.in(resD.candidateIds) }).get()).data;
  const badStruct = [];
  for (const c of candsD) {
    if (!Array.isArray(c.pinyin) || c.pinyin.length !== 3) badStruct.push(c.name + ':pinyin');
    if (!Array.isArray(c.tones) || c.tones.length !== 3) badStruct.push(c.name + ':tones');
    if (typeof (c.checks && c.checks.writeCost) !== 'number') badStruct.push(c.name + ':writeCost');
    if (typeof (c.checks && c.checks.homophonePutonghua) !== 'string') badStruct.push(c.name + ':hp');
  }
  check('g1 30 候选 schema 完整', candsD.length === 30 && badStruct.length === 0, badStruct.slice(0, 5).join(','));
  const leak = JSON.stringify(candsD).match(/score|星级|总分|评分|打分|quoteRef/i);
  check('g2 无分值/过渡字段外泄', leak === null, leak && ('命中: ' + leak[0]));

  // ===== 汇总 =====
  console.log('\n=========================================');
  console.log('B3 测试结果：通过 ' + pass + ' / 失败 ' + failCnt + '，总耗时 ' + (Date.now() - t0) + 'ms');
  if (failures.length) {
    console.log('失败项：');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('ALL PASS ✅');
}

main().catch((e) => { console.error('测试脚本异常：', e); process.exit(1); });
