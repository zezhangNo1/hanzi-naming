/**
 * homophone.js — 谐音检测（B3 过滤流水线第 3 层，QA 第 1 轮修订；B3.1 增粤语）
 *
 * 匹配规则（音节边界全等，替代裸子串匹配，消除世棠/诗腾类误杀）：
 * - 取候选逐字无声调音节序列（如 ['shi','ting']），对所有连续子序列拼接
 *   （shi / ting / shiting）与 blocklist 词条做全等匹配；
 * - homophonePutonghua：任一子序列拼接命中普通话表 → fail；
 * - homophoneEnglish：任一子序列拼接命中英文表 → fail；
 * - warn 级（音近但非直接命中）：全串拼接后滑动窗口与词条编辑距离为 1 → 保留并写回 checks；
 * - homophoneDialect（B3.1 粤语）：名用字（不含姓）经 jyutping-map 转粤拼后：
 *   带调音节子串拼接命中 CANTONESE 硬表 → fail；命中 CANTONESE_SOFT 软表 → warn；
 *   无调连串滑窗与任一词条编辑距离 1 → warn（如 琳 lam4 音近 撚 lan2）。
 *   任一字查无粤拼映射 → 跳过方言检测（pass + 空 jyutping，不误报）。
 */
'use strict';

const blocklist = require('./homophone-blocklist');
const { JYUTPING } = require('./jyutping-map');

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
 * 粤语音近 warn 判定（仅多音节词条）：
 * 粤语韵尾对立丰富（-m/-n/-ng/-p/-t/-k），单音节字母编辑距离 1 会跨过
 * 母语者不会混淆的音位边界（lam≠lan、miu≠mou、jyu≠zyu），实测 30 候选
 * 24+ warn 全为误报；故音近告警只对多音节词条（去调 ≥5 字母）生效
 * （如 秀霏 saufei 音近 收皮 saupei）。单音节风险由带调全等覆盖（fail/软表）。
 */
function nearHitCantonese(concat, entries) {
  for (const bad of entries) {
    if (bad.length < 5 || concat.length < bad.length) continue;
    for (let start = 0; start + bad.length <= concat.length; start++) {
      if (withinDistanceOne(concat.slice(start, start + bad.length), bad)) {
        return bad;
      }
    }
  }
  return null;
}

/**
 * 粤语谐音检测（B3.1）：名用字（不含姓，cand.chars[1..]）逐字转粤拼。
 * @param {Object} cand 候选（chars 数组含姓，首元素为姓氏）
 * @returns {{ yue: 'pass'|'warn'|'fail', jyutping: string, detail: string|null }}
 *   任一字无粤拼映射 → yue='pass'、jyutping=''（跳过方言检测，不误报）。
 */
function checkCantonese(cand) {
  const givenChars = (Array.isArray(cand.chars) ? cand.chars : [])
    .slice(1) // 不含姓
    .map((c) => (c && typeof c.char === 'string') ? c.char : '')
    .filter(Boolean);
  if (givenChars.length === 0) {
    return { yue: 'pass', jyutping: '', detail: null };
  }
  const syls = givenChars.map((ch) => JYUTPING[ch]);
  if (syls.some((s) => !s)) {
    return { yue: 'pass', jyutping: '', detail: null };
  }

  // fail：带调音节子串拼接与硬表全等（音节边界，如 智鳩 zi3+gau1 命中 gau1）
  const hard = syllableHit(blocklist.CANTONESE, syls);
  if (hard) {
    return { yue: 'fail', jyutping: syls.join(''), detail: '粤语谐音「' + hard + '」' };
  }
  // soft warn：带调全等命中软表（珠 zyu1 音同 豬）
  const soft = syllableHit(blocklist.CANTONESE_SOFT, syls);
  if (soft) {
    return { yue: 'warn', jyutping: syls.join(''), detail: '粤语谐音「' + soft + '」' };
  }
  // near warn：无调连串滑窗音近，仅多音节词条（秀霏 saufei 音近 收皮 saupei；
  // 琳 lam 与 撚 lan 韵尾 -m/-n 对立，不属音近——见 nearHitCantonese 注释）
  const near = nearHitCantonese(syls.map(stripTone).join(''),
    blocklist.CANTONESE.concat(blocklist.CANTONESE_SOFT).map(stripTone));
  if (near) {
    return { yue: 'warn', jyutping: syls.join(''), detail: '粤语音近「' + near + '」' };
  }
  return { yue: 'pass', jyutping: syls.join(''), detail: null };
}

/**
 * 单候选检测
 * @param {Object} cand 候选名
 * @returns {{ pass: boolean, homophonePutonghua: 'pass'|'warn'|'fail', homophoneEnglish: 'pass'|'fail', homophoneDialect: {yue, jyutping}, detail: string|null }}
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

  // 粤语（B3.1）：普通话/英文 fail/warn 优先占用 detail，否则透传粤语检测文案
  const yue = checkCantonese(cand);

  return {
    pass: ph !== 'fail' && en !== 'fail' && yue.yue !== 'fail',
    homophonePutonghua: ph,
    homophoneEnglish: en,
    homophoneDialect: { yue: yue.yue, jyutping: yue.jyutping },
    detail: detail || yue.detail
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
    } else if (r.homophoneDialect && r.homophoneDialect.yue === 'warn') {
      warns.push({ name: cand.name, detail: r.detail || '粤语谐音提示' });
      passed.push(cand);
    } else {
      passed.push(cand);
    }
  }
  return { passed: passed, blocked: blocked, warns: warns };
}

module.exports = {
  check: check,
  checkCantonese: checkCantonese,
  filterCandidates: filterCandidates,
  stripTone: stripTone,
  concatPinyin: concatPinyin,
  toCamel: toCamel
};
