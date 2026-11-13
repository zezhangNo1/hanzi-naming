'use strict';
/**
 * 取名双通道（mode=fast/ai/auto）测试
 * 覆盖：jobHash 通道参与指纹 / create 通道解析与落库（job.mode）/
 *       fast 与 ai 生成任务隔离（不同 hash 不互串缓存）/ 非法 mode 兜底 auto /
 *       LLM 未配置时 ai/auto 走降级、fast 恒降级 / 热门字入池生效抽查（玥/岑可入名）。
 * 运行：NODE_PATH=scripts/e2e/node_modules node scripts/e2e/test-mode.js
 */
const path = require('path');
require('./mock-sdk-bind');

const GEN = path.resolve(__dirname, '../../cloudfunctions/generate');
const cache = require(path.join(GEN, 'lib', 'cache.js'));

let pass = 0, failCnt = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { failCnt++; failures.push(name + (detail ? ' —— ' + detail : '')); console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}

async function main() {
  const t0 = Date.now();
  console.log('\n[1] jobHash 通道参与指纹');
  const base = { surname: '沈', gender: 'female', styles: ['温柔诗意'], constraints: {}, batch: 1 };
  const hFast = cache.jobHash(Object.assign({}, base, { mode: 'fast' }));
  const hAi = cache.jobHash(Object.assign({}, base, { mode: 'ai' }));
  const hAuto = cache.jobHash(Object.assign({}, base));
  check('1a fast ≠ ai ≠ auto 三指纹互异', hFast !== hAi && hAi !== hAuto && hFast !== hAuto);
  check('1b 同通道指纹稳定', hFast === cache.jobHash(Object.assign({}, base, { mode: 'fast' })));

  console.log('\n[2] create 通道解析与落库（每单独立 openid，避免免费额度串扰）');
  const freshGen = (openid) => {
    for (const k of Object.keys(require.cache)) {
      if (k.startsWith(GEN)) delete require.cache[k];
    }
    process.env.MOCK_OPENID = openid;
    return require(path.join(GEN, 'index.js'));
  };
  const jobs = [];
  const modes = ['fast', 'ai', undefined, '什么鬼'];
  for (let i = 0; i < modes.length; i++) {
    const genI = freshGen('openid_mode_' + i);
    const payload = Object.assign({ action: 'create', surname: '沈', gender: 'female', styles: ['温柔诗意'], constraints: {}, source: 'free', batch: 1 });
    if (modes[i] !== undefined) payload.mode = modes[i];
    const r = await genI.main(payload, {});
    jobs.push({ in: modes[i], r: r });
    check('2 create(mode=' + (modes[i] || '缺省') + ') code=0', r.code === 0, JSON.stringify(r).slice(0, 100));
  }
  const gen = freshGen('openid_mode_0');
  const sdk = require('wx-server-sdk');
  const jobDocs = sdk.__store.name_jobs.docs;
  const byMode = {};
  for (const j of jobDocs) byMode[j._id] = j;
  const expectMode = ['fast', 'ai', 'auto', 'auto'];
  jobs.forEach((j, i) => {
    const doc = byMode[j.r.data.jobId];
    check('2 job.mode 落库正确（' + (j.in || '缺省') + ' → ' + expectMode[i] + '）',
      doc && doc.mode === expectMode[i], '实际 ' + (doc && doc.mode));
  });

  console.log('\n[3] 通道隔离与降级（LLM 未配置）');
  const ids = new Set(jobs.map((j) => j.r.data.jobId));
  check('3a 四次生成产出四个独立任务（无缓存互串）', ids.size === 4, '实际 ' + ids.size);
  const pollFast = await gen.main({ action: 'poll', jobId: jobs[0].r.data.jobId }, {});
  check('3b fast 通道候选 30 且 degraded=true（未配置 LLM 恒降级）',
    pollFast.code === 0 && pollFast.data.candidates.length === 30 && pollFast.data.degraded === true);

  console.log('\n[4] 热门字入池生效（v0.4）');
  const pool = require(path.join(GEN, 'data', 'name-pool.json'));
  const all = [...pool.chars.m, ...pool.chars.f, ...pool.chars.n];
  check('4a 池总量 665（v0.7 微补后）', all.length === 665, '实际 ' + all.length);
  const hot = '玥宥佑祐丞熙楚岑奕栩樾荞浔'.split('');
  check('4b 13 热门字全部在池', hot.every((c) => all.includes(c)));
  const core = require(path.join(GEN, 'data', 'hanzi-core.json'));
  const coreMap = {}; core.chars.forEach((c) => coreMap[c.char] = c);
  check('4c 热门字 hanzi-core 释义非占位（抽查 玥/岑/奕）',
    ['玥', '岑', '奕'].every((c) => coreMap[c] && coreMap[c].meaning && !/人名常用字|规范汉字/.test(coreMap[c].meaning)),
    JSON.stringify(['玥', '岑', '奕'].map((c) => coreMap[c] && coreMap[c].meaning)));
  // 验收口径：用户诉求是「字库可见热门字」（候选字库页全量展示）。生成引擎按
  // 产品口径刻意降权高重名热字（freq 惩罚），不强求生成命中——此为正确行为。
  const genL = freshGen('openid_mode_0');
  const board = await genL.main({ action: 'listChars' }, {});
  const boardChars = (board.data && board.data.chars) || [];
  const hotRows = boardChars.filter((c) => hot.includes(c.char));
  check('4d 候选字库 listChars 全量可见 13 热门字（含释义/热度/意象）',
    hotRows.length === 13 && hotRows.every((c) => c.meaning && c.freqLevel && Array.isArray(c.tags) && c.groups.length >= 1),
    '可见 ' + hotRows.length + '/13');

  console.log('\n=========================================');
  console.log('双通道测试结果：通过 ' + pass + ' / 失败 ' + failCnt + '，总耗时 ' + (Date.now() - t0) + 'ms');
  if (failCnt > 0) {
    console.log('失败项：');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('ALL PASS ✅');
}

main().catch((e) => { console.error('测试脚本异常：', e); process.exit(1); });
