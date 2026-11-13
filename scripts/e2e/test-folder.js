'use strict';
/**
 * T09 选名夹端到端模拟（INTENT-T09 自检）
 * 场景：mock 云数据库 + mock openid，直调 generate / user 云函数 exports.main。
 * 覆盖：listFolder 正常返回（摘要字段 + 脱敏 + 排序 + limit 夹取）/
 *       收藏→列表→取消→列表联动 / 空选名夹 / 孤儿收藏行（候选已删）跳过 /
 *       他人 openid 不可见（隔离）。
 * 运行：NODE_PATH=scripts/e2e/node_modules node scripts/e2e/test-folder.js
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
  console.log('\n【场景 A】生成 → 收藏 3 个 → listFolder 正常链路（openid_T09）');
  const gen = freshGen('openid_T09');
  const cr = await gen.main({
    action: 'create', surname: '林', gender: 'male',
    styles: ['英气飒爽'], constraints: {}, source: 'free', batch: 1
  }, {});
  check('A1 create code=0', cr.code === 0, JSON.stringify(cr).slice(0, 120));
  const pr = await gen.main({ action: 'poll', jobId: cr.data.jobId }, {});
  const cands = (pr.code === 0 && pr.data.candidates) || [];
  check('A2 poll 返回 30 候选', cands.length === 30, '实际 ' + cands.length);

  process.env.MOCK_OPENID = 'openid_T09';
  const user = require(USER + '/index.js');
  const picks = [cands[0]._id, cands[1]._id, cands[2]._id];
  for (const cid of picks) {
    const r = await user.main({ action: 'collect', candidateId: cid }, {});
    if (r.code !== 0) { check('A3 收藏 ' + cid + ' 失败', false, JSON.stringify(r).slice(0, 120)); }
  }
  check('A3 收藏 3 个候选全部 code=0', true);
  // 第二个补一条备注（幂等更新路径）
  await user.main({ action: 'collect', candidateId: picks[1], note: '爷爷喜欢' }, {});

  const fr = await user.main({ action: 'listFolder' }, {});
  check('A4 listFolder code=0', fr.code === 0, JSON.stringify(fr).slice(0, 120));
  const list = (fr.data && fr.data.list) || [];
  check('A5 返回 3 行且 total=3', list.length === 3 && fr.data.total === 3, '实际 ' + list.length + '/' + fr.data.total);

  const row = list.find((x) => x.candidateId === picks[1]) || {};
  const cand = row.candidate || {};
  check('A6 行结构齐备（candidateId/note/collectedAt/candidate）',
    typeof row.candidateId === 'string' && typeof row.note === 'string'
    && typeof row.collectedAt === 'number' && cand && typeof cand.name === 'string');
  check('A7 备注幂等更新可见（爷爷喜欢）', row.note === '爷爷喜欢', 'note=' + JSON.stringify(row.note));
  check('A8 候选摘要六维字段齐备（name/pinyin/tones/chars/checks/meaning）',
    typeof cand.name === 'string' && cand.name.length === 3
    && Array.isArray(cand.pinyin) && Array.isArray(cand.tones)
    && Array.isArray(cand.chars) && cand.chars.length === 3
    && cand.checks && typeof cand.checks.duplicateLevel === 'string'
    && typeof cand.meaning === 'string');

  const leaked = JSON.stringify(fr.data);
  const bad = ['_openid', 'jobId', 'score', 'quoteRef', '_internalScore'].filter((k) => leaked.includes(k));
  check('A9 输出零内部字段外泄', bad.length === 0, '命中 ' + bad.join(','));

  console.log('\n【场景 B】排序与 limit 夹取');
  // 制造可区分时间戳：把 picks[1] 的 updatedAt 拉到未来，验证「最近操作在前」
  const sdk = require('wx-server-sdk');
  const favB = sdk.__store.favorites.docs.find((d) => d.candidateId === picks[1]);
  favB.updatedAt = favB.updatedAt + 10000;
  const l1 = await user.main({ action: 'listFolder', limit: 1 }, {});
  check('B1 limit=1 只回 1 行', l1.code === 0 && l1.data.list.length === 1, '实际 ' + l1.data.list.length);
  const lBad = await user.main({ action: 'listFolder', limit: 'abc' }, {});
  check('B2 limit 非法值兜底不报错', lBad.code === 0 && lBad.data.list.length === 3, 'code=' + lBad.code);
  // 排序：最近收藏/更新的在前（picks[1] 刚被幂等更新过 updatedAt，应居首）
  check('B3 最近操作的行排最前', l1.data.list[0].candidateId === picks[1],
    '首行=' + l1.data.list[0].candidateId);

  console.log('\n【场景 C】取消收藏 → 列表联动');
  const u1 = await user.main({ action: 'uncollect', candidateId: picks[0] }, {});
  const f2 = await user.main({ action: 'listFolder' }, {});
  const ids2 = f2.data.list.map((x) => x.candidateId);
  check('C1 uncollect 后列表剩 2 行且不含被移除项',
    u1.code === 0 && ids2.length === 2 && !ids2.includes(picks[0]),
    '实际 ' + JSON.stringify(ids2));
  await user.main({ action: 'uncollect', candidateId: picks[1] }, {});
  await user.main({ action: 'uncollect', candidateId: picks[2] }, {});
  const f3 = await user.main({ action: 'listFolder' }, {});
  check('C2 全部取消后空选名夹（total=0）', f3.code === 0 && f3.data.total === 0 && f3.data.list.length === 0);

  console.log('\n【场景 D】孤儿收藏行（候选文档已不存在）跳过不阻断');
  sdk.__store.favorites.docs.push({
    _openid: 'openid_T09', candidateId: 'candidates_999_ghost', note: '',
    createdAt: 1, updatedAt: 1
  });
  const f4 = await user.main({ action: 'listFolder' }, {});
  check('D1 孤儿行被跳过，列表为空且 code=0',
    f4.code === 0 && f4.data.list.length === 0, 'code=' + f4.code + ' 行数=' + f4.data.list.length);

  console.log('\n【场景 E】他人 openid 隔离');
  process.env.MOCK_OPENID = 'openid_T09_other';
  const f5 = await user.main({ action: 'listFolder' }, {});
  check('E1 他人选名夹为空（不可见他人收藏）',
    f5.code === 0 && f5.data.total === 0, JSON.stringify(f5.data).slice(0, 120));

  // ===== 汇总 =====
  console.log('\n=========================================');
  console.log('T09 选名夹模拟结果：通过 ' + pass + ' / 失败 ' + failCnt + '，总耗时 ' + (Date.now() - t0) + 'ms');
  if (failures.length) {
    console.log('失败项：');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('ALL PASS ✅');
}

main().catch((e) => { console.error('模拟脚本异常：', e); process.exit(1); });
