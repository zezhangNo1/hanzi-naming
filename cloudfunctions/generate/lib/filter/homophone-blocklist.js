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

/**
 * 粤语敏感词组（B3.1，含声调粤拼；jyutping-map.js 供字→音转换）。
 * 分级：
 * - CANTONESE（fail 硬剔除）：粗口/咒骂/死亡类，音节边界带调全等命中即剔除；
 * - CANTONESE_SOFT（warn 保留）：贬义/不雅联想（豬/笨/醜等），命中提示但不剔除。
 * 词条为「词的完整粤拼连串」（逐字带调），如 鳩=gau1、鹹濕=haam4sap1。
 */
const CANTONESE = [
  // 单字粗口/死亡
  'diu2',      // 屌
  'gau1',      // 鳩
  'hai1',      // 閪
  'lan2',      // 撚
  'cat6',      // 柒
  'sei2',      // 死
  'ngong6',    // 戇（憨）
  // 复合粗口/咒骂
  'ngong6gau1',   // 戇鳩
  'haam4sap1',    // 鹹濕
  'puk1gaai1',    // 仆街
  'ham6gaa1',     // 冚家
  'ham6gaa1caan2',// 冚家鏟
  'sau1pei4',     // 收皮
  'laap6saap3'    // 垃圾
];

/** 粤语软敏感（贬义联想，warn 提示不剔除） */
const CANTONESE_SOFT = [
  'zyu1',      // 豬（珠/朱同音）
  'mou5',      // 冇
  'seoi1',     // 衰
  'cau2',      // 醜
  'ban6',      // 笨
  'fai3',      // 廢
  'zin6',      // 賤
  'leon6zeon6',// 論盡（笨拙）
  'faan1syu4'  // 番薯（愚笨）
];

module.exports = {
  PUTONGHUA: PUTONGHUA,
  ENGLISH: ENGLISH,
  CANTONESE: CANTONESE,
  CANTONESE_SOFT: CANTONESE_SOFT
};
