# INTENT-T04：generate 云函数生成流水线

## 1. 背景与目标
产品核心。目标：**实现 create/poll 双 action 与 7 步服务端流水线，LLM 在白名单解空间内生成、超时/失败自动降级规则引擎，整体成功率 ≥98%**。

## 2. 范围
**做**：额度校验、白名单解空间筛选、LLM prompt v1、异步任务与轮询、缓存查重、降级兜底、name_jobs/candidates 落库。
**不做**：过滤流水线内部实现（T05，本任务只编排调用）；规则引擎打分细节（T06）。

## 3. 输入
- 交接包 3.1（入出参契约与流水线顺序）、3.2（prompt 草案全文）
- T02 的 hanzi-core/quotes-index；T06 的排序引擎；T05 的 filter 模块
- PRD M2-1/2-2/2-6/2-7/2-8

## 4. 产出
```
cloudfunctions/generate/index.js        # action 路由：create / poll
cloudfunctions/generate/lib/quota.js    # free/ad/paid 三源额度校验与扣减
cloudfunctions/generate/lib/solver.js   # 白名单解空间：姓氏适配字集→styles 加权→避讳过滤→60-100 字输出
cloudfunctions/generate/lib/prompt.js   # system/user prompt 组装（v1 草案为准）
cloudfunctions/generate/lib/llm.js      # LLM HTTP 调用、12s 超时、JSON 解析与 3 次重试
cloudfunctions/generate/lib/pipeline.js # 7 步编排，调 T05 过滤模块
cloudfunctions/generate/lib/cache.js    # hash(surname+gender+styles+constraints+batch) 查重
cloudfunctions/generate/lib/degrade.js  # 规则引擎降级输出 + 模板文案
```

## 5. 实现要点
- **异步轮询模式**：`create` 只做校验+扣额度+建 name_jobs(status=pending)+触发异步生成（云函数内 Promise 不等结果即返回，或用云函数队列/定时触发器续跑），返回 `{jobId,status:'pending'}`；`poll` 按 jobId 查状态，done 时返回 `{status, candidates[], quota:{freeLeft,adLeft,paidLeft}, degraded}`。
- **流水线顺序（不可变）**：①输入校验（姓氏 1 字）→ ②额度校验（free 2 批 / ad 当日 1 批 / paid 剩余）→ ③solver 产出 60–100 字候选字集（每字附 possible_quotes）→ ④LLM 生成 → ⑤过滤流水线（T05，任一 P0 失败重生成，累计 3 次失败→降级）→ ⑥缓存查重 → ⑦落库 candidates+更新 name_jobs(status/done, candidateIds, degraded, latencyMs)。
- **prompt v1（严格按交接包 3.2）**：system 声明硬规则——①用字仅限提供的候选字集 ②禁一切命理测算词汇 ③典籍只能引用提供的语料片段、禁编造作者篇名原句 ④寓意 ≤30 字、祝福不夸大；输出严格 JSON `{"names":[{"name","pinyin","style","meaning","quoteRef{lang,key}","wishesEcho"}]}`。quoteRef 指向 quotes-index 的 key，服务端回查——**模型不自由发挥出处**。
- 额度不足：`code:2001`（前端弹解锁卡）；降级：`degraded:true`（前端正常展示但打标记）；内容安全全失败：`code:3002`。
- 环境变量：LLM_API_KEY/LLM_BASE_URL/LLM_MODEL/FREE_BATCH_LIMIT=2/AD_BATCH_LIMIT=1，只读 `process.env`。
- 缓存命中直接返回既有 candidateIds，但换一批（batch+1）强制新组合；重复批次重名率 <20%。

## 6. 验收标准
- [ ] 输出每个名字的每个字 100% ∈ 白名单且 ∉ avoidChars（脚本抽验 100 批）
- [ ] 结构化字段完整率 ≥95%（PRD M2-2 验收）
- [ ] 95 分位生成时延 ≤15s，LLM 超时 12s 必触发降级且 status 正常 done
- [ ] create→poll 轮询在弱网（3 次失败）下 UI 不卡死
- [ ] free 第 3 批返回 2001；同一入参二次生成命中缓存
- [ ] block_log 与 name_jobs.latencyMs/degraded 字段落库正确

## 7. 依赖与风险
- 依赖：T01、T02（硬依赖 quotes-index）、T05、T06（可先接 stub 再替换）。
- 风险：LLM 结构化输出不稳定 → JSON schema 校验+重试；云函数执行时长限制 → 轮询模式下单次执行控制在 20s 内，必要时拆两段云函数（任务态推进）。

## 8. 预估人天
4
