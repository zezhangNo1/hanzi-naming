# docs/deploy.md — 环境变量与云开发环境配置步骤

> 配套：《开发交接包》第一节/第三节。核心安全原则：**所有密钥只存云函数环境变量，
> 严禁出现在 miniprogram/ 下任何文件**（验收用 grep 复查 `LLM_API_KEY|LLM_BASE_URL|LLM_MODEL`）。

## 一、云开发环境创建

1. 微信开发者工具 → 云开发 → 开通，按「开发/生产分环境」创建两个环境：
   - 开发环境：如 `hanzi-dev-xxxx`
   - 生产环境：如 `hanzi-prod-xxxx`（成本隔离，配额独立）
2. 替换占位：`miniprogram/config/env.js` 中 `CLOUD_ENV: 'CLOUD_ENV_PLACEHOLDER'`
   改为当前所用环境 ID（提审前务必切到生产环境 ID）；
3. 确认 `project.config.json` 的 `cloudfunctionRoot: "cloudfunctions/"`。

## 二、数据库集合初始化

云开发控制台 → 数据库 → 创建集合（权限均为「仅创建者可读写」）：

`users`、`name_jobs`、`candidates`、`collections`、`votes`、`orders`、`block_log`、`feedback`、`events`

> `events` 为埋点集合，只允许云函数写入（user.track），前端不直连。

## 三、云函数环境变量配置（步骤）

每个云函数在「云开发控制台 → 云函数 → 配置 → 环境变量」单独配置：

### generate（必配，密钥所在）

| 变量 | 示例值 | 说明 |
|------|--------|------|
| `LLM_API_KEY` | `sk-xxxxxxxx` | LLM 厂商密钥（**密钥，严禁入库/入前端**） |
| `LLM_BASE_URL` | `https://api.xxx.com/v1` | LLM 接口地址 |
| `LLM_MODEL` | `xxx-model-name` | 模型名 |
| `FREE_BATCH_LIMIT` | `2` | 免费批次上限（服务端真实校验依据） |
| `AD_BATCH_LIMIT` | `1` | 激励视频单日可换批次数上限 |

其余云函数（vote/order/user/admin）当前无需环境变量，预留配置位为空即可。

### 部署云函数

开发者工具 → cloudfunctions 下各目录右键「上传并部署：云端安装依赖」，
共 5 个：`generate`、`vote`、`order`、`user`、`admin`。

## 四、admin 云函数权限收紧（三重保障）

1. `cloudfunctions/admin/config.json` 未声明任何 openapi 前端权限；
2. `admin/index.js` 内置 `context.SOURCE` 检查：来源含 `wx_client`（前端直达）直接拒绝；
3. 控制台 → 云函数 → admin → 权限设置，确认为「仅管理员/云函数可调用」。

## 五、验收自检

- [ ] 开发者工具控制台执行 `wx.cloud.callFunction({name:'user',data:{action:'ping'}})` 返回 `{code:0}`；
- [ ] mock 一个返回 `code:2001` 的分支，前端能走「解锁卡」回调（request.js QUOTA_EXCEEDED 分支）；
- [ ] `grep -rn "LLM_API_KEY\|LLM_BASE_URL\|LLM_MODEL" miniprogram/` 结果为空；
- [ ] `.gitignore` 已排除 `node_modules/`、`.env`、`*.key`（见仓库根 .gitignore）；
- [ ] 真机预览 8 个占位页全部可打开。

## 六、提审前切换清单

1. `project.config.json` 的 `appid` 由 `touristappid` 换为正式 AppID；
2. `config/env.js` 的 `CLOUD_ENV` 切生产环境 ID；
3. 生成云函数环境变量按上表在生产环境重新配置一遍（环境变量不跨环境同步）。
