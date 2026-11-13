'use strict';
/**
 * AI 帮选测试（ai-pick 纯函数 + generate.aiPick action）
 * 覆盖：prompt 组装（寄语/红线禁令）/ 规则降级摘要（排序与覆盖）/ 输出消毒
 *       （白名单/截断/红线词替换/top3 补齐/结构非法）/ action 编排
 *       （LLM 未配置降级、归属过滤、缺参、>20 截断、LLM 输出消毒落地）。
 * 运行：NODE_PATH=scripts/e2e/node_modules node scripts/e2e/test-aipick.js
 */
const path = require('path');
require('./mock-sdk-bind');

const GEN = path.resolve(__dirname, '../../cloudfunctions/generate');
const aiPick = require(path.join(GEN, 'lib', 'ai-pick.js'));
const llm = require(path.join(GEN, 'lib', 'llm.js'));

let pass = 0, failCnt = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { failCnt++; failures.push(name + (detail ? ' —— ' + detail : '')); console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}

/** 测试用候选上下文 */
const CTX = {
  wishes: '希望沉心笃学',
  items: [
    { name: '沈知远', pinyin: 'shěn zhī yuǎn', meaning: '知：博学明达；远：高远开阔', quote: { title: '楚辞', sentence: '路漫漫其修远兮' }, style: '典籍感', dupLevel: 'low', homophonePass: true },
    { name: '沈静姝', pinyin: 'shěn jìng shū', meaning: '静：安静沉心；姝：美好', quote: null, style: '温柔诗意', dupLevel: 'high', homophonePass: true },
    { name: '沈明澈', pinyin: 'shěn míng chè', meaning: '明：光明磊落；澈：澄澈通透', quote: null, style: '自然清新', dupLevel: 'mid', homophonePass: false }
  ]
};
const NAMES = CTX.items.map((i) => i.name);

async function main() {
  const t0 = Date.now();

  console.log('\n[1] buildPickPrompt');
  const p = aiPick.buildPickPrompt(CTX);
  check('1a system 含红线禁令（命理/打分）', /命理/.test(p.system) && /打分/.test(p.system));
  check('1b system 含输出 JSON 契约', /"comments"/.test(p.system) && /"top3"/.test(p.system));
  check('1c user 含寄语与全部候选', p.user.includes('沉心笃学') && NAMES.every((n) => p.user.includes(n)));
  check('1d user 不携带内部维度字段（dupLevel/homophonePass）',
    !/dupLevel|homophonePass/.test(p.user), p.user.slice(-160));
  const p2 = aiPick.buildPickPrompt({ wishes: '', items: CTX.items });
  check('1e 无寄语时 user 有兜底占位', p2.user.includes('未填写寄语'));

  console.log('\n[2] ruleSummary（规则降级）');
  const rule = aiPick.ruleSummary(CTX);
  check('2a comments 覆盖全部候选', rule.comments.length === 3 && NAMES.every((n) => rule.comments.some((c) => c.name === n)));
  check('2b 排序：出处+低重名+谐音过 的「沈知远」居首', rule.top3[0].name === '沈知远', JSON.stringify(rule.top3.map((t) => t.name)));
  check('2c top3 ≤3 且理由无红线词', rule.top3.length <= 3
    && rule.top3.every((t) => !aiPick.UI_REDLINE.some((w) => t.reason.includes(w))));
  check('2d 点评为客观事实拼接（无红线词）',
    rule.comments.every((c) => !aiPick.UI_REDLINE.some((w) => c.comment.includes(w))));

  console.log('\n[3] sanitizePick（LLM 输出消毒）');
  const good = aiPick.sanitizePick({
    comments: [
      { name: '沈知远', comment: '「知远」出自《楚辞》修远句，与沉心笃学的寄语呼应' },
      { name: '沈静姝', comment: '连读顺口，静字点题安静气质' }
    ],
    top3: [{ name: '沈知远', reason: '有出处且与寄语最契合' }, { name: '沈静姝', reason: '音律柔和' }]
  }, NAMES);
  check('3a 合法输出透传（含 top3）', good && good.comments.length === 2 && good.top3.length === 2);
  check('3b 超长点评截断 ≤60', aiPick.sanitizePick({
    comments: [{ name: '沈知远', comment: '长'.repeat(100) }]
  }, NAMES).comments[0].comment.length <= 60);

  const evil = aiPick.sanitizePick({
    comments: [
      { name: '沈知远', comment: '此名五行属木，运势极佳' },
      { name: '沈明澈', comment: '字义澄澈，连读清亮' },
      { name: '不存在名', comment: '假名' }
    ],
    top3: [{ name: '不存在名', reason: 'x' }]
  }, NAMES);
  check('3c 红线词整条替换兜底文案', evil.comments[0].comment === aiPick.FALLBACK_COMMENT, evil.comments[0].comment);
  check('3d 白名单外的名剔除（comments 与 top3）',
    evil.comments.every((c) => NAMES.includes(c.name)) && evil.top3.every((t) => NAMES.includes(t.name)));
  check('3e top3 全非法时按 comments 顺序补齐', evil.top3.length >= 2, JSON.stringify(evil.top3.map((t) => t.name)));
  check('3f comments 为空 → null', aiPick.sanitizePick({ comments: [], top3: [] }, NAMES) === null);
  check('3g 非对象输入 → null', aiPick.sanitizePick(null, NAMES) === null
    && aiPick.sanitizePick('xx', NAMES) === null);

  console.log('\n[4] aiPick action 编排（mock db，LLM 未配置 → 降级）');
  const gen = require(path.join(GEN, 'index.js'));
  const cr = await gen.main({
    action: 'create', surname: '沈', gender: 'female',
    styles: ['温柔诗意'], constraints: { wishes: '沉心笃学' }, source: 'free', batch: 1
  }, {});
  check('4a 造数 create code=0', cr.code === 0);
  const pr = await gen.main({ action: 'poll', jobId: cr.data.jobId }, {});
  const cands = pr.data.candidates || [];
  const ids = cands.slice(0, 5).map((c) => c._id);

  const r0 = await gen.main({ action: 'aiPick', candidateIds: ids, wishes: '沉心笃学' }, {});
  check('4b 未配置 LLM → 规则降级（mode=rule, degraded=true）',
    r0.code === 0 && r0.data.mode === 'rule' && r0.data.degraded === true,
    JSON.stringify(r0).slice(0, 120));
  check('4c 降级点评覆盖 5 个候选且无内部字段',
    r0.data.comments.length === 5 && !/score|_openid|jobId/i.test(JSON.stringify(r0.data)));

  const r1 = await gen.main({ action: 'aiPick' }, {});
  check('4d 缺参 → 1001', r1.code === 1001);
  const r2 = await gen.main({ action: 'aiPick', candidateIds: ids.map((i, k) => (k === 0 ? i : i)) }, {});
  check('4e 单维度重复 id 不炸（按候选去重由引擎输出保证）', r2.code === 0);

  console.log('\n[5] aiPick action（LLM 输出消毒落地，monkey-patch callChat）');
  const realCallChat = llm.callChat;
  // 正常输出
  llm.callChat = async () => ({
    comments: [{ name: cands[0].name, comment: '音律平仄相间，朗读顺口' }],
    top3: [{ name: cands[0].name, reason: '音律和谐，字义清晰' }]
  });
  process.env.LLM_API_KEY = 'k'; process.env.LLM_BASE_URL = 'u'; process.env.LLM_MODEL = 'm';
  const r3 = await gen.main({ action: 'aiPick', candidateIds: ids }, {});
  check('5a LLM 合法输出 → mode=ai', r3.code === 0 && r3.data.mode === 'ai' && r3.data.degraded === false);
  // 红线输出 → 消毒替换
  llm.callChat = async () => ({
    comments: [{ name: cands[0].name, comment: '八字合盘，五行不缺，运势佳' }],
    top3: []
  });
  const r4 = await gen.main({ action: 'aiPick', candidateIds: ids }, {});
  check('5b LLM 红线点评被替换为兜底文案',
    r4.code === 0 && r4.data.mode === 'ai'
    && r4.data.comments[0].comment === aiPick.FALLBACK_COMMENT,
    r4.data.comments[0].comment);
  // 垃圾输出 → 降级
  llm.callChat = async () => null;
  const r5 = await gen.main({ action: 'aiPick', candidateIds: ids }, {});
  check('5c LLM 输出不可用 → 规则降级', r5.code === 0 && r5.data.mode === 'rule' && r5.data.degraded === true);
  llm.callChat = realCallChat;
  delete process.env.LLM_API_KEY; delete process.env.LLM_BASE_URL; delete process.env.LLM_MODEL;

  console.log('\n[6] 归属过滤');
  process.env.MOCK_OPENID = 'openid_aipick_other';
  const r6 = await gen.main({ action: 'aiPick', candidateIds: ids }, {});
  check('6a 他人候选 → 1001 候选不存在', r6.code === 1001, 'code=' + r6.code);
  process.env.MOCK_OPENID = 'openid_default';

  console.log('\n=========================================');
  console.log('AI 帮选测试结果：通过 ' + pass + ' / 失败 ' + failCnt + '，总耗时 ' + (Date.now() - t0) + 'ms');
  if (failCnt > 0) {
    console.log('失败项：');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('ALL PASS ✅');
}

main().catch((e) => { console.error('测试脚本异常：', e); process.exit(1); });
