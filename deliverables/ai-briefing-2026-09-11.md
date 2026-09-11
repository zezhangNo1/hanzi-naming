# AI 工具交接简报（2026-09-11）

> 用途：把本项目交给任何 AI 编程工具（Cursor / Copilot / Claude / CodeBuddy 等）继续开发时，
> 将本文件全文粘贴给对方作为上下文，再附上具体任务的「任务指令」段落即可。

---

## 一、项目是什么（30 秒版）

「汉字美学·取名工具」——微信原生小程序 + 微信云开发（CloudBase），去玄学化定位：
只用可验证维度（字义/音律/典籍出处/重名度/谐音）生成宝宝名，LLM 生成 + 规则引擎兜底。

- 目录：`miniprogram/`（前端页面）+ `cloudfunctions/`（generate/user/vote/order/admin 云函数）+ `database/`（数据源）+ `scripts/e2e/`（本地测试）
- 云环境：cloud1-7g7dev8ec78ed7b5；AppID wx9fa9820c3550351b
- 当前进度：B1-B3 全部完成（引擎 v5 + LLM 链路 + 五道过滤器 + 603 字字池），代码已全部提交推送（GitHub main）

## 二、铁律（任何 AI 改代码前必须知道，违反必出线上事故）

1. **数据双份**：`database/*.json` 是源，`cloudfunctions/generate/data/` 是云函数打包副本。
   改任何数据 JSON 后必须 `cp` 同步两份并 `diff` 校验一致。
2. **引擎版本号**：任何影响生成输出的改动（引擎/字池/prompt/参数），必须把
   `cloudfunctions/generate/lib/cache.js` 里的 `ENGINE_VERSION` 递增（当前 `v5-distinct-20260908`），
   它参与缓存 hash，否则同参数请求永远命中旧缓存。
3. **部署**：云函数改动需在微信开发者工具右键对应函数目录 →「上传并部署：云端安装依赖」；
   或本地 `npm install --production` 后用「上传并部署：所有文件」（本项目两个主函数的
   node_modules 已在本地装好）。免费环境偶发 Node16 框架冷启动崩溃（145/0 code exit），
   重试即可，与代码无关。
4. **LLM 密钥**：只读 `process.env.LLM_API_KEY / LLM_BASE_URL / LLM_MODEL`（opencode zen 网关，
   `https://opencode.ai/zen/v1` + `deepseek-v4-flash-free`），严禁写死在代码或 config.json。
   LLM 失败必须静默回退规则引擎（`degraded: true`），前端无感。
5. **输出红线**：引擎/LLM 输出的候选对象不得携带任何分值/星级/内部过渡字段（score、quoteRef 等）；
   候选 schema 见 `cloudfunctions/generate/lib/engine/generate.js` 的 buildCandidate。
6. **WXML 不支持函数调用绑定**：选中态用对象映射查表 `{{selectedMap[item.key]}}`。
7. **`cloud.getWXContext()` 只能在请求处理函数内调用**，模块顶层调用拿不到 OPENID。
8. **本地测试**：`NODE_PATH=scripts/e2e/node_modules node scripts/e2e/run-e2e.js`（14 断言）、
   `test-b3.js`（24）、`test-qa-b3.js`（31）、`test-quality.js`（34）——改动后四套必须全绿。
   `scripts/e2e/node_modules/wx-server-sdk` 是本地 mock，禁止用于生产代码。
9. **git**：monorepo 根在 `small-wechat/`（.git 在根），GitHub 远程是 hanzi-naming 仓库；
   push 失败（SSL 断连）重试一次即可。禁止提交 node_modules。

## 三、当前待办清单（按优先级）

### P0 —— 云端收尾验证（人工操作，不需要 AI 写代码）
上一轮环境崩溃（平台 Node16 框架 bug，非代码问题）后的收尾，逐项打勾：
- [ ] `generate`、`user` 两个云函数已完成「删除重建 + 部署最新代码」（user 之前还是 Hello World 模板）
- [ ] 控制台测试：user `{"action":"ping"}` 返回 `{"code":0}`；generate `{"action":"poll","jobId":""}` 返回 `{"code":1001}`
- [ ] generate 环境变量已配（3 个 LLM 变量 + 超时 60s）
- [ ] 小程序「换一批」→ name_jobs 最新记录 `llmUsed: true`、结果页「规则模式」横幅消失、名字带典籍出处

### P1 —— LLM 效果验证与灰度
- [ ] 真机生成 5-10 批，对比规则引擎结果：文采、出处正确性（引文必须是真实典籍）
- [ ] 观察 name_jobs 的 `llmUsed / attemptCount / degraded` 与 block_log 的 stage 分布
- [ ] 若 LLM 失败率高：看 generate 日志 `[llm]` 行（401=密钥、404=URL 路径、超时=网关慢）

### P2 —— 下一批次开发（B4 前端体验）
- [ ] **T08 详情报告页**：单个名字的完整报告（逐字释义/音律分析/典籍出处/重名度/谐音检查结果），
  数据已具备（candidates.checks + quote），缺页面
- [ ] **T12 命名说明书**：选名后生成 PDF/长图版命名说明
- [ ] **T09 选名夹完善** + **T10 家人共选**（投票）
- [ ] 粤语 jyutping 谐音检测（`lib/filter/homophone.js` 内有 TODO B3.1，需内置粤拼映射表）
- [ ] 规则引擎 129 个新增字的通用占位释义（「人名常用字，寓意美好」）替换为真实释义

### P3 —— 提审前清理
- [ ] `cloudfunctions/generate/index.js` 里 5000 错误响应附带 err.stack 的调试代码移除
- [ ] 隐私协议/用户协议页接入（微信审核要求）
- [ ] 类目与资质自查（起名类目敏感：去玄学化文案保留）

## 四、任务指令（直接复制给其他 AI 工具）

### 任务 A：详情报告页（推荐首选，价值最大）
```
你在开发一个微信原生小程序「汉字美学·取名工具」（+微信云开发）。项目在
/Users/karl/Documents/workspaceMoney/small-wechat/hanzi-naming，先阅读
deliverables/dev-plan/intents/INTENT-T08-详情报告.md 和 docs/ 下相关文档了解约定。

任务：实现名字详情报告页 pages/detail/。
数据源：candidates 集合文档（字段 schema 参考 cloudfunctions/generate/lib/engine/generate.js
的 buildCandidate 函数），入口是结果页 pages/result/ 每个候选的点击事件（跳转带 candidateId），
用 generate 云函数新增 action:"getDetail" 按 candidateId+openid 查询返回。

页面内容：名字大字展示 + 拼音/声调、逐字卡片（strokes/meaning/imageryTags）、
四维分析条（音律 surnameFit/笔画 writeCost/重名度 duplicateLevel/谐音 checks.*）、
典籍出处区块（quote 有值才显示：author/title/sentence，来自真实语料，禁止展示 null）、
收藏按钮（调 user 云函数 collect action，已预留）。

约束：wxss 沿用 app.wxss 的宣纸色板（#F7F4EC 底/墨色字/朱砂点缀）；禁止命理测算类文案；
新页面要在 app.json 注册；改动后跑 NODE_PATH=scripts/e2e/node_modules node scripts/e2e/run-e2e.js
确认 14/14 通过；禁止提交 node_modules；commit 信息用中文描述。
```

### 任务 B：粤语谐音检测（小而美，半天量）
```
项目同上。任务：在 cloudfunctions/generate/lib/filter/homophone.js 中实现 homophoneDialect
（当前恒为 null，代码内有 TODO B3.1 标注）。
方案：新建 lib/filter/jyutping-map.js，内置 6003 字常用字的「字→粤语 jyutping」映射
（可优先覆盖 database/name-pool.json 的 603 字 + 常见姓氏），数据需真实准确（参考粤拼方案 Jyutping）。
检测逻辑：整名（不含姓）jyutping 连串命中 lib/filter/homophone-blocklist.js 的粤语敏感组
（需新增 15-25 个粤语谐音敏感词条，如 冇/撚/鸠 类不雅音组）→ fail；编辑距离 1 → warn 保留。
fail 剔除并记 block_log（stage:'homophone'），通过后写回 checks.homophoneDialect={yue:'pass',jyutping:'...'}。
注意数据双份约定（改 JSON 必须 cp database/ 与 cloudfunctions/generate/data/ 两份）、
缓存版本号递增、四套测试全绿（NODE_PATH=scripts/e2e/node_modules 前缀运行）。
新增单测：张智凛（粤音近「支凛」类）等用例自拟，保证至少 1 fail + 1 warn + 1 pass 用例。
```

### 任务 C：新增字释义精修（纯数据工作，适合批量）
```
项目同上。任务：database/name-pool.json 中 v0.3 扩容新增的 193 字，其 hanzi-core 释义
有约 129 字是通用占位「人名常用字，寓意美好」。逐字替换为真实、具体、≤12 字的人名向释义
（参考《说文》《康熙字典》通行释义，禁止编造出处），并同步双份数据
（database/ 与 cloudfunctions/generate/data/ 的 hanzi-core.json——注意扩容字已在 hanzi-core，
改释义要同步两份 hanzi-core + 一致性 diff 校验）。完成后跑四套测试确认全绿。
```

## 五、给 AI 工具的三条协作约定

1. **先读再改**：任何改动前先读对应 INTENT 文档（deliverables/dev-plan/intents/）和目标文件
2. **改完必测**：四套测试全绿才算完成；数据文件改动必须双份 diff 一致
3. **一次一个任务**：按上面任务独立下达，不要让 AI 一次做多个任务
