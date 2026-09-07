# INTENT-T09：选名夹与收藏

## 1. 背景与目标
选名夹是北极星 WNKU 的口径来源，也是共选与说明书的输入。目标：**收藏/排除即时生效并服务端持久化，免费额度状态可视化**。

## 2. 范围
**做**：folder 页、收藏/取消、排除与理由记录、user 云函数 collect/uncollect/listFolder、解锁卡完整态（额度用完场景）。
**不做**：共选房间（T10）、说明书（T12）、支付扣费逻辑（T13）。

## 3. 输入
- PRD M3-4（收藏数=WNKU 口径）、M7-1 免费额度
- 交接包 collections schema、user 云函数契约 3.5、错误码 2001
- 原型屏06：选名夹解锁（解锁卡视觉）

## 4. 产出
```
miniprogram/pages/folder/index.{js,wxml,wxss,json}
cloudfunctions/user/index.js             # action: collect / uncollect / listFolder / setBirthConsent（骨架在本任务成型）
cloudfunctions/user/lib/store.js         # users/collections 读写封装
miniprogram/components/candidate-row/*   # 列表行（含备注、取消收藏、投票状态占位）
```

## 5. 实现要点
- collect：写 collections `{candidateId,note,addedAt}` 并置 candidates.collected=true；uncollect 反向；listFolder 返回收藏列表+各候选关键信息（后续 T10 要含投票状态字段）。
- note 为可选一句话理由（"爷爷喜欢"）；排除理由记录在 result 页左滑动作里，写入 collections.note 前缀 `[排除]` 或独立字段——落库口径本任务内定稿。
- WNKU 口径：本周有 ≥1 次 collect 事件的去重 openid；埋点 `collect{candidateId,batch_index}` 在本任务接通（与 T15 对齐）。
- 解锁卡：freeUsed≥2 且无 ad/paid 时，folder 与 result 的"换一批"位置展示 unlock-card（视觉对齐屏06），CTA 事件 T13 接管。
- users 集合初始化：首次任意 user 云函数调用时 ensure 用户文档（freeUsed:0, privacy 默认值）。

## 6. 验收标准
- [ ] 收藏/取消在弱网下有乐观更新+失败回滚；数据以服务端为准
- [ ] collect 埋点与 WNKU 口径一致（PRD 3-4）
- [ ] listFolder 返回含 note/addedAt/候选摘要
- [ ] 免费额度用完场景解锁卡正确弹出且不阻断已收藏内容浏览
- [ ] users 文档 privacy.birthConsent / agreeVersion 字段初始化正确

## 7. 依赖与风险
- 依赖：T07、T04（额度数据）。
- 风险：收藏与 candidates.collected 双写不一致 → 以 collections 集合为唯一真源，collected 为冗余展示字段。

## 8. 预估人天
1.5
