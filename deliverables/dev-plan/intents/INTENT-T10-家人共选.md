# INTENT-T10：家人共选房间

## 1. 背景与目标
家庭共识是核心差异化之一。目标：**从选名夹 3–8 个候选一键生成共选链接，家人免登录投票（点赞/踩+一句话理由），房主看票数汇总**。

## 2. 范围
**做**：vote 云函数 5 个 action、vote 页（分享落地页）、voterKey 匿名机制、票数实时展示、房主关房。
**不做**：命名说明书（T12）；完整投票房间体系（Non-goals，只做最小共选）。

## 3. 输入
- PRD M4-1/4-2、5.2 家人共选流程
- 交接包 votes schema（含 ballots、匿名 voterKey 设计）、3.3 vote 契约、错误码 4001
- 原型屏04：家人共选

## 4. 产出
```
miniprogram/pages/vote/index.{js,wxml,wxss,json}
cloudfunctions/vote/index.js             # action: createRoom / initRoom / castVote / getResult / closeRoom
cloudfunctions/vote/lib/room.js          # 房间 CRUD 与票数聚合
miniprogram/components/vote-card/*       # 候选投票卡（up/down + 票数 + 评论输入）
```

## 5. 实现要点
- createRoom：房主从 folder 勾选 3–8 个 candidateIds（越界 toast），建 votes 文档 `{roomId:R+8位随机, candidateIds, title, status:'open', ballots:[]}`，返回 sharePath `/pages/vote/index?roomId=...`。
- initRoom：分享进入时调用，若无本地 voterKey 则下发 `anon_+4位随机` 并 `wx.setStorageSync` 持久化；**不请求昵称头像、不要求登录**（规避 15.2.1）。
- castVote：`{roomId,candidateId,choice:up|down,comment}`；同一 voterKey 对同一 candidateId 覆盖改票；comment 先过 msgSecCheck（输入侧，复用 T05 seccheck）；投票者打开房间也生成轻量 users 记录（privacy 默认，不采敏感项）或完全匿名——实现取**后者**，ballots 仅存 voterKey。
- getResult：聚合逐候选 up/down 计数与评论列表；房主端（openid==房主）额外可 closeRoom（status=closed 后拒投，返回 4001）。
- 分享卡片：`onShareAppMessage` 标题「帮我家宝宝选名字：{title}」，内容型分享、无诱导话术（3.2.1）。
- 埋点：`vote_invite{roomId,candidate_count}`（房主生成房间时）、`vote_cast{roomId,voterKey}`。

## 6. 验收标准
- [ ] 3–8 上下限强校验；链接分享→新设备打开可立即投票，全程无登录/授权弹窗
- [ ] 同一 voterKey 改票覆盖不重复计数；票数聚合准确
- [ ] 评论含敏感词被 msgSecCheck 拦截且有提示
- [ ] 非房主调 closeRoom 被拒；closed 房间投票返回 4001
- [ ] 全流程不采集昵称/头像/生日（代码审查确认）
- [ ] vote_invite/vote_cast 埋点上报（Gate2 投票邀请率 ≥20% 依赖此口径）

## 7. 依赖与风险
- 依赖：T09（candidateIds 来源）、T05（seccheck 复用）。
- 风险：分享链路在审核中可能被质疑诱导 → 保持纯内容型分享文案。

## 8. 预估人天
3.5
