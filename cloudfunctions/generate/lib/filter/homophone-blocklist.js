/**
 * homophone-blocklist.js — 谐音内置黑名单（B3，QA 第 1 轮修订）
 *
 * 匹配规则（音节边界全等）：候选逐字无声调音节序列的连续子序列拼接
 * 与词条全等才命中（homophone.js 实现）。裸子串匹配已废弃——
 * 世棠(shi+tang→shitang) 不再命中 'shit'，诗婷(shi+ting→shiting) 仍命中。
 * 普通话表：无声调拼音音节序列。英文表：同规则（全小写）。
 */
'use strict';

/** 普通话不雅/忌讳音组（无声调拼音，全小写；只收全等命中即需 fail 的硬敏感项） */
const PUTONGHUA = [
  'shabi', 'erbi', 'nima', 'caonima', 'shiting', 'siwang', 'siren', 'sharen',
  'guosi', 'duyao', 'biantai', 'shazi', 'fengzi', 'daomei', 'bingsi', 'aizi',
  'laji', 'qinshou', 'chusheng', 'jianren', 'biaozi', 'wugui', 'wangba',
  'baichi', 'feiwu', 'feihua', 'erbaiwu', 'shashi', 'hasha'
];

/** 英文敏感词（小写；音节边界全等规则下生效，如 诗婷 → shiting） */
const ENGLISH = [
  'shit', 'shiting', 'fuck', 'dick', 'cunt', 'bitch', 'nigg', 'whore', 'slut',
  'rape', 'porn', 'piss', 'cock', 'sex', 'faggot', 'dildo', 'penis',
  'vagina', 'blowjob', 'incest', 'bastard'
];

module.exports = {
  PUTONGHUA: PUTONGHUA,
  ENGLISH: ENGLISH
};
