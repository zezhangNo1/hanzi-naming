/**
 * pipeline.js — 生成流水线编排（B3：真实 LLM + 过滤全链路）
 *
 * 编排顺序：
 *   solver 解空间 → LLM（isConfigured 才走；≤3 次尝试，每次 LLM 结果过 filter.runAll，
 *   通过数 ≥10 视为成功批次）→ 成功后不足 30 用规则引擎补齐（LLM 候选排前）
 *   → LLM 全部失败/通过不足 → degrade.runDegenerate 整批降级（degraded=true，
 *   逐段过滤补齐到 30）→ 落库 candidates + 更新 name_jobs（增记 llmUsed/attemptCount）。
 */
'use strict';

const cloud = require('wx-server-sdk');
const solver = require('./solver');
const llm = require('./llm');
const degrade = require('./degrade');
const filter = require('./filter/index');
const loader = require('./data-loader');
const tones = require('./engine/tones');
const strokes = require('./engine/strokes');
const freq = require('./engine/freq');

// 独立入口保障：pipeline 可能被 index.js 之外的测试脚本直接 require，此处幂等 init
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/** 每批目标候选数 */
const BATCH_SIZE = 30;
/** LLM 批次成功的最小通过数 */
const MIN_LLM_PASS = 10;
/** LLM 最大尝试次数（含首次；3 次仍不足 → 整批降级） */
const MAX_ATTEMPTS = 3;
/** 规则引擎补齐的最大段数（防死循环护栏） */
const MAX_FILL_SEGMENTS = 10;

/**
 * 执行一次生成任务
 * @param {Object} job { jobId, surname, gender, styles, constraints, source, batch }
 * @returns {Promise<{ status: 'done', candidateIds: string[], degraded: boolean, llmUsed: boolean, attemptCount: number, latencyMs: number }>}
 */
async function run(job) {
  const startedAt = Date.now();
  const constraints = job.constraints || {};

  // 3. 白名单解空间筛选
  const solved = solver.solve({
    surname: job.surname,
    gender: job.gender,
    styles: job.styles,
    constraints: constraints,
    params: loader.engineParams
  });

  // 与候选字集有交集的可用语料（prompt 用，最多 30 条）
  const poolCharSet = new Set(solved.llmPool.map((c) => c.char));
  const usableQuotes = (loader.quotesIndex.quotes || [])
    .filter((q) => (q.chars || []).some((ch) => poolCharSet.has(ch)))
    .slice(0, 30);

  // 过滤器上下文（统一落 block_log）
  const filterCtx = { db: db, jobId: job.jobId, constraints: constraints };

  let candidates = [];
  let degraded = true;
  let llmUsed = false;
  let attemptCount = 0;

  if (llm.isConfigured()) {
    const charMetaMap = buildCharMetaMap(solved.pool);
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      attemptCount = attempt;
      const llmResult = await llm.callLlm({
        surname: job.surname,
        gender: job.gender,
        styles: job.styles,
        constraints: constraints,
        llmPool: solved.llmPool,
        quotes: usableQuotes
      });
      if (!llmResult || !Array.isArray(llmResult.names)) continue; // 本次尝试失败

      const mapped = mapLlmCandidates(llmResult.names, {
        surname: job.surname,
        surnameMeta: solved.surnameMeta,
        charMetaMap: charMetaMap,
        constraints: constraints,
        styles: job.styles
      });
      const fr = await filter.runAll(mapped, filterCtx);
      if (fr.passed.length >= MIN_LLM_PASS) {
        // 上限截断：LLM 通过数可能超 30，截断在补齐逻辑之前，保证落库恒 ≤30
        candidates = fr.passed.slice(0, BATCH_SIZE);
        degraded = false;
        llmUsed = true;
        break;
      }
      console.error('[pipeline] LLM 尝试 ' + attempt + ' 通过数不足（'
        + fr.passed.length + '/' + MIN_LLM_PASS + '）');
    }
  }

  if (!llmUsed) {
    // 整批降级：规则引擎直出，逐段过滤补齐到 30
    const filled = [];
    const seen = new Set();
    const startSeg = Math.max(1, job.batch || 1);
    for (let seg = startSeg; filled.length < BATCH_SIZE && seg < startSeg + MAX_FILL_SEGMENTS; seg++) {
      const deg = degrade.runDegenerate({
        surname: job.surname,
        surnameMeta: solved.surnameMeta,
        gender: job.gender,
        styles: job.styles,
        constraints: constraints,
        pool: solved.pool,
        params: loader.engineParams,
        batch: seg
      });
      const fr = await filter.runAll(deg.candidates, filterCtx);
      for (const c of fr.passed) {
        if (filled.length >= BATCH_SIZE) break;
        if (!seen.has(c.name)) { seen.add(c.name); filled.push(c); }
      }
    }
    candidates = filled;
    degraded = true;
  } else if (candidates.length < BATCH_SIZE) {
    // LLM 成功批次：不足 30 用规则引擎补齐（补齐候选自然不带 quote，LLM 候选排前）
    const seen = new Set(candidates.map((c) => c.name));
    const startSeg = Math.max(1, job.batch || 1);
    for (let seg = startSeg; candidates.length < BATCH_SIZE && seg < startSeg + MAX_FILL_SEGMENTS; seg++) {
      const deg = degrade.runDegenerate({
        surname: job.surname,
        surnameMeta: solved.surnameMeta,
        gender: job.gender,
        styles: job.styles,
        constraints: constraints,
        pool: solved.pool,
        params: loader.engineParams,
        batch: seg
      });
      const fr = await filter.runAll(deg.candidates, filterCtx);
      for (const c of fr.passed) {
        if (candidates.length >= BATCH_SIZE) break;
        if (!seen.has(c.name)) { seen.add(c.name); candidates.push(c); }
      }
    }
  }

  // 7. 落库 candidates + 更新 name_jobs
  const latencyMs = Date.now() - startedAt;
  const candidateIds = [];
  for (const cand of candidates) {
    const doc = Object.assign({}, cand, {
      _openid: job.openid,
      jobId: job.jobId,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    const added = await db.collection('candidates').add({ data: doc });
    candidateIds.push(added._id);
  }

  await db.collection('name_jobs').doc(job.jobId).update({
    data: {
      status: 'done',
      candidateIds: candidateIds,
      degraded: degraded,
      llmUsed: llmUsed,
      attemptCount: attemptCount,
      latencyMs: latencyMs,
      poolSize: solved.pool.length,
      updatedAt: Date.now()
    }
  });

  return {
    status: 'done',
    candidateIds: candidateIds,
    degraded: degraded,
    llmUsed: llmUsed,
    attemptCount: attemptCount,
    latencyMs: latencyMs
  };
}

/**
 * 字池元数据 Map：字 → { strokes, pinyin, tone, freqLevel, meaning }
 * （LLM 输出映射用；池本身已过白名单/避讳/名用性过滤）
 */
function buildCharMetaMap(pool) {
  const map = {};
  for (const c of pool || []) map[c.char] = c;
  return map;
}

/**
 * LLM names → 统一候选 schema 映射。
 * 规则：必须为「姓 + 2 名字」三字名；名字用字必须能在字池取到元数据
 * （取不到 = 白名单外，直接淘汰）；不携带任何分值字段。
 * @param {Object[]} llmNames LLM 输出的 names 数组
 * @param {Object} ctx { surname, surnameMeta, charMetaMap, constraints, styles }
 * @returns {Object[]} 统一 schema 候选数组
 */
function mapLlmCandidates(llmNames, ctx) {
  const surname = ctx.surname;
  const surnameMeta = ctx.surnameMeta || { pinyin: '', tone: 0, strokes: 0, meaning: '姓氏用字', freqLevel: 'mid' };
  const styleLabel = (ctx.styles && ctx.styles.length > 0) ? ctx.styles[0] : '不限';
  const out = [];
  const seenName = new Set();

  for (const item of llmNames || []) {
    const name = item && typeof item.name === 'string' ? item.name.trim() : '';
    const chars = Array.from(name);
    // 结构校验：三字名且首字为姓氏（LLM 违反结构直接淘汰该条）
    if (chars.length !== 3 || chars[0] !== surname) continue;
    const given = [chars[1], chars[2]];
    if (given[0] === given[1]) continue;

    // 逐字回查字池：取不到的字视为白名单外，整名淘汰
    const metas = [];
    let ok = true;
    for (const ch of given) {
      const meta = ctx.charMetaMap[ch];
      if (!meta || !meta.pinyin || !meta.strokes) { ok = false; break; }
      metas.push(meta);
    }
    if (!ok) continue;
    if (seenName.has(name)) continue;
    seenName.add(name);

    const meaning = typeof item.meaning === 'string' ? item.meaning.slice(0, 30) : '';
    const quoteRef = (item.quoteRef && typeof item.quoteRef === 'object')
      ? { key: item.quoteRef.key, author: item.quoteRef.author, title: item.quoteRef.title, sentence: item.quoteRef.sentence }
      : null;

    out.push({
      name: name,
      pinyin: [surnameMeta.pinyin, metas[0].pinyin, metas[1].pinyin],
      tones: tones.annotateTones([surnameMeta.tone, metas[0].tone, metas[1].tone]),
      chars: [
        {
          char: surname,
          strokes: surnameMeta.strokes,
          freqLevel: surnameMeta.freqLevel || 'mid',
          meaning: surnameMeta.meaning || '姓氏用字',
          inWhitelist: true
        }
      ].concat(metas.map((m) => ({
        char: m.char,
        strokes: m.strokes,
        freqLevel: m.freqLevel,
        meaning: m.meaning,
        inWhitelist: true
      }))),
      checks: {
        homophonePutonghua: 'pass',   // 由 homophone 过滤器写实
        homophoneDialect: null,       // TODO(B3.1) 粤语 jyutping
        homophoneEnglish: 'pass',
        sensitive: 'pass',            // 由 seccheck 层整批裁定
        duplicateLevel: freq.nameDuplicateLevel(
          metas.map((m) => m.freqLevel), loader.engineParams.freq),
        whitelist: true,
        writeCost: strokes.writeCost([surnameMeta.strokes, metas[0].strokes, metas[1].strokes])
      },
      style: typeof item.style === 'string' && item.style ? item.style.slice(0, 10) : styleLabel,
      meaning: meaning,
      quote: null,          // 由 quote-verify 过滤器回填或置 null
      quoteRef: quoteRef,   // 过渡字段，quote-verify 校验后删除
      collected: false,
      reportFlagged: false
    });
  }
  return out;
}

module.exports = {
  run: run,
  mapLlmCandidates: mapLlmCandidates
};
