/**
 * char-board.js — 候选字库看板（数据装配）
 *
 * 用途：pages/chars 候选字浏览页的数据源（generate 云函数 listChars action）。
 * 装配口径与 solver 一致：
 *   - 字来源：name-pool 精选字池（chars.m/f/n 并集，603 字，均已过白名单/黑名单）；
 *   - 意象标签：name-pool.cats 人工精标优先，回退 hanzi-core.imageryTags（tagVocab 18 类）；
 *   - 热门度：hanzi-core.freqLevel（high 热门 / mid 常用 / low 少见）。
 * 气质分组：18 类标签 → 6 个用户向气质组（每标签恰属一组；一个字可属多组；
 * 无标签的字仅出现在「全部」视图）。纯静态装配，确定性输出，进程内缓存。
 * 红线：输出仅 char/pinyin/tone/strokes/meaning/freqLevel/tags/gender/groups
 *   展示字段，不含任何内部排序分值；meaning 为字库既有释义（已过红线词校验）。
 */
'use strict';

/** tagVocab 18 类 → 6 气质组映射（每组标签互斥且并集=18 类） */
const GROUPS = [
  { key: 'qingya',    label: '清雅澄澈', desc: '水泽山岚，安静清冷',     tags: ['水泽', '山岳', '音律'] },
  { key: 'minglang',  label: '明朗热烈', desc: '光亮有力量，蓬勃向上',   tags: ['光亮', '力量', '丰茂'] },
  { key: 'wenrou',    label: '温柔灵动', desc: '柔软灵动，可爱有生气',   tags: ['温柔', '灵动', '草木'] },
  { key: 'shujuan',   label: '书卷风雅', desc: '文采心性，安静笃学',     tags: ['文采', '言信', '心性'] },
  { key: 'duanzhuang',label: '端庄美善', desc: '品性如玉，端正大方',     tags: ['品德', '美玉', '家宅'] },
  { key: 'gaoyuan',   label: '高远开阔', desc: '志向高远，大气舒展',     tags: ['高远', '刚毅', '自然'] }
];

/** 字频等级 → 展示排序权（热门在前） */
const FREQ_RANK = { high: 0, mid: 1, low: 2 };

/** 进程内缓存（确定性输出，重复构建无意义） */
let cached = null;

/**
 * 构建候选字看板
 * @param {Object} loader data-loader 实例（注入便于测试）
 * @returns {{ groups: Object[], chars: Object[] }}
 *   - groups：气质组定义（key/label/desc/tags）
 *   - chars：[{ char, pinyin, tone, strokes, meaning, freqLevel, tags, gender, groups }]
 *     排序：热门 → 常用 → 少见，同级按笔画升序再按字码（确定性）
 */
function buildBoard(loader) {
  if (cached) return cached;

  const tagToGroup = {};
  for (const g of GROUPS) {
    for (const t of g.tags) tagToGroup[t] = g.key;
  }

  // 字池并集：m/f/n（namePoolMap 值为最后写入的池别，作性别亲和展示）
  const chars = [];
  for (const ch of Object.keys(loader.namePoolMap)) {
    const core = loader.coreMap[ch] || {};
    const stroke = loader.strokesMap[ch] || {};
    const tags = (loader.namePoolCats && loader.namePoolCats[ch])
      || core.imageryTags || [];
    const groups = [];
    const seen = {};
    for (const t of tags) {
      const gk = tagToGroup[t];
      if (gk && !seen[gk]) { seen[gk] = true; groups.push(gk); }
    }
    chars.push({
      char: ch,
      pinyin: core.pinyin || stroke.pinyin || '',
      tone: (core.tone != null ? core.tone : stroke.tone) || 0,
      strokes: core.strokes || stroke.strokes || 0,
      meaning: core.meaning || '',
      freqLevel: core.freqLevel || 'mid',
      tags: tags,
      gender: loader.namePoolMap[ch],
      groups: groups
    });
  }

  chars.sort((a, b) =>
    (FREQ_RANK[a.freqLevel] - FREQ_RANK[b.freqLevel])
    || (a.strokes - b.strokes)
    || (a.char < b.char ? -1 : 1));

  // meta 供前端展示字库版本（云端未重新部署时版本落后，一眼可辨）
  const meta = {
    version: (loader.namePool && loader.namePool.metadata && loader.namePool.metadata.version) || '',
    count: chars.length
  };
  cached = { groups: GROUPS, chars: chars, meta: meta };
  return cached;
}

module.exports = {
  GROUPS: GROUPS,
  buildBoard: buildBoard
};
