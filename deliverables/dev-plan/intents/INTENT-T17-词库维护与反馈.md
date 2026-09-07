# INTENT-T17：词库维护通道与反馈闭环

## 1. 背景与目标
词库是活的。目标：**不发布新版本即可更新禁用词/谐音库/方言库/语料索引，用户反馈的解析错误能回流到词库与 prompt 迭代**。

## 2. 范围
**做**：admin 云函数（词库热更新）、database 版本化加载、feedback 查看与调优记录流程。
**不做**：自建 Web 后台（用云开发控制台）；自动化 prompt 调优。

## 3. 输入
- PRD M10-1/10-2
- 交接包 admin 云函数定位（控制台权限，不暴露）、feedback schema
- T05 的词库加载方式（需改造为可热更）

## 4. 产出
```
cloudfunctions/admin/index.js            # action: updateDict / reloadCache / listFeedback（仅控制台/云函数调用）
cloudfunctions/generate/lib/dict-store.js # 词库统一加载：云数据库 dict 集合优先，database/ JSON 为出厂兜底
database/scripts/publish-dict.js         # 本地 JSON → 云数据库 dict 集合发布（带版本号与 diff 预览）
docs/dict-maintenance.md                 # 词库维护 SOP（谁改、怎么验、怎么回滚）
```

## 5. 实现要点
- dict 集合结构：`{key:'redline-llm'|'redline-ui'|'homophone-indecent'|..., version, items, updatedAt}`；dict-store 启动加载并内存缓存，admin.reloadCache 触发失效；**出厂 JSON 永远保留作兜底**（云数据库异常时服务不降级）。
- 词库更新 SOP：本地改 JSON → verify.js 自检 → publish-dict.js diff 预览 → 发布 → 用回归用例（mock LLM 输出）验证拦截 → 记录版本。
- feedback 闭环：详情页上报 → admin.listFeedback 按 type 分组 → 每周 review → 案例进 prompt few-shot 或词库修正 → 在 feedback 文档标 resolved；candidates.reportFlagged 用于统计 bad case 率。
- prompt 调优记录文档：每次修改 prompt vN 留 diff 与回归用例结果（50 例抽检集）。

## 6. 验收标准
- [ ] 不改代码发布新红线词：云数据库更新后 ≤5 分钟新词生效（T05 mock 用例验证）
- [ ] 云数据库词库损坏/清空时自动回退出厂 JSON，服务不中断
- [ ] feedback 四类 type 均有样例走通"上报→查看→修正→resolved"全流程（PRD 10-2）
- [ ] dict 每次发布带版本号且可回滚；SOP 文档评审通过

## 7. 依赖与风险
- 依赖：T05（词库消费方改造）、T08（反馈入口）。
- 风险：热更词库与出厂版本漂移 → publish 脚本强制 diff 审阅。

## 8. 预估人天
1.5
