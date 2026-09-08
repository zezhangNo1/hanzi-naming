/**
 * homophone.js — 谐音检测（B3 过滤流水线第 3 层，QA 第 1 轮修订）
 *
 * 匹配规则（音节边界全等，替代裸子串匹配，消除世棠/诗腾类误杀）：
 * - 取候选逐字无声调音节序列（如 ['shi','ting']），对所有连续子序列拼接
 *   （shi / ting / shiting）与 blocklist 词条做全等匹配；
 * - homophonePutonghua：任一子序列拼接命中普通话表 → fail；
 * - homophoneEnglish：任一子序列拼接命中英文表 → fail；
 * - warn 级（音近但非直接命中）：全串拼接后滑动窗口与词条编辑距离为 1 → 保留并写回 checks；
 * - homophoneDialect：本期不做粤语 jyutping 全表，恒 null。
 *   TODO(B3.1)：接入 jyutping 字表，按用户所选方言组（constraints.dialects）输出检测。
 */
'use strict';

const blocklist = require('./homophone-blocklist');

/** 声调符号（含 ü 的组合附加符）——拼音去调用 */
const TONE_MARKS = /[\u0300-\u036f]/g;

/**
 * 拼音去声调（NFD 分解后剥附加符；ü→u 可接受，仅用于连串比对）
 * @param {string} py 带调拼音（如 shī）
 * @returns {string} 无声调拼音（如 shi）
 */
function stripTone(py) {
  if (!py) return '';
  return String(py)
    .toLowerCase()
    .normalize('NFD')
    .replace(TONE_MARKS, '')
    .replace(/[^a-z]/g, '');
}

/**
 * 候选的无声调音节序列（如 ['zhang','shi','ting']）
 * @param {Object} cand 候选（pinyin 为逐字带调拼音数组）
 * @returns {string[]}
 */
function syllablesOf(cand) {
  return (Array.isArray(cand.pinyin) ? cand.pinyin : [])
    .map(stripTone)
    .filter((s) => s.length > 0);
}

/**
 * 全名无声调拼音连串（如 zhangshiting）
 * @param {Object} cand 候选
 * @returns {string}
 */
function concatPinyin(cand) {
  return syllablesOf(cand).join('');
}

/**
 * 首字母大写驼峰（每字拼音段首字母大写，如 zhang shi ting → ZhangShiting）
 * @param {Object} cand 候选
 * @returns {string}
 */
function toCamel(cand) {
  return syllablesOf(cand)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}

/**
 * 音节边界全等命中：音节序列所有连续子序列拼接与词条全等即命中
 * （诗婷 shi+ting → "shiting" 命中；世棠 shi+tang → "shitang" 不命中 'shit'）
 * @param {string[]} entries 词条表
 * @param {string[]} syllables 无声调音节序列
 * @returns {string|null} 命中的词条
 */
function syllableHit(entries, syllables) {
  for (let i = 0; i < syllables.length; i++) {
    let acc = '';
    for (let j = i; j < syllables.length; j++) {
      acc += syllables[j];
      if (entries.indexOf(acc) !== -1) return acc;
    }
  }
  return null;
}

/** 编辑距离 ≤1 判定（仅用于 warn 级音近判定；全等不算音近） */
function withinDistanceOne(a, b) {
  if (a === b) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      if (a.charAt(i) !== b.charAt(i) && ++diff > 1) return false;
    }
    return diff === 1;
  }
  // 长度差 1：一次插入/删除
  const short = a.length < b.length ? a : b;
  const long = a.length < b.length ? b : a;
  let i = 0, j = 0, diff = 0;
  while (i < short.length && j < long.length) {
    if (short.charAt(i) === long.charAt(j)) { i++; j++; continue; }
    if (++diff > 1) return false;
    j++;
  }
  return true;
}

/**
 * warn 级音近判定：全串拼接的滑动窗口（窗长=词条长）与词条编辑距离为 1
 * @param {string} concat 全名无声调连串
 * @param {string[]} entries 词条表
 * @returns {string|null} 音近的词条
 */
function nearHit(concat, entries) {
  for (const bad of entries) {
    if (concat.length < bad.length) continue;
    for (let start = 0; start + bad.length <= concat.length; start++) {
      if (withinDistanceOne(concat.slice(start, start + bad.length), bad)) {
        return bad;
      }
    }
  }
  return null;
}

/**
 * 单候选检测
 * @param {Object} cand 候选名
 * @returns {{ pass: boolean, homophonePutonghua: 'pass'|'warn'|'fail', homophoneEnglish: 'pass'|'fail', homophoneDialect: null, detail: string|null }}
 */
function check(cand) {
  const syllables = syllablesOf(cand);
  const concat = syllables.join('');
  let ph = 'pass';
  let en = 'pass';
  let detail = null;

  if (syllables.length > 0) {
    const phHit = syllableHit(blocklist.PUTONGHUA, syllables);
    if (phHit) {
      ph = 'fail';
      detail = '普通话谐音「' + phHit + '」';
    } else {
      const near = nearHit(concat, blocklist.PUTONGHUA);
      if (near) {
        ph = 'warn';
        detail = '音近「' + near + '」';
      }
    }

    const enHit = syllableHit(blocklist.ENGLISH, syllables);
    if (enHit) {
      en = 'fail';
      detail = '英文谐音「' + enHit + '」';
    }
  }

  return {
    pass: ph !== 'fail' && en !== 'fail',
    homophonePutonghua: ph,
    homophoneEnglish: en,
    homophoneDialect: null, // TODO(B3.1)：粤语 jyutping 全表接入后写实
    detail: detail
  };
}

/**
 * 过滤候选数组（fail 剔除；warn 保留并写回 checks）
 * @param {Object[]} candidates
 * @returns {{ passed: Object[], blocked: Array<{name,detail}>, warns: Array<{name,detail}> }}
 */
function filterCandidates(candidates) {
  const passed = [];
  const blocked = [];
  const warns = [];
  for (const cand of candidates || []) {
    const r = check(cand);
    if (cand.checks) {
      cand.checks.homophonePutonghua = r.homophonePutonghua;
      cand.checks.homophoneEnglish = r.homophoneEnglish;
      cand.checks.homophoneDialect = r.homophoneDialect;
    }
    if (!r.pass) {
      blocked.push({ name: cand.name, detail: r.detail || '谐音命中' });
    } else if (r.homophonePutonghua === 'warn') {
      warns.push({ name: cand.name, detail: r.detail || '谐音音近' });
      passed.push(cand);
    } else {
      passed.push(cand);
    }
  }
  return { passed: passed, blocked: blocked, warns: warns };
}

module.exports = {
  check: check,
  filterCandidates: filterCandidates,
  stripTone: stripTone,
  concatPinyin: concatPinyin,
  toCamel: toCamel
};
