'use strict';
/**
 * patch-hot-chars-2.js — 热门字扩充第二批（2026-11 豆包清单 + 全网榜单交叉）
 *
 * 来源：用户提供的豆包热门起名字清单（男宝/女宝/中性分风格）+ 2026 公开榜单
 * 交叉核对（予琛/景禾/子屹/锦宸程 等），剔除 11 个生僻或疑义字
 * （琀=葬玉义不吉、岍邠崚昪邶晁畯珫妧媱 极生僻且粤拼难确证），
 * 补入搜索命中的 慕棠柠柚弈程黎年见，共 81 字。
 * 释义均取通行字书义转人名向表述（≤12 字，禁编造）；
 * freq：high=当下真实高频爆款，mid=稳步流行，low=小众国风（重名低）。
 * 运行：node scripts/e2e/patch-hot-chars-2.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const DB = path.join(ROOT, 'database');
const GEN_DATA = path.join(ROOT, 'cloudfunctions', 'generate', 'data');

/** 81 字精标表：gender(m|f|n) / freq / meaning / tags(tagVocab 18 类) */
const CHARS = [
  // ---- 男宝 30 ----
  { char: '珩', gender: 'm', freq: 'high', meaning: '佩上横玉，君子如玉', tags: ['美玉', '品德'] },
  { char: '洵', gender: 'm', freq: 'high', meaning: '洵然可信，诚然美好', tags: ['言信', '心性'] },
  { char: '屿', gender: 'm', freq: 'high', meaning: '岛屿清幽，独立安然', tags: ['山岳', '自然'] },
  { char: '慕', gender: 'n', freq: 'high', meaning: '心有所慕，向善而行', tags: ['心性', '品德'] },
  { char: '策', gender: 'm', freq: 'mid', meaning: '运筹谋略，策马向前', tags: ['言信', '力量'] },
  { char: '驰', gender: 'm', freq: 'mid', meaning: '驰骋远方，志在四方', tags: ['力量', '高远'] },
  { char: '韬', gender: 'm', freq: 'mid', meaning: '胸有韬略，藏锋守正', tags: ['言信', '心性'] },
  { char: '浚', gender: 'm', freq: 'mid', meaning: '疏浚深通，求深致远', tags: ['水泽', '言信'] },
  { char: '祁', gender: 'm', freq: 'low', meaning: '祁祁舒缓，安然大气', tags: ['草木', '自然'] },
  { char: '桢', gender: 'm', freq: 'low', meaning: '栋梁之材，坚贞挺立', tags: ['刚毅', '草木'] },
  { char: '昉', gender: 'm', freq: 'low', meaning: '天将破晓，光明初现', tags: ['光亮', '高远'] },
  { char: '崧', gender: 'm', freq: 'low', meaning: '山高而稳，中正大气', tags: ['山岳', '刚毅'] },
  { char: '峙', gender: 'm', freq: 'low', meaning: '山势屹立，稳如磐石', tags: ['山岳', '刚毅'] },
  { char: '旷', gender: 'm', freq: 'low', meaning: '胸怀开阔，旷达明朗', tags: ['高远', '心性'] },
  { char: '朔', gender: 'm', freq: 'low', meaning: '清晨初始，开阔清朗', tags: ['光亮', '高远'] },
  { char: '垣', gender: 'm', freq: 'low', meaning: '城垣厚实，端方可靠', tags: ['家宅', '刚毅'] },
  { char: '祈', gender: 'm', freq: 'low', meaning: '心怀祈愿，郑重真诚', tags: ['家宅', '心性'] },
  { char: '劭', gender: 'm', freq: 'low', meaning: '品德美好，勉励向上', tags: ['品德', '心性'] },
  { char: '颂', gender: 'm', freq: 'low', meaning: '颂声嘉赞，气象光正', tags: ['言信', '光亮'] },
  { char: '尉', gender: 'm', freq: 'low', meaning: '安定抚慰，庄重整肃', tags: ['品德', '力量'] },
  { char: '稷', gender: 'm', freq: 'low', meaning: '五谷之神，社稷担当', tags: ['丰茂', '力量'] },
  { char: '溥', gender: 'm', freq: 'low', meaning: '广博宽厚，深远普及', tags: ['水泽', '心性'] },
  { char: '祚', gender: 'm', freq: 'low', meaning: '福泽安泰，绵延有继', tags: ['家宅', '丰茂'] },
  { char: '禧', gender: 'm', freq: 'low', meaning: '喜乐安宁，生活和美', tags: ['家宅', '光亮'] },
  { char: '祜', gender: 'm', freq: 'low', meaning: '福泽深厚，安和康宁', tags: ['家宅', '品德'] },
  { char: '谌', gender: 'm', freq: 'low', meaning: '诚信笃定，言行如一', tags: ['言信', '品德'] },
  { char: '谟', gender: 'm', freq: 'low', meaning: '深谋远虑，筹策从容', tags: ['言信', '力量'] },
  { char: '箴', gender: 'm', freq: 'low', meaning: '箴言规勉，自省修身', tags: ['言信', '品德'] },
  { char: '序', gender: 'n', freq: 'low', meaning: '有序有节，条理分明', tags: ['言信', '品德'] },
  { char: '珙', gender: 'm', freq: 'low', meaning: '大璧温厚，持重端方', tags: ['美玉', '品德'] },
  // ---- 女宝 35 ----
  { char: '芮', gender: 'f', freq: 'high', meaning: '草木初生，蓬勃灵巧', tags: ['草木', '灵动'] },
  { char: '舒', gender: 'n', freq: 'high', meaning: '舒展从容，安然自在', tags: ['心性', '温柔'] },
  { char: '晞', gender: 'f', freq: 'high', meaning: '晨光熹微，明朗初升', tags: ['光亮', '灵动'] },
  { char: '芷', gender: 'f', freq: 'high', meaning: '香草幽芷，清雅芬芳', tags: ['草木', '温柔'] },
  { char: '祎', gender: 'f', freq: 'high', meaning: '美好珍贵，娴雅出众', tags: ['美玉', '温柔'] },
  { char: '琛', gender: 'm', freq: 'mid', meaning: '天赐珍宝，贵重美好', tags: ['美玉', '家宅'] },
  { char: '珞', gender: 'f', freq: 'mid', meaning: '璎珞珠玉，华美庄重', tags: ['美玉', '光亮'] },
  { char: '暄', gender: 'f', freq: 'mid', meaning: '春日暄和，温暖明媚', tags: ['光亮', '温柔'] },
  { char: '苒', gender: 'f', freq: 'low', meaning: '草木苒苒，生机柔婉', tags: ['草木', '灵动'] },
  { char: '绾', gender: 'f', freq: 'low', meaning: '青丝绾结，柔美妥帖', tags: ['温柔', '灵动'] },
  { char: '漪', gender: 'f', freq: 'mid', meaning: '清波涟漪，灵动柔美', tags: ['水泽', '灵动'] },
  { char: '韶', gender: 'f', freq: 'mid', meaning: '韶乐华美，风雅美好', tags: ['音律', '文采'] },
  { char: '棠', gender: 'f', freq: 'mid', meaning: '海棠春盛，明艳大方', tags: ['草木', '光亮'] },
  { char: '柠', gender: 'f', freq: 'mid', meaning: '柠香清新，明快爽朗', tags: ['草木', '灵动'] },
  { char: '柚', gender: 'f', freq: 'low', meaning: '柚实丰盈，清新圆满', tags: ['草木', '丰茂'] },
  { char: '甯', gender: 'n', freq: 'mid', meaning: '安宁静好，从容自适', tags: ['家宅', '心性'] },
  { char: '婳', gender: 'f', freq: 'low', meaning: '娴静美好，安静婉约', tags: ['温柔', '心性'] },
  { char: '苓', gender: 'f', freq: 'low', meaning: '苓草青青，安然滋养', tags: ['草木', '家宅'] },
  { char: '漫', gender: 'f', freq: 'low', meaning: '水波漫漾，自在舒展', tags: ['水泽', '灵动'] },
  { char: '泠', gender: 'f', freq: 'low', meaning: '清泠悦耳，澄澈明净', tags: ['水泽', '音律'] },
  { char: '珵', gender: 'f', freq: 'low', meaning: '美玉之质，端方持正', tags: ['美玉', '品德'] },
  { char: '璎', gender: 'f', freq: 'low', meaning: '珠玉成串，华彩盈身', tags: ['美玉', '光亮'] },
  { char: '荃', gender: 'f', freq: 'low', meaning: '香草荃芜，芳洁自持', tags: ['草木', '品德'] },
  { char: '湄', gender: 'f', freq: 'low', meaning: '在水之湄，温婉澄澈', tags: ['水泽', '温柔'] },
  { char: '菀', gender: 'f', freq: 'low', meaning: '草木菀茂，生机盎然', tags: ['草木', '丰茂'] },
  { char: '湉', gender: 'f', freq: 'low', meaning: '水面湉湉，安然澄静', tags: ['水泽', '心性'] },
  { char: '涔', gender: 'f', freq: 'low', meaning: '清泉涔涔，润泽绵密', tags: ['水泽', '自然'] },
  { char: '翎', gender: 'f', freq: 'low', meaning: '羽翎轻扬，轻灵敏秀', tags: ['灵动', '高远'] },
  { char: '珈', gender: 'f', freq: 'low', meaning: '玉饰琳琅，端庄华美', tags: ['美玉', '家宅'] },
  { char: '珣', gender: 'f', freq: 'low', meaning: '美玉温润，光华内蕴', tags: ['美玉', '光亮'] },
  { char: '瑀', gender: 'f', freq: 'low', meaning: '似玉之石，温润含光', tags: ['美玉', '光亮'] },
  { char: '瑢', gender: 'f', freq: 'low', meaning: '佩玉瑽瑢，温雅悦耳', tags: ['美玉', '音律'] },
  { char: '蕖', gender: 'f', freq: 'low', meaning: '芙蕖出水，清丽天然', tags: ['草木', '灵动'] },
  { char: '堇', gender: 'f', freq: 'low', meaning: '堇花淡紫，清雅宜人', tags: ['草木', '温柔'] },
  // ---- 中性 16 ----
  { char: '时', gender: 'n', freq: 'mid', meaning: '应时而立，从容有序', tags: ['自然', '心性'] },
  { char: '攸', gender: 'n', freq: 'low', meaning: '水流安行，从容自得', tags: ['水泽', '心性'] },
  { char: '叙', gender: 'n', freq: 'low', meaning: '叙事有序，从容条达', tags: ['言信', '文采'] },
  { char: '寻', gender: 'n', freq: 'low', meaning: '求索不辍，寻真有得', tags: ['心性', '文采'] },
  { char: '芃', gender: 'n', freq: 'mid', meaning: '芃芃其麦，生机蓬勃', tags: ['草木', '丰茂'] },
  { char: '闻', gender: 'n', freq: 'low', meaning: '博闻广识，声名远播', tags: ['文采', '言信'] },
  { char: '惟', gender: 'n', freq: 'low', meaning: '惟精惟一，专注笃定', tags: ['心性', '品德'] },
  { char: '恪', gender: 'n', freq: 'low', meaning: '恪守本心，恭敬有度', tags: ['品德', '心性'] },
  { char: '晏', gender: 'n', freq: 'mid', meaning: '河清海晏，安然平和', tags: ['家宅', '光亮'] },
  { char: '笙', gender: 'n', freq: 'mid', meaning: '笙歌雅乐，和悦悠扬', tags: ['音律', '光亮'] },
  { char: '旻', gender: 'n', freq: 'low', meaning: '秋旻高远，明朗辽阔', tags: ['高远', '自然'] },
  { char: '辞', gender: 'n', freq: 'mid', meaning: '属辞成章，文采斐然', tags: ['文采', '言信'] },
  { char: '淮', gender: 'n', freq: 'low', meaning: '淮水汤汤，源远流长', tags: ['水泽', '自然'] },
  { char: '程', gender: 'n', freq: 'mid', meaning: '前程似锦，行稳致远', tags: ['高远', '言信'] },
  { char: '黎', gender: 'n', freq: 'low', meaning: '黎明破晓，希望初升', tags: ['光亮', '自然'] },
  { char: '年', gender: 'n', freq: 'low', meaning: '岁月安然，年年丰盈', tags: ['自然', '丰茂'] },
  { char: '见', gender: 'n', freq: 'low', meaning: '见微知著，识见明达', tags: ['言信', '文采'] },
  { char: '弈', gender: 'm', freq: 'mid', meaning: '弈局从容，智深虑远', tags: ['言信', '心性'] }
];

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeJson(p, doc) { fs.writeFileSync(p, JSON.stringify(doc, null, 2) + '\n', 'utf8'); }

function main() {
  const strokes = readJson(path.join(DB, 'hanzi-strokes.json'));
  const whitelist = new Set(readJson(path.join(DB, 'whitelist-8105.json')).chars.map((c) => c.char));
  const blockDoc = readJson(path.join(DB, 'name-blocklist.json'));
  const blockSet = new Set();
  for (const k of Object.keys(blockDoc.chars || {})) {
    const v = blockDoc.chars[k];
    (Array.isArray(v) ? v : Object.keys(v)).forEach((c) => blockSet.add(c));
  }
  const redlineWords = readJson(path.join(DB, 'redline-llm.json')).words || [];

  for (const item of CHARS) {
    const s = strokes.chars[item.char];
    if (!s) throw new Error(item.char + ' 缺 hanzi-strokes 数据');
    if (!whitelist.has(item.char)) throw new Error(item.char + ' 不在白名单');
    if (blockSet.has(item.char)) throw new Error(item.char + ' 命中黑名单');
    if (redlineWords.some((w) => item.meaning.includes(w))) throw new Error(item.char + ' 释义命中红线词');
    if (item.meaning.length > 12) throw new Error(item.char + ' 释义超 12 字');
  }

  for (const base of [DB, GEN_DATA]) {
    const core = readJson(path.join(base, 'hanzi-core.json'));
    const pool = readJson(path.join(base, 'name-pool.json'));
    const coreIdx = new Map(core.chars.map((c) => [c.char, c]));
    const inPool = new Set([...pool.chars.m, ...pool.chars.f, ...pool.chars.n]);

    let added = 0;
    for (const item of CHARS) {
      if (inPool.has(item.char)) continue;
      const s = strokes.chars[item.char];
      coreIdx.set(item.char, {
        char: item.char, strokes: s.strokes, pinyin: s.pinyin, tone: s.tone,
        freqLevel: item.freq, imageryTags: item.tags, meaning: item.meaning
      });
      pool.chars[item.gender].push(item.char);
      if (!pool.cats) pool.cats = {};
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
      version: 'v0.5',
      note: pool.metadata.note + '；v0.5 依豆包热门清单与 2026 公开榜单交叉增补 81 字（含珩芮晞芷祎慕等爆款及攸晏笙辞等国风小众，剔除琀等疑义生僻字），人工精标释义/意象/常用度/性别亲和。'
    });

    writeJson(path.join(base, 'hanzi-core.json'), core);
    writeJson(path.join(base, 'name-pool.json'), pool);
    console.log('[' + base + '] 入池 ' + added + ' 字；hanzi-core ' + core.chars.length
      + '；池总量 ' + (pool.chars.m.length + pool.chars.f.length + pool.chars.n.length));
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
