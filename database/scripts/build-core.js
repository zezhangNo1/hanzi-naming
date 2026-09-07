/**
 * build-core.js — 构建精选字库 hanzi-core.json（1200-3000 字）
 *
 * 数据源：
 * - 白名单：whitelist-8105.json（准入下限）；
 * - 笔画/拼音/部首：hanzi-strokes.json + Unihan kRSUnicode（部首号）；
 * - 字频 freqLevel：粗标 —— 内置「热名高频字表」→ high；一级字表其余 → mid；二三级 → low；
 *   （正式口径应以公安热名榜公开数据替换，见 metadata.note，人工可后补）
 * - imageryTags / meaning：程序化粗标 v0 —— 部首类别映射 + 内置高频名字字释义表，
 *   其余字按部首给模板释义；标注"粗标 v0"，后续人工迭代。
 *
 * 输出：database/hanzi-core.json
 *   { metadata, chars: [{ char, strokes, pinyin, tone, freqLevel, imageryTags, meaning }] }
 *
 * 用法：node build-core.js [unihan目录]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DB_DIR = path.join(PROJECT_ROOT, 'database');
const UNIHAN_DIR = process.argv[2] || '/tmp/hanzi-src';

/* ------------------------------------------------------------------ */
/* 一、热名高频字表（freqLevel=high 粗标来源）                          */
/* 来源：公安新生儿热名榜公开新闻稿 + 母婴平台热名榜的人工汇总近似       */
/* ------------------------------------------------------------------ */
const HIGH_FREQ_NAME_CHARS = (
  '伟芳娜秀英敏艳丽强磊军洋勇毅杰娟涛明超霞平刚桂华建文军鑫辉力' +
  '佳琪雪颖慧巧美玉兰凤洁梅琳素云莲真环雪荣爱妹霞香月莺媛怡骏瑞' +
  '泽宇宸浩子涵梓轩然晨曦昊辰星辰博文昊天俊彦诺恒煜柏桉铭钧祺锐' +
  '昀朗启承宗延嵩峥书语诗涵雨梦菲露婷玉洁欣恬恬婧妍汐悦萌可星牧' +
  '逸安宁静致远帆航翊聪语嫣若汐知夏初一乐崽崽米团安暖念念' +
  '清源正则知行合一思齐明礼守信嘉言懿德慎思笃学温故知新' +
  '一诺千金心远地自偏不忘初心方得始终江晚吟山海月与灯火' +
  '语桐嘉树南乔北枳亦安初晴与安晚棠知橙意南絮' +
  '勇敢坚毅果断自信乐观豁达谦逊温和从容淡定沉稳重情重义'
);

/* ------------------------------------------------------------------ */
/* 二、内置释义表（高频名字字真实短释义，人工维护优先级最高）            */
/* 键 = 字，值 = ≤16 字释义；未命中的字按部首模板生成粗标释义           */
/* ------------------------------------------------------------------ */
const MEANING_DICT = {
  '承': '承载、担当，有继往开来之意',
  '沈': '沉稳之姓源，水名，沉静笃定',
  '祖': '先祖、本源，含追远之意',
  '宗': '宗族本源，端正大气',
  '延': '延续、延展，绵长悠远',
  '书': '书卷、学识，儒雅博闻',
  '语': '言语灵动，善表达',
  '诗': '诗意风雅，才情蕴藉',
  '涵': '涵养包容，温润内敛',
  '雨': '润物无声，滋养万物',
  '梦': '梦想憧憬，浪漫轻盈',
  '菲': '花草芬芳，清雅脱俗',
  '露': '晨露清透，纯洁晶莹',
  '婷': '婷婷袅袅，姿态美好',
  '玉': '温润如玉，品性高洁',
  '洁': '洁净纯粹，品行端方',
  '梅': '凌寒独放，坚韧清雅',
  '琳': '美玉之名，珍贵美好',
  '晶': '晶莹剔透，明朗澄澈',
  '欣': '欣然喜悦，生机盎然',
  '怡': '怡然自得，和悦安适',
  '静': '宁静致远，沉静安然',
  '淑': '淑德温良，贤淑端庄',
  '惠': '惠心仁厚，聪慧贤明',
  '秀': '秀外慧中，出众挺拔',
  '雅': '雅正高洁，气质出众',
  '琴': '琴瑟和鸣，艺术才情',
  '燕': '燕语呢喃，轻巧灵动',
  '婉': '婉转温柔，柔美顺遂',
  '如': '如意顺遂，从心所愿',
  '妍': '妍丽明媚，美好出众',
  '悦': '喜悦欢欣，明朗可爱',
  '萌': '萌发新生，朝气蓬勃',
  '可': '可爱可亲，灵动讨喜',
  '星': '星辰璀璨，志向高远',
  '辰': '星辰时序，大气悠远',
  '昊': '昊天广阔，胸怀博大',
  '宇': '气宇轩昂，天地格局',
  '航': '扬帆起航，志在远方',
  '帆': '一帆风顺，乘风前行',
  '翊': '辅佐翊卫，羽翼渐丰',
  '然': '泰然自若，坦然从容',
  '安': '安然无恙，平安顺遂',
  '宁': '宁和安谧，岁月静好',
  '致': '致知致远，志存高远',
  '远': '宁静致远，目光长远',
  '文': '文质彬彬，才学出众',
  '博': '博学多识，胸襟开阔',
  '轩': '气宇轩昂，明朗俊朗',
  '浩': '浩然正气，胸怀宽广',
  '泽': '润泽万物，恩泽绵长',
  '晨': '晨光初露，朝气蓬勃',
  '曦': '晨曦微光，温暖明亮',
  '阳': '阳光开朗，明亮温暖',
  '明': '明理明澈，光明磊落',
  '朗': '明朗豁达，爽朗大气',
  '启': '启迪开启，开创之才',
  '铭': '铭记于心，志向坚定',
  '钧': '雷霆万钧，稳重有力',
  '瑞': '祥瑞之兆，美好寓意',
  '俊': '俊朗出众，才貌兼得',
  '彦': '彦士贤才，学识过人',
  '恒': '持之以恒，坚毅不移',
  '毅': '坚毅果敢，勇往直前',
  '勇': '勇敢无畏，敢作敢当',
  '刚': '刚正不阿，坚毅挺拔',
  '强': '自强不息，坚韧有力',
  '磊': '光明磊落，坦荡正直',
  '峰': '登峰造极，志向高远',
  '山': '稳重如山，可靠厚实',
  '川': '川流不息，胸襟开阔',
  '海': '海纳百川，包容博大',
  '江': '大江奔流，气象开阔',
  '河': '大河汤汤，源远流长',
  '林': '茂林修竹，生机繁盛',
  '森': '森然成林，茁壮繁茂',
  '木': '质朴自然，生长不息',
  '柏': '松柏长青，坚贞挺拔',
  '松': '松风傲骨，坚韧长青',
  '楠': '楠木珍贵，沉稳坚实',
  '桐': '梧桐引凤，高洁美好',
  '枫': '枫叶如霞，热烈浪漫',
  '柳': '柳枝依依，柔美灵动',
  '竹': '竹有虚节，正直谦逊',
  '兰': '兰心蕙质，幽香高洁',
  '荷': '出水芙蓉，清雅不染',
  '莲': '莲花高洁，清正不染',
  '菊': '秋菊傲霜，淡泊悠然',
  '清': '清澈明净，清风朗月',
  '源': '饮水思源，生生不息',
  '正': '正直端方，堂堂正正',
  '则': '以身作则，原则坚定',
  '知': '求知明理，聪慧好学',
  '行': '言行一致，践行不辍',
  '思': '思考深邃，敏而好学',
  '齐': '见贤思齐，整肃齐整',
  '礼': '知书达礼，谦和有度',
  '信': '言而有信，诚实可靠',
  '嘉': '嘉言懿行，美好出众',
  '言': '嘉言善辩，言出必行',
  '懿': '懿德美好，品行高贵',
  '慎': '谨慎稳重，思虑周全',
  '笃': '笃行不怠，专注坚定',
  '温': '温润如玉，温和亲切',
  '和': '和乐融融，温和谦逊',
  '谦': '谦谦君子，虚怀若谷',
  '容': '有容乃大，包容大度',
  '善': '与人为善，心地纯良',
  '仁': '仁心仁德，宽厚爱人',
  '德': '德行兼备，品行高尚',
  '华': '才华斐然，光彩焕发',
  '光': '光明在前，熠熠生辉',
  '辉': '辉煌灿烂，光彩照人',
  '虹': '雨后长虹，绚烂美好',
  '云': '云卷云舒，自在从容',
  '风': '清风朗朗，潇洒自如',
  '月': '月色皎洁，温柔静谧',
  '雪': '白雪纯净，冰清玉洁',
  '霜': '傲霜而立，清冷坚贞',
  '冰': '冰雪聪明，纯净剔透',
  '泉': '清泉石上，澄澈灵动',
  '溪': '溪水潺潺，清新自然',
  '澜': '波澜壮阔，气象宏大',
  '洋': '汪洋恣意，开阔大气',
  '潮': '潮起潮涌，澎湃有劲',
  '沁': '沁人心脾，清新怡人',
  '沛': '充沛丰盈，精力旺盛',
  '涵容': '涵容并蓄，有容乃大',
  '砚': '文房之要，静心笃学',
  '墨': '笔墨书香，才思泉涌',
  '简': '大道至简，纯粹不繁',
  '真': '率真纯粹，返璞归真',
  '初': '不忘初心，纯真本然',
  '一': '始终如一，专一纯粹',
  '之': '文言虚字，古雅悠然',
  '亦': '亦步亦趋之外，自有主见',
  '若': '若无旁骛，从容自若',
  '乐': '乐观豁达，快乐常伴',
  '宜': '宜室宜家，从容得体',
  '念': '心心念念，珍视在怀',
  '悠': '悠然自得，从容不迫',
  '暖': '温暖如春，和煦宜人',
  '南': '南山之寿，向阳而生',
  '北': '北斗指路，方向坚定',
  '东': '旭日东升，朝气蓬勃',
  '西': '西山日落，静美安然',
  '夏': '夏日热烈，生机盎然',
  '秋': '秋高气爽，丰硕沉静',
  '冬': '冬藏静养，内敛沉稳',
  '棠': '海棠花开，温柔明艳',
  '橙': '橙黄橘绿，明亮鲜活',
  '絮': '柳絮轻扬，浪漫轻盈',
  '乔': '乔木挺立，高大可靠',
  '树': '十年树木，百年树人'
};

/* ------------------------------------------------------------------ */
/* 三、部首号 → { tags, template } 粗标映射（覆盖取名常见部首）         */
/* 未列出的部首走 GENERAL 兜底                                         */
/* ------------------------------------------------------------------ */
const RADICAL_MAP = {
  9:  { tags: ['品德'], tpl: '人部字，多与立身处世相关' },
  10: { tags: ['品德'], tpl: '儿部字，多与人物形态相关' },
  15: { tags: ['自然', '水泽'], tpl: '冰部字，含清冽澄澈之意' },
  19: { tags: ['力量'], tpl: '力部字，劲健有力' },
  30: { tags: ['言信'], tpl: '口部字，与言语表达相关' },
  32: { tags: ['自然'], tpl: '土部字，厚重踏实' },
  33: { tags: ['品德'], tpl: '士部字，含士人之风' },
  38: { tags: ['温柔'], tpl: '女部字，柔美娴静' },
  39: { tags: ['灵动'], tpl: '子部字，含聪敏之意' },
  40: { tags: ['家宅'], tpl: '宝盖部字，有庇护安宁之意' },
  46: { tags: ['山岳', '高远'], tpl: '山部字，稳重而高远' },
  47: { tags: ['水泽'], tpl: '川部字，奔流不息' },
  61: { tags: ['心性'], tpl: '心部字，性情真挚' },
  64: { tags: ['力量'], tpl: '手部字，勤勉笃行' },
  67: { tags: ['文采'], tpl: '文部字，文质彬彬' },
  72: { tags: ['光亮'], tpl: '日部字，光明磊落' },
  74: { tags: ['温柔', '光亮'], tpl: '月部字，皎洁温柔' },
  75: { tags: ['草木', '自然'], tpl: '木部字，生机挺拔' },
  85: { tags: ['水泽', '灵动'], tpl: '水部字，澄澈灵动' },
  86: { tags: ['光亮'], tpl: '火部字，温暖明亮' },
  96: { tags: ['美玉', '品德'], tpl: '玉部字，温润如玉' },
  100: { tags: ['自然'], tpl: '生部字，生生不息' },
  106: { tags: ['品德'], tpl: '白部字，纯洁明净' },
  109: { tags: ['灵动'], tpl: '目部字，明察秋毫' },
  112: { tags: ['品德'], tpl: '示部字，福泽绵长' },
  113: { tags: ['丰茂'], tpl: '禾部字，丰茂踏实' },
  115: { tags: ['品德'], tpl: '立部字，挺立不阿' },
  116: { tags: ['品德', '自然'], tpl: '竹部字，虚劲有节' },
  121: { tags: ['灵动', '高远'], tpl: '羽部字，轻盈高飞' },
  140: { tags: ['草木', '自然'], tpl: '草部字，青葱繁茂' },
  145: { tags: ['文采'], tpl: '衣部字，锦绣华美' },
  149: { tags: ['言信'], tpl: '言部字，言而有信' },
  154: { tags: ['美玉'], tpl: '贝部字，珍贵美好' },
  162: { tags: ['力量'], tpl: '走之部字，行稳致远' },
  167: { tags: ['刚毅'], tpl: '金部字，坚毅果决' },
  173: { tags: ['水泽'], tpl: '雨部字，润泽万物' },
  174: { tags: ['自然'], tpl: '青部字，青翠欲滴' },
  180: { tags: ['音律'], tpl: '音部字，音律和谐' },
  186: { tags: ['自然'], tpl: '香部字，芳馨怡人' },
  212: { tags: ['高远', '灵动'], tpl: '龙部字，腾跃高远' }
};

/** 兜底模板 */
const GENERAL_TPL = { tags: ['自然'], tpl: '规范汉字，音形均衡，可入名' };

/** 粗标标签全集（引擎 styles 加权映射的取值域） */
const TAG_VOCAB = [
  '品德', '文采', '自然', '水泽', '草木', '山岳', '光亮', '美玉', '心性',
  '刚毅', '温柔', '灵动', '高远', '丰茂', '言信', '音律', '力量', '家宅'
];

/** 目标精选字数（1200-3000 区间内；先 high→mid→low 逐级补足） */
const TARGET_TOTAL = 2600;

function main() {
  const whitelist = JSON.parse(fs.readFileSync(path.join(DB_DIR, 'whitelist-8105.json'), 'utf8'));
  const strokesData = JSON.parse(fs.readFileSync(path.join(DB_DIR, 'hanzi-strokes.json'), 'utf8'));

  // Unihan 部首号（kRSUnicode）
  const radicalMap = loadRadicals(UNIHAN_DIR);

  // 白名单 → level 映射（metadata.levels 顺序即 level-1/2/3）
  const levelSet = loadLevelSets(UNIHAN_DIR);

  const highSet = new Set(Array.from(HIGH_FREQ_NAME_CHARS).filter((c) => /[^\s]/.test(c)));

  // 精选规则：
  // 1) 热名高频字 ∩ 白名单 → freqLevel=high（全部入选）
  // 2) 一级字表（常用 3500）中笔画 2-20 且拼音合法 → freqLevel=mid（补足至目标数）
  // 3) 二三级字表中取名常见（笔画 2-16）→ freqLevel=low（少量补充气质字）
  const core = [];
  const seen = new Set();

  for (const item of whitelist.chars) {
    const ch = item.char;
    const meta = strokesData.chars[ch];
    if (!meta) continue;
    if (highSet.has(ch)) {
      seen.add(ch);
      core.push(buildEntry(ch, meta, 'high', radicalMap[ch] || 0));
    }
  }

  for (const item of whitelist.chars) {
    if (core.length >= TARGET_TOTAL) break;
    const ch = item.char;
    if (seen.has(ch)) continue;
    const meta = strokesData.chars[ch];
    if (!meta || meta.tone === 0 || meta.strokes < 2 || meta.strokes > 20) continue;
    if (!levelSet.l1.has(ch)) continue;
    seen.add(ch);
    core.push(buildEntry(ch, meta, 'mid', radicalMap[ch] || 0));
  }

  for (const item of whitelist.chars) {
    if (core.length >= TARGET_TOTAL) break;
    const ch = item.char;
    if (seen.has(ch)) continue;
    const meta = strokesData.chars[ch];
    if (!meta || meta.tone === 0 || meta.strokes < 2 || meta.strokes > 16) continue;
    if (levelSet.l2.has(ch) || levelSet.l3.has(ch)) {
      seen.add(ch);
      core.push(buildEntry(ch, meta, 'low', radicalMap[ch] || 0));
    }
  }

  const counts = { high: 0, mid: 0, low: 0 };
  for (const e of core) counts[e.freqLevel]++;

  const output = {
    metadata: {
      name: '取名精选字库',
      version: '粗标 v0，构建于 ' + new Date().toISOString().slice(0, 10),
      total: core.length,
      freqLevelCounts: counts,
      freqLevelSource: '粗标：内置热名高频字表(high) / 一级字表(mid) / 二三级字表(low)；正式版应以公安热名榜公开数据替换',
      imageryTagsSource: '粗标 v0：按 Unihan kRSUnicode 部首号程序化映射，人工可后补迭代',
      meaningSource: '内置高频名字字释义表（' + Object.keys(MEANING_DICT).length + ' 字人工释义）+ 部首模板粗标释义',
      tagVocab: TAG_VOCAB,
      note: '粗标 v0：imageryTags 与 meaning 允许程序化粗标，后续批次人工精修'
    },
    chars: core
  };

  fs.writeFileSync(path.join(DB_DIR, 'hanzi-core.json'), JSON.stringify(output, null, 0), 'utf8');
  console.log('[build-core] 完成：' + core.length + ' 字 → hanzi-core.json');
  console.log('  freqLevel 分布：', counts);
}

/** 组装单字条目（meaning：释义表优先，否则部首模板粗标） */
function buildEntry(ch, meta, freqLevel, radical) {
  const info = RADICAL_MAP[radical] || GENERAL_TPL;
  const meaning = MEANING_DICT[ch] || info.tpl;
  return {
    char: ch,
    strokes: meta.strokes,
    pinyin: meta.pinyin,
    tone: meta.tone,
    freqLevel: freqLevel,
    imageryTags: info.tags.slice(),
    meaning: meaning
  };
}

/** 解析 kRSUnicode → { '字': 部首号 } */
function loadRadicals(unihanDir) {
  const file = path.join(unihanDir, 'Unihan_IRGSources.txt');
  const map = {};
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('\t');
    if (parts.length < 3 || parts[1] !== 'kRSUnicode') continue;
    const cp = parseInt(parts[0].replace('U+', ''), 16);
    const ch = String.fromCodePoint(cp);
    const first = parts[2].split(/\s+/)[0];
    map[ch] = parseInt(first.split('.')[0], 10) || 0;
  }
  return map;
}

/** 从 level 源文件还原三级字集（与 build-whitelist 同源） */
function loadLevelSets(unihanDir) {
  const readChars = (name) => {
    const file = path.join(unihanDir, name);
    const set = new Set();
    if (!fs.existsSync(file)) return set;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      const ch = Array.from(t).find((c) => c.codePointAt(0) >= 0x3400);
      if (ch) set.add(ch);
    }
    return set;
  };
  return { l1: readChars('level-1.txt'), l2: readChars('level-2.txt'), l3: readChars('level-3.txt') };
}

main();
