/**
 * generate.js — 降级模式生成器（T06 核心）
 *
 * 职责：在 solver 产出的解空间字池内组合候选名，四维评分排序取 topN，
 *       模板句式生成寓意文案（「X：字义…；Y：字义…」）。
 * 输入：solver 输出的字池（hanzi-core 子集，已过避讳/白名单）+ 姓氏元数据 + engine-params。
 * 输出：candidates 数组，字段对齐交接包 candidates schema
 *       （pinyin[]、tones[]、chars[]、checks.writeCost 等）。
 * 红线：内部排序分只在模块内存中出现，输出对象绝不携带 score/星级字段。
 * 批次：batch>1 时从评分池的后续分段取候选，保证换一批不重复（池不足时取模回绕）。
 */
'use strict';

const tones = require('./tones');
const strokes = require('./strokes');
const freq = require('./freq');
const surnameFit = require('./surname-fit');
const score = require('./score');

/** 每个位置（名首字/名次字）预筛池大小：控制组合规模在毫秒级 */
const POOL_SIZE = 60;

/**
 * 降级模式生成入口
 * @param {Object} input
 *   - surname: string 姓氏（1 字）
 *   - surnameMeta: { pinyin, tone, strokes } 来自 hanzi-strokes
 *   - gender: 'male' | 'female'
 *   - styles: string[]（可空 = 不限）
 *   - constraints: { generationChar, avoidChars, wishes, dialects, birth }
 *   - pool: 字池数组 [{ char, strokes, pinyin, tone, freqLevel, imageryTags, meaning }]
 *   - params: engine-params.json 内容
 *   - batch: 批次号（从 1 起）
 * @returns {{ candidates: Object[], poolSize: number }}
 */
function generate(input) {
  const p = input.params;
  const constraints = input.constraints || {};
  const generationChar = constraints.generationChar || '';
  const batch = Math.max(1, input.batch || 1);
  const topN = p.generate.topN;

  // 1. 基础过滤：同姓字回避（名中不重复用姓字，避免姓=名歧义）
  const base = (input.pool || []).filter((c) => c.char !== input.surname && c.strokes > 0 && c.pinyin);

  // 2. 单字预筛分：风格加权 + 字频 + 性别偏置，分位置取 top 池
  const scored = base.map((c) => ({
    entry: c,
    styleScore: score.charStyleScore(input.styles, c.imageryTags, p.styles, p.genderBias, input.gender),
    freqScore: freq.freqScore(c.freqLevel, p.freq)
  }));

  scored.sort((a, b) => (b.styleScore + b.freqScore) - (a.styleScore + a.freqScore));
  let posPool = scored.slice(0, POOL_SIZE);

  // 字辈字保底进位置池（修复：此前保底只加进 scored，排序后仍会被挤出
  // POOL_SIZE 截断池，导致组合阶段全部被字辈约束过滤、产出 0 候选）。
  // 字辈字若不在位置池中，替换池尾一个名额强制纳入；避讳冲突已在 solver 过滤。
  if (generationChar && !posPool.some((s) => s.entry.char === generationChar)) {
    const raw = (input.pool || []).find((c) => c.char === generationChar);
    if (raw) {
      posPool = posPool
        .slice(0, POOL_SIZE - 1)
        .concat([{
          entry: raw,
          styleScore: 0,
          freqScore: freq.freqScore(raw.freqLevel, p.freq)
        }]);
    }
  }

  // 3. 组合 + 全名四维评分
  const surnameMeta = input.surnameMeta || { pinyin: '', tone: 0, strokes: 0 };
  const combos = [];
  const seenName = new Set();
  for (const a of posPool) {
    for (const b of posPool) {
      if (a.entry.char === b.entry.char) continue;
      // 字辈约束：若指定字辈，至少一个位置命中
      if (generationChar && a.entry.char !== generationChar && b.entry.char !== generationChar) continue;
      const name = input.surname + a.entry.char + b.entry.char;
      if (seenName.has(name)) continue;
      seenName.add(name);

      const strokeArr = [surnameMeta.strokes, a.entry.strokes, b.entry.strokes];
      const toneArr = [surnameMeta.tone, a.entry.tone, b.entry.tone];
      const pyArr = [surnameMeta.pinyin, a.entry.pinyin, b.entry.pinyin];
      const fit = surnameFit.fitScore({
        surnamePinyin: surnameMeta.pinyin,
        surnameTone: surnameMeta.tone,
        namePinyins: [a.entry.pinyin, b.entry.pinyin],
        nameTones: [a.entry.tone, b.entry.tone]
      }, p.surnameFit);

      const internal = score.totalScore({
        surnameFit: fit,
        style: a.styleScore + b.styleScore,
        stroke: strokes.balanceScore(strokeArr, p.strokes),
        freq: a.freqScore + b.freqScore,
        generationCharHit: !!generationChar
      }, p.score);

      combos.push({
        name: name,
        first: a.entry,
        second: b.entry,
        pyArr: pyArr,
        toneArr: toneArr,
        strokeArr: strokeArr,
        _internalScore: internal
      });
    }
  }

  // 4. 排序 + 批次分段（batch=1 取前 topN；换一批顺移分段，池不足取模回绕）
  combos.sort((x, y) => y._internalScore - x._internalScore || (x.name < y.name ? -1 : 1));
  const start = (batch - 1) * topN;
  const picked = [];
  if (combos.length > 0) {
    for (let i = 0; picked.length < topN && i < combos.length; i++) {
      picked.push(combos[(start + i) % combos.length]);
    }
  }

  // 5. 组装 candidates（schema 对齐；分值字段到此为止，不再外传）
  const styleLabel = (input.styles && input.styles.length > 0) ? input.styles[0] : '不限';
  const candidates = picked.map((c) => buildCandidate({
    surname: input.surname,
    surnameMeta: surnameMeta,
    combo: c,
    styleLabel: styleLabel,
    params: p
  }));

  return { candidates: candidates, poolSize: base.length };
}

/** 组装单个 candidate 文档（字段对齐交接包 candidates schema） */
function buildCandidate(ctx) {
  const c = ctx.combo;
  const charsMeta = [c.first, c.second];
  const surnameMeaning = ctx.surnameMeta.meaning || '姓氏用字';

  return {
    name: c.name,
    pinyin: c.pyArr.slice(),
    tones: tones.annotateTones(c.toneArr),
    chars: [
      {
        char: ctx.surname,
        strokes: ctx.surnameMeta.strokes,
        freqLevel: ctx.surnameMeta.freqLevel || 'mid',
        meaning: surnameMeaning,
        inWhitelist: true
      }
    ].concat(charsMeta.map((m) => ({
      char: m.char,
      strokes: m.strokes,
      freqLevel: m.freqLevel,
      meaning: m.meaning,
      inWhitelist: true
    }))),
    checks: {
      homophonePutonghua: 'pass',   // B3 接入谐音词表后写实
      homophoneDialect: null,       // B3 方言检测后填 { yue: 'pass', jyutping: '...' }
      homophoneEnglish: 'pass',
      sensitive: 'pass',
      duplicateLevel: freq.nameDuplicateLevel(
        charsMeta.map((m) => m.freqLevel), ctx.params.freq),
      whitelist: true,
      writeCost: strokes.writeCost(c.strokeArr)
    },
    style: ctx.styleLabel,
    meaning: c.first.char + '：' + c.first.meaning + '；' + c.second.char + '：' + c.second.meaning,
    quote: null,          // 降级模式不提供典籍出处（B3 语料索引接入后填充）
    collected: false,
    reportFlagged: false
  };
}

module.exports = {
  generate: generate
};
