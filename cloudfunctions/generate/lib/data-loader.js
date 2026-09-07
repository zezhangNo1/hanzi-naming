/**
 * data-loader.js — 云函数内数据装载（B2）
 *
 * 数据来源：database/scripts/sync-data.js 拷贝至本函数 data/ 目录的 JSON。
 * Node require 自带缓存，冷启动后多次调用零开销。
 */
'use strict';

const whitelist = require('../data/whitelist-8105.json');
const hanziCore = require('../data/hanzi-core.json');
const hanziStrokes = require('../data/hanzi-strokes.json');
const redlineLlm = require('../data/redline-llm.json');
const engineParams = require('../data/engine-params.json');
const nameBlocklist = require('../data/name-blocklist.json');
const namePool = require('../data/name-pool.json');

/** 白名单 Set（O(1) 查询） */
const whitelistSet = new Set(whitelist.chars.map((c) => c.char));

/** 名字适用性黑名单 Set：solver 构池时强制过滤（categories 展平） */
const nameBlockSet = new Set();
for (const category of Object.keys(nameBlocklist.chars || {})) {
  for (const ch of nameBlocklist.chars[category] || []) {
    nameBlockSet.add(ch);
  }
}

/** 红线单词 Set：字形本身即命理敏感词的字（吉/凶等），不得进入名字池 */
const redlineSingleCharSet = new Set(
  (redlineLlm.words || []).filter((w) => typeof w === 'string' && w.length === 1)
);

/** 精选字库 Map：字 → 条目 */
const coreMap = {};
for (const entry of hanziCore.chars) {
  coreMap[entry.char] = entry;
}

/** 笔画/拼音 Map：字 → { strokes, pinyin, tone } */
const strokesMap = hanziStrokes.chars;

/** 人名精选字池 Map：字 → 性别亲和（m|f|n）——solver 构池的正向来源 */
const namePoolMap = {};
for (const g of ['m', 'f', 'n']) {
  for (const ch of namePool.chars[g] || []) {
    namePoolMap[ch] = g;
  }
}

module.exports = {
  whitelist: whitelist,
  whitelistSet: whitelistSet,
  nameBlocklist: nameBlocklist,
  nameBlockSet: nameBlockSet,
  redlineSingleCharSet: redlineSingleCharSet,
  namePool: namePool,
  namePoolMap: namePoolMap,
  hanziCore: hanziCore,
  coreMap: coreMap,
  strokesMap: strokesMap,
  redlineLlm: redlineLlm,
  engineParams: engineParams
};
