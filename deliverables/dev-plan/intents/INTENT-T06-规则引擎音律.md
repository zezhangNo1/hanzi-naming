# INTENT-T06：规则引擎与音律层

## 1. 背景与目标
规则引擎承担三职：LLM 的解空间预筛、降级模式下的独立生成、候选排序。目标：**平仄/笔画/字频/姓氏适配四维可解释排序，输出字 100% 白名单**。

## 2. 范围
**做**：平仄标注、笔画均衡、字频/重名度、姓氏声韵适配、styles 加权、组合打分排序、降级模板文案。
**不做**：LLM 调用与 prompt（T04）；过滤（T05）。

## 3. 输入
- PRD M2-1（笔画/结构/拼音声调/平仄；组合排序：姓氏适配+声韵搭配+笔画均衡）
- T02 hanzi-core / hanzi-strokes
- 交接包 candidates schema 的 tones/chars/checks 字段口径

## 4. 产出
```
cloudfunctions/generate/lib/engine/tones.js        # 声调→ping/ze，标注 tones 数组
cloudfunctions/generate/lib/engine/strokes.js      # 笔画均衡分 + writeCost 总笔画
cloudfunctions/generate/lib/engine/freq.js         # duplicateLevel low|mid|high
cloudfunctions/generate/lib/engine/surname-fit.js  # 姓氏声调/声母适配（如姓上声→名首字宜平；避同声母拗口）
cloudfunctions/generate/lib/engine/score.js        # styles 加权 + 四维合成排序
cloudfunctions/generate/lib/engine/generate.js     # 降级模式：解空间内组合 top30 + 模板寓意文案
```

## 5. 实现要点
- tones：阴平/阳平→ping，上去入→ze（粤音入声可作参考但排序以普调为准）。
- surname-fit 规则可解释、可配置（JSON 参数文件），例：姓氏尾字为仄（沈 shěn 上声）→ 名首字优先平声；双字名避免声母完全相同（沈书诗 s-s-s 拗口扣分）。
- styles 加权：8 风格映射 imageryTags 集合，候选字标签命中加权；多选风格取并集。
- 输出字段对齐 candidates schema：`pinyin[]、tones[]、chars[{char,strokes,freqLevel,meaning,inWhitelist}]、checks.writeCost`；meaning 由字库预置（降级模式使用模板句式「X：字义…；Y：字义…」）。
- 打分仅用于内部排序与标签，**绝不输出分数/星级/匹配度数值**（匹配度=标签化表述，见 T07）。

## 6. 验收标准
- [ ] 降级模式输出 30 个候选，每字 100% ∈ 白名单（PRD M2-1 验收）
- [ ] 沈姓 + 古风雅致风格：top10 中 ≥7 个名首字为平声（姓氏适配生效可验证）
- [ ] tones/pinyin 与 pinyin-pro 权威结果抽样 200 例一致率 ≥99%
- [ ] duplicateLevel 与热名榜口径抽检一致；writeCost=逐字笔画和
- [ ] 全链路禁分值外泄：引擎任何输出不含 score/星级字段（grep 验证）

## 7. 依赖与风险
- 依赖：T02。与 T04 并行开发、约定接口后替换 stub。
- 风险：音律规则主观性 → 参数外置 JSON，依据 T17 反馈通道迭代。

## 8. 预估人天
2.5
