# INTENT-T05：过滤流水线与质量兜底

## 1. 背景与目标
这是「去玄学化」定位的工程护城河与审核生死线。目标：**红线词/白名单/出处三元组/谐音歧义/msgSecCheck 五道关卡 100% 拦截违规输出，且全程留痕 block_log**。

## 2. 范围
**做**：五段过滤器（服务端）、block_log 落库、msgSecCheck 输入输出双侧、前端预过滤 client、拦截率统计口径。
**不做**：生成与降级编排（T04）；前端 UI 展示 warn/fail（T08）。

## 3. 输入
- 交接包第五节「过滤流水线实现要点」、block_log schema、3.2 prompt 设计要点
- PRD M2-3/2-4/2-5、M8-1
- T02 词库全部文件

## 4. 产出
```
cloudfunctions/generate/lib/filter/redline.js      # 红线词（redline-llm.json，正则+词表）
cloudfunctions/generate/lib/filter/whitelist.js    # 全字∈白名单 且 ∉avoidChars
cloudfunctions/generate/lib/filter/quote-verify.js # quoteRef→quotes-index 回查(作者,篇名,句)全中
cloudfunctions/generate/lib/filter/homophone.js    # 普通话全拼/音近→粤jyutping全串→英语转写+编辑距离≤1
cloudfunctions/generate/lib/filter/seccheck.js     # security.msgSecCheck（候选名+寓意；wishes/评论输入侧）
miniprogram/utils/filter-client.js                 # 前端红线词预过滤（redline-ui 轻量版）
cloudfunctions/generate/lib/filter/index.js        # runAll(candidate, ctx) -> {pass, stage, detail} 汇编
docs/filter-pipeline.md                            # 各关卡 fail/warn 判定矩阵
```

## 5. 实现要点
- 判定矩阵：红线词命中→**丢弃重生成**（fail）；白名单外→丢弃重生成；出处校验不过→**不丢弃**，quote 置 null（文案改为不引用）；谐音 fail（英语 Shiting 类/不雅全拼命中）→丢弃重生成，warn→保留并标 checks；msgSecCheck 不过→丢弃重生成。任一环节累计 3 次失败→通知 pipeline 走降级（T04）。
- 每次拦截写 block_log：`{jobId, stage: redline|whitelist|homophone|seccheck|quote, detail:"命中词：五格", raw:脱敏}`。
- msgSecCheck 用云调用 `security.msgSecCheck`（需 cloud.init 带 env），输入侧对用户 wishes/投票评论同样送检。
- 谐音检测输出写回 candidates.checks：`homophonePutonghua / homophoneDialect{yue,jyutping} / homophoneEnglish / sensitive / duplicateLevel / whitelist / writeCost`。
- 前端 filter-client.js：页面渲染前对文案做 redline-ui 匹配，命中即上报并显示兜底文案（防御性双保险）。

## 6. 验收标准
- [ ] 内测 50 例人工评审：违规输出拦截率 100%（PRD M2-5）
- [ ] "诗婷"粤语 jyutping 检出近音警示；"诗婷"→英语 Shiting 命中 fail 并重生成成功
- [ ] 构造含"五格"的 LLM mock 输出 → 被 redline 拦截且 block_log 有记录
- [ ] 出处三元组任一不中 → quote=null 且页面不显示出处
- [ ] wishes 输入"打分"类词被输入侧 msgSecCheck/红线词拦截
- [ ] `compliance_block` 埋点（T15）随拦截上报，stage 字段齐全

## 7. 依赖与风险
- 依赖：T02（硬）、T04（编排）。
- 风险：msgSecCheck 有频控 → 批量合并送检+失败重试队列；粤/英语词表覆盖不足 → 漏检案例进 T17 反馈库持续补词。

## 8. 预估人天
3
