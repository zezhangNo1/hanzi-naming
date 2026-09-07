# INTENT-T07：结果列表与筛选页

## 1. 背景与目标
首批候选的第一接触面。目标：**单屏 3–4 个候选、无综合分、风格即筛选器**，并承载额度与解锁入口。

## 2. 范围
**做**：候选列表（大字+拼音+3 标签+出处一行）、风格分组筛选、换一批、收藏/左滑排除入口、轮询与加载态、2001 解锁卡跳转。
**不做**：详情页（T08）、选名夹页（T09）、支付（T13）。

## 3. 输入
- PRD M3-1/3-2、5.1 首次起名流程
- 交接包 3.1 poll 出参、错误码 2001/3001
- 原型屏02：名字衬线大字、客观标签 pill、出处一行

## 4. 产出
```
miniprogram/pages/result/index.{js,wxml,wxss,json}
miniprogram/components/tag-pill/*        # 平仄/笔画数/重名度参考 三个客观标签
miniprogram/components/style-filter/*    # 复用 style-chips 的筛选态
miniprogram/components/unlock-card/*     # 解锁卡骨架（付费/广告 CTA 在 T13 填充）
```

## 5. 实现要点
- 进入即 `call('generate','poll',{jobId})` 轮询（间隔 1.5s，超 25s 提示重试）；`degraded:true` 时正常展示但顶部轻提示"规则模式生成"。
- 单卡结构：姓名大字（衬线）、拼音串、tag-pill×3（平仄构成/总笔画/重名度参考）、quote 一行（quote=null 则显示寓意而不显示出处行）。
- 筛选：前端按 style 字段过滤（响应 <100ms，PRD 3-2），不改请求。
- 换一批：constraints 不变 batch+1 重新 create/poll；source 按额度状态由 T13 决定 free/ad/paid。
- code=2001 → 弹 unlock-card（原型屏06 样式）。
- 埋点：`generate_success{jobId,latency_ms,degraded,source}`、`generate_fail{stage,code}`。
- 文案红线：标签措辞用「重名度参考」「命名检测报告」，禁"评分/打分/星级/总分"。

## 6. 验收标准
- [ ] 单屏 3–4 候选、无任何综合分/分数展示（PRD 3-1）
- [ ] 风格筛选响应 <100ms；筛选后计数正确
- [ ] 2001 触发解锁卡；3001 降级标记可见；quote=null 候选不显示出处行
- [ ] 弱网轮询有超时与重试路径；generate_success 埋点 latency_ms 与服务端一致
- [ ] 页面文案 grep redline-ui 零命中

## 7. 依赖与风险
- 依赖：T03（入口跳转）、T04（接口）、T13（解锁卡 CTA 可先占位）。
- 风险：30 个候选单页渲染性能 → 分页渲染 10 个/屏。

## 8. 预估人天
2.5
