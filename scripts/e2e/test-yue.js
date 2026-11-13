'use strict';
/**
 * B3.1 粤语 jyutping 谐音检测测试
 * 运行：NODE_PATH=scripts/e2e/node_modules node scripts/e2e/test-yue.js
 *
 * 覆盖：
 *   a) 硬表 fail：智鳩（zi3+gau1 命中 gau1=鳩）→ 剔除 + block detail；
 *   b) 软表 warn：慧珠（wai6+zyu1 命中 zyu1=豬）→ 保留 + checks 警示；
 *   c) 音近 warn：佩琳（pui3+lam4，lam 音近 lan2=撚）→ 保留 + 警示；
 *   d) pass：妙如（miu6+jyu4）→ 通过 + 写回完整 jyutping；
 *   e) 查无映射字 → 跳过方言检测（pass + 空 jyutping，不误报）；
 *   f) 全池不变量：665 池字粤拼映射 100% 覆盖（防扩池后漏配）；
 *   g) 集成：降级生成 30 候选 checks.homophoneDialect 全部为 {yue, jyutping} 对象且
 *      yue ∈ {pass, warn}（fail 级已被过滤剔除），jyutping 非空。
 */
require('./mock-sdk-bind');

const path = require('path');
const GEN = path.resolve(__dirname, '../../cloudfunctions/generate');

let pass = 0, failCnt = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { failCnt++; failures.push(name + (detail ? ' —— ' + detail : '')); console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}
/** 造候选（chars 含姓，粤语检测只看 chars[1..]） */
function cand(surname, given, pinyin) {
  return {
    name: surname + given,
    pinyin: pinyin,
    chars: [{ char: surname }].concat(Array.from(given).map((ch) => ({ char: ch }))),
    checks: {}
  };
}

(async () => {
  const t0 = Date.now();
  const { JYUTPING } = require(path.join(GEN, 'lib/filter/jyutping-map.js'));
  const homophone = require(path.join(GEN, 'lib/filter/homophone.js'));

  console.log('\n【场景 A】分级检测单测');
  // a) 硬表 fail
  const a1 = homophone.check(cand('沈', '智鳩', ['shěn', 'zhì', 'jiū']));
  check('A1 智鳩 → yue=fail（gau1 硬命中）', a1.homophoneDialect.yue === 'fail' && a1.pass === false,
    JSON.stringify(a1.homophoneDialect));
  const fr1 = homophone.filterCandidates([cand('沈', '智鳩', ['shěn', 'zhì', 'jiū'])]);
  check('A2 fail 剔除 + detail 粤语谐音', fr1.passed.length === 0 && fr1.blocked.length === 1
    && /粤语谐音/.test(fr1.blocked[0].detail), JSON.stringify(fr1.blocked));

  // b) 软表 warn
  const fr2 = homophone.filterCandidates([cand('沈', '慧珠', ['shěn', 'huì', 'zhū'])]);
  check('B1 慧珠 → 软表 warn 保留', fr2.passed.length === 1 && fr2.warns.length === 1
    && fr2.passed[0].checks.homophoneDialect.yue === 'warn',
    JSON.stringify(fr2.warns));

  // c) 多音节音近 warn：秀霏（sau3+fei1，saufei 音近 saupei=收皮）
  const fr3 = homophone.filterCandidates([cand('沈', '秀霏', ['shěn', 'xiù', 'fēi'])]);
  check('C1 秀霏 → 多音节音近 warn 保留', fr3.passed.length === 1 && fr3.warns.length === 1
    && fr3.passed[0].checks.homophoneDialect.yue === 'warn',
    JSON.stringify(fr3.warns));
  // c2) 单音节音近不告警（韵尾 -m/-n 对立：佩琳 pui3+lam4 不算音近 撚 lan2）
  const a3 = homophone.check(cand('沈', '佩琳', ['shěn', 'pèi', 'lín']));
  check('C2 佩琳 → 单音节韵尾对立不告警（yue=pass）', a3.homophoneDialect.yue === 'pass'
    && a3.homophoneDialect.jyutping === 'pui3lam4', JSON.stringify(a3.homophoneDialect));

  // d) pass
  const a4 = homophone.check(cand('沈', '妙如', ['shěn', 'miào', 'rú']));
  check('D1 妙如 → yue=pass + 完整 jyutping', a4.homophoneDialect.yue === 'pass'
    && a4.homophoneDialect.jyutping === 'miu6jyu4', JSON.stringify(a4.homophoneDialect));

  // e) 查无映射字跳过
  const a5 = homophone.check(cand('沈', '㙓垚', ['shěn', '', '']));
  check('E1 无映射字 → pass + 空 jyutping（不误报）', a5.homophoneDialect.yue === 'pass'
    && a5.homophoneDialect.jyutping === '', JSON.stringify(a5.homophoneDialect));

  console.log('\n【场景 B】全池映射不变量');
  const pool = require(path.resolve(__dirname, '../../database/name-pool.json'));
  const all = [...new Set([...pool.chars.m, ...pool.chars.f, ...pool.chars.n])];
  const noMap = all.filter((ch) => !JYUTPING[ch]);
  check('B1 665 池字粤拼 100% 覆盖', noMap.length === 0, '缺：' + noMap.join(''));
  const badFmt = all.filter((ch) => !/^[a-z]+[1-6]$/.test(JYUTPING[ch] || ''));
  check('B2 粤拼格式合法（字母+声调 1-6）', badFmt.length === 0,
    '非法：' + badFmt.slice(0, 10).map((c) => c + '=' + JYUTPING[c]).join(','));

  console.log('\n【场景 C】降级生成集成（粤语检测并入全链路）');
  process.env.MOCK_OPENID = 'openid_yue';
  for (const k of Object.keys(require.cache)) {
    if (k.startsWith(GEN)) delete require.cache[k];
  }
  delete require.cache[require.resolve(path.resolve(__dirname, '../../database/name-pool.json'))];
  const mod = require(path.join(GEN, 'index.js'));
  const cr = await mod.main({
    action: 'create', surname: '陈', gender: 'female',
    styles: ['温柔诗意'], constraints: {}, source: 'free', batch: 1
  }, {});
  const pr = await mod.main({ action: 'poll', jobId: cr.data.jobId }, {});
  const cands = (pr.code === 0 && pr.data.candidates) || [];
  check('C1 降级生成 30 候选（粤语硬表未误杀整批）', cands.length === 30, '实际 ' + cands.length);
  const badDia = cands.filter((c) => !c.checks.homophoneDialect
    || !c.checks.homophoneDialect.yue
    || ['pass', 'warn'].indexOf(c.checks.homophoneDialect.yue) === -1
    || !c.checks.homophoneDialect.jyutping);
  check('C2 homophoneDialect 全部 {yue∈pass|warn, jyutping 非空}',
    badDia.length === 0, '异常 ' + badDia.length + ' 个：'
      + badDia.slice(0, 3).map((c) => c.name + JSON.stringify(c.checks.homophoneDialect)).join(' | '));
  const warnCnt = cands.filter((c) => c.checks.homophoneDialect.yue === 'warn').length;
  console.log('  ℹ️ 本批粤语 warn ' + warnCnt + ' 个（软表/音近，保留展示）');

  // ===== 汇总 =====
  console.log('\n=========================================');
  console.log('B3.1 粤语检测结果：通过 ' + pass + ' / 失败 ' + failCnt + '，总耗时 ' + (Date.now() - t0) + 'ms');
  if (failures.length) {
    console.log('失败项：');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('ALL PASS ✅');
})().catch((e) => { console.error('模拟脚本异常：', e); process.exit(1); });
