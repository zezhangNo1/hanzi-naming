# INTENT-T11：名字卡片海报 canvas 导出

## 1. 背景与目标
海报是分享率（Gate2 8–10%）与拉新的主要载体，也是隐私合规高危区。目标：**3 套模板 canvas 生成、字段白名单强校验、AIGC 隐式标识写入、保存/转发顺畅**。

## 2. 范围
**做**：poster 页、Canvas 2D 三模板渲染、字段白名单校验器、PNG tEXt 元数据写入、相册保存授权流、转发分享。
**不做**：说明书长卡（T12）；周边实物（P2 不做）。

## 3. 输入
- PRD M5-1/5-2、3.1 海报字段白名单约束（无生辰/父母全名/头像/ID）
- 交接包提审 Checklist C（图片元数据 AIGC 隐式标识：canvas 导出写入 PNG tEXt）
- 原型屏05：名字卡片海报（宣纸底、衬线大字、朱砂印章元素）

## 4. 产出
```
miniprogram/pages/poster/index.{js,wxml,wxss,json}
miniprogram/components/poster-canvas/*   # Canvas 2D 渲染器（模板 A/B/C 可切换）
miniprogram/components/poster-templates/*# 三套模板绘制函数与预览缩略图
miniprogram/utils/poster-fields.js       # 字段白名单校验器
miniprogram/utils/png-metadata.js        # tEXt chunk 写入（AIGC 标识）
```

## 5. 实现要点
- 白名单字段仅：名字、拼音、典故原句、寓意、寄语（用户自填）；`poster-fields.js` 在渲染前白名单断言，出现生辰/父母姓名/头像/ID 等字段即拒渲染并上报——**代码级保证，不靠人工**。
- 免责声明绘制进图片（「基于汉字字义、音律与传统典籍提供文化参考，不具备任何预测效力」+「内容由 AI 生成，仅供文化参考」小字行），保证分享出去的图自带合规信息。
- AIGC 隐式标识：导出 PNG 后在二进制层插入 tEXt chunk（`AIGC:1` + 生成时间），覆盖 wx.canvasToTempFilePath 产物。
- 保存：`wx.saveImageToPhotosAlbum` 前检测 `wx.getSetting` 相册写入授权，拒绝时给设置页引导（不阻断其他功能）；转发走 onShareAppMessage（内容型）。
- 埋点：`poster_save{template}`、`report_share{type:'poster'}`。
- 模板设计对齐原型：宣纸底纹、墨色衬线名、朱砂印；A/B 测试按 openid 尾号分流。

## 6. 验收标准
- [ ] 三模板真机渲染无文字截断/错位；切换即时预览
- [ ] poster-fields 校验器单测：注入生辰字段被拒
- [ ] 导出 PNG 经二进制检查含 AIGC tEXt 字段（提审 Checklist C 项）
- [ ] 拒绝相册授权 → 引导浮层出现，返回后流程不中断，其他功能不受影响（15.1.3.2）
- [ ] 图片内含免责+AI 生成小字；poster_save 埋点携带 template

## 7. 依赖与风险
- 依赖：T07/T08（数据）、T14（合规文案组件定稿）。
- 风险：不同机型 canvas 字体渲染差异 → 关键文案用系统衬线字体回退链+多机型截图回归。

## 8. 预估人天
3
