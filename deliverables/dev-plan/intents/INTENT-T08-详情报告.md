# INTENT-T08：名字详情·命名检测报告页

## 1. 背景与目标
「命名检测报告」是打分功能的合规替代，也是长辈说服场景的载体。目标：**六维完整呈现，全部为客观可校验信息，零测算语义**。

## 2. 范围
**做**：六维报告（字义/音律/典籍出处/谐音检测/书写成本/重名度参考）、出处原句可展开、谐音警示与同风格替代、解析不准确反馈入口。
**不做**：收藏逻辑（T09）、海报（T11）、反馈落库链路（T17 只做入口+调 user.feedback）。

## 3. 输入
- PRD M3-3（六维）、用户故事 3/4（避坑检查、长辈说服）
- 交接包 candidates.checks 结构、feedback schema
- 原型屏03：命名检测报告、平仄图、原句展开卡

## 4. 产出
```
miniprogram/pages/detail/index.{js,wxml,wxss,json}
miniprogram/components/tone-chart/*      # 平仄可视化（ping/ze 色块）
miniprogram/components/quote-card/*      # 出处卡：原句/作者/篇名 + verified 徽标
miniprogram/components/homophone-panel/* # 普通话/方言/英语三段检测结果
miniprogram/components/report-feedback/* # "这条解析不准确"按钮（type: meaning|quote|homophone）
```

## 5. 实现要点
- 六维映射 candidates 字段：①字义=chars[].meaning ②音律=tone-chart+拼音 ③典籍=quote-card（quote.verified=false 或 null 时整卡隐藏，改显示"本候选暂无可校验出处"）④谐音=homophone-panel（pass/warn/fail 三态，warn 给同风格替代建议——替代从同 jobId 其他候选取）⑤书写=writeCost 逐字笔画 ⑥重名度=duplicateLevel 文案化。
- 反馈按钮调 `user.feedback {candidateId,type,comment}`，同时置本地 reportFlagged。
- 埋点：`candidate_view{candidateId}`。
- 合规：报告标题固定「命名检测报告」，副标题带免责声明；任何量化仅用标签（如"重名度：低"）。

## 6. 验收标准
- [ ] 六维完整度 ≥95%（抽验 100 个候选每维字段非空率，出处维按"显式无出处"计完整）
- [ ] "诗婷"类案例：英语/粤语警示可见且给出替代
- [ ] 出处卡仅展示 verified=true 三元组；展开显示原句全文
- [ ] 反馈四类 type 落库正确；无出处/无谐音数据时有优雅降级文案
- [ ] 全页文案 grep redline-ui 零命中；无任何分数

## 7. 依赖与风险
- 依赖：T07（进入路径）、T05（checks 数据）。
- 风险：谐音 warn 判定过严影响体验 → warn 阈值参数化，依据内测反馈调。

## 8. 预估人天
2.5
