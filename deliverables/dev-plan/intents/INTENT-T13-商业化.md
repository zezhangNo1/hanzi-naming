# INTENT-T13：商业化（免费额度/虚拟支付/激励视频）

## 1. 背景与目标
G3 合规商业化。目标：**免费 2 批→激励视频 +1 批→¥9.9 深度包/¥19.9 三次包的额度体系全链路闭环，支付幂等、查单补发可靠**。

## 2. 范围
**做**：order 云函数（create/onPayNotify/reconcile）、wx.requestVirtualPayment 接入、users 额度字段扣减与恢复、激励视频 ad 批次、解锁卡完整 CTA、iOS 保守文案。
**不做**：实物周边（P2）；会员体系。

## 3. 输入
- PRD M7-1/7-2/7-3
- 交接包 orders schema、3.4 order 契约、错误码 2001/2002、环境变量 FREE_BATCH_LIMIT/AD_BATCH_LIMIT
- 原型屏06：选名夹解锁

## 4. 产出
```
cloudfunctions/order/index.js            # action: create / reconcile（onPayNotify 为独立回调入口）
cloudfunctions/order/lib/wxpay.js        # wx.requestVirtualPayment 参数组装、验签、幂等控制
cloudfunctions/order/lib/entitlement.js  # SKU→deliveries 定义（deep_single:1批+六维完整+说明书；deep_x3:3批）
miniprogram/pages/mine/pay-result/*      # 支付结果页（含 2002 重试 reconcile 入口）
miniprogram/components/unlock-card/*     # 完整 CTA（¥9.9 / 看视频+1批 / ¥19.9）
miniprogram/utils/rewarded-ad.js         # 激励视频封装（UV≥500 前置判断，未开通时隐藏入口）
```

## 5. 实现要点
- 额度模型（users 字段）：`freeUsed`（≤FREE_BATCH_LIMIT=2）、`adFreeToday{date,count}`（≤AD_BATCH_LIMIT=1，跨日重置）、`paidUntil`（三次包剩余次数 int）。generate 的 quota.js（T04）消费端按此判断，本任务提供扣减/恢复的唯一实现（避免两处扣费）。
- 下单：`create{sku}` → 组装 wxPayParams 返回；前端 `wx.requestVirtualPayment` 成功后立即调 `reconcile{orderId}` 查单，未 delivered 则补发（onPayNotify 丢失兜底）；2002 时保留重试入口。
- onPayNotify：验签 → 幂等（orderId 已 paid 则直接返回）→ 置 paid + 写 deliveries{type:'batch_quota',amount,appliedAt} → 恢复因 2002 冻结的额度。
- orders 记录 `env:android|ios|harmony|windows`；iOS 文案保守版（退款指引走苹果），费率差异不影响定价。
- 激励视频：看完回调 → adFreeToday+1 → 以 source:'ad' 重新 create；不做"转发解锁"（3.2.1 红线）。
- 深度包权益与免费版的差异：更多候选 + 六维完整报告 + 命名说明书（M7-2）；candidates.source 落 paid。
- 埋点：`pay_success{sku,env,price_fen}`、`ad_batch{placement}`。

## 6. 验收标准
- [ ] 免费第 3 批被 2001 拦截并弹解锁卡；看广告后成功再生成 1 批，当日第 2 次广告被限
- [ ] ¥9.9 沙箱支付成功 → paidUntil/quota 更新 → 可继续生成；candidates.source=paid
- [ ] 幂等：人为重放 onPayNotify 不重复发放（PRD 7-2 验收"支付幂等+查单补发"）
- [ ] 断网模拟回调丢失 → 支付结果页 reconcile 补发成功
- [ ] iOS 环境展示保守退款文案；全部支付走 requestVirtualPayment（Checklist D 项）
- [ ] pay_success/ad_batch 埋点与订单金额一致（ARPPU 口径）

## 7. 依赖与风险
- 依赖：T01、T04（quota 消费端）、T09（解锁卡位置）。
- 外部依赖：虚拟支付开通资质（个体户+类目审核）、流量主 UV≥500（未达标前广告位隐藏，不阻塞上线）。
- 风险：回调与查单双写竞争 → entitlement 更新统一走 order 云函数事务。

## 8. 预估人天
4.5
