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
 *   - rng: 可选随机函数（缺省 Math.random；测试注入 seeded RNG 保证可复现）
 * @returns {{ candidates: Object[], poolSize: number }}
 */
function generate(input) {
  const p = input.params;
  const constraints = input.constraints || {};
  const generationChar = constraints.generationChar || '';
  const batch = Math.max(1, input.batch || 1);
  const topN = p.generate.topN;
  // 受控探索：RNG 可注入（测试传 mulberry32 等 seeded RNG）；未注入走 Math.random
  const rng = typeof input.rng === 'function' ? input.rng : Math.random;
  const jitterRatio = (p.exploration && p.exploration.jitterRatio) || 0;

  // 1. 基础过滤：同姓字回避（名中不重复用姓字，避免姓=名歧义）
  //    + 笔画下限（minCharStrokes：滤掉丁/乃/丫/丸类 1-2 画怪字，默认 3 画起）
  const minStrokes = (p.generate && p.generate.minCharStrokes) || 1;
  const base = (input.pool || []).filter((c) =>
    c.char !== input.surname && c.strokes >= minStrokes && c.strokes > 0 && c.pinyin);

  // 2. 单字预筛分：风格加权 + 字频 + 性别偏置 + 精选池性别亲和，分位置取 top 池
  //    性别亲和：精选池标注 m/f/n，与请求性别一致 +1.5、相反 -1、中性 0
  const scored = base.map((c) => {
    const aff = c.genderAffinity
      ? (c.genderAffinity === input.gender ? 1.5 : -1)
      : 0;
    return {
      entry: c,
      styleScore: score.charStyleScore(input.styles, c.imageryTags, p.styles, p.genderBias, input.gender) + aff,
      freqScore: freq.freqScore(c.freqLevel, p.freq)
    };
  });

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

  // 位置池意象覆盖：首标签（imageryTags[0]）种类过少时（< minTagVariety，默认 6），
  // 从 scored 剩余部分按「每标签最多补 tagFillPerTag（默认 8）字」换入池尾名额
  // （字辈保底位不参与替换），防止单一意象霸占位置池导致候选同质化。
  const minTagVariety = (p.generate && p.generate.minTagVariety) || 6;
  const tagFillPerTag = (p.generate && p.generate.tagFillPerTag) || 8;
  const tagFillMax = (p.generate && p.generate.tagFillMax) || 20;
  const firstTagOf = (s) => (s.entry.imageryTags && s.entry.imageryTags[0]) || '无';
  {
    const tagSet = new Set(posPool.map(firstTagOf));
    if (tagSet.size < minTagVariety) {
      const inPool = new Set(posPool.map((s) => s.entry.char));
      const fillCount = {};
      const fillers = [];
      for (let i = 0; i < scored.length && fillers.length < tagFillMax; i++) {
        const s = scored[i];
        if (inPool.has(s.entry.char) || s.entry.char === generationChar) continue;
        const t = firstTagOf(s);
        if ((fillCount[t] || 0) >= tagFillPerTag) continue;
        fillCount[t] = (fillCount[t] || 0) + 1;
        fillers.push(s);
        tagSet.add(t);
      }
      if (fillers.length > 0) {
        // 从池尾向前替换非字辈名额（保底位不挤掉），池规模维持 POOL_SIZE
        let fi = 0;
        const genInPool = generationChar
          ? posPool.some((s) => s.entry.char === generationChar) : false;
        for (let i = posPool.length - 1; i >= 0 && fi < fillers.length; i--) {
          if (genInPool && posPool[i].entry.char === generationChar) continue;
          posPool[i] = fillers[fi++];
        }
      }
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

      // 受控探索扰动：总分按比例加均匀抖动（保持正负号语义 |score| 缩放），
      // 打破纯确定性贪心的「同参数永远同批」；rng 可注入保证测试可复现
      const jittered = internal + Math.abs(internal) * jitterRatio * (rng() * 2 - 1);

      combos.push({
        name: name,
        first: a.entry,
        second: b.entry,
        pyArr: pyArr,
        toneArr: toneArr,
        strokeArr: strokeArr,
        _internalScore: jittered
      });
    }
  }

  // 4. 排序 + 多样性约束选取 + 批次分段
  //    贪心选取三重约束：
  //    a) 同一字（含名次字位置）整批出现 ≤ maxSameCharInList（默认 4）；
  //    b) 同一名首字整批出现 ≤ maxSameFirstInList（默认 3）——首字决定名字
  //       第一观感，收得更紧（历史痛点：候选首字 妙/婉/如 扎堆）；
  //    c) 字辈字豁免——指定字辈时该字必须出现在每个候选中。
  combos.sort((x, y) => y._internalScore - x._internalScore || (x.name < y.name ? -1 : 1));
  const maxSameChar = (p.generate && p.generate.maxSameCharInList) || topN;
  const maxSameFirst = (p.generate && p.generate.maxSameFirstInList) || maxSameChar;
  const capFor = (ch) => (ch === generationChar ? Infinity : maxSameChar);
  const capForFirst = (ch) => (ch === generationChar ? Infinity : maxSameFirst);

  // 单段贪心选取：从 segIndex*topN 起扫描组合，批内多样性三重配额（每段重置），
  // 并排除低批次已收录的组合（跨批不相交）。
  const lowerBatchCombos = new Set();
  const walkSegment = (segIndex) => {
    const segCharUsed = {};
    const segFirstUsed = {};
    const segPicked = [];
    const segStart = segIndex * topN;
    for (let i = 0; segPicked.length < topN && i < combos.length * 2; i++) {
      const combo = combos[(segStart + i) % combos.length];
      if (segPicked.indexOf(combo) !== -1) continue; // 取模回绕后防重复收录
      if (lowerBatchCombos.has(combo)) continue;     // 跨批去重：低批次已收录
      if ((segCharUsed[combo.first.char] || 0) >= capFor(combo.first.char)) continue;
      if ((segCharUsed[combo.second.char] || 0) >= capFor(combo.second.char)) continue;
      if ((segFirstUsed[combo.first.char] || 0) >= capForFirst(combo.first.char)) continue;
      segPicked.push(combo);
      segCharUsed[combo.first.char] = (segCharUsed[combo.first.char] || 0) + 1;
      segCharUsed[combo.second.char] = (segCharUsed[combo.second.char] || 0) + 1;
      segFirstUsed[combo.first.char] = (segFirstUsed[combo.first.char] || 0) + 1;
    }
    return segPicked;
  };

  // 批次配额接续：batch=N 前先模拟低批次（1..N-1）的贪心选取（只登记已收录组合、
  // 不产出候选），使本批从「低批次未收录的组合」继续选取——批间候选因此不相交
  // （仅当组合池耗尽触发取模回绕时才允许重名）。全程确定性。
  // 组合池容量护栏：模拟段数不超过组合池可容纳的不相交批数，防止大 batch 空转。
  const maxDisjointSegs = Math.ceil(combos.length / topN);
  const simSegs = Math.min(batch - 1, maxDisjointSegs);
  for (let s = 0; s < simSegs; s++) {
    for (const combo of walkSegment(s)) lowerBatchCombos.add(combo);
  }
  const picked = walkSegment(Math.min(batch - 1, maxDisjointSegs));

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
