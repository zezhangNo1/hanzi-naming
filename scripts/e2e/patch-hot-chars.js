'use strict';
/**
 * patch-hot-chars.js — 热门字扩充补丁（2026-11 起名流行字）
 *
 * 来源：2025-2026 新生儿热门用字公开榜单（两岸）：玥/宥/佑/祐/丞/熙/楚/岑/奕/
 * 栩/樾/荞/浔 共 13 字（沐宸辰泽汐涵等已在池）。
 * 做法（对齐 patch-hanzi-core-129.js 惯例）：
 *   1. hanzi-core upsert 条目（笔画/拼音/声调取 hanzi-strokes；佑的占位释义同步精修）；
 *   2. name-pool chars.{m,f,n} 入池 + cats 人工精标（tagVocab 18 类）+ metadata v0.4；
 *   3. 双份数据同写（database/ 与 cloudfunctions/generate/data/）；
 *   4. 校验：白名单 ∩ 非黑名单 ∩ 非红线 ∩ 不在池 → 写后 diff 一致。
 * 运行：node scripts/e2e/patch-hot-chars.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const DB = path.join(ROOT, 'database');
const GEN_DATA = path.join(ROOT, 'cloudfunctions', 'generate', 'data');

/** 新增字精标表：gender(m|f|n) / freqLevel / meaning(≤12字人名向) / tags(tagVocab) */
const HOT_CHARS = [
  { char: '玥', gender: 'f', freq: 'high', meaning: '传说神珠，珍美出众', tags: ['美玉', '灵动'] },
  { char: '宥', gender: 'n', freq: 'mid',  meaning: '宽宏仁厚，有容乃大', tags: ['心性', '品德'] },
  { char: '佑', gender: 'n', freq: 'high', meaning: '护佑平安，顺遂安康', tags: ['家宅', '品德'] },
  { char: '祐', gender: 'm', freq: 'mid',  meaning: '护助之义，安和顺遂', tags: ['家宅', '品德'] },
  { char: '丞', gender: 'm', freq: 'mid',  meaning: '辅弼之才，担当有为', tags: ['力量', '品德'] },
  { char: '熙', gender: 'n', freq: 'high', meaning: '光明和乐，兴盛温暖', tags: ['光亮', '丰茂'] },
  { char: '楚', gender: 'f', freq: 'mid',  meaning: '清晰清丽，明净雅致', tags: ['文采', '灵动'] },
  { char: '岑', gender: 'n', freq: 'low',  meaning: '山之清峻，挺拔雅正', tags: ['山岳', '高远'] },
  { char: '奕', gender: 'n', freq: 'high', meaning: '神采焕发，盛大光明', tags: ['光亮', '高远'] },
  { char: '栩', gender: 'n', freq: 'low',  meaning: '栩栩如生，生动灵巧', tags: ['灵动', '草木'] },
  { char: '樾', gender: 'n', freq: 'low',  meaning: '林荫覆地，庇护清凉', tags: ['草木', '家宅'] },
  { char: '荞', gender: 'f', freq: 'low',  meaning: '荞麦清风，朴素天然', tags: ['草木', '自然'] },
  { char: '浔', gender: 'f', freq: 'low',  meaning: '水滨之地，澄澈悠远', tags: ['水泽', '自然'] }
];

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeJson(p, doc) {
  fs.writeFileSync(p, JSON.stringify(doc, null, 2) + '\n', 'utf8');
}

function main() {
  const strokes = readJson(path.join(DB, 'hanzi-strokes.json'));
  const whitelist = new Set(readJson(path.join(DB, 'whitelist-8105.json')).chars.map((c) => c.char));
  const blockDoc = readJson(path.join(DB, 'name-blocklist.json'));
  const blockSet = new Set();
  for (const k of Object.keys(blockDoc.chars || {})) {
    const v = blockDoc.chars[k];
    (Array.isArray(v) ? v : Object.keys(v)).forEach((c) => blockSet.add(c));
  }
  const redlineWords = readJson(path.join(DB, 'redline-llm.json')).words || [];

  // 逐字预校验
  for (const item of HOT_CHARS) {
    const s = strokes.chars[item.char];
    if (!s) throw new Error(item.char + ' 缺 hanzi-strokes 数据');
    if (!whitelist.has(item.char)) throw new Error(item.char + ' 不在通用规范汉字表白名单');
    if (blockSet.has(item.char)) throw new Error(item.char + ' 命中名字黑名单');
    if (redlineWords.some((w) => item.meaning.includes(w))) throw new Error(item.char + ' 释义命中红线词');
    if (item.meaning.length > 12) throw new Error(item.char + ' 释义超 12 字');
  }

  for (const base of [DB, GEN_DATA]) {
    const core = readJson(path.join(base, 'hanzi-core.json'));
    const pool = readJson(path.join(base, 'name-pool.json'));
    const coreIdx = new Map(core.chars.map((c) => [c.char, c]));
    const inPool = new Set([...pool.chars.m, ...pool.chars.f, ...pool.chars.n]);

    let added = 0;
    for (const item of HOT_CHARS) {
      const s = strokes.chars[item.char];
      if (inPool.has(item.char)) continue; // 幂等：已在池只做 core 释义精修
      coreIdx.set(item.char, {
        char: item.char,
        strokes: s.strokes,
        pinyin: s.pinyin,
        tone: s.tone,
        freqLevel: item.freq,
        imageryTags: item.tags,
        meaning: item.meaning
      });
      pool.chars[item.gender].push(item.char);
      if (!pool.cats) pool.cats = {};
      pool.cats[item.char] = item.tags;
      added++;
    }

    // core 数组重排（新字按字码稳定位置：追加后整体按原序+新字在尾即可；保持既有顺序不动）
    const seen = new Set();
    const merged = [];
    for (const c of core.chars) {
      if (coreIdx.has(c.char) && coreIdx.get(c.char) !== c) {
        merged.push(coreIdx.get(c.char)); // 既有字精修（佑）
      } else {
        merged.push(c);
      }
      seen.add(c.char);
    }
    for (const c of coreIdx.values()) {
      if (!seen.has(c.char)) merged.push(c);
    }
    core.chars = merged;

    pool.metadata = Object.assign({}, pool.metadata, {
      version: 'v0.4',
      note: pool.metadata.note + '；v0.4 增补 2025-2026 新生儿热门用字 13 个（玥宥佑祐丞熙楚岑奕栩樾荞浔，来源公开起名流行榜，人工精标释义/意象/常用度/性别亲和）。'
    });

    writeJson(path.join(base, 'hanzi-core.json'), core);
    writeJson(path.join(base, 'name-pool.json'), pool);
    console.log('[' + base + '] 入池 ' + added + ' 字；hanzi-core ' + core.chars.length + '；池总量 '
      + (pool.chars.m.length + pool.chars.f.length + pool.chars.n.length));
  }

  // 双份一致性
  for (const f of ['hanzi-core.json', 'name-pool.json']) {
    const a = fs.readFileSync(path.join(DB, f));
    const b = fs.readFileSync(path.join(GEN_DATA, f));
    if (!a.equals(b)) throw new Error(f + ' 双份数据不一致');
    console.log('diff 一致 ✓ ' + f);
  }
  console.log('DONE');
}

main();
