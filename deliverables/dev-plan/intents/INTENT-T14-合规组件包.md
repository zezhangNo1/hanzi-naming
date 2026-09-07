# INTENT-T14：合规工程组件包

## 1. 背景与目标
审核生死线全部工程化。目标：**AI 横幅、免责声明、隐私授权、删除数据、红线词 CI 校验五件套成为全局不可绕过的基础设施**。

## 2. 范围
**做**：aigc-banner/disclaimer 全局组件、生辰单独授权弹窗、隐私保护指引页与字段勾选清单、「删除我的数据」全链路（user.deleteMyData）、redline-ui CI 扫描脚本。
**不做**：提审材料撰写与提交（T18）；服务端过滤（T05）。

## 3. 输入
- PRD M8-1~8-4、3.1 平台合规表、3.2/3.3 禁用词与隐私分级
- 交接包第五节前端 UI 红线、提审 Checklist B/C、user 云函数 3.5 deleteMyData 契约

## 4. 产出
```
miniprogram/components/aigc-banner/*     # 「内容由 AI 生成，仅供文化参考」固定横幅（不可关闭、非角落小字）
miniprogram/components/disclaimer/*      # 免责声明条（统一文案）
miniprogram/components/birth-consent-popup/*  # 生辰单独授权弹窗（默认不勾选）
miniprogram/pages/privacy/index.*        # 隐私保护指引（按实际字段勾选清单渲染）
miniprogram/pages/mine/  (扩展)          # 我的-隐私-删除我的数据入口 + 二次确认
tools/check-redline.js                   # CI 脚本：扫描 wxml/js/json 全部 UI 文案 × redline-ui.json
docs/privacy-checklist.md                # MP 后台隐私指引勾选清单（对照 Checklist B）
```

## 5. 实现要点
- aigc-banner：生成相关页面（index/result/detail/poster/report）顶部固定展示，组件内禁提供关闭态；海报图内另有小字行（T11）。
- disclaimer 统一文案：「基于汉字字义、音律与传统典籍提供文化参考，不具备任何预测效力」——首页/结果页/详情页/海报四处全覆盖（M8-3）。
- birth-consent-popup：默认不勾选、明确用途与存储期限（生辰 ≤180 天或即时哈希）、可跳过；勾选才允许生辰输入并调 setBirthConsent。
- deleteMyData：调 `user.deleteMyData`，硬删除 users/name_jobs/candidates/collections/votes/feedback 本人数据，orders 保留必要支付记录并脱敏 openid 尾号；前端二次确认+完成提示；**删除后 app 清本地缓存重置游客态**。
- CI 脚本：`node tools/check-redline.js` 全仓扫描，命中即非零退出，接入 pre-commit/流水线；同时校验「总分/星级/评分」等词在全部组件 props/文案中出现即失败。
- UI 措辞对照：用「命名检测报告」不用打分、「匹配度」不用评分、任何组件禁"总分/星级"。

## 6. 验收标准
- [ ] AI 横幅在 4 个生成相关页面固定可见、不可关闭（Checklist C 项）
- [ ] 免责声明四链路全覆盖；拒绝生辰授权后全功能可用（15.1.3.2 代码自查）
- [ ] 删除我的数据：测试账号全集合数据清空验证（orders 脱敏保留）
- [ ] 构造含"评分"的测试文案 → CI 脚本拦截非零退出
- [ ] privacy-checklist.md 与 MP 后台实际勾选项逐条对照完成（Checklist B 全项）

## 7. 依赖与风险
- 依赖：T01；与各页面任务并行，页面任务负责挂载组件。
- 风险：后加页面漏挂横幅 → 在页面基类/mixin 中统一注入而非逐页手贴。

## 8. 预估人天
3.5
