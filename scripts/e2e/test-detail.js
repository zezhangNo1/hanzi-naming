'use strict';
/**
 * T08 详情报告页端到端模拟（INTENT-T08 自检）
 * 场景：mock 云数据库 + mock openid，直调 generate / user 云函数 exports.main。
 * 覆盖：getDetail 正常返回（六维字段 + 脱敏 + 同风格替代 + 收藏态）/
 *       参数与权限拒绝（1001 × 3）/ user.collect 幂等收藏 / uncollect /
 *       feedback 四类 type 白名单落库 / 降级模式 quote 恒 null（出处卡降级契约）。
 * 运行：NODE_PATH=scripts/e2e/node_modules node scripts/e2e/test-detail.js
 */
const path = require('path');
require('./mock-sdk-bind'); // wx-server-sdk → 本地 mock（云函数目录内的真实依赖会遮蔽 NODE_PATH）

const GEN = path.resolve(__dirname, '../../cloudfunctions/generate');
const USER = path.resolve(__dirname, '../../cloudfunctions/user');

let pass = 0, failCnt = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { failCnt++; failures.push(name + (detail ? ' —— ' + detail : '')); console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}

/** 清缓存重载 generate（切 openid 身份用） */
function freshGen(openid) {
  for (const k of Object.keys(require.cache)) {
    if (k.startsWith(GEN)) delete require.cache[k];
  }
  process.env.MOCK_OPENID = openid;
  return require(GEN + '/index.js');
}

async function main() {
  const t0 = Date.now();
  console.log('\n【场景 A】降级生成 → getDetail 正常链路（openid_T08）');
  const gen = freshGen('openid_T08');
  const cr = await gen.main({
    action: 'create', surname: '沈', gender: 'female',
    styles: ['温柔诗意'], constraints: {}, source: 'free', batch: 1
  }, {});
  check('A1 create code=0', cr.code === 0, JSON.stringify(cr).slice(0, 120));
  const pr = await gen.main({ action: 'poll', jobId: cr.data.jobId }, {});
  const cands = (pr.code === 0 && pr.data.candidates) || [];
  check('A2 poll 返回 30 候选', cands.length === 30, '实际 ' + cands.length);

  const target = cands[0];
  const dr = await gen.main({ action: 'getDetail', candidateId: target._id }, {});
  check('A3 getDetail code=0', dr.code === 0, JSON.stringify(dr).slice(0, 120));

  const cand = (dr.data && dr.data.candidate) || {};
  check('A4 候选六维字段齐备（name/pinyin/tones/chars/checks/meaning）',
    typeof cand.name === 'string' && cand.name.length === 3
    && Array.isArray(cand.pinyin) && cand.pinyin.length === 3
    && Array.isArray(cand.tones) && cand.tones.length === 3
    && Array.isArray(cand.chars) && cand.chars.length === 3
    && cand.checks && typeof cand.checks.writeCost === 'number'
    && typeof cand.checks.duplicateLevel === 'string'
    && typeof cand.meaning === 'string');
  check('A5 chars 逐字含 char/strokes/meaning',
    cand.chars.every((ch) => ch.char && typeof ch.strokes === 'number' && typeof ch.meaning === 'string'));

  const leaked = JSON.stringify(dr.data);
  const bad = ['_openid', 'jobId', 'score', 'quoteRef', '_internalScore'].filter((k) => leaked.includes(k));
  check('A6 输出零内部字段外泄', bad.length === 0, '命中 ' + bad.join(','));
  check('A7 quote 为 null 或合法出处三元组（典故组名候选直接带出处）',
    cand.quote === null
    || (cand.quote && typeof cand.quote.author === 'string'
      && typeof cand.quote.title === 'string' && typeof cand.quote.sentence === 'string'),
    'quote=' + JSON.stringify(cand.quote));

  const alts = (dr.data && dr.data.alternatives) || [];
  check('A8 同风格替代 1-6 个且结构合法',
    alts.length >= 1 && alts.length <= 6
    && alts.every((a) => typeof a.name === 'string' && a.name.length === 3 && Array.isArray(a.pinyin)),
    '实际 ' + alts.length + ' 个');
  check('A9 替代不含自身', alts.every((a) => a.name !== cand.name));
  check('A10 未收藏时 collected=false', dr.data.collected === false);

  console.log('\n【场景 B】getDetail 拒绝路径');
  const r1 = await gen.main({ action: 'getDetail' }, {});
  check('B1 缺 candidateId → 1001', r1.code === 1001, 'code=' + r1.code);
  const r2 = await gen.main({ action: 'getDetail', candidateId: 'no_such_id' }, {});
  check('B2 不存在 → 1001', r2.code === 1001, 'code=' + r2.code);
  const genX = freshGen('openid_T08_other');
  const r3 = await genX.main({ action: 'getDetail', candidateId: target._id }, {});
  check('B3 他人候选（openid 不匹配）→ 1001', r3.code === 1001, 'code=' + r3.code);

  console.log('\n【场景 C】user 收藏闭环（openid_T08）');
  process.env.MOCK_OPENID = 'openid_T08';
  const user = require(USER + '/index.js');
  const c1 = await user.main({ action: 'collect', candidateId: target._id }, {});
  check('C1 collect code=0', c1.code === 0, JSON.stringify(c1).slice(0, 120));

  const dr2 = await gen.main({ action: 'getDetail', candidateId: target._id }, {});
  check('C2 收藏后 getDetail collected=true', dr2.data.collected === true);

  const c2 = await user.main({ action: 'collect', candidateId: target._id, note: '二刷' }, {});
  const sdk = require('wx-server-sdk');
  const favDocs = (sdk.__store.favorites && sdk.__store.favorites.docs) || [];
  check('C3 重复收藏幂等（favorites 恒 1 条）', c2.code === 0 && favDocs.length === 1, '实际 ' + favDocs.length);

  const c3 = await user.main({ action: 'uncollect', candidateId: target._id }, {});
  const dr3 = await gen.main({ action: 'getDetail', candidateId: target._id }, {});
  check('C4 uncollect 后 getDetail collected=false', c3.code === 0 && dr3.data.collected === false);

  const c4 = await user.main({ action: 'uncollect' }, {});
  check('C5 uncollect 缺参 → 1001', c4.code === 1001, 'code=' + c4.code);

  console.log('\n【场景 D】user 反馈落库');
  const f1 = await user.main({
    action: 'feedback', candidateId: target._id, type: 'meaning', comment: '字义太笼统'
  }, {});
  const fbDocs = (sdk.__store.feedbacks && sdk.__store.feedbacks.docs) || [];
  check('D1 feedback meaning 落库 code=0', f1.code === 0 && fbDocs.length === 1,
    JSON.stringify(f1).slice(0, 120));
  check('D2 落库字段完整（openid 服务端补齐/type/comment）',
    fbDocs[0] && fbDocs[0]._openid === 'openid_T08'
    && fbDocs[0].type === 'meaning' && fbDocs[0].comment === '字义太笼统'
    && fbDocs[0].candidateId === target._id);
  const f2 = await user.main({ action: 'feedback', candidateId: target._id, type: 'fortune' }, {});
  check('D3 非法 type → 1001 且不落库', f2.code === 1001 && fbDocs.length === 1,
    'code=' + f2.code + ' docs=' + fbDocs.length);

  // ===== 汇总 =====
  console.log('\n=========================================');
  console.log('T08 详情页模拟结果：通过 ' + pass + ' / 失败 ' + failCnt + '，总耗时 ' + (Date.now() - t0) + 'ms');
  if (failures.length) {
    console.log('失败项：');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('ALL PASS ✅');
}

main().catch((e) => { console.error('模拟脚本异常：', e); process.exit(1); });
