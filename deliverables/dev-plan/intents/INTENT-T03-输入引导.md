# INTENT-T03：输入与引导（首页）

## 1. 背景与目标
首屏是转化漏斗第一环，也是合规审查第一站。目标：**首屏无滚动完成 3 项输入并提交生成**，同时把「生辰可选、字辈避讳、方言」以渐进方式收纳。

## 2. 范围
**做**：极简首屏 3 项、8 风格 chips、渐进折叠卡、字辈/避讳字、方言选择（粤/川渝可用）、提交后调 generate.create 并携 jobId 跳结果页。
**不做**：生成流水线本身（T04）；结果页（T07）。

## 3. 输入
- PRD M1-1~1-5；3.3 隐私分级表（生辰为敏感项，单独勾选同意）
- 交接包 3.1 generate create 入参契约、name_jobs schema 的 constraints 结构
- 原型屏01：标题「好名字，从字义与音律开始」、风格 chips、AI 横幅位置

## 4. 产出
```
miniprogram/pages/index/index.{js,wxml,wxss,json}
miniprogram/components/style-chips/*        # 8 风格多选，含"不限"态
miniprogram/components/progressive-card/*   # 折叠卡：生辰（单独授权勾选）/字辈/避讳/寄语/方言
miniprogram/components/aigc-banner/*        # 占位接入（T14 完整实现）
```

## 5. 实现要点
- 必填最小集仅 3 项：姓氏（1 字，正则校验，超出提示）、性别（male/female 单选）、风格（可跳过=不限）。
- 生辰输入前弹出单独授权弹窗（默认不勾选），勾选后调用 `user.setBirthConsent`（T09 前可先本地记 privacy.birthConsent，云函数后补）；**拒绝/跳过不阻断任何功能**（15.1.3 红线）。
- 提交即 `call('generate','create',{surname,gender,styles,constraints,source:'free'})`，得到 `{jobId,status:'pending'}` 后 `wx.navigateTo` 到 result 页并把 jobId 通过 query 传递；轮询在结果页做（T07）。
- constraints 序列化对齐 name_jobs：`{generationChar, avoidChars[], wishes, dialects[], birth:null|哈希}`；避讳字不要求在白名单内（仅做过滤）；字辈字命中优先逻辑在 T04。
- 方言 chips：粤语/川渝 默认可见，吴/闽/客置灰标注"即将支持"。
- 埋点：`enter{scene}`（onLoad 取 options.scene）、`input_submit{has_styles,has_constraints}`。

## 6. 验收标准
- [ ] 首屏无需滚动即可完成输入（750rpx 宽真机验证）
- [ ] 8 chips 点击有选中态；全不选=「不限」可生成
- [ ] 拒绝生辰授权后生成流程完整可用；勾选后 birthConsent 记录为 true
- [ ] 字辈"承"提交后 name_jobs.constraints 落库正确；避讳"祖"传参正确
- [ ] 页面全部文案过 redline-ui.json 零命中
- [ ] 首页/结果页有统一免责声明文案：「基于汉字字义、音律与传统典籍提供文化参考，不具备任何预测效力」

## 7. 依赖与风险
- 依赖：T01（request/骨架）、T14（aigc-banner 可先用占位）。
- 风险：折叠卡诱导感过强影响完成率 → 默认收起且文案中性。

## 8. 预估人天
3（含 1-4/1-5 的 P1 输入部分）
