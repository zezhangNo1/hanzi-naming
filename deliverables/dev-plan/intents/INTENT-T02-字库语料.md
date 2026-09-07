# INTENT-T02：字库与语料数据落地

## 1. 背景与目标
生成引擎、过滤流水线、出处校验全部依赖本地数据。目标：**交接包第四节 #1–#11 全部数据源落地为 database/ 下的 JSON/索引，并提供构建与查询脚本**，使输出字 100% 可控、出处可本地校验。

## 2. 范围
**做**：白名单、编码上限、音律数据、精选字库+意象标签、jyutping、粤/英谐音词表、不雅谐音词表、两份红线词表、典籍语料索引（倒排）、构建脚本。
**不做**：川渝/吴/闽/客完整词表（先建空文件与 schema，粤/英先行）；农历干支仅引包不做 UI。

## 3. 输入
- 交接包第四节 11 项数据源及获取方式
- PRD 3.2 红线词表（llm 表 31 词逐字落入 redline-llm.json）

## 4. 产出
```
database/whitelist-8105.json          # 通用规范汉字表白名单（数组，含字/Unicode）
database/hanzi-core.json              # 精选字 1200–3000：{char, strokes, pinyin, tone, freqLevel, imageryTags[], possible_quotes[]}
database/hanzi-strokes.json           # 全量笔画/部首/结构（Unihan kTotalStrokes + pinyin-pro 派生）
database/jyutping.json                # 字→jyutping 映射（rime-jyutping 词表提取）
database/homophone-indecent.json      # 不雅谐音/贬义组合词表 ≥500 条
database/homophone-dialect-yue.json   # 粤语负面词（P0）；xic/wu/min/hak 空文件占位
database/homophone-english.json       # 拼音转写负面词 200–300 条（Shiting/Yu 类）
database/redline-ui.json              # UI 文案红线词（评分/星级/吉凶等）
database/redline-llm.json             # LLM 输出红线词（PRD 3.2 全量 31 词）
database/corpus/quotes-index.json     # 典籍倒排索引：字→[{book, author, title, text, key}]
database/corpus/manifest.json         # 语料覆盖统计（诗经305/楚辞/论语/全唐诗/全宋词 篇数句数）
database/scripts/build-whitelist.js / build-core.js / build-jyutping.js / build-quotes-index.js
database/scripts/verify.js            # 数据自检（字数、索引抽查回查、红线词与 PRD 一致性 diff）
```

## 5. 实现要点
- 典籍索引：chinese-poetry（Apache/MIT）抽取句子级记录，key 规则 `{book}.{卷/篇}.{序号}`（如 `quantangshi.190.17`），与 LLM prompt 的 quoteRef 对齐；倒排索引只对**名字常用字**建（hanzi-core 字集），控制体积（目标 <15MB，超限拆分片或改云数据库集合承载）。
- hanzi-core 每字附 `possible_quotes`（3–5 条该字出现的佳句），供 prompt 的 user 消息直接拼装——这是「模型只做选择与润色」设计的关键输入。
- redline-llm.json 必须与 PRD 3.2 逐词一致（verify.js 做 diff，防手抄遗漏）：`吉|凶|数理|三才|五格|命格|命局|喜用神|日主|五行缺|补缺|卦象|宜忌|冲克|运势|打分|评分|总分|评级|星级|测算|算命|占卜|改运|化解|招财|克父|克母|犯太岁|开光|灵符|转运|注定`。
- 字频 freqLevel（low/mid/high）来源：公安新生儿热名榜公开新闻稿统计 + 母婴平台榜，人工标注允许 2–3 人天，但**白名单与典籍索引必须先交付**。

## 6. 验收标准
- [ ] 白名单 8105 字与官方附件抽样 200 字 diff 一致
- [ ] 随机 50 个 quoteRef key 回查：(作者,篇名,句) 全中率 100%
- [ ] verify.js 全绿；红线词表与 PRD diff 为空
- [ ] jyutping 覆盖 hanzi-core 全部字；英文词表 ≥200 条
- [ ] 云数据库挂载后单字白名单查询 <10ms

## 7. 依赖与风险
- 依赖：无（可与 T01 并行）。
- 风险：chinese-poetry 全量较大 → 只导出诗句级子集；公安热名榜数据零散 → 允许 freqLevel 粗粒度三档。

## 8. 预估人天
4（其中白名单+典籍索引 2 天为 M1 硬依赖，意象标签/字频可延 1 周）
