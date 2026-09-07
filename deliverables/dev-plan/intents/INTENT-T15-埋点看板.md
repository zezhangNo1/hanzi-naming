# INTENT-T15：埋点与数据看板

## 1. 背景与目标
五个 Gate 全靠数据验证。目标：**14 个关键事件从 W1 起全量上报，周报 7 个数一键可查，WNKU 口径与 collect 严格一致**。

## 2. 范围
**做**：tracker.js 封装、events 集合（或云开发统计）、14 事件字典落地、周报查询脚本、看板文档。
**不做**：自建 BI；实时大屏。

## 3. 输入
- PRD M9-1/9-2、第 8 节 Gate 表
- 交接包第六节埋点事件字典（14 事件全量）

## 4. 产出
```
miniprogram/utils/tracker.js             # track(event, params) 批量合并上报+失败重试
cloudfunctions/user/  (扩展)             # action: track（服务端写入 events 集合，避开前端直写权限）
database/README.md (扩展)                # events 集合 schema：{openid, event, params, ts, scene}
database/scripts/weekly-report.js        # 周报脚本：WNKU/完成率/分享率/K/付费/违规率/审核状态
docs/metrics-dashboard.md                # 7 数周报口径定义与查询方法
```

## 5. 实现要点
- 事件字典（逐个落地参数，缺一不可）：`enter{scene}`、`input_submit{has_styles,has_constraints}`、`generate_success{jobId,latency_ms,degraded,source}`、`generate_fail{stage,code}`、`candidate_view{candidateId}`、`collect{candidateId,batch_index}`、`vote_invite{roomId,candidate_count}`、`vote_cast{roomId,voterKey}`、`poster_save{template}`、`report_share{type}`、`ad_batch{placement}`、`pay_success{sku,env,price_fen}`、`compliance_block{stage}`、`audit_status{result}`。
- tracker 技术点：本地队列 5 条或 10s 合并上报；app 启动补发离线事件；openid 服务端补齐（前端不传）；采集前依赖隐私指引同意（首次启动弹隐私授权后再启用）。
- 周报 7 数口径（docs 内定稿）：WNKU=本周 collect 去重 openid；首次生成完成率=generate_success/input_submit；海报分享率=poster_save/UV；投票邀请率=vote_invite/UV；K=新用户中来自分享占比；付费转化=pay_success UV/UV；违规拦截率=block_log 中 redline 命中且未出街比率（目标 100%）。
- audit_status 事件由人工在提审后手动触发记录（result: submitted/rejected/passed）。

## 6. 验收标准
- [ ] 14 事件逐一真机触发并在 events 集合可查、参数完整（Checklist D"埋点全量上报验证"）
- [ ] collect 事件与 collections 集合新增数一致（WNKU 口径校验，Checklist D 项）
- [ ] weekly-report.js 输出 7 数与手工 SQL 抽查一致
- [ ] 离线事件补发无丢失（飞行模式用例）
- [ ] compliance_block 与 block_log 条数吻合

## 7. 依赖与风险
- 依赖：T01；各业务任务按清单挂埋点（本任务提供 tracker 并做接入 review）。
- 风险：事件参数漂移 → tracker 内置参数 schema 校验，缺参告警。

## 8. 预估人天
2.5
