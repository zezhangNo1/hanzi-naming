'use strict';
/**
 * patch-pool-v06.js — 字池 v0.6：清除「上个世纪」俗字 + 增补冷门惊艳字
 *
 * 背景：用户反馈字库含大量过时俗字（风/兰/巧等），要求全面焕新、以冷门惊艳字为主。
 * 删除（98 字，全量命中字池）：上世纪女宝俗字（娟丽娜婷慧凤玉梅芳霞燕娥淑贤珍萍…）、
 *   男宝俗字（军勇强伟磊斌辉涛刚建国胜进隆昌富贵祥龙飞俊波鹏震洪河岩鑫超剑锋…）、
 *   过饱和退潮字（梓——2026 公开榜单已批量退场）、平淡字（霜雷荣虹雯等）。
 *   保留： timeless 雅字（云月春秋竹简…）、用户点名的热门字（沐宸辰泽玥汐珩芮晞芷祎慕…）全部不动。
 * 增补（65 字，全网「冷门惊艳」榜交叉）：霁岫彧韫葭篁疏汀潋（出处：光风霁月/云出岫/
 *   荀彧/石韫玉/蒹葭/幽篁/疏影横斜/汀上白沙/水光潋滟）等，全部人工精标
 *   释义（通行字书义+典籍出处，≤12 字）/意象/常用度/性别亲和。
 * 运行：node scripts/e2e/patch-pool-v06.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const DB = path.join(ROOT, 'database');
const GEN_DATA = path.join(ROOT, 'cloudfunctions', 'generate', 'data');

/** 删除清单：过时俗字（脚本自动跳过不在池者，此处为全量候选） */
const REMOVE = '风兰巧娟丽娜婷慧凤玉梅菊芳霞燕娥淑贤珍萍花秀英华彩珠莲环爱媚姣艳娇莺倩莉桂素真琴蓉娣娅芬微婵敏静洁珊眉翠碧曼丹红雯虹芝荔菱梨桦梧桑梓霜雷荣军勇强伟磊斌辉涛刚建国胜进隆昌富贵祥龙飞俊波鹏震洪河岩鑫超剑锋世仲劲毅志';

/** 增补 65 字：gender / freq（low=冷门惊艳 mid=小有流行）/ meaning / tags */
const ADD = [
  // 山川云物（清冷疏阔）
  { char: '霁', gender: 'n', freq: 'low', meaning: '雨过天晴，光风霁月', tags: ['光亮', '心性'] },
  { char: '岫', gender: 'n', freq: 'low', meaning: '云无心出岫，山岚幽深', tags: ['山岳', '自然'] },
  { char: '嵘', gender: 'm', freq: 'low', meaning: '山势高峻，岁月峥嵘', tags: ['山岳', '刚毅'] },
  { char: '岱', gender: 'm', freq: 'low', meaning: '岱宗泰山，巍然稳重', tags: ['山岳', '刚毅'] },
  { char: '邈', gender: 'n', freq: 'low', meaning: '烟波辽远，超然出尘', tags: ['高远', '心性'] },
  { char: '颢', gender: 'm', freq: 'low', meaning: '白光浩大，气象光明', tags: ['光亮', '高远'] },
  { char: '昶', gender: 'm', freq: 'low', meaning: '白昼舒长，畅达光明', tags: ['光亮', '家宅'] },
  { char: '曈', gender: 'n', freq: 'low', meaning: '日出渐明，曈曈向暖', tags: ['光亮', '灵动'] },
  { char: '皎', gender: 'f', freq: 'low', meaning: '皎皎明月，明亮纯净', tags: ['光亮', '温柔'] },
  { char: '旖', gender: 'f', freq: 'low', meaning: '旖旎柔美，婉转生姿', tags: ['温柔', '灵动'] },
  // 水泽清灵
  { char: '汀', gender: 'n', freq: 'low', meaning: '水边平洲，清浅安然', tags: ['水泽', '自然'] },
  { char: '涧', gender: 'n', freq: 'low', meaning: '山间清溪，泠泠作响', tags: ['水泽', '山岳'] },
  { char: '沚', gender: 'f', freq: 'low', meaning: '水中小洲，静立澄澈', tags: ['水泽', '自然'] },
  { char: '洄', gender: 'f', freq: 'low', meaning: '水流回旋，温柔绵长', tags: ['水泽', '灵动'] },
  { char: '溯', gender: 'n', freq: 'low', meaning: '逆流求源，探本穷理', tags: ['水泽', '言信'] },
  { char: '濯', gender: 'n', freq: 'low', meaning: '濯清涟而不妖，澄净', tags: ['水泽', '品德'] },
  { char: '潋', gender: 'f', freq: 'low', meaning: '水光潋滟，盈盈生辉', tags: ['水泽', '灵动'] },
  { char: '渺', gender: 'n', freq: 'low', meaning: '烟波浩渺，辽远开阔', tags: ['水泽', '高远'] },
  { char: '沅', gender: 'n', freq: 'low', meaning: '沅有芷兮，澄江如练', tags: ['水泽', '草木'] },
  { char: '霈', gender: 'm', freq: 'low', meaning: '霖雨丰沛，泽被绵长', tags: ['水泽', '丰茂'] },
  // 草木诗经（蒹葭篁竹）
  { char: '葭', gender: 'f', freq: 'low', meaning: '蒹葭苍苍，清扬婉约', tags: ['草木', '温柔'] },
  { char: '苇', gender: 'n', freq: 'low', meaning: '蒹葭苇荻，柔韧清白', tags: ['草木', '温柔'] },
  { char: '荻', gender: 'n', freq: 'low', meaning: '枫叶荻花，清逸萧然', tags: ['草木', '自然'] },
  { char: '篁', gender: 'n', freq: 'low', meaning: '独坐幽篁，竹韵清雅', tags: ['草木', '高远'] },
  { char: '竺', gender: 'n', freq: 'low', meaning: '清雅如竹，笃学不倦', tags: ['草木', '文采'] },
  { char: '蓁', gender: 'f', freq: 'low', meaning: '其叶蓁蓁，欣欣向荣', tags: ['草木', '丰茂'] },
  { char: '蕤', gender: 'f', freq: 'low', meaning: '葳蕤生光，繁盛华美', tags: ['草木', '光亮'] },
  { char: '芊', gender: 'f', freq: 'low', meaning: '草木芊芊，葱茏生机', tags: ['草木', '丰茂'] },
  { char: '栀', gender: 'f', freq: 'mid', meaning: '栀子花开，清芬馥郁', tags: ['草木', '光亮'] },
  { char: '蔚', gender: 'n', freq: 'low', meaning: '云蒸霞蔚，葱郁可观', tags: ['自然', '丰茂'] },
  { char: '蕴', gender: 'n', freq: 'low', meaning: '蕴藉含蓄，厚积薄发', tags: ['心性', '文采'] },
  // 美玉珍宝（君子如玉）
  { char: '韫', gender: 'f', freq: 'low', meaning: '石韫玉而山辉，含光', tags: ['美玉', '心性'] },
  { char: '璁', gender: 'f', freq: 'low', meaning: '似玉美石，明亮温润', tags: ['美玉', '光亮'] },
  { char: '珑', gender: 'f', freq: 'low', meaning: '玉声玲珑，明澈精巧', tags: ['美玉', '灵动'] },
  { char: '瑭', gender: 'm', freq: 'low', meaning: '玉质温润，端方贵重', tags: ['美玉', '品德'] },
  { char: '珺', gender: 'f', freq: 'mid', meaning: '美玉温润，坚贞可贵', tags: ['美玉', '品德'] },
  { char: '钰', gender: 'n', freq: 'mid', meaning: '宝璧珍金，坚贵兼美', tags: ['美玉', '品德'] },
  { char: '缇', gender: 'f', freq: 'low', meaning: '丹缃明色，温暖明丽', tags: ['光亮', '温柔'] },
  { char: '斓', gender: 'f', freq: 'low', meaning: '五彩斑斓，明丽生辉', tags: ['光亮', '灵动'] },
  // 文采风骨（书卷典籍）
  { char: '彧', gender: 'm', freq: 'low', meaning: '文采茂盛，高雅有教', tags: ['文采', '品德'] },
  { char: '聿', gender: 'm', freq: 'low', meaning: '笔之古称，文思敏捷', tags: ['文采', '言信'] },
  { char: '徽', gender: 'n', freq: 'low', meaning: '徽音雅正，德音孔昭', tags: ['言信', '品德'] },
  { char: '箫', gender: 'n', freq: 'low', meaning: '箫声清远，风雅悠扬', tags: ['音律', '高远'] },
  { char: '弦', gender: 'n', freq: 'low', meaning: '弦歌不辍，雅意悠长', tags: ['音律', '文采'] },
  { char: '隽', gender: 'n', freq: 'low', meaning: '隽永悠长，才俊出众', tags: ['文采', '心性'] },
  { char: '臻', gender: 'n', freq: 'mid', meaning: '臻于至善，日臻圆满', tags: ['品德', '高远'] },
  { char: '谙', gender: 'n', freq: 'low', meaning: '风景旧曾谙，博闻深晓', tags: ['言信', '文采'] },
  { char: '疏', gender: 'n', freq: 'low', meaning: '疏影横斜，清逸有致', tags: ['心性', '自然'] },
  { char: '邕', gender: 'm', freq: 'low', meaning: '四方文水，雍和儒雅', tags: ['水泽', '文采'] },
  { char: '宓', gender: 'f', freq: 'low', meaning: '洛神宓妃，安宁娴静', tags: ['家宅', '心性'] },
  { char: '妘', gender: 'f', freq: 'low', meaning: '上古雅姓，温婉高贵', tags: ['温柔', '家宅'] },
  // 品性气象
  { char: '忱', gender: 'n', freq: 'low', meaning: '热忱真挚，赤诚待人', tags: ['心性', '品德'] },
  { char: '恺', gender: 'm', freq: 'mid', meaning: '恺悌君子，和乐明朗', tags: ['心性', '光亮'] },
  { char: '晟', gender: 'm', freq: 'mid', meaning: '光明兴盛，朝阳气象', tags: ['光亮', '丰茂'] },
  { char: '燊', gender: 'm', freq: 'mid', meaning: '火木旺盛，兴旺炽盛', tags: ['光亮', '丰茂'] },
  { char: '赫', gender: 'm', freq: 'low', meaning: '声名显赫，光明盛大', tags: ['光亮', '力量'] },
  { char: '衎', gender: 'm', freq: 'low', meaning: '和乐衎衎，刚正愉悦', tags: ['心性', '品德'] },
  { char: '祉', gender: 'n', freq: 'low', meaning: '福祉安宁，嘉乐绵长', tags: ['家宅', '丰茂'] },
  { char: '颀', gender: 'n', freq: 'low', meaning: '硕人其颀，仪态挺秀', tags: ['高远', '灵动'] },
  { char: '胤', gender: 'm', freq: 'low', meaning: '福胤绵长，气度雍容', tags: ['家宅', '高远'] },
  { char: '翾', gender: 'f', freq: 'low', meaning: '轻飞曼舞，翩然灵动', tags: ['灵动', '高远'] },
  { char: '飏', gender: 'm', freq: 'low', meaning: '风举高飏，意气飞扬', tags: ['灵动', '高远'] },
  { char: '阑', gender: 'n', freq: 'low', meaning: '夜阑静好，清宁雅致', tags: ['家宅', '自然'] },
  { char: '雎', gender: 'f', freq: 'low', meaning: '关雎和鸣，淑雅端庄', tags: ['家宅', '音律'] }
];

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeJson(p, doc) { fs.writeFileSync(p, JSON.stringify(doc, null, 2) + '\n', 'utf8'); }

function main() {
  const addList = ADD.filter((x) => !x.skip);
  const strokes = readJson(path.join(DB, 'hanzi-strokes.json'));
  const whitelist = new Set(readJson(path.join(DB, 'whitelist-8105.json')).chars.map((c) => c.char));
  const blockDoc = readJson(path.join(DB, 'name-blocklist.json'));
  const blockSet = new Set();
  for (const k of Object.keys(blockDoc.chars || {})) {
    const v = blockDoc.chars[k];
    (Array.isArray(v) ? v : Object.keys(v)).forEach((c) => blockSet.add(c));
  }
  const redlineWords = readJson(path.join(DB, 'redline-llm.json')).words || [];

  for (const item of addList) {
    const s = strokes.chars[item.char];
    if (!s) throw new Error(item.char + ' 缺 hanzi-strokes');
    if (!whitelist.has(item.char)) throw new Error(item.char + ' 非白名单');
    if (blockSet.has(item.char)) throw new Error(item.char + ' 黑名单');
    if (redlineWords.some((w) => item.meaning.includes(w))) throw new Error(item.char + ' 释义命中红线词');
    if (item.meaning.length > 12) throw new Error(item.char + ' 释义超 12 字：' + item.meaning);
  }

  const removeSet = new Set(REMOVE.split(''));
  for (const base of [DB, GEN_DATA]) {
    const core = readJson(path.join(base, 'hanzi-core.json'));
    const pool = readJson(path.join(base, 'name-pool.json'));
    const coreIdx = new Map(core.chars.map((c) => [c.char, c]));

    // 1) 删除俗字（池与 cats；hanzi-core 条目保留作字书参考，池外不参与生成/展示）
    let removed = 0;
    for (const g of ['m', 'f', 'n']) {
      pool.chars[g] = pool.chars[g].filter((c) => {
        if (removeSet.has(c)) { removed++; return false; }
        return true;
      });
    }
    for (const c of removeSet) delete pool.cats[c];

    // 2) 增补冷门惊艳字
    let added = 0;
    for (const item of addList) {
      if ([...pool.chars.m, ...pool.chars.f, ...pool.chars.n].includes(item.char)) continue;
      const s = strokes.chars[item.char];
      coreIdx.set(item.char, {
        char: item.char, strokes: s.strokes, pinyin: s.pinyin, tone: s.tone,
        freqLevel: item.freq, imageryTags: item.tags, meaning: item.meaning
      });
      pool.chars[item.gender].push(item.char);
      pool.cats[item.char] = item.tags;
      added++;
    }

    const seen = new Set();
    const merged = [];
    for (const c of core.chars) {
      merged.push(coreIdx.has(c.char) ? (coreIdx.get(c.char) !== c ? coreIdx.get(c.char) : c) : c);
      seen.add(c.char);
    }
    for (const c of coreIdx.values()) if (!seen.has(c.char)) merged.push(c);
    core.chars = merged;

    pool.metadata = Object.assign({}, pool.metadata, {
      version: 'v0.6',
      note: pool.metadata.note + '；v0.6 大换血：清除上世纪俗字 98 个（风兰巧娟丽娜婷慧凤玉军勇强伟磊斌辉涛建国富贵祥龙等；梓因过饱和退潮一并移除），增补全网冷门惊艳字 65 个（霁岫彧韫葭篁疏汀潋徽聿雎等，释义均带典籍出处），保留全部 timeless 雅字与既有热门字。'
    });

    writeJson(path.join(base, 'hanzi-core.json'), core);
    writeJson(path.join(base, 'name-pool.json'), pool);
    const total = pool.chars.m.length + pool.chars.f.length + pool.chars.n.length;
    console.log('[' + base + '] 删 ' + removed + ' 增 ' + added + '；池总量 ' + total
      + '；cats ' + Object.keys(pool.cats).length + '；hanzi-core ' + core.chars.length);
  }

  for (const f of ['hanzi-core.json', 'name-pool.json']) {
    const a = fs.readFileSync(path.join(DB, f));
    const b = fs.readFileSync(path.join(GEN_DATA, f));
    if (!a.equals(b)) throw new Error(f + ' 双份数据不一致');
    console.log('diff 一致 ✓ ' + f);
  }
  console.log('DONE');
}

main();
