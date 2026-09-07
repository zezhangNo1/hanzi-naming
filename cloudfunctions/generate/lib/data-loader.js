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

/** 白名单 Set（O(1) 查询） */
const whitelistSet = new Set(whitelist.chars.map((c) => c.char));

/** 精选字库 Map：字 → 条目 */
const coreMap = {};
for (const entry of hanziCore.chars) {
  coreMap[entry.char] = entry;
}

/** 笔画/拼音 Map：字 → { strokes, pinyin, tone } */
const strokesMap = hanziStrokes.chars;

module.exports = {
  whitelist: whitelist,
  whitelistSet: whitelistSet,
  hanziCore: hanziCore,
  coreMap: coreMap,
  strokesMap: strokesMap,
  redlineLlm: redlineLlm,
  engineParams: engineParams
};
