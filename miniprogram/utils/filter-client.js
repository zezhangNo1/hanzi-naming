/**
 * filter-client.js — 前端预过滤（B3 防御双保险，客户端兜底扫描）
 *
 * 职责：result 页渲染候选前对「名字+寓意」做一次红线词扫描；命中则该候选
 * 显示为「该名字暂时无法展示」占位（服务端过滤已被拦截项不会下发，此为
 * 缓存/异常数据等极端情况的最后防线）。
 * 词表：redline-ui 核心词精简版（内联数组——小程序端无 require json 先例，
 * 保持现状避免运行时兼容问题；与服务端 redline-llm.json 语义对齐）。
 */
'use strict';

/** 红线词精简版（源自 database/redline-llm.json；单字「吉/凶」已移除——寓意文案中
 * 「平安吉祥」属正常祝福；新增词先改服务端再同步此处） */
const REDLINE_UI_WORDS = [
  '数理', '三才', '五格', '命格', '命局', '喜用神', '日主',
  '五行缺', '补缺', '卦象', '宜忌', '冲克', '运势', '打分', '评分',
  '总分', '评级', '星级', '测算', '算命', '占卜', '改运', '化解',
  '招财', '克父', '克母', '犯太岁', '开光', '灵符', '转运', '注定',
  '匹配度', '五行', '八字', '生辰八字'
];

/**
 * 扫描文本是否命中红线词
 * @param {string} text 待扫描文本（建议 名字+寓意 拼接）
 * @returns {string|null} 命中的词；未命中返回 null
 */
function scanRedline(text) {
  if (!text || typeof text !== 'string') return null;
  for (const word of REDLINE_UI_WORDS) {
    if (text.indexOf(word) !== -1) return word;
  }
  return null;
}

/** 渲染占位文案（与 result 页约定一致） */
const PLACEHOLDER_TEXT = '该名字暂时无法展示';

module.exports = {
  scanRedline: scanRedline,
  PLACEHOLDER_TEXT: PLACEHOLDER_TEXT
};
