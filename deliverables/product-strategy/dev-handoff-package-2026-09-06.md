# 开发交接包：汉字美学 · 取名工具

**日期**：2026-09-06 ｜ **版本**：v1.0 ｜ **配套**：PRD `prd-hanzi-naming-v1-2026-09-06.md`、原型 `prototype-hanzi-naming.html`
**技术栈**：原生微信小程序 + 微信云开发 CloudBase（云函数调 LLM，API Key 只存云函数环境变量）

---

## 一、工程结构建议

```
miniprogram/
  pages/            index(首页) / result(结果) / detail(报告) / vote(共选) / poster(卡片) / folder(选名夹) / inspiration(灵感小铺) / mine(我的)
  components/       name-card / tag-pill / style-chips / aigc-banner / disclaimer
  utils/            tracker.js(埋点) / filter-client.js(前端红线词预过滤) / request.js
cloudfunctions/
  generate/         起名主流程（LLM + 规则层 + 过滤流水线）
  vote/             共选房间创建/投票/查询
  order/            虚拟支付下单/回调/查单补发
  user/             收藏、删除我的数据、反馈
  admin/            词库/语料更新（走云开发控制台权限，不暴露）
database/           本仓库维护的词库 JSON（见第四节）
```

**环境变量（云函数 config，勿入前端）**：`LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`、`FREE_BATCH_LIMIT=2`、`AD_BATCH_LIMIT=1`

---

## 二、数据库集合 Schema（云开发文档型数据库）

> 通用约定：所有集合含 `_id`（自动）、`createdAt`、`updatedAt`（服务端时间）；用户侧数据均带 `openid`；所有集合禁止存出生日期明文超过 180 天（见合规节）。

### users
```json
{
  "_openid": "string（云开发自动注入）",
  "freeUsed": 0,               // 免费批次已用数，int
  "adFreeToday": { "date": "2026-09-06", "count": 0 },   // 当日激励视频次数
  "paidUntil": null,           // 三次包剩余次数 int 或 null
  "privacy": {
    "birthConsent": false,     // 生辰单独授权勾选
    "agreeVersion": "v1.0"     // 用户协议/隐私政策版本
  },
  "deletedAt": null
}
```

### name_jobs（一次生成任务）
```json
{
  "_openid": "string",
  "surname": "沈",
  "gender": "male",            // male | female
  "styles": ["古风雅致", "典籍感"],
  "constraints": {             // 全部可选
    "birth": null,             // 仅当 privacy.birthConsent=true 且用户主动填；存哈希不存明文亦可
    "generationChar": "承",    // 字辈字
    "avoidChars": ["祖"],      // 避讳字
    "wishes": "希望沉心笃学",  // 期望寄语（替代父母性格）
    "dialects": ["yue"]        // yue|xic|wu|min|hak
  },
  "status": "done",            // pending|done|failed
  "source": "free|ad|paid",
  "batch": 1,
  "candidateIds": ["..."],     // 本批候选 id 列表
  "degraded": false,           // 是否触发规则引擎降级
  "latencyMs": 9800
}
```

### candidates（候选名）
```json
{
  "_openid": "string",
  "jobId": "...",
  "name": "沈砚清",
  "pinyin": ["shěn","yàn","qīng"],
  "tones": ["ze","ze","ping"],
  "chars": [
    { "char": "砚", "strokes": 9, "freqLevel": "low", "meaning": "文房之要，静心笃学", "inWhitelist": true }
  ],
  "quote": {                   // 出处三元组，校验失败则整对象为 null
    "text": "秋水砚清，松风清入弦",
    "author": "韦应物", "book": "全唐诗", "volume": "卷一九〇",
    "verified": true
  },
  "checks": {
    "homophonePutonghua": "pass",     // pass|warn|fail
    "homophoneDialect": { "yue": "pass", "jyutping": "san2 jin6 cing1" },
    "homophoneEnglish": "pass",       // 近似词表比对
    "sensitive": "pass",              // msgSecCheck + 自建词表
    "duplicateLevel": "low",          // low|mid|high（本地字频统计）
    "whitelist": true,                // 全字在通用规范汉字表白名单
    "writeCost": 35                   // 总笔画
  },
  "style": "古风雅致",
  "collected": false,
  "reportFlagged": false      // 用户点"解析不准确"
}
```

### collections（选名夹，可并入 candidates 的 collected 字段，独立集合便于导出说明书）
```json
{ "_openid": "...", "candidateId": "...", "note": "爷爷喜欢", "addedAt": "..." }
```

### votes（家人共选）
```json
{
  "_openid": "...",            // 房主
  "roomId": "R8位随机",
  "candidateIds": ["..."],
  "title": "沈家小宝贝",
  "status": "open",            // open|closed
  "ballots": [
    { "voterKey": "anon_3f2a", // 投票者匿名标识（首次打开生成，不取昵称头像）
      "candidateId": "...", "choice": "up", "comment": "带书卷气", "at": "..." }
  ]
}
```
> 合规注意：投票者**不要求登录、不采集昵称头像**，用设备级匿名 key，规避 15.2.1 展示他人信息问题。

### orders
```json
{
  "_openid": "...",
  "sku": "deep_single|deep_x3",
  "priceFen": 990,             // 9.9 元
  "status": "created|paid|delivered|refunded",
  "wxPayParams": {}, "platformOrderId": "...",
  "deliveries": [ { "type": "batch_quota", "amount": 1, "appliedAt": null } ],  // 查单补发用
  "env": "android|ios|harmony|windows"   // 费率与退款策略分端
}
```

### block_log（拦截日志，合规元指标数据源）
```json
{ "jobId": "...", "stage": "redline|whitelist|homophone|seccheck|quote", "detail": "命中词：五格", "raw": "…（脱敏）" }
```

### feedback
```json
{ "_openid": "...", "candidateId": "...", "type": "meaning|quote|homophone", "comment": "..." }
```

---

## 三、云函数接口契约

> 统一返回：`{ "code": 0, "msg": "ok", "data": {...} }`；非 0 见错误码表。鉴权：云函数内取 `context.OPENID`，前端不传身份。

### 3.1 `generate` — 起名主流程

**action: `create`**
```json
// 入参
{ "surname": "沈", "gender": "male", "styles": ["古风雅致"],
  "constraints": { "generationChar": "", "avoidChars": [], "wishes": "", "dialects": [], "birth": null },
  "source": "free" }
// 出参（异步轮询模式，避免长连接超时）
{ "code": 0, "data": { "jobId": "J..." , "status": "pending" } }
```
**action: `poll`**（入参 `{ "jobId": "J..." }`）
```json
{ "code": 0, "data": {
    "status": "done",
    "candidates": [ /* candidates 文档数组，含 quote/checks */ ],
    "quota": { "freeLeft": 1, "adLeft": 1, "paidLeft": 0 },
    "degraded": false } }
```
**服务端流水线（顺序执行，任一 P0 失败即重生成，3 次失败降级）：**
```
1. 输入校验（姓氏 1 字、避讳字在白名单外也可传但仅做过滤）
2. 额度校验：free/ad/paid
3. 白名单解空间筛选（surname 适配字集 → styles 加权 → 避讳过滤）
4. LLM 生成（prompt 见 3.2；超时 12s 即降级规则引擎）
5. 过滤流水线：红线词 → 白名单复核 → 出处三元组校验 → 谐音/歧义 → msgSecCheck
6. 缓存查重（hash(surname+gender+styles+constraints+batch)）
7. 落库 candidates + block_log
```

### 3.2 LLM Prompt 草案（generate 云函数内置，v1）

```
System:
你是汉字命名顾问。任务：为 {surname}姓{gender}宝宝生成 10 个候选名，风格：{styles}。
硬规则（违反任何一条即废稿）：
1. 用字只能来自我提供的候选字集（见 user 消息中的字表），禁止造字、禁用生僻字。
2. 只描述字义、字音、典籍出处、气质意象；禁止出现：吉/凶/五行/八字/命/运/卦/数理/打分/评分/测试 等一切命理测算词汇。
3. 引用典籍时只能引用我提供的语料片段（见字表附带的出处候选），禁止凭记忆编造作者、篇名或原句。
4. 寓意文案每条不超过 30 字，语气祝福而不夸大。
输出：严格 JSON：{"names":[{"name":"沈砚清","pinyin":["shěn","yàn","qīng"],
"style":"古风雅致","meaning":"砚：…；清：…","quoteRef":{"lang":"zh","key":"quantangshi.190.x"},
"wishesEcho":"呼应寄语的一句话"}]}
User: 候选字集：[...本地预筛 60-100 字，每字附 possible_quotes 数组...]；寄语：{wishes}；字辈：{generationChar}；避讳：{avoidChars}
```
> 设计要点：**出处由本地语料索引提供选项、模型只做选择与润色**（quoteRef 指向语料 key），服务端按 key 回查原文——把"张冠李戴"风险从模型侧移到检索侧。

### 3.3 `vote` — 家人共选
```json
// action: createRoom  入参 { "candidateIds": ["..."], "title": "..." }
//   出参 { "roomId": "R8位", "sharePath": "/pages/vote/index?roomId=R8位" }
// action: castVote    入参 { "roomId": "...", "candidateId": "...", "choice": "up|down", "comment": "" }
//   匿名 voterKey 由前端首次进入时请求 action:initRoom 下发并本地存储
// action: getResult   入参 { "roomId": "..." }  出参含逐候选票数与评论
// action: closeRoom   仅房主 openid 可调
```

### 3.4 `order` — 虚拟支付
```json
// action: create   入参 { "sku": "deep_single" }
//   出参 { "code":0, "data": { "wxPayParams": { /* wx.requestVirtualPayment 所需 */ } } }
// action: onPayNotify（微信支付回调，验签后置 paid + deliveries）
// action: reconcile 入参 { "orderId": "..." }  // 前端支付后查单，未 delivered 则补发
```
> iOS 侧：付费引导文案用保守版（退款需用户向 App Store 申请）；安卓 1% / iOS 12% 费率差异不影响 SKU 定价。

### 3.5 `user` — 用户数据
```json
// action: collect      { "candidateId": "...", "note": "" }
// action: uncollect    { "candidateId": "..." }
// action: listFolder   {}  → 收藏列表（含家人投票状态）
// action: setBirthConsent { "consent": true }   // 生辰授权单独记录
// action: feedback     { "candidateId": "...", "type": "...", "comment": "..." }
// action: deleteMyData {}  // 硬删除 users/name_jobs/candidates/collections/votes/feedback 中本人数据（15.3.9），orders 保留必要支付记录并脱敏
```

### 错误码表
| code | 含义 | 前端处理 |
|------|------|----------|
| 0 | 成功 | — |
| 1001 | 参数不合法 | toast |
| 2001 | 免费额度用完 | 弹解锁卡（屏 06） |
| 2002 | 支付未到账 | 提示 + 保留 reconcile 重试入口 |
| 3001 | 生成超时已降级 | 正常展示，标记 degraded |
| 3002 | 内容安全拦截（全部重试失败） | 提示"本次生成失败，请重试" |
| 4001 | 房间不存在/已关闭 | toast |

---

## 四、字库与语料数据源清单（第 1 周必须落实）

| # | 数据 | 用途 | 获取方式 | 授权/成本 |
|---|------|------|----------|-----------|
| 1 | **《通用规范汉字表》8105 字**（国务院 2013） | 白名单准入（下限） | 教育部官网公开附件；或 GitHub 开源镜像（搜 "通用规范汉字表 json"） | 公开政府文件，✅ 免费 |
| 2 | GB18030-2022 编码范围 | 上限兜底（编码不了必排除） | Unicode/国家标准公开映射表 | ✅ |
| 3 | 汉字拼音/声调/部首/笔画 | 音律层、书写层 | 开源：`pinyin-pro`、`hanzi-writer` 数据、Unihan 数据库（Unicode 官方，`kTotalStrokes` 等字段） | ✅ 开源（注意各自 License，Unihan 为自由分发） |
| 4 | 取名常用字精选集（1,200-3,000 字）+ 字频/意象标签 | 解空间与重名度参考 | 自建：① 各地公安历年新生儿热名榜（佛山/杭州/惠州等公开新闻稿）② 母婴平台热名字榜做频率参考 ③ 人工标注意象标签（美学类目词表自建，2-3 人天） | ✅ 自建，无版权风险 |
| 5 | 粤语 jyutping 映射 | 方言谐音检测 | 开源 `rime-jyutping` / `canfd` 词表；或 HK 字库资料 | ✅ 开源 |
| 6 | 川渝/吴/闽/客 谐音词表 | 方言检测（二期覆盖） | 无现成系统数据 → 自建"方言同音/近音歧义词表"（先只做负面词：如川渝 "史/死" 类），每方言 200-500 条起 | 自建，1-2 人天/方言 |
| 7 | 英语近似负面词表 | 跨文化检测 | 自建（Shiting/Yu/Urinus 类痛点词），200-300 条 + 拼音-英文音近规则 | 自建 |
| 8 | 不雅谐音/贬义组合词表 | 谐音过滤 | 自建 + 参考"姓名谐音翻车"公开盘点文（泉州网实测、知乎盘点），≥500 条 | 自建 |
| 9 | **典籍语料**：全唐诗（≈4.9 万首）、全宋词、诗经、楚辞、论语 | 出处校验索引 | 开源：chinese-poetry（GitHub，Apache/MIT，最全中文古诗数据库，含作者/篇目/段落） | ✅ 开源 |
| 10 | 典籍索引结构 | 三元组校验 | 基于 #9 建 SQLite/JSON 索引：`(作者, 篇名, 句)` → 倒排 `字→quotes`；LLM 的 quoteRef 必须命中此索引 | 自建，1-1.5 人天 |
| 11 | 农历/干支（仅展示属相，不做宜忌） | 可选生辰的民俗展示 | 开源 `lunar-javascript` / `lunar-python`（MIT） | ✅ 开源。**注意：属相仅作文化元素展示，禁做吉凶判断** |

> ⚠️ 不接公安重名查询 API（无公开 API + 频控）；结果页放"去官方查重名"指引（zwfw.mps.gov.cn / 粤省事等），作为差异化卖点而非数据依赖。

---

## 五、过滤流水线实现要点（P0）

```
输入/输出双侧过滤，服务端为主、前端预过滤为辅：

1) 红线词（正则 + 词表，UI 文案与 LLM 输出分开两份词表维护，database/redline-ui.json / redline-llm.json）
   llm 表：吉|凶|数理|三才|五格|命格|命局|喜用神|日主|五行缺|补缺|卦象|宜忌|冲克|运势|打分|评分|总分|评级|星级|测算|算命|占卜|改运|化解|招财|克父|克母|犯太岁|开光|灵符|转运|注定
   命中 → 丢弃该候选 → 重生成 → 记 block_log
2) 白名单复核：候选名每个字 ∈ 通用规范汉字表白名单，且 ∉ avoidChars
3) 出处校验：quoteRef → 语料索引回查 (作者,篇名,句) 全中才返回 quote；否则 quote=null（文案改为不引用）
4) 谐音：普通话全拼/音近匹配不雅词表 → 粤 jyutping 全串匹配 → 英语近似（拼音转写 + 编辑距离 ≤1 的负面词）
   命中 → 标 checks 对应项 warn/fail；fail 则丢弃重生成
5) msgSecCheck：候选名 + 寓意文案送检（云调用 security.msgSecCheck），用户输入（wishes/评论）同样送检
6) 免责与 AI 标识由前端固定组件渲染（aigc-banner / disclaimer），不依赖 LLM 输出
```

**前端 UI 红线（code review checklist）**：全部页面文案禁出现第 1 条词表任何词；"匹配度/重名度参考/命名检测报告"为唯一允许的量化措辞；任何"总分/星级"组件禁入。

---

## 六、埋点事件字典（tracker.js，上报云开发统计或自建 events 集合）

| 事件 | 参数 | 用途 |
|------|------|------|
| `enter` | `scene`（搜索/分享/扫码） | 渠道占比 |
| `input_submit` | `has_styles`, `has_constraints` | 表单完成率 |
| `generate_success` | `jobId`, `latency_ms`, `degraded`, `source` | 成功率/延迟 |
| `generate_fail` | `stage`, `code` | 兜底监控 |
| `candidate_view` | `candidateId` | 详情转化 |
| `collect` | `candidateId`, `batch_index` | **WNKU 口径** |
| `vote_invite` | `roomId`, `candidate_count` | 投票邀请率（Gate 2） |
| `vote_cast` | `roomId`, `voterKey`（匿名） | 参与度 |
| `poster_save` | `template` | 海报保存率 |
| `report_share` | `type`（poster/manual） | 分享率 |
| `ad_batch` | `placement` | 激励视频转化 |
| `pay_success` | `sku`, `env`, `price_fen` | 付费转化/ARPPU |
| `compliance_block` | `stage` | 合规拦截率元指标（目标 100% 拦截） |
| `audit_status` | `result`（提审后人工记录） | 审核状态 |

看板周报只看 7 个数：WNKU / 首次生成完成率 / 海报分享率+投票邀请率 / K 值 / 付费转化+ARPPU / 违规拦截率+出处校验率 / 审核状态。

---

## 七、提审材料 Checklist（封版前逐项打勾）

**A. 主体与资质**
- [ ] 个体工商户执照到手；小程序主体为个体户；微信认证完成（¥300/年）
- [ ] 云开发环境已创建；如走云开发 AI 路线：环境有效期 ≥3 个月后开具「深度合成服务在用证明」
- [ ] 如走第三方 LLM：厂商《算法备案》截图 + **含算法名称/应用场景/备案编号的合作协议**已归档
- [ ] 服务类目：「工具 – 信息查询」或「资讯 – 信息资讯服务」（无"取名"类目，勿写"算命/取名"关键词）

**B. 隐私（MP 后台 → 用户隐私保护指引，按实际勾选，未勾选接口不可用）**
- [ ] 勾选「相册（仅写入）」——海报保存依赖
- [ ] 勾选实际收集项：选填的出生日期、期望文本；**不勾选即不采集**
- [ ] 生辰输入前单独弹窗授权（默认不勾选同意）
- [ ] 「删除我的全部数据」自助入口可用（15.3.9）
- [ ] 隐私协议含：用途、存储期限（生辰 ≤180 天或即时哈希）、删除方式、监护人同意声明
- [ ] 代码自查：拒绝授权后主流程完整可用（15.1.3.2），无任何"拒绝即退出"路径

**C. 内容合规**
- [ ] 全站文案 grep 红线词表 0 命中（含 UI 与 LLM 输出两份词表）
- [ ] AI 生成横幅：生成页顶部固定展示「内容由 AI 生成，仅供文化参考」，不可关闭、非角落小字
- [ ] 免责声明覆盖：首页/结果页/详情页/海报（分享出去的图上也带）
- [ ] 海报字段白名单：仅 名字+拼音+典故+寓意+寄语；无生辰/父母姓名/头像/ID（15.2.1）
- [ ] 图片元数据 AIGC 隐式标识（canvas 导出时写入 PNG tEXt 字段）
- [ ] 免费、无诱导分享（3.2.1：不做"转发解锁"，只做内容型分享与激励视频）

**D. 技术项**
- [ ] LLM API Key 仅存云函数环境变量；前端无任何密钥
- [ ] 虚拟支付：全端走 `wx.requestVirtualPayment`；查单补发（reconcile）上线
- [ ] 生成成功率压测 ≥98%；首字 <2s；95 分位 ≤15s
- [ ] 埋点全量上报验证；WNKU 口径与 collect 事件一致

**E. 提审策略**
- [ ] 首提用最小壳验证类目与话术口径（最多硬提 2 次；第 2 次被拒触发 Gate 0 掉头评审）
- [ ] 驳回预案：话术类 → 24h 全站文案整改；类目类 → 改挂资讯类目重提；均记录留存

---

## 八、两周启动排期（对齐路线图 S1）

| 周 | 开发 | 数据/合规（并行） |
|----|------|--------------------|
| W1 | 工程骨架、6 页面静态版、埋点、生成云函数流水线（含降级） | **字库与语料落地（上表 #1-#10）**；个体户注册提交；LLM 厂商发函；prompt v1 联调 |
| W2 | 规则引擎精调（平仄/笔画/字频）、过滤流水线全链路、共选房间、支付接入 | 粤语/英语谐音词表完成；隐私指引字段定稿；免责/AI 横幅组件验收 |
| W3 | 名字卡片 canvas 导出（含 AIGC 元数据）、说明书长图、看板 | 内测：违规拦截率 100% 验证、生成质量抽检（50 例人工评审） |
| W4 | 性能、降级演练、封版 → 最小壳试审 | 提审 Checklist 全项打勾 → 提审 |

---

> 交接完成定义（DoD）：开发拿着本包可 ①搭建工程 ②写出全部云函数与流水线 ③落地词库 ④通过提审 Checklist。任何一项材料缺失，先回到本包对应章节补齐。
