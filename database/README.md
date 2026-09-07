# database/ — 本仓库维护的词库与语料数据

> 本目录由 T02（词库落地任务）填充。此处为清单占位与构建脚本说明，数据源依据见
> 交付物《开发交接包》第四节「字库与语料数据源清单」。

## 一、词库文件清单（占位，T02 落地）

| # | 文件（规划名） | 内容 | 数据源 | 状态 |
|---|----------------|------|--------|------|
| 1 | `whitelist-8105.json` | 《通用规范汉字表》8105 字白名单（准入下限） | 教育部公开附件 / 开源镜像 | 占位 |
| 2 | `gb18030-ranges.json` | GB18030-2022 编码范围（上限兜底） | Unicode / 国标公开映射表 | 占位 |
| 3 | `hanzi-meta.json` | 拼音/声调/部首/笔画（音律层、书写层） | pinyin-pro、Unihan（kTotalStrokes） | 占位 |
| 4 | `naming-chars-1200.json` | 取名常用字精选集 + 字频/意象标签 | 热名榜公开新闻稿 + 自建标注 | 占位 |
| 5 | `jyutping-map.json` | 粤语 jyutping 映射（方言谐音检测） | rime-jyutping 等开源词表 | 占位 |
| 6 | `dialect-negative-*.json` | 川渝/吴/闽/客 谐音负面词表（每方言 200-500 条起） | 自建 | 占位 |
| 7 | `english-negative.json` | 英语近似负面词表（200-300 条 + 音近规则） | 自建 | 占位 |
| 8 | `homophone-negative.json` | 不雅谐音/贬义组合词表（≥500 条） | 自建 + 公开盘点 | 占位 |
| 9 | `corpus-index.json` | 典籍语料索引：(作者, 篇名, 句) 倒排 字→quotes | chinese-poetry（开源） | 占位 |
| 10 | `redline-ui.json` | 前端 UI 红线词表（code review 用） | 自建 | 占位 |
| 11 | `redline-llm.json` | LLM 输出红线词表（过滤流水线第 1 层） | 交接包第五节 | 占位 |

> ⚠️ 两份红线词表（UI / LLM 输出）分开维护；全站文案与 LLM 输出均须 grep 0 命中。

## 二、云数据库集合（CloudBase 文档型数据库）

集合不落本目录，于云开发控制台创建；schema 定义见交付包第二节。清单：

`users`、`name_jobs`、`candidates`、`collections`、`votes`、`orders`、`block_log`、`feedback`、`events`

### events 集合 schema（埋点，T15）

```json
{
  "openid": "string（服务端补齐，前端不传）",
  "event": "string（14 事件之一）",
  "params": "object（事件参数，schema 见 miniprogram/utils/tracker.js EVENT_SCHEMAS）",
  "invalid": "boolean（tracker schema 校验缺参标记）",
  "ts": "number（客户端时间戳 ms）",
  "createdAt": "number（服务端写入时间 ms）"
}
```

> 所有集合禁止存出生日期明文超过 180 天；用户侧数据均带 openid（`_openid`）。

## 三、构建脚本说明（占位，T02/T15 实现）

- `scripts/import-lexicon.js`：词库 JSON → 云数据库集合导入（经 admin 云函数）；
- `scripts/weekly-report.js`：周报 7 数查询（WNKU / 首次生成完成率 / 海报分享率 / 投票邀请率 / K 值 / 付费转化+ARPPU / 违规拦截率 + 审核状态），T15 实现。

## 四、红线约束（本目录数据相关）

1. 不接公安重名查询 API（无公开 API + 频控）；重名参考改为结果页官方指引；
2. 属相/农历数据（lunar-javascript，MIT）仅作文化元素展示，禁做吉凶判断；
3. 语料出处索引是 quoteRef 校验的唯一可信来源，LLM 不得凭记忆编造出处。
